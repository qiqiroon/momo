// app.js - MOMO Noise Main Controller v0.04
'use strict';

const APP_VERSION = 'v0.04';

// ── I18N ──────────────────────────────────────────────────────────────────
const I18N = {
  ja: {
    ver:           'ver 1.03',
    editMode:      '編集',
    playMode:      '再生',
    masterVol:     '音量',
    masterPitch:   'ピッチ',
    pitchReset:    'リセット',
    metro:         'メトロノーム',
    bpm:           'BPM',
    btnName:       'ボタン名',
    record:        '● 録音',
    recording:     '■ 停止',
    preview:       '試聴',
    fileLoad:      'ファイル',
    save:          '保存',
    erase:         '消去',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       '音声なし',
    driveConnect:  'Drive接続',
    driveDiscon:   '切断',
    driveSave:     'Driveに保存',
    driveLoad:     'Driveから読み込み',
    driveNotConn:  'Drive未接続です。接続しますか？',
    confirmErase:  'この音声を消去しますか？',
    syncOn:        'シンクON',
    syncOff:       'シンクOFF',
    trimLabel:     '無音カット',
    noAudio:       '音声が設定されたボタンがありません',
    saved:         '保存完了',
    saveErr:       '保存失敗',
    driveOk:       'Drive接続完了',
    driveErr:      'Drive接続失敗',
    driveLoaded:   'Driveから読み込み完了',
    saving:        '保存中',
    loading:       '読み込み中',
    micDenied:     'マイクへのアクセスが拒否されています。\n設定 → Safari → マイク → 許可 に変更してください。',
    micError:      'マイクエラー: ',
    muteWarn:      '音が出ない場合はiPhoneのサイドスイッチ（無音スイッチ）を確認してください',
  },
  en: {
    ver:           'ver 1.03',
    editMode:      'Edit',
    playMode:      'Play',
    masterVol:     'Volume',
    masterPitch:   'Pitch',
    pitchReset:    'Reset',
    metro:         'Metronome',
    bpm:           'BPM',
    btnName:       'Name',
    record:        '● Rec',
    recording:     '■ Stop',
    preview:       'Preview',
    fileLoad:      'File',
    save:          'Save',
    erase:         'Erase',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       'No sound',
    driveConnect:  'Connect Drive',
    driveDiscon:   'Disconnect',
    driveSave:     'Save to Drive',
    driveLoad:     'Load from Drive',
    driveNotConn:  'Drive not connected. Connect now?',
    confirmErase:  'Erase this sound?',
    syncOn:        'Sync ON',
    syncOff:       'Sync OFF',
    trimLabel:     'Trim silence',
    noAudio:       'No buttons have audio assigned',
    saved:         'Saved',
    saveErr:       'Save failed',
    driveOk:       'Drive connected',
    driveErr:      'Drive connection failed',
    driveLoaded:   'Loaded from Drive',
    saving:        'Saving',
    loading:       'Loading',
    micDenied:     'Microphone access denied.\nSettings → Safari → Microphone → Allow.',
    micError:      'Mic error: ',
    muteWarn:      'No sound? Check the silent switch on the side of your iPhone.',
  },
  zh: {
    ver:           'ver 1.03',
    editMode:      '编辑',
    playMode:      '播放',
    masterVol:     '音量',
    masterPitch:   '音调',
    pitchReset:    '重置',
    metro:         '节拍器',
    bpm:           'BPM',
    btnName:       '名称',
    record:        '● 录音',
    recording:     '■ 停止',
    preview:       '试听',
    fileLoad:      '文件',
    save:          '保存',
    erase:         '清除',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       '无音频',
    driveConnect:  '连接Drive',
    driveDiscon:   '断开',
    driveSave:     '保存到Drive',
    driveLoad:     '从Drive加载',
    driveNotConn:  'Drive未连接。是否立即连接？',
    confirmErase:  '确认清除此音频？',
    syncOn:        '同步开',
    syncOff:       '同步关',
    trimLabel:     '静音裁切',
    noAudio:       '没有已分配音频的按钮',
    saved:         '已保存',
    saveErr:       '保存失败',
    driveOk:       'Drive已连接',
    driveErr:      'Drive连接失败',
    driveLoaded:   '已从Drive加载',
    saving:        '保存中',
    loading:       '加载中',
    micDenied:     '麦克风访问被拒绝。\n请前往设置 → Safari → 麦克风 → 允许。',
    micError:      '麦克风错误: ',
    muteWarn:      '没有声音？请检查iPhone侧面的静音开关。',
  }
};

// ── CAT language ──────────────────────────────────────────────────────────
let catBase = 'ja';
const CATVOC = {
  err:  { ja:['シャー！','フーッ！'], en:['HISS!','SPIT!'], zh:['嘶！','哈！'] },
  calm: { ja:['ごろごろ…','にゃ…'],  en:['purrrr...','mrrr...'], zh:['咕噜…','喵…'] },
  norm: { ja:['にゃあ','にゃーん','ニャ！'], en:['MEOW','meow','NYA!'], zh:['喵','喵呜','咪'] },
};
const CAT_ERR  = ['saveErr','driveErr','micDenied','micError'];
const CAT_CALM = ['driveConnect','recording','saving','loading'];
function catSpeak(key) {
  const b = ['en','zh'].includes(catBase) ? catBase : 'ja';
  const v = CAT_ERR.includes(key) ? CATVOC.err[b] : CAT_CALM.includes(key) ? CATVOC.calm[b] : CATVOC.norm[b];
  return v[Math.floor(Math.random() * v.length)];
}

let currentLang = (() => {
  try { const v = localStorage.getItem('momoLang'); return ['ja','en','zh','cat'].includes(v) ? v : 'ja'; }
  catch(e) { return 'ja'; }
})();

function t(key) {
  if (currentLang === 'cat') return catSpeak(key);
  return (I18N[currentLang] || I18N.ja)[key] || I18N.ja[key] || key;
}
function onLangChange(val) {
  if (val === 'cat') catBase = currentLang === 'cat' ? catBase : currentLang;
  currentLang = val;
  try { localStorage.setItem('momoLang', val); } catch(e) {}
  applyLang();
}
function applyLang() {
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = currentLang;
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hans' : currentLang === 'cat' ? catBase : currentLang;
  renderEditList();
  renderControls();
}

// ── State ─────────────────────────────────────────────────────────────────
const MAX_BTN = 30;
let buttons = Array.from({ length: MAX_BTN }, (_, i) => ({
  id: i, name: '', buffer: null, fileName: null, volume: 1.0, pitch: 1.0
}));
let mode        = 'edit';
let masterVol   = 1.0;
let masterPitch = 1.0;
let pitchSemitones = 0;   // -12 to +12 semitones display value
let metroOn     = false;
let syncOn      = false;
let bpm         = 120;
let trimDb      = -40;

const activeSources = new Map();

// ── IndexedDB ─────────────────────────────────────────────────────────────
let db = null;
function openDb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('momonoise', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('buttons'))  d.createObjectStore('buttons',  { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = e => { db = e.target.result; res(); };
    req.onerror   = e => rej(e.target.error);
  });
}

async function saveToDb() {
  if (!db) return;
  const tx = db.transaction(['buttons','settings'], 'readwrite');
  const bs = tx.objectStore('buttons');
  for (const btn of buttons) {
    let bufData = null;
    if (btn.buffer) {
      bufData = [];
      for (let c = 0; c < btn.buffer.numberOfChannels; c++)
        bufData.push(Array.from(btn.buffer.getChannelData(c)));
    }
    bs.put({ id: btn.id, name: btn.name, volume: btn.volume, pitch: btn.pitch,
             fileName: btn.fileName, bufData, sampleRate: btn.buffer?.sampleRate });
  }
  tx.objectStore('settings').put({
    key: 'global', masterVol, masterPitch, pitchSemitones, bpm, trimDb, syncOn
  });
}

async function loadFromDb() {
  if (!db) return;
  return new Promise(res => {
    const tx  = db.transaction(['buttons','settings'], 'readonly');
    const req = tx.objectStore('buttons').getAll();
    req.onsuccess = e => {
      for (const row of e.target.result) {
        const btn = buttons[row.id];
        if (!btn) continue;
        btn.name     = row.name     || '';
        btn.volume   = row.volume   ?? 1.0;
        btn.pitch    = row.pitch    ?? 1.0;
        btn.fileName = row.fileName || null;
        if (row.bufData && row.sampleRate) {
          try {
            AudioEngine.init();
            const actx = AudioEngine.getCtx();
            const buf  = actx.createBuffer(row.bufData.length, row.bufData[0].length, row.sampleRate);
            for (let c = 0; c < row.bufData.length; c++)
              buf.getChannelData(c).set(new Float32Array(row.bufData[c]));
            btn.buffer = buf;
          } catch(e) { console.warn('restore buf', row.id, e); }
        }
      }
      const sr = tx.objectStore('settings').get('global');
      sr.onsuccess = f => {
        const s = f.target.result;
        if (s) {
          masterVol      = s.masterVol      ?? 1.0;
          masterPitch    = s.masterPitch    ?? 1.0;
          pitchSemitones = s.pitchSemitones ?? 0;
          bpm            = s.bpm            ?? 120;
          trimDb         = s.trimDb         ?? -40;
          syncOn         = s.syncOn         ?? false;
        }
        res();
      };
      sr.onerror = () => res();
    };
    req.onerror = () => res();
  });
}

// ── Drive save / load (manual only) ───────────────────────────────────────
async function ensureDriveConnected() {
  if (Drive.isSignedIn()) return true;
  const ok = confirm(t('driveNotConn'));
  if (!ok) return false;
  try {
    showToast(t('driveConnect') + '…', 30000);
    await Drive.signIn();
    renderControls();
    return true;
  } catch(e) {
    showToast(t('driveErr') + ': ' + e.message, 5000);
    return false;
  }
}

async function saveToDrive() {
  if (!await ensureDriveConnected()) return;
  const targets = buttons.filter(b => b.buffer);
  if (targets.length === 0) { showToast(t('saved')); return; }

  showToast('0 / ' + targets.length + ' ' + t('saving') + '…', 120000);
  try {
    // 設定JSON
    const meta = buttons.map(b => ({
      id: b.id, name: b.name, volume: b.volume, pitch: b.pitch,
      fileName: b.fileName, hasBuffer: !!b.buffer
    }));
    await Drive.saveJson({ meta, masterVol, masterPitch, pitchSemitones, bpm, trimDb, syncOn });
    // 全WAV (ボタン番号固定)
    let n = 0;
    for (const btn of targets) {
      const wav = AudioEngine.bufferToWav(btn.buffer);
      await Drive.uploadWav(btn.id, wav);
      n++;
      showToast(n + ' / ' + targets.length + ' ' + t('saving') + '…', 120000);
    }
    showToast(t('saved'));
  } catch(e) {
    console.error(e);
    showToast(t('saveErr') + ': ' + e.message, 6000);
  }
}

async function loadFromDrive() {
  if (!await ensureDriveConnected()) return;
  showToast(t('loading') + '…', 120000);
  try {
    const data = await Drive.loadJson();
    if (!data) { showToast('No data in Drive'); return; }

    // 設定
    if (data.meta) {
      for (const m of data.meta) {
        const btn = buttons[m.id];
        if (!btn) continue;
        btn.name     = m.name     || '';
        btn.volume   = m.volume   ?? 1.0;
        btn.pitch    = m.pitch    ?? 1.0;
        btn.fileName = m.fileName || null;
        btn.buffer   = null; // clear before reload
      }
    }
    masterVol      = data.masterVol      ?? masterVol;
    masterPitch    = data.masterPitch    ?? masterPitch;
    pitchSemitones = data.pitchSemitones ?? pitchSemitones;
    bpm            = data.bpm            ?? bpm;
    trimDb         = data.trimDb         ?? trimDb;
    syncOn         = data.syncOn         ?? syncOn;

    // WAV復元 (ボタン番号固定)
    if (data.meta) {
      let n = 0, total = data.meta.filter(m => m.hasBuffer).length;
      for (const m of data.meta) {
        if (!m.hasBuffer) continue;
        try {
          const ab = await Drive.downloadWav(m.id);
          if (ab) {
            AudioEngine.init();
            const actx = AudioEngine.getCtx();
            const buf  = await new Promise((res, rej) => actx.decodeAudioData(ab.slice(0), res, rej));
            buttons[m.id].buffer = buf;
          }
        } catch(e) { console.warn('WAV restore', m.id, e); }
        n++;
        showToast(n + ' / ' + total + ' ' + t('loading') + '…', 120000);
      }
    }
    await saveToDb();
    AudioEngine.setMasterVolume(masterVol);
    AudioEngine.setMasterPitch(masterPitch);
    Metro.setBpm(bpm);
    renderEditList();
    renderControls();
    showToast(t('driveLoaded'));
  } catch(e) {
    console.error(e);
    showToast(t('saveErr') + ': ' + e.message, 6000);
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, ms = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── iOS mute warning ───────────────────────────────────────────────────────
let muteShown = false;
function showMuteWarning() {
  if (muteShown || !/iPad|iPhone|iPod/.test(navigator.userAgent)) return;
  muteShown = true;
  showToast(t('muteWarn'), 8000);
}

// ── Microphone permission ─────────────────────────────────────────────────
async function checkMicPermission() {
  if (navigator.permissions) {
    try {
      const r = await navigator.permissions.query({ name: 'microphone' });
      if (r.state === 'denied') { alert(t('micDenied')); return false; }
    } catch(e) {}
  }
  return true;
}

// ── Metronome ──────────────────────────────────────────────────────────────
function toggleMetro() {
  metroOn = !metroOn;
  if (metroOn) { Metro.setBpm(bpm); Metro.start(onBeat); }
  else { Metro.stop(); document.getElementById('beat-flash')?.classList.remove('active'); }
  renderControls();
}
function onBeat() {
  const el = document.getElementById('beat-flash');
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 80);
}

// ── Play ──────────────────────────────────────────────────────────────────
async function triggerPlay(btnId) {
  const btn = buttons[btnId];
  if (!btn?.buffer) return;

  await AudioEngine.resume();
  showMuteWarning();

  const now     = AudioEngine.getCurrentTime();
  const startAt = (metroOn && syncOn) ? Metro.snapToBeat(now) : now;

  const stopFn = AudioEngine.play(btn.buffer, {
    volume: btn.volume, pitch: btn.pitch, startAt,
    onEnded: () => {
      const srcs = activeSources.get(btnId);
      if (!srcs) return;
      const i = srcs.indexOf(stopFn);
      if (i !== -1) srcs.splice(i, 1);
      if (srcs.length === 0) { activeSources.delete(btnId); updatePadBtn(btnId, false); }
    }
  });

  if (!activeSources.has(btnId)) activeSources.set(btnId, []);
  activeSources.get(btnId).push(stopFn);
  updatePadBtn(btnId, true);
}

function updatePadBtn(btnId, active) {
  document.querySelector(`[data-play-id="${btnId}"]`)?.classList.toggle('active', active);
}

// ── Edit: record ──────────────────────────────────────────────────────────
let recBtnId = null;

async function startRecord(btnId) {
  if (recBtnId !== null) return;
  if (!await checkMicPermission()) return;
  try {
    await AudioEngine.startRecording();
    recBtnId = btnId;
    renderEditRow(btnId);
  } catch(e) {
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') alert(t('micDenied'));
    else showToast(t('micError') + e.message, 5000);
    recBtnId = null;
    renderEditRow(btnId);
  }
}

async function stopRecord(btnId) {
  if (recBtnId !== btnId) return;
  try {
    const buf = await AudioEngine.stopRecording();
    recBtnId = null;
    if (buf) { buttons[btnId].buffer = buf; buttons[btnId].fileName = null; }
  } catch(e) {
    recBtnId = null;
    showToast(t('micError') + e.message, 5000);
  }
  renderEditRow(btnId);
  saveToDb();
}

async function loadFile(btnId) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/*';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) { res(); return; }
      try {
        AudioEngine.init();
        const buf = await AudioEngine.decodeFile(await f.arrayBuffer());
        buttons[btnId].buffer   = buf;
        buttons[btnId].fileName = f.name;
        renderEditRow(btnId);
        saveToDb();
      } catch(e) { showToast('⚠ ' + e.message, 5000); }
      res();
    };
    inp.click();
  });
}

async function previewButton(btnId) {
  const btn = buttons[btnId];
  if (!btn?.buffer) return;
  AudioEngine.init();
  await AudioEngine.resume();
  showMuteWarning();
  AudioEngine.play(btn.buffer, { volume: btn.volume, pitch: btn.pitch });
}

function eraseButton(btnId) {
  if (!confirm(t('confirmErase'))) return;
  buttons[btnId].buffer = null; buttons[btnId].fileName = null; buttons[btnId].name = '';
  renderEditRow(btnId); saveToDb();
}

function saveWavLocal(btn) {
  if (!btn.buffer) return;
  const url = URL.createObjectURL(AudioEngine.bufferToWav(btn.buffer));
  const a   = Object.assign(document.createElement('a'), {
    href: url, download: (btn.name || 'noise_' + btn.id) + '.wav'
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function moveButton(id, dir) {
  const t = id + dir;
  if (t < 0 || t >= MAX_BTN) return;
  [buttons[id], buttons[t]] = [buttons[t], buttons[id]];
  buttons[id].id = id; buttons[t].id = t;
  renderEditList(); saveToDb();
}

// ── Pitch control ─────────────────────────────────────────────────────────
function changePitch(delta) {
  pitchSemitones = Math.max(-12, Math.min(12, pitchSemitones + delta));
  masterPitch = Math.pow(2, pitchSemitones / 12);
  AudioEngine.setMasterPitch(masterPitch);
  updatePitchDisplay();
  saveToDb();
}
function resetPitch() {
  pitchSemitones = 0; masterPitch = 1.0;
  AudioEngine.setMasterPitch(1.0);
  updatePitchDisplay();
  saveToDb();
}
function updatePitchDisplay() {
  const el = document.getElementById('pitch-val');
  if (el) el.textContent = (pitchSemitones >= 0 ? '+' : '') + pitchSemitones;
}

// ── Render ────────────────────────────────────────────────────────────────
function renderControls() {
  const set = (id, val) => { const e = document.getElementById(id); if (e) e[typeof val === 'boolean' ? 'classList' : 'value'] = val; };
  const setTxt = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  const toggleActive = (id, on) => { document.getElementById(id)?.classList.toggle('active', on); };

  const volEl = document.getElementById('ctrl-vol');
  if (volEl) volEl.value = masterVol;
  setTxt('bpm-val', bpm);
  const bpmEl = document.getElementById('ctrl-bpm');
  if (bpmEl) bpmEl.value = bpm;
  updatePitchDisplay();

  toggleActive('btn-metro', metroOn);
  setTxt('btn-metro', t('metro'));
  toggleActive('btn-sync', syncOn);
  setTxt('btn-sync', syncOn ? t('syncOn') : t('syncOff'));
  toggleActive('btn-mode-edit', mode === 'edit');
  toggleActive('btn-mode-play', mode === 'play');
  setTxt('btn-mode-edit', t('editMode'));
  setTxt('btn-mode-play', t('playMode'));
  setTxt('btn-drive', Drive.isSignedIn() ? t('driveDiscon') : t('driveConnect'));
  setTxt('btn-drive-save', t('driveSave'));
  setTxt('btn-drive-load', t('driveLoad'));
  setTxt('lbl-vol', t('masterVol'));
  setTxt('lbl-bpm', t('bpm'));
  setTxt('lbl-trim', t('trimLabel'));
  setTxt('lbl-pitch', t('masterPitch'));
  setTxt('btn-pitch-reset', t('pitchReset'));

  const trimEl = document.getElementById('ctrl-trim');
  if (trimEl) trimEl.value = trimDb;
  setTxt('trim-val', trimDb + 'dB');

  // version display
  setTxt('ver-display', t('ver'));
}

function renderEditRow(btnId) {
  const row = document.querySelector(`[data-edit-row="${btnId}"]`);
  if (!row) return;
  const btn   = buttons[btnId];
  const isRec = recBtnId === btnId;
  const has   = !!btn.buffer;

  row.querySelector('.btn-name-input').value = btn.name;
  const al = row.querySelector('.btn-has-audio');
  al.textContent = has ? (btn.fileName ? '📄 ' + btn.fileName : '🎙 recorded') : t('noSound');
  al.classList.toggle('has-audio', has);

  const rb = row.querySelector('.rec-btn');
  const sb = row.querySelector('.stop-btn');
  rb.textContent = t('record');
  sb.textContent = t('recording');
  rb.style.display = isRec ? 'none' : '';
  sb.style.display = isRec ? '' : 'none';
  rb.classList.toggle('recording', isRec);

  row.querySelector('.prev-btn').textContent  = t('preview');
  row.querySelector('.file-btn').textContent  = t('fileLoad');
  row.querySelector('.save-btn').textContent  = t('save');
  row.querySelector('.erase-btn').textContent = t('erase');
  row.querySelector('.up-btn').textContent    = t('moveUp');
  row.querySelector('.dn-btn').textContent    = t('moveDown');

  row.querySelector('.prev-btn').disabled  = !has;
  row.querySelector('.save-btn').disabled  = !has;
  row.querySelector('.erase-btn').disabled = !has;
}

function renderEditList() {
  const list = document.getElementById('edit-list');
  if (!list) return;
  list.innerHTML = '';
  buttons.forEach((btn, idx) => {
    const row = document.createElement('div');
    row.className = 'edit-row';
    row.setAttribute('data-edit-row', idx);
    row.innerHTML = `
      <span class="btn-number">${idx + 1}</span>
      <input class="btn-name-input" type="text" maxlength="20" placeholder="${t('btnName')}">
      <span class="btn-has-audio"></span>
      <div class="btn-actions">
        <button class="rec-btn  noise-btn"></button>
        <button class="stop-btn noise-btn btn-danger" style="display:none"></button>
        <button class="prev-btn noise-btn"></button>
        <button class="file-btn noise-btn"></button>
        <button class="save-btn noise-btn"></button>
        <button class="erase-btn noise-btn btn-danger"></button>
        <button class="up-btn noise-btn btn-move"></button>
        <button class="dn-btn noise-btn btn-move"></button>
      </div>`;
    row.querySelector('.btn-name-input').addEventListener('input',  e => { buttons[idx].name = e.target.value; saveToDb(); });
    row.querySelector('.rec-btn').addEventListener('click',  () => startRecord(idx));
    row.querySelector('.stop-btn').addEventListener('click', () => stopRecord(idx));
    row.querySelector('.prev-btn').addEventListener('click', () => previewButton(idx));
    row.querySelector('.file-btn').addEventListener('click', () => loadFile(idx));
    row.querySelector('.save-btn').addEventListener('click', () => saveWavLocal(btn));
    row.querySelector('.erase-btn').addEventListener('click',() => eraseButton(idx));
    row.querySelector('.up-btn').addEventListener('click',   () => moveButton(idx, -1));
    row.querySelector('.dn-btn').addEventListener('click',   () => moveButton(idx, +1));
    list.appendChild(row);
    renderEditRow(idx);
  });
}

function renderPlayPad() {
  const pad = document.getElementById('play-pad');
  if (!pad) return;
  pad.innerHTML = '';
  activeSources.clear();
  const active = buttons.filter(b => b.buffer);
  if (!active.length) { pad.innerHTML = `<p class="pad-empty">${t('noAudio')}</p>`; return; }
  active.forEach(btn => {
    const el = document.createElement('button');
    el.className = 'pad-btn';
    el.setAttribute('data-play-id', btn.id);
    el.textContent = btn.name || ('#' + (btn.id + 1));
    el.addEventListener('pointerdown', e => { e.preventDefault(); triggerPlay(btn.id); });
    pad.appendChild(el);
  });
}

// ── Mode switch ────────────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  // Sync button state immediately (no async — stable)
  document.getElementById('btn-mode-edit')?.classList.toggle('active', m === 'edit');
  document.getElementById('btn-mode-play')?.classList.toggle('active', m === 'play');
  document.getElementById('edit-panel').style.display = m === 'edit' ? '' : 'none';
  document.getElementById('play-panel').style.display = m === 'play' ? '' : 'none';
  if (m === 'play') renderPlayPad();
  // Resume audio in background (non-blocking)
  AudioEngine.resume().catch(() => {});
}

// ── Version display ────────────────────────────────────────────────────────
function showVersions() {
  const el = document.getElementById('version-panel');
  if (!el) return;
  el.innerHTML =
    `app.js ${APP_VERSION} | audio.js ${AudioEngine.VERSION} | drive.js ${Drive.VERSION} | ` +
    `metro.js v0.02 | style.css v0.02 | index.html v0.03`;
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  await openDb();
  AudioEngine.init();
  await loadFromDb();

  AudioEngine.setMasterVolume(masterVol);
  AudioEngine.setMasterPitch(masterPitch);
  Metro.setBpm(bpm);

  renderEditList();
  renderControls();
  setMode('edit');
  showVersions();

  // Controls wiring
  document.getElementById('ctrl-vol').addEventListener('input', e => {
    masterVol = parseFloat(e.target.value);
    AudioEngine.setMasterVolume(masterVol);
    saveToDb();
  });
  document.getElementById('ctrl-bpm').addEventListener('input', e => {
    bpm = parseInt(e.target.value);
    Metro.setBpm(bpm);
    document.getElementById('bpm-val').textContent = bpm;
    saveToDb();
  });
  document.getElementById('ctrl-trim').addEventListener('input', e => {
    trimDb = parseInt(e.target.value);
    document.getElementById('trim-val').textContent = trimDb + 'dB';
    saveToDb();
  });
  document.getElementById('btn-pitch-up').addEventListener('click',    () => changePitch(+1));
  document.getElementById('btn-pitch-down').addEventListener('click',  () => changePitch(-1));
  document.getElementById('btn-pitch-reset').addEventListener('click', resetPitch);
  document.getElementById('btn-metro').addEventListener('click', toggleMetro);
  document.getElementById('btn-sync').addEventListener('click', () => {
    syncOn = !syncOn; renderControls(); saveToDb();
  });
  document.getElementById('btn-mode-edit').addEventListener('click', () => setMode('edit'));
  document.getElementById('btn-mode-play').addEventListener('click', () => setMode('play'));
  document.getElementById('btn-drive').addEventListener('click', async () => {
    if (Drive.isSignedIn()) { Drive.signOut(); renderControls(); }
    else {
      try { await Drive.signIn(); showToast(t('driveOk')); renderControls(); }
      catch(e) { showToast(t('driveErr') + ': ' + e.message, 5000); }
    }
  });
  document.getElementById('btn-drive-save').addEventListener('click', saveToDrive);
  document.getElementById('btn-drive-load').addEventListener('click', loadFromDrive);

  applyLang();
}

// ── Splash ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash');
  const main   = document.getElementById('main');
  let started  = false;

  function startApp(e) {
    if (e) e.preventDefault();
    if (started) return;
    started = true;
    AudioEngine.init(); // init inside user gesture
    splash.style.display = 'none';
    main.style.display   = '';
    init();
  }

  splash.addEventListener('touchend', startApp, { passive: false });
  splash.addEventListener('click',    startApp);
});
