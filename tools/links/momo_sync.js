// momo_sync.js  –  MOMO Links v3.30 GDrive同期モジュール
'use strict';

const SYNC_FILE   = '/momo-works/links/links_data.json';
const GDRIVE_PY   = 'https://qiqiroon.github.io/momo/lib/momo_gdrive/momo_gdrive.py';
const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.27.4/full/pyodide.js';
const GSI_URL     = 'https://accounts.google.com/gsi/client';
const YEAR_SEC    = 365 * 24 * 3600;
const DAY_SEC     = 24 * 3600;

const LS_ENABLED   = 'gdrive_sync_enabled';
const LS_LAST_SYNC = 'gdrive_last_sync';

// ── 状態 ──
let _pyodide  = null;
let _loading  = false;
let _syncing  = false;

// ── localStorage ヘルパー ──
function syncEnabled(){ try{return localStorage.getItem(LS_ENABLED)==='true';}catch{return false;} }
function setSyncEnabled(v){ try{localStorage.setItem(LS_ENABLED,v?'true':'false');}catch{} }
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
    if(!resp.ok) throw new Error('momo_gdrive.py の取得に失敗しました');
    _pyodide.runPython(await resp.text());
    _pyodide.runPython('import js');
  }finally{
    _loading=false;
  }
}

// ── Pyodide 経由の GDrive 操作 ──
async function _gConnect(){
  await _pyodide.runPythonAsync('gdrive = MomoGDrive()');
  await _pyodide.runPythonAsync('await gdrive.connect()');
}

async function _gExists(path){
  window._sp=path;
  return await _pyodide.runPythonAsync('await gdrive.exists(js.window._sp)');
}

async function _gReadJson(path){
  window._sp=path;
  const s=await _pyodide.runPythonAsync(
    'import json\n'+
    '_fid=await gdrive.resolve_path(js.window._sp)\n'+
    '_url=f"https://www.googleapis.com/drive/v3/files/{_fid}?alt=media"\n'+
    '_r=await gdrive._fetch(_url)\n'+
    'json.dumps(_r if isinstance(_r,(dict,list)) else json.loads(_r.decode("utf-8")),ensure_ascii=False)'
  );
  return JSON.parse(s);
}

async function _gWriteText(path,content){
  window._sp=path; window._sc=content;
  await _pyodide.runPythonAsync('await gdrive.write_text(js.window._sp, js.window._sc)');
}

// ── 同期中インジケーター ──
function _showIndicator(){
  let el=document.getElementById('syncIndicator');
  if(!el){
    el=document.createElement('span');
    el.id='syncIndicator';
    el.textContent='☁ 同期中';
    const hdr=document.querySelector('header');
    if(hdr) hdr.appendChild(el);
  }
  el.style.display='';
}
function _hideIndicator(){
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

function _mergeData(loc,rem){
  const links=_mergeLinks(loc.links||[],rem.links||[]);
  const tags=[...new Set([...(loc.tags||[]),...(rem.tags||[])])].sort();
  return{links,tags};
}

// ── ローカルへの適用 ──
function _applyMerged(data){
  /* global link_data, link_allTags, save, renderAll */
  link_data    = [...(data.links||[])];
  link_allTags = [...(data.tags||[])];
  if(typeof save==='function') save();
  if(typeof renderAll==='function') renderAll();
}

function _localSnapshot(){
  /* global link_data, link_allTags */
  return{links:[...link_data],tags:[...link_allTags]};
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
      if(!confirm('GDriveに同期ファイルがありません。\nローカルのデータをGDriveにアップロードしますか？')) return;
      await _gWriteText(SYNC_FILE, JSON.stringify(loc));

    }else{
      const rem     = await _gReadJson(SYNC_FILE);
      const hasRemote = (rem.links||[]).filter(l=>!l.deleted_at).length>0;

      if(!hasLocal&&hasRemote){
        // ローカル空 → GDriveから取得
        if(!confirm('ローカルにデータがありません。\nGDriveのデータをローカルに読み込みますか？')) return;
        _applyMerged(rem);

      }else if(firstSync){
        // 初回または長期未同期 → 3択
        const msg=
          '初回同期または長期間（1年以上）未同期です。\n\n'+
          '操作を選んでください：\n'+
          '  1 ── マージ（updated_at で勝敗判定・推奨）\n'+
          '  2 ── GDrive → ローカルに上書き（⚠️ローカルデータが消えます）\n'+
          '  3 ── ローカル → GDriveに上書き（⚠️GDriveデータが消えます）\n\n'+
          '※ 2・3 を選ぶ前に「データ管理 → エクスポート」でバックアップを推奨します。\n\n'+
          '番号を入力（キャンセルで中止）:';
        const ch=prompt(msg,'1');
        if(!ch) return;
        if(ch==='1'){
          const merged=_mergeData(loc,rem);
          _applyMerged(merged);
          await _gWriteText(SYNC_FILE, JSON.stringify({links:window.link_data,tags:window.link_allTags}));
        }else if(ch==='2'){
          _applyMerged(rem);
        }else if(ch==='3'){
          await _gWriteText(SYNC_FILE, JSON.stringify(loc));
        }else{
          alert('無効な入力です。同期をキャンセルしました。');
          return;
        }

      }else{
        // 通常マージ
        const merged=_mergeData(loc,rem);
        _applyMerged(merged);
        await _gWriteText(SYNC_FILE, JSON.stringify({links:window.link_data,tags:window.link_allTags}));
      }
    }

    saveLastSync();

  }catch(e){
    console.error('[MomoSync]',e);
    alert('GDrive同期エラー:\n'+(e.message||String(e)));
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

// ── 起動時自動同期 ──
window.addEventListener('load',()=>{
  if(shouldAutoSync()) runSync();
});

// ── 継続使用中の定期チェック（1時間ごと）──
setInterval(()=>{ if(shouldAutoSync()) runSync(); }, 3600*1000);
