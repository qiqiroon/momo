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
}
function lastSyncTs(){ try{return parseInt(localStorage.getItem(LS_LAST_SYNC)||'0');}catch{return 0;} }
function saveLastSync(){ try{localStorage.setItem(LS_LAST_SYNC,String(Math.floor(Date.now()/1000)));}catch{} }

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

// ── 同期中インジケーター ──
function _getOrCreateIndicator(){
  let el=document.getElementById('syncIndicator');
  if(!el){
    el=document.createElement('span');
    el.id='syncIndicator';
    const hdr=document.querySelector('header')||document.body;
    hdr.appendChild(el);
  }
  return el;
}
function _showIndicator(){
  const el=_getOrCreateIndicator();
  el.textContent=_t('syncBusy');
  el.onclick=null;
  el.style.cursor='default';
  el.style.display='inline';
}
function _hideIndicator(){
  const el=document.getElementById('syncIndicator');
  if(el) el.style.display='none';
}

// ── 「同期が必要」バッジ（トークンなし自動同期スキップ時）──
function _showSyncNeeded(){
  const el=_getOrCreateIndicator();
  el.textContent=_t('syncNeeded');
  el.title=_t('syncNeededHint');
  el.style.cursor='pointer';
  el.onclick=()=>runSyncManual();
  el.style.display='inline';
}
function _hideSyncNeeded(){
  const el=document.getElementById('syncIndicator');
  if(el) el.style.display='none';
}

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

// ── 手動同期トリガー（モバイル対応：ユーザー操作直後にGSIトークン取得）──
// ボタンのonclickから直接呼ぶこと。awaitを挟む前にrequestAccessTokenを実行する。
function runSyncManual(){
  if(_syncing) return;
  if(location.protocol==='file:') return;
  // v4.33: データ管理を閉じるのは「実際に同期/サインインへ進む時」だけ。
  //  準備中(GSI未ロード)では閉じない→目の前の「同期」ボタンをもう一度押すだけで済む。
  const _closeModal=()=>{ if(typeof closeDataModal==='function') closeDataModal(); };

  const _doSync=()=>{
    const now=Math.floor(Date.now()/1000);
    if(_gToken&&now<_gTokenExp){
      _closeModal(); runSync(); return;
    }
    const doRequest=()=>{
      const client=google.accounts.oauth2.initTokenClient({
        client_id:CLIENT_ID,
        scope:GDRIVE_SCOPE,
        callback:(resp)=>{
          if(resp.error){ alert(_t('syncAuthError',resp.error)); return; }
          _gToken=resp.access_token;
          _gTokenExp=Math.floor(Date.now()/1000)+(resp.expires_in||3600)-60;
          runSync();
        }
      });
      _closeModal();
      client.requestAccessToken();
    };
    if(typeof google!=='undefined'&&google.accounts){
      doRequest();
    }else{
      // v4.32: GSI未ロード時に「読込→then→requestAccessToken」とするとユーザー操作の文脈が切れ、
      //  ブラウザがアカウント選択ポップアップをブロックし「無反応で空振り」になる(特にPWA初回)。
      //  黙って失敗させず、準備を始めて「もう一度押して」と促す(2回目はロード済みで選択画面が出る)。
      _loadScript(GSI_URL).catch(()=>{});
      alert(_t('syncPreparing'));
    }
  };
  _doSync();
}

// ── メイン同期処理 ──
async function runSync(){
  if(_syncing) return;
  if(location.protocol==='file:') return;
  _syncing=true;
  _showIndicator();
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
    _hideSyncNeeded();

  }catch(e){
    console.error('[MomoSync]',e);
    alert(_t('syncErrorMsg',(e.message||String(e))));
    // lastSync は更新しない（次回再試行）
  }finally{
    _syncing=false;
    _hideIndicator();
    _unlockUnload();
  }
}

// ── 自動同期チェック ──
function shouldAutoSync(){
  return syncEnabled()&&location.protocol!=='file:'&&(Math.floor(Date.now()/1000)-lastSyncTs()>=DAY_SEC);
}

// ── 自動同期：トークンが有効な場合のみ実行、なければバッジ表示 ──
function _autoSyncOrBadge(){
  if(!shouldAutoSync()) return;
  const now=Math.floor(Date.now()/1000);
  if(_gToken&&now<_gTokenExp){
    runSync();
  }else{
    _showSyncNeeded();
  }
}

// ── 起動時：GSI先読み＋自動同期チェック ──
window.addEventListener('load',()=>{
  if(syncEnabled()&&location.protocol!=='file:') _loadScript(GSI_URL);
  _autoSyncOrBadge();
});

// ── 継続使用中の定期チェック（1時間ごと）──
setInterval(()=>{ _autoSyncOrBadge(); }, 3600*1000);
