// momo_sync.js  –  MOMO Links v3.30 GDrive同期モジュール
'use strict';

const SYNC_FILE   = '/momo-works/links/links_data.json';
const SYNC_BAK    = '/momo-works/links/links_data.bak.json';   // 上書き前に退避する一世代バックアップ
const GDRIVE_PY   = 'https://qiqiroon.github.io/momo/lib/momo_gdrive/momo_gdrive.py';
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js';
const GSI_URL     = 'https://accounts.google.com/gsi/client';
const CLIENT_ID   = '1053350886212-q87r5msugnqbb3saoq1fh3uj3t648hcg.apps.googleusercontent.com';
const GDRIVE_SCOPE= 'https://www.googleapis.com/auth/drive.file';
const YEAR_SEC    = 365 * 24 * 3600;
const DAY_SEC     = 24 * 3600;

const LS_ENABLED   = 'gdrive_sync_enabled';
const LS_LAST_SYNC = 'gdrive_last_sync';
const LS_SYNC_LOG  = 'gdrive_sync_log';        // 案件②段2: 同期ログ(JSON配列・最新50件)
const SYNC_LOG_MAX = 50;
const LS_EVER_SIGNED = 'gdrive_ever_signed';   // 一度でもサインインしたか(⚠表示判定)
const LS_REMOTE_MOD  = 'gdrive_remote_modified';  // 段3: 最後に同期成功したときのリモートmodifiedTime(ISO)
const LS_ACCOUNT_HINT= 'gdrive_account_hint';     // 段4: 自分のメール(silent取得時のhint用・追加権限不要でdrive/about?fields=userから取得)

// ── 状態 ──
let _pyodide  = null;
let _loading  = false;
let _syncing  = false;
let _gToken   = null;   // 手動トリガー時にキャッシュするGSIアクセストークン
let _gTokenExp= 0;      // トークン有効期限（Unix秒）

// ── 多言語ヘルパー（本体 index.html の t() を利用。未定義時はキーをそのまま返す）──
function _t(key,...args){ return (typeof t==='function') ? t(key,...args) : key; }

// ── localStorage ヘルパー ──
function syncEnabled(){ try{return localStorage.getItem(LS_ENABLED)==='true';}catch{return false;} }
function setSyncEnabled(v){
  try{localStorage.setItem(LS_ENABLED,v?'true':'false');}catch{}
  // v4.32: ONにした時点でサインイン部品(GSI)を先読み→初回同期タップでアカウント選択が間に合うように
  if(v && location.protocol!=='file:'){ try{ _loadScript(GSI_URL); }catch{} }
  if(typeof updateSyncStatus==='function') updateSyncStatus();   // v4.38(②): トグルで状態表示を更新(オフ→⚠B/iOS等)
}
// v4.48: 同期ONのユーザーは「windowload を待たず即GSI先読み」。ハードリロード直後の手動更新が gsi-not-ready にならないように。
try{ if(syncEnabled() && location.protocol!=='file:') _loadScript(GSI_URL).catch(()=>{}); }catch{}
function lastSyncTs(){ try{return parseInt(localStorage.getItem(LS_LAST_SYNC)||'0');}catch{return 0;} }
function saveLastSync(){ try{localStorage.setItem(LS_LAST_SYNC,String(Math.floor(Date.now()/1000)));}catch{} }

// ── 案件②段2: 同期ログ(端末内・最新SYNC_LOG_MAX件・FIFO) ──
function _getSyncLog(){ try{return JSON.parse(localStorage.getItem(LS_SYNC_LOG)||'[]');}catch{return [];} }
function _logSync(ev, ok, msg){
  try{
    const arr=_getSyncLog();
    arr.push({ts:Math.floor(Date.now()/1000), ev, ok:!!ok, msg:msg||''});
    while(arr.length>SYNC_LOG_MAX) arr.shift();
    localStorage.setItem(LS_SYNC_LOG, JSON.stringify(arr));
  }catch(e){}
  if(typeof updateSyncStatus==='function') updateSyncStatus();
}
function getSyncLogForView(){ return _getSyncLog(); }   // index.html から参照
function clearSyncLog(){ try{localStorage.removeItem(LS_SYNC_LOG);}catch{} if(typeof updateSyncStatus==='function') updateSyncStatus(); }
function _everSigned(){ try{return localStorage.getItem(LS_EVER_SIGNED)==='1';}catch{return false;} }
function _markEverSigned(){ try{localStorage.setItem(LS_EVER_SIGNED,'1');}catch{} }

// 段3: リモート更新時刻(ISO)を保存/取得。同期完了時に更新→次回チェックの基準。
function _savedRemoteMod(){ try{return localStorage.getItem(LS_REMOTE_MOD)||'';}catch{return '';} }
function _setRemoteMod(iso){ try{localStorage.setItem(LS_REMOTE_MOD, iso||'');}catch{} }

// 段4: 「どのアカウントを使うか」のhint(メール)を保存/取得/クリア。silent試行時にGoogleに渡し、複数アカウント勢でも選択画面なしで通る。
function _savedHint(){ try{return localStorage.getItem(LS_ACCOUNT_HINT)||'';}catch{return '';} }
function _setHint(email){ try{ if(email) localStorage.setItem(LS_ACCOUNT_HINT,email); else localStorage.removeItem(LS_ACCOUNT_HINT); }catch{} }
// 段4: Drive APIから自分のメールを取得して保存(追加権限不要・drive.file scope内で /drive/v3/about にアクセス可)
async function _fetchAndSaveHint(){
  if(!_gToken) return;
  try{
    const r=await fetch('https://www.googleapis.com/drive/v3/about?fields=user',{headers:{Authorization:`Bearer ${_gToken}`}});
    if(!r.ok){ _logSync('hint',false,'http-'+r.status); return; }
    const j=await r.json();
    const email=(j&&j.user&&j.user.emailAddress)||'';
    if(email){ _setHint(email); _logSync('hint',true,email); }
  }catch(e){ _logSync('hint',false,(e.message||String(e))); }
}

// 段3: ローカルに「未送信の編集」があるか。前回同期成功時刻より新しい updated_at を持つリンクがあるか。
function _hasLocalChanges(){
  try{
    const last=lastSyncTs();
    const links=JSON.parse(localStorage.getItem('links_v2')||'[]');
    for(const l of links){ if((l.updated_at||0) > last) return true; }
    const meta=JSON.parse(localStorage.getItem('tagmeta_v2')||'{}');
    for(const k in meta){ if((meta[k]&&meta[k].t||0) > last) return true; }
    return false;
  }catch(e){ return false; }
}

// 段3: リモートのファイル更新時刻だけを軽く取得(中身は読まない)。前回値と比較し変化を返す。
//   返り値: 'changed' / 'unchanged' / 'no-file' / 'error'
async function _checkRemoteChanged(){
  try{
    await loadDeps();
    await _gConnect();
    const exists=await _gExists(SYNC_FILE);
    if(!exists) return 'no-file';
    window._sp=SYNC_FILE;
    const fileId=await _pyodide.runPythonAsync('await gdrive.resolve_path(js.window._sp)');
    const token=_pyodide.runPython('gdrive._token');
    const resp=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,
      {headers:{Authorization:`Bearer ${token}`}});
    if(!resp.ok) return 'error';
    const j=await resp.json();
    const cur=(j&&j.modifiedTime)||'';
    const prev=_savedRemoteMod();
    if(!prev) return 'changed';   // 基準が未保存なら念のため同期
    return (cur===prev)?'unchanged':'changed';
  }catch(e){ return 'error'; }
}

// ── スクリプト動的ロード ──
function _loadScript(src){
  return new Promise((res,rej)=>{
    if(document.querySelector(`script[src="${src}"]`)){res();return;}
    const s=document.createElement('script');
    s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}

// ── Pyodide + GSI + momo_gdrive.py の遅延ロード ──
async function loadDeps(){
  if(_pyodide) return;
  if(_loading){ while(_loading) await new Promise(r=>setTimeout(r,100)); return; }
  _loading=true;
  try{
    await Promise.all([_loadScript(GSI_URL), _loadScript(PYODIDE_URL)]);
    _pyodide = await globalThis.loadPyodide();
    const resp = await fetch(GDRIVE_PY);
    if(!resp.ok) throw new Error(_t('syncModuleLoadError'));
    _pyodide.runPython(await resp.text());
    _pyodide.runPython('import js');
  }finally{
    _loading=false;
  }
}

// ── Pyodide 経由の GDrive 操作 ──
async function _gConnect(){
  await _pyodide.runPythonAsync('gdrive = MomoGDrive()');
  const now=Math.floor(Date.now()/1000);
  if(_gToken && now<_gTokenExp){
    // 手動トリガーで取得済みのトークンを注入（モバイル対応）
    window._gtok=_gToken;
    _pyodide.runPython('gdrive._token = js.window._gtok');
  }else{
    await _pyodide.runPythonAsync('await gdrive.connect()');
  }
}

async function _gExists(path){
  window._sp=path;
  return await _pyodide.runPythonAsync('await gdrive.exists(js.window._sp)');
}

async function _gReadJson(path){
  window._sp=path;
  const fileId=await _pyodide.runPythonAsync('await gdrive.resolve_path(js.window._sp)');
  const token=_pyodide.runPython('gdrive._token');
  const resp=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {headers:{Authorization:`Bearer ${token}`}});
  if(!resp.ok) throw new Error(_t('syncDriveApiError',resp.status));
  return await resp.json();
}

async function _gWriteText(path,content){
  const token=_pyodide.runPython('gdrive._token');
  const name=path.split('/').pop();
  const boundary='momo_boundary_xXx';

  window._sp=path;
  let fileId=null;
  try{ fileId=await _pyodide.runPythonAsync('await gdrive.resolve_path(js.window._sp)'); }catch(e){}

  let url,method,meta;
  if(fileId){
    url=`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id`;
    method='PATCH';
    meta=JSON.stringify({name});
  }else{
    const parentPath='/'+path.replace(/^\//,'').split('/').slice(0,-1).join('/');
    window._pp=parentPath;
    const parentId=await _pyodide.runPythonAsync('await gdrive.mkdir(js.window._pp)');
    url='https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
    method='POST';
    meta=JSON.stringify({name,parents:[parentId]});
  }

  const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--`;
  const resp=await fetch(url,{method,headers:{'Authorization':`Bearer ${token}`,'Content-Type':`multipart/related; boundary=${boundary}`},body});
  if(!resp.ok) throw new Error(_t('syncDriveApiError',resp.status)+': '+await resp.text());
  await _pyodide.runPythonAsync('gdrive.cache.clear()');
}

// ── 整合性チェック（チェックサム）＋バックアップ ──
// データ本体(links/tags/tagMeta)を一定の順で文字列化してから指紋を取る（読み書きで同一結果になる）
function _canonical(d){ return JSON.stringify({links:d.links||[],tags:d.tags||[],tagMeta:d.tagMeta||{}}); }
async function _sha256(str){
  try{
    const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }catch(e){ return null; }   // 安全でない環境等でハッシュ不可なら指紋なしで運用
}
// 指紋＋件数を同梱して書き込む
async function _writeSync(path,data){
  const obj={links:data.links||[],tags:data.tags||[],tagMeta:data.tagMeta||{}};
  const sum=await _sha256(_canonical(obj));
  if(sum) obj._checksum=sum;
  obj._count={links:obj.links.length,tags:obj.tags.length};
  await _gWriteText(path, JSON.stringify(obj));
}
// 読み込み＋指紋照合。指紋の無い旧式ファイルは ok 扱い（後方互換）
async function _readVerified(path){
  const obj=await _gReadJson(path);
  if(obj && obj._checksum){
    const got=await _sha256(_canonical(obj));
    if(got && got!==obj._checksum) return {obj,ok:false};
  }
  return {obj,ok:true};
}
// 上書き前に現行を退避(backup)→本体を書く→書いた直後に読み返して照合
async function _commitRemote(data, prevRemote){
  if(prevRemote){ try{ await _writeSync(SYNC_BAK, prevRemote); }catch(e){ console.warn('[MomoSync] backup failed', e); } }
  await _writeSync(SYNC_FILE, data);
  const v=await _readVerified(SYNC_FILE);          // 書き込み後の確認
  if(!v.ok) throw new Error(_t('syncWriteVerifyFail'));
}

// 案件②段2: AM/PM 12時間制(3言語統一)。今日なら時刻のみ、過去日なら "月/日 H:MM AM/PM"
function _fmtTime12(unixSec){
  try{
    const d=new Date(unixSec*1000), now=new Date();
    let h=d.getHours(); const m=d.getMinutes();
    const ap=h>=12?'PM':'AM'; h=h%12; if(h===0) h=12;
    const mm=(m<10?'0':'')+m;
    const sameDay=d.toDateString()===now.toDateString();
    if(sameDay) return h+':'+mm+' '+ap;
    return (d.getMonth()+1)+'/'+d.getDate()+' '+h+':'+mm+' '+ap;
  }catch(e){ return ''; }
}

// ── 状態表示 兼 手動更新ボタン（案件②）──
//   状態: 'manual'/'auto'(=更新中・オレンジ＋回転) / 'idle'(=手動更新・通常) / 'needed'(=更新が必要・アンバー＋⚠A) / 'warnB'(=同期オフ・⚠B・iOSのみ) / 'hide'
function _isIOS(){
  try{ return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1); }catch(e){ return false; }
}
let _syncNeeded=false;   // 画面なしサインイン失敗等で手動サインインが要る状態
function _getStatusEl(){
  let el=document.getElementById('syncIndicator');
  if(!el){
    el=document.createElement('span'); el.id='syncIndicator';
    el.style.marginRight='8px';
    const anchor=document.getElementById('btnData');   // 「データ管理」ボタンの前に差し込む（ヘッダー制御行に収める）
    if(anchor&&anchor.parentNode) anchor.parentNode.insertBefore(el,anchor);
    else (document.querySelector('header')||document.body).appendChild(el);
  }
  return el;
}
function _renderStatus(state){
  const el=_getStatusEl();
  if(state==='hide'){ el.style.display='none'; return; }
  el.style.display='inline-flex';
  const spinning=(state==='manual'||state==='auto');
  let text='', warn='';
  if(state==='manual'||state==='auto') text=_t(state==='auto'?'syncAuto':'syncManual');
  else if(state==='idle') text=_t('syncManual');
  else if(state==='needed'){ text=_t('syncNeeded'); warn='A'; }
  else if(state==='warnB') warn='B';
  // 更新アイコンはSVG（フォント字形由来の縦棒等を避ける）。更新中はSVGだけ回転。
  const svg=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${spinning?'spin':''}"><path d="M20 11A8.1 8.1 0 0 0 4.5 9M4 5v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>`;
  let html='';
  if(state!=='warnB') html+=`<span class="sync-main"><span class="sync-ic">${svg}</span><span class="sync-tx">${text}</span></span>`;
  if(warn) html+=`<span class="sync-warn" title="${_t(warn==='A'?'syncWarnTitleA':'syncWarnTitleB')}">⚠️</span>`;
  // 案件②段2: 安静/必要状態のときに「前回 HH:MM AM/PM」を小さく併記(更新中は出さない＝邪魔しない)
  if(state==='idle'||state==='needed'){
    const ts=lastSyncTs();
    if(ts){ html+=`<span class="sync-last">${_t('syncLastPrefix')} ${_fmtTime12(ts)}</span>`; }
  }
  el.innerHTML=html;
  el.className='sync-status sync-'+state;
  const main=el.querySelector('.sync-main');
  if(main && (state==='idle'||state==='needed')) main.onclick=()=>runSyncManual();   // 文字・アイコンどちら押下でも手動更新
  const w=el.querySelector('.sync-warn');
  if(w) w.onclick=(e)=>{ e.stopPropagation(); openSyncWarn(warn); };
}
// 非同期中の通常状態を判定して描画（load/トグル/同期完了時に呼ぶ）
function updateSyncStatus(){
  if(location.protocol==='file:'){ _renderStatus('hide'); return; }
  if(_syncing) return;                          // 更新中は runSync が描画
  if(!syncEnabled()){ _renderStatus(_isIOS()?'warnB':'hide'); return; }   // 同期オフ: iOSのみ⚠B
  _renderStatus(_syncNeeded?'needed':'idle');
}
// ⚠押下→データ管理のGDrive同期タブで該当警告を表示（index.html側 openSyncHelp）
function openSyncWarn(which){ if(typeof openSyncHelp==='function') openSyncHelp(which); }

// ── ページ離脱抑止 ──
let _unloadHandler=null;
function _lockUnload(){
  _unloadHandler=e=>{e.preventDefault();e.returnValue='';};
  window.addEventListener('beforeunload',_unloadHandler);
}
function _unlockUnload(){
  if(_unloadHandler){ window.removeEventListener('beforeunload',_unloadHandler); _unloadHandler=null; }
}

// ── マージロジック（Last Write Wins by updated_at）──
function _mergeLinks(local,remote){
  const map={};
  [...local,...remote].forEach(l=>{
    const ex=map[l.id];
    if(!ex||(l.updated_at||0)>(ex.updated_at||0)) map[l.id]={...l};
  });
  const now=Math.floor(Date.now()/1000);
  return Object.values(map).filter(l=>!(l.deleted_at&&now-l.deleted_at>YEAR_SEC));
}

// 自浄ゲート: 明らかなゴミ(URL等)はタグとして扱わない
function _isJunkTag(n){
  if(typeof n!=='string') return true;
  const s=n.trim();
  if(!s) return true;
  if(s.includes('://')) return true;
  if(/^(https?|ftp|file):/i.test(s)) return true;
  return false;
}
function _mergeData(loc,rem){
  const links=_mergeLinks(loc.links||[],rem.links||[]);
  // 同期のたびにゴミタグを各リンクから除去（保存先に書く前に毎回掃除）
  links.forEach(l=>{ if(l.tags) l.tags=l.tags.filter(t=>!_isJunkTag(t)); });
  // タグの削除記録(tombstone)を突き合わせ、削除済み・ゴミを除いた「生きたタグ一覧」を作る
  const meta=(typeof mergeTagMeta==='function')
    ? mergeTagMeta(loc.tagMeta||{}, rem.tagMeta||{})
    : Object.assign({}, loc.tagMeta||{}, rem.tagMeta||{});
  const tags=[...new Set([...(loc.tags||[]),...(rem.tags||[])])]
    .filter(t=>!_isJunkTag(t) && !(meta[t]&&meta[t].del)).sort();
  return{links,tags,tagMeta:meta};
}

// ── ローカルへの適用 ──
function _applyMerged(data){
  if(typeof applyExternalData==='function'){
    applyExternalData(data.links||[],data.tags||[],data.tagMeta||{});
  }else{
    localStorage.setItem('links_v2',JSON.stringify(data.links||[]));
    localStorage.setItem('tags_v2',JSON.stringify(data.tags||[]));
    localStorage.setItem('tagmeta_v2',JSON.stringify(data.tagMeta||{}));
  }
}

function _localSnapshot(){
  return{
    links:JSON.parse(localStorage.getItem('links_v2')||'[]'),
    tags:JSON.parse(localStorage.getItem('tags_v2')||'[]'),
    tagMeta:JSON.parse(localStorage.getItem('tagmeta_v2')||'{}')
  };
}

// ── 案件②段2: 共通トークン取得 ──
//   prompt='none' = 画面なし(silent)サインイン試行(GSIに「絶対UI出すな」と明示)。
//                   Googleのログイン＋過去の許可が生きていれば無音で取れる、無理なら即エラー。
//                   ※v4.45: `prompt:''`はGSIがpopupを試みるケースがあり自動経路で不適切。
//   prompt='select_account' = アカウント選択画面を強制(アカウント変更時)
//   prompt=undefined = ブラウザ既定(通常はconsent or chooserが出る)
function _requestToken(prompt, onSuccess, onFail){
  if(typeof google==='undefined' || !google.accounts){ onFail&&onFail('gsi-not-loaded'); return; }
  const opt={ client_id:CLIENT_ID, scope:GDRIVE_SCOPE,
    callback:(resp)=>{
      if(resp.error){ onFail&&onFail(resp.error); return; }
      _gToken=resp.access_token;
      _gTokenExp=Math.floor(Date.now()/1000)+(resp.expires_in||3600)-60;
      _markEverSigned();
      // 段4: hint未保存ならDriveから自分のメールを取得して保存(次回silent取得で複数アカウント勢でも通る)
      if(!_savedHint()) _fetchAndSaveHint();
      onSuccess&&onSuccess();
    },
    // v4.50(⑥段A修正): ポップアップ阻止/閉鎖等のGSI実装側エラーを確実に受ける受け口。
    //  これが無いと自動経路の silent試行が popup_blocked された時に何も検知できず、
    //  ログにも残らず・バックオフも掛からず・5分ごとに同じ失敗を繰り返す事故が出ていた。
    error_callback:(err)=>{
      const type=(err&&(err.type||err.message))||'popup-error';
      onFail&&onFail(type);
    }
  };
  if(prompt!==undefined) opt.prompt=prompt;
  // 段4: 保存済みhint(メール)があれば渡す→Googleが「このアカウントを使う」と判断し、複数アカウント時もsilent成功率向上
  const hint=_savedHint();
  if(hint) opt.hint=hint;
  const client=google.accounts.oauth2.initTokenClient(opt);
  client.requestAccessToken();
}

// ── 手動同期トリガー（モバイル対応：ユーザー操作直後にGSIトークン取得）──
// ボタンのonclickから直接呼ぶこと。awaitを挟む前にrequestAccessTokenを実行する。
function runSyncManual(){
  if(_syncing) return;
  if(location.protocol==='file:') return;
  // v4.33: データ管理を閉じるのは「実際に同期/サインインへ進む時」だけ。
  //  準備中(GSI未ロード)では閉じない→目の前の「同期」ボタンをもう一度押すだけで済む。
  const _closeModal=()=>{ if(typeof closeDataModal==='function') closeDataModal(); };

  const now=Math.floor(Date.now()/1000);
  if(_gToken&&now<_gTokenExp){
    _closeModal(); _logSync('manual',true,'token-cached'); runSync('manual'); return;
  }
  if(typeof google==='undefined' || !google.accounts){
    // GSI未ロード→読み込み開始＋押し直し依頼(v4.32)
    _loadScript(GSI_URL).catch(()=>{});
    _logSync('manual',false,'gsi-not-ready');
    alert(_t('syncPreparing'));
    return;
  }
  // v4.47(②段4修正): hint(メール記憶)があるときだけ silent試行。無いとき or 失敗時は直接 chooser。
  //   理由: hint無しの silent試行で「枠だけ出てすぐ消える」popup attempt→user gesture消費→
   //  続くフォールバックが popup blockerに引っかかり何も出ない事故が起きるため。
  //   初回押下で確実に chooser→選択→メール保存。次回以降は silent成功(hint付き)。
  _closeModal();
  const hint=_savedHint();
  if(hint){
    _requestToken('none',
      ()=>{ _logSync('silent',true,''); _logSync('manual',true,''); runSync('manual'); },
      (err)=>{
        _logSync('silent',false,err);
        // silent失敗時はもう一度押してもらう(user gesture消費済み対策)
        alert(_t('syncPreparing'));
      }
    );
  }else{
    // hint無し→直接 chooser(初回・あるいはアカウント変更直後)
    _requestToken(undefined,
      ()=>{ _logSync('manual',true,'prompt'); runSync('manual'); },
      (err)=>{ _logSync('manual',false,err); alert(_t('syncAuthError',err)); }
    );
  }
}

// ── 案件②段2: アカウント変更（select_accountで強制的にアカウント選択画面を出す）──
function changeSyncAccount(){
  if(_syncing) return;
  if(location.protocol==='file:') return;
  if(typeof google==='undefined' || !google.accounts){
    _loadScript(GSI_URL).catch(()=>{});
    _logSync('account-change',false,'gsi-not-ready');
    alert(_t('syncPreparing'));
    return;
  }
  if(typeof closeDataModal==='function') closeDataModal();
  _setHint('');   // 段4: 古いhintをクリア→強制選択画面→新しい選択後にhint再取得
  _requestToken('select_account',
    ()=>{ _logSync('account-change',true,''); runSync('manual'); },
    (err)=>{ _logSync('account-change',false,err); alert(_t('syncAuthError',err)); }
  );
}

// ── メイン同期処理 ──
async function runSync(mode){
  if(_syncing) return;
  if(location.protocol==='file:') return;
  _syncing=true;
  _syncNeeded=false;
  _renderStatus(mode==='auto'?'auto':'manual');
  _lockUnload();

  try{
    await loadDeps();
    await _gConnect();

    const remoteExists = await _gExists(SYNC_FILE);
    const loc          = _localSnapshot();
    const hasLocal     = loc.links.filter(l=>!l.deleted_at).length>0||loc.tags.length>0;
    const now          = Math.floor(Date.now()/1000);
    const lastSync     = lastSyncTs();
    const firstSync    = lastSync===0||(now-lastSync>YEAR_SEC);

    if(!remoteExists){
      // GDriveにファイルなし → ローカルをアップロード
      if(!confirm(_t('syncUploadAsk'))) return;
      await _writeSync(SYNC_FILE, loc);

    }else{
      // 整合性チェック付きで読む。壊れていたらバックアップから復旧
      let rem;
      const v=await _readVerified(SYNC_FILE);
      if(v.ok){
        rem=v.obj;
      }else if(await _gExists(SYNC_BAK)){
        const vb=await _readVerified(SYNC_BAK);
        if(vb.ok){ rem=vb.obj; alert(_t('syncRecovered')); }
        else { throw new Error(_t('syncCorrupt')); }
      }else{
        throw new Error(_t('syncCorrupt'));
      }
      const hasRemote = (rem.links||[]).filter(l=>!l.deleted_at).length>0;

      if(!hasLocal&&hasRemote){
        // ローカル空 → GDriveから取得
        if(!confirm(_t('syncDownloadAsk'))) return;
        _applyMerged(rem);

      }else if(firstSync){
        // 初回または長期未同期 → 3択
        const ch=prompt(_t('syncChoiceAsk'),'1');
        if(!ch) return;
        if(ch==='1'){
          const merged=_mergeData(loc,rem);
          _applyMerged(merged);
          await _commitRemote(merged, rem);
        }else if(ch==='2'){
          _applyMerged(rem);
        }else if(ch==='3'){
          await _commitRemote(loc, rem);
        }else{
          alert(_t('syncInvalid'));
          return;
        }

      }else{
        // 通常マージ
        const merged=_mergeData(loc,rem);
        _applyMerged(merged);
        await _commitRemote(merged, rem);
      }
    }

    saveLastSync();
    _syncNeeded=false;
    _disarmUserGestureSilentRetry();   // v4.51: 同期成功で待機解除
    // 段3: 同期成功後、現在のリモート更新時刻を取得して保存(次回チェックの基準)
    try{
      window._sp=SYNC_FILE;
      const fileId=await _pyodide.runPythonAsync('await gdrive.resolve_path(js.window._sp)');
      const token=_pyodide.runPython('gdrive._token');
      const r=await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,{headers:{Authorization:`Bearer ${token}`}});
      if(r.ok){ const j=await r.json(); if(j&&j.modifiedTime) _setRemoteMod(j.modifiedTime); }
    }catch(e){}
    _logSync('sync',true,mode==='auto'?'auto-ok':'manual-ok');

  }catch(e){
    console.error('[MomoSync]',e);
    _logSync('sync',false,(e.message||String(e)));
    alert(_t('syncErrorMsg',(e.message||String(e))));
    // lastSync は更新しない（次回再試行）
  }finally{
    _syncing=false;
    _unlockUnload();
    updateSyncStatus();
  }
}

// ── 自動同期チェック ──
function shouldAutoSync(){
  return syncEnabled()&&location.protocol!=='file:'&&(Math.floor(Date.now()/1000)-lastSyncTs()>=DAY_SEC);
}

// ── 自動同期：トークンが有効な場合のみ実行、なければバッジ表示 ──
// 案件⑥段A: 自動同期＝silent試行復活＋5分ごと＋編集後30秒＋失敗時15分バックオフ。
//   方針(2026-06-19/2026-06-23 ユーザー再確認): アクセスできるなら更新する。
//     1) tokenあり→そのまま軽いチェック→必要なら同期
//     2) tokenなし＋hint(メール記憶)あり＋everSigned→silent試行（一瞬ぐるぐる許容）
//     3) silent成功→新tokenで同期。失敗→15分バックオフ＋⚠表示
//     4) hint無し or 未サインインは何もしない（初回は手動更新ボタンから）
let _silentBackoffUntil=0;   // 段A: silent失敗時のバックオフ期限(Unix秒)

// v4.55: silentエラーが「回復見込みあり(popup系)」かを判定。回復見込みありなら警告を出さず、
// 次のユーザー操作で再試行→たいてい成功する。本当のサインイン切れ等のときだけ警告。
function _isRecoverableSilentError(err){
  return /popup_failed_to_open|popup_closed/i.test(String(err||''));
}

// v4.51(⑥段A改良): 「更新が必要」状態のとき、次のユーザー操作(クリック/タップ/キー入力)直下で
//   こっそりsilent試行を走らせる。ユーザーが「更新が必要」表示を押さなくても、普通に使い始めた
//   最初のクリック等で勝手に同期が再開する。ブラウザの「user gesture直下のpopupは許可」を活用。
let _gestureListenerActive=false;
let _gestureHandler=null;
function _armUserGestureSilentRetry(){
  if(_gestureListenerActive) return;
  // v4.52: バックオフ中でも仕掛けてOK。ユーザー操作直下のsilent試行はpopup_blockerが出ないので別扱い。
  if(!_savedHint() || !_everSigned()) return;                   // 試行条件を満たさない時は仕掛けない
  _gestureHandler=function(ev){
    if(!_syncNeeded || _syncing) return;
    // v4.54: リンク(<a>)クリックは除外。silent試行のpopupでフォーカスがLinksに戻る不便を回避。
    // v4.55: 同期ボタン(syncIndicator)上のクリックも除外＝ボタンのonclick=runSyncManualと二重起動するのを防ぐ。
    if(ev.type!=='keydown'){
      let el=ev.target;
      for(let i=0; el && i<10; i++){
        if(el.tagName==='A') return;
        if(el.id==='syncIndicator') return;
        el=el.parentElement;
      }
    }
    _disarmUserGestureSilentRetry();
    _userGestureSilentRetry();   // バックオフを無視してsilent試行(ユーザー操作直下)
  };
  document.addEventListener('click', _gestureHandler, {capture:true});
  document.addEventListener('touchstart', _gestureHandler, {capture:true, passive:true});
  document.addEventListener('keydown', _gestureHandler, {capture:true});
  _gestureListenerActive=true;
}
// v4.52: ユーザー操作直下のsilent試行。バックオフ無視。手動更新ボタン押下と同じ扱い。
function _userGestureSilentRetry(){
  if(_syncing) return;
  if(!_savedHint() || !_everSigned()) return;
  if(typeof google==='undefined' || !google.accounts){ _loadScript(GSI_URL).catch(()=>{}); return; }
  _requestToken('none',
    ()=>{
      _logSync('silent',true,'user-gesture'); _silentBackoffUntil=0;
      _syncNeeded=false; updateSyncStatus();   // v4.53: silent成功で「更新が必要」表示を解除
      _doAutoCheck('user-gesture');
    },
    (err)=>{
      _logSync('silent',false,'user-gesture:'+err);
      _silentBackoffUntil = Math.floor(Date.now()/1000) + 15*60;
      // v4.55: popup系エラーは警告無しで再arm(レース等で偶発失敗・次のユーザー操作で回復見込み)。
      //  非popup系(本当のサインイン切れ等)のみ警告。
      if(!_isRecoverableSilentError(err)){ _syncNeeded=true; updateSyncStatus(); }
      _armUserGestureSilentRetry();   // 次のユーザー操作で再試行を仕掛け直す
    }
  );
}
function _disarmUserGestureSilentRetry(){
  if(!_gestureListenerActive) return;
  if(_gestureHandler){
    document.removeEventListener('click', _gestureHandler, {capture:true});
    document.removeEventListener('touchstart', _gestureHandler, {capture:true, passive:true});
    document.removeEventListener('keydown', _gestureHandler, {capture:true});
  }
  _gestureHandler=null;
  _gestureListenerActive=false;
}
async function _autoSyncOrBadge(autoTrigger){
  if(location.protocol==='file:' || !syncEnabled()) return;
  if(_syncing) return;
  if(!_everSigned()) return;
  if(typeof google==='undefined' || !google.accounts){ _loadScript(GSI_URL).catch(()=>{}); return; }
  const now=Math.floor(Date.now()/1000);
  // token生存時はそのまま軽いチェックへ
  if(_gToken && now<_gTokenExp){ await _doAutoCheck(autoTrigger); return; }
  // バックオフ中は試行しない(⚠表示はそのまま維持)
  if(_silentBackoffUntil && now<_silentBackoffUntil) return;
  // hint無しはsilent試行できない→次の手動更新待ち
  const hint=_savedHint();
  if(!hint){ _syncNeeded=true; updateSyncStatus(); _armUserGestureSilentRetry(); return; }
  // hint付きsilent試行
  _requestToken('none',
    ()=>{
      _logSync('silent',true,'auto'); _silentBackoffUntil=0;
      _syncNeeded=false; updateSyncStatus();   // v4.53: silent成功=「更新が必要」の理由解消→表示を戻す
      _disarmUserGestureSilentRetry();
      _doAutoCheck(autoTrigger);
    },
    (err)=>{
      _logSync('silent',false,'auto:'+err);
      _silentBackoffUntil = now + 15*60;   // 15分バックオフ
      // v4.55: popup系エラー(回復見込みあり)では警告を出さない。次のユーザー操作で再試行→たいてい成功。
      //  本当のサインイン切れ等(access_denied/invalid_grant等)の時だけ「更新が必要」表示。
      if(!_isRecoverableSilentError(err)){ _syncNeeded=true; updateSyncStatus(); }
      _armUserGestureSilentRetry();   // v4.51: 次のユーザー操作で再試行を仕掛ける
    }
  );
}
// 軽いチェック→変更あれば同期(token必須・両方変化なしで静かに終了)
async function _doAutoCheck(autoTrigger){
  const remote=await _checkRemoteChanged();
  const localDirty=_hasLocalChanges();
  _logSync('check', remote!=='error', remote+(localDirty?' / local-dirty':' / local-clean'));
  if(remote==='unchanged' && !localDirty){ _logSync('skip', true, autoTrigger||'auto'); return; }
  if(remote==='error') return;
  runSync('auto');
}
// 起動時/間隔チェックの共通入口(段A: shouldAutoSyncの24時間判定は廃止＝5分ごとに毎回チェック)
function _intervalAutoSync(){ _autoSyncOrBadge('interval'); }

// 段A: ローカル編集の通知(index.html の save() 等から呼ぶ)→30秒デバウンス→自動同期
let _editDebounceTimer=null;
function notifyLocalEdit(){
  if(location.protocol==='file:' || !syncEnabled()) return;
  if(_editDebounceTimer) clearTimeout(_editDebounceTimer);
  _editDebounceTimer=setTimeout(()=>{ _editDebounceTimer=null; _autoSyncOrBadge('edit'); }, 30*1000);
}

// ── 起動時：GSI先読み＋軽いチェック＋状態表示（段3: 24時間判定無視で毎起動1回チェック）──
window.addEventListener('load',()=>{
  if(syncEnabled()&&location.protocol!=='file:'){
    _loadScript(GSI_URL).then(()=>{ setTimeout(()=>_autoSyncOrBadge('startup'), 800); }).catch(()=>{});
  }
  updateSyncStatus();
});

// ── 段A: 継続使用中の定期チェック（5分ごと・毎回 軽いチェック→必要なら同期）──
setInterval(()=>{ _intervalAutoSync(); }, 5*60*1000);
