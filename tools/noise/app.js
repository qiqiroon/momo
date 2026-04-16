// app.js - MOMO Noise Main Controller
'use strict';

// ── I18N ──────────────────────────────────────────────────────────────────
const I18N = {
  ja: {
    appSub:        'ver 1.00',
    editMode:      '編集',
    playMode:      '再生',
    masterVol:     'マスター音量',
    masterPitch:   'ピッチ',
    metro:         'メトロノーム',
    bpm:           'BPM',
    btnName:       'ボタン名',
    record:        '録音',
    recording:     '録音中…',
    stopRec:       '停止',
    play:          '再生',
    fileLoad:      'ファイル',
    save:          '保存',
    erase:         '消去',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       '音声なし',
    driveConnect:  'Drive接続',
    driveDiscon:   '切断',
    driveSave:     'Driveに保存',
    localSave:     'ローカル保存',
    confirmErase:  'この音声を消去しますか？',
    splash:        'タップして開始',
    splashSub:     'MOMO Noise',
    syncOn:        'シンクON',
    syncOff:       'シンクOFF',
    trimLabel:     '無音カット閾値',
    noAudio:       '音声が設定されていないボタンがあります',
    saved:         '保存しました',
    saveErr:       '保存に失敗しました',
    driveOk:       'Drive接続完了',
    driveErr:      'Drive接続に失敗しました',
  },
  en: {
    appSub:        'ver 1.00',
    editMode:      'Edit',
    playMode:      'Play',
    masterVol:     'Master Vol',
    masterPitch:   'Pitch',
    metro:         'Metronome',
    bpm:           'BPM',
    btnName:       'Button Name',
    record:        'Record',
    recording:     'Recording…',
    stopRec:       'Stop',
    play:          'Play',
    fileLoad:      'File',
    save:          'Save',
    erase:         'Erase',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       'No sound',
    driveConnect:  'Connect Drive',
    driveDiscon:   'Disconnect',
    driveSave:     'Save to Drive',
    localSave:     'Save Local',
    confirmErase:  'Erase this sound?',
    splash:        'Tap to Start',
    splashSub:     'MOMO Noise',
    syncOn:        'Sync ON',
    syncOff:       'Sync OFF',
    trimLabel:     'Silence Trim',
    noAudio:       'Some buttons have no audio assigned',
    saved:         'Saved',
    saveErr:       'Save failed',
    driveOk:       'Drive connected',
    driveErr:      'Drive connection failed',
  },
  zh: {
    appSub:        'ver 1.00',
    editMode:      '编辑',
    playMode:      '播放',
    masterVol:     '主音量',
    masterPitch:   '音调',
    metro:         '节拍器',
    bpm:           'BPM',
    btnName:       '按钮名称',
    record:        '录音',
    recording:     '录音中…',
    stopRec:       '停止',
    play:          '播放',
    fileLoad:      '文件',
    save:          '保存',
    erase:         '清除',
    moveUp:        '↑',
    moveDown:      '↓',
    noSound:       '无音频',
    driveConnect:  '连接Drive',
    driveDiscon:   '断开',
    driveSave:     '保存到Drive',
    localSave:     '本地保存',
    confirmErase:  '确认清除此音频？',
    splash:        '点击开始',
    splashSub:     'MOMO Noise',
    syncOn:        '同步开',
    syncOff:       '同步关',
    trimLabel:     '静音裁切',
    noAudio:       '部分按钮未设置音频',
    saved:         '已保存',
    saveErr:       '保存失败',
    driveOk:       'Drive已连接',
    driveErr:      'Drive连接失败',
  }
};

// catSpeak
let catBase = 'ja';
const CAT_ERROR = { ja: ['シャー！','フーッ！','シャシャシャ！'], en: ['HISS!','SPIT!','FSSST!'], zh: ['嘶！','哈！','嘶嘶！'] };
const CAT_CALM  = { ja: ['ごろごろ…','にゃ…','ぐるぐる…'],     en: ['purrrr...','mrrr...','prrr...'],  zh: ['咕噜…','喵…','噜噜…'] };
const CAT_NORM  = { ja: ['にゃあ','にゃ','にゃーん','みゃお','ニャ！'], en: ['MEOW','meow','mrrrow','mew','NYA!'], zh: ['喵','喵呜','咪','喵！'] };
const CAT_ERR_KEYS  = ['saveErr','driveErr'];
const CAT_CALM_KEYS = ['driveConnect','recording'];

function catSpeak(key) {
  const base = catBase === 'en' || catBase === 'zh' ? catBase : 'ja';
  let vocab;
  if (CAT_ERR_KEYS.includes(key))  vocab = CAT_ERROR[base];
  else if (CAT_CALM_KEYS.includes(key)) vocab = CAT_CALM[base];
  else vocab = CAT_NORM[base];
  return vocab[Math.floor(Math.random() * vocab.length)];
}

let currentLang = (() => {
  try { const v = localStorage.getItem('momoLang'); return ['ja','en','zh','cat'].includes(v) ? v : 'ja'; } catch(e) { return 'ja'; }
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
  document.documentElement.lang = currentLang === 'zh' ? 'zh-Hans' : (currentLang === 'cat' ? catBase : currentLang);
  renderEditList();
  renderControls();
}

// ── State ─────────────────────────────────────────────────────────────────
const MAX_BUTTONS = 30;
let buttons = Array.from({ length: MAX_BUTTONS }, (_, i) => ({
  id: i,
  name: '',
  buffer: null,       // AudioBuffer
  fileName: null,     // original filename (read-only, no re-save)
  volume: 1.0,
  pitch: 1.0,
}));
let mode = 'edit';   // 'edit' | 'play'
let masterVol   = 1.0;
let masterPitch = 1.0;
let metroOn     = false;
let syncOn      = false;
let bpm         = 120;
let trimDb      = -40;

// Active play sources: Map<buttonId, stopFn[]>
const activeSources = new Map();

// ── Persistence (IndexedDB) ───────────────────────────────────────────────
const DB_NAME = 'momonoise';
const DB_VER  = 1;
let db = null;

function openDb() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('buttons')) d.createObjectStore('buttons', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess  = e => { db = e.target.result; res(db); };
    req.onerror    = e => rej(e.target.error);
  });
}

async function saveToDb() {
  if (!db) return;
  const tx = db.transaction(['buttons', 'settings'], 'readwrite');
  const store = tx.objectStore('buttons');
  for (const btn of buttons) {
    // Store buffer as Float32Array[]
    let bufData = null;
    if (btn.buffer) {
      bufData = [];
      for (let c = 0; c < btn.buffer.numberOfChannels; c++) {
        bufData.push(Array.from(btn.buffer.getChannelData(c)));
      }
    }
    store.put({ id: btn.id, name: btn.name, volume: btn.volume, pitch: btn.pitch, fileName: btn.fileName, bufData, sampleRate: btn.buffer?.sampleRate });
  }
  const settings = tx.objectStore('settings');
  settings.put({ key: 'global', masterVol, masterPitch, bpm, trimDb, syncOn });
}

async function loadFromDb() {
  if (!db) return;
  return new Promise(res => {
    const tx = db.transaction(['buttons', 'settings'], 'readonly');
    const store = tx.objectStore('buttons');
    const req = store.getAll();
    req.onsuccess = async e => {
      const rows = e.target.result;
      for (const row of rows) {
        const btn = buttons[row.id];
        if (!btn) continue;
        btn.name = row.name || '';
        btn.volume = row.volume ?? 1.0;
        btn.pitch  = row.pitch  ?? 1.0;
        btn.fileName = row.fileName || null;
        if (row.bufData && row.sampleRate) {
          try {
            const ctx = AudioEngine.getCtx() || new (window.AudioContext || window.webkitAudioContext)();
            const buf = ctx.createBuffer(row.bufData.length, row.bufData[0].length, row.sampleRate);
            for (let c = 0; c < row.bufData.length; c++) {
              buf.getChannelData(c).set(new Float32Array(row.bufData[c]));
            }
            btn.buffer = buf;
          } catch(e) { console.warn('Failed to restore buffer', row.id, e); }
        }
      }
      // Load settings
      const sReq = tx.objectStore('settings').get('global');
      sReq.onsuccess = f => {
        const s = f.target.result;
        if (s) {
          masterVol   = s.masterVol   ?? 1.0;
          masterPitch = s.masterPitch ?? 1.0;
          bpm         = s.bpm         ?? 120;
          trimDb      = s.trimDb      ?? -40;
          syncOn      = s.syncOn      ?? false;
        }
        res();
      };
      sReq.onerror = () => res();
    };
    req.onerror = () => res();
  });
}

// ── Drive save/load ────────────────────────────────────────────────────────
async function saveToDrive() {
  if (!Drive.isSignedIn()) { showToast(t('driveErr')); return; }
  showToast('…');
  try {
    // Save settings JSON
    const meta = buttons.map(b => ({ id: b.id, name: b.name, volume: b.volume, pitch: b.pitch, fileName: b.fileName, hasBuffer: !!b.buffer }));
    await Drive.saveJson('noise_settings.json', { meta, masterVol, masterPitch, bpm, trimDb, syncOn });

    // Save WAV for each recorded (non-file) button
    for (const btn of buttons) {
      if (!btn.buffer || btn.fileName) continue; // skip file-loaded buffers
      const wav = AudioEngine.bufferToWav(btn.buffer);
      await Drive.uploadWav(`noise_btn_${btn.id}.wav`, wav);
    }
    showToast(t('saved'));
  } catch(e) {
    console.error(e);
    showToast(t('saveErr'));
  }
}

async function loadFromDrive() {
  if (!Drive.isSignedIn()) return;
  try {
    const data = await Drive.loadJson('noise_settings.json');
    if (!data) return;
    if (data.meta) {
      for (const m of data.meta) {
        const btn = buttons[m.id];
        if (!btn) continue;
        btn.name     = m.name     || '';
        btn.volume   = m.volume   ?? 1.0;
        btn.pitch    = m.pitch    ?? 1.0;
        btn.fileName = m.fileName || null;
      }
    }
    masterVol   = data.masterVol   ?? masterVol;
    masterPitch = data.masterPitch ?? masterPitch;
    bpm         = data.bpm         ?? bpm;
    trimDb      = data.trimDb      ?? trimDb;
    syncOn      = data.syncOn      ?? syncOn;
  } catch(e) { console.warn('Drive load failed', e); }
}

// ── Local WAV download ─────────────────────────────────────────────────────
function downloadWav(btn) {
  if (!btn.buffer) return;
  const blob = AudioEngine.bufferToWav(btn.buffer);
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href     = url;
  a.download = `${btn.name || 'noise_' + btn.id}.wav`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Toast ──────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// ── Metronome ──────────────────────────────────────────────────────────────
function toggleMetro() {
  metroOn = !metroOn;
  if (metroOn) {
    Metro.setBpm(bpm);
    Metro.start(onBeat);
  } else {
    Metro.stop();
    document.getElementById('beat-flash')?.classList.remove('flash');
  }
  renderControls();
}

function onBeat(beatNum) {
  const el = document.getElementById('beat-flash');
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 80);
}

// ── Play button ────────────────────────────────────────────────────────────
function triggerPlay(btnId) {
  const btn = buttons[btnId];
  if (!btn || !btn.buffer) return;

  AudioEngine.init();
  const pressTime = AudioEngine.getCurrentTime();

  let startAt = pressTime;
  if (metroOn && syncOn) {
    const snapped = Metro.snapToBeat(pressTime);
    if (snapped !== null) startAt = snapped;
  }

  const stopFn = AudioEngine.play(btn.buffer, {
    volume: btn.volume,
    pitch:  btn.pitch,
    startAt,
    onEnded: () => {
      const srcs = activeSources.get(btnId);
      if (srcs) {
        const idx = srcs.indexOf(stopFn);
        if (idx !== -1) srcs.splice(idx, 1);
        if (srcs.length === 0) {
          activeSources.delete(btnId);
          updatePlayButtonState(btnId, false);
        }
      }
    }
  });

  if (!activeSources.has(btnId)) activeSources.set(btnId, []);
  activeSources.get(btnId).push(stopFn);
  updatePlayButtonState(btnId, true);
}

function updatePlayButtonState(btnId, active) {
  const el = document.querySelector(`[data-play-id="${btnId}"]`);
  if (el) el.classList.toggle('active', active);
}

// ── Edit: Recording state per button ──────────────────────────────────────
let recordingBtnId = null;
let previewStopFn  = null;

async function startRecord(btnId) {
  if (recordingBtnId !== null) return;
  try {
    await AudioEngine.startRecording();
    recordingBtnId = btnId;
    renderEditRow(btnId);
  } catch(e) {
    showToast('🎤 ' + (e.message || 'Mic error'));
    recordingBtnId = null;
    renderEditRow(btnId);
  }
}

async function stopRecord(btnId) {
  if (recordingBtnId !== btnId) return;
  const buffer = await AudioEngine.stopRecording();
  recordingBtnId = null;
  if (buffer) {
    buttons[btnId].buffer   = buffer;
    buttons[btnId].fileName = null; // recorded, not file
  }
  renderEditRow(btnId);
  saveToDb();
}

async function loadFile(btnId) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'audio/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) { resolve(); return; }
      const ab = await file.arrayBuffer();
      try {
        AudioEngine.init();
        const buffer = await AudioEngine.decodeFile(ab);
        buttons[btnId].buffer   = buffer;
        buttons[btnId].fileName = file.name; // mark as file-loaded (read-only)
        renderEditRow(btnId);
        saveToDb();
      } catch(e) { showToast('⚠ ' + e.message); }
      resolve();
    };
    input.click();
  });
}

function previewButton(btnId) {
  if (previewStopFn) { previewStopFn(); previewStopFn = null; }
  const btn = buttons[btnId];
  if (!btn.buffer) return;
  AudioEngine.init();
  previewStopFn = AudioEngine.play(btn.buffer, { volume: btn.volume, pitch: btn.pitch });
}

function eraseButton(btnId) {
  if (!confirm(t('confirmErase'))) return;
  buttons[btnId].buffer   = null;
  buttons[btnId].fileName = null;
  buttons[btnId].name     = '';
  renderEditRow(btnId);
  saveToDb();
}

function moveButton(btnId, dir) {
  const idx    = btnId;
  const target = idx + dir;
  if (target < 0 || target >= MAX_BUTTONS) return;
  [buttons[idx], buttons[target]] = [buttons[target], buttons[idx]];
  buttons[idx].id    = idx;
  buttons[target].id = target;
  renderEditList();
  saveToDb();
}

// ── Render helpers ─────────────────────────────────────────────────────────
function renderControls() {
  // Master volume
  const volEl = document.getElementById('ctrl-vol');
  if (volEl) volEl.value = masterVol;
  // Master pitch
  const pitchEl = document.getElementById('ctrl-pitch');
  if (pitchEl) pitchEl.value = masterPitch;
  // BPM
  const bpmEl = document.getElementById('ctrl-bpm');
  if (bpmEl) bpmEl.value = bpm;
  // Metro button
  const metBtn = document.getElementById('btn-metro');
  if (metBtn) { metBtn.textContent = t('metro'); metBtn.classList.toggle('active', metroOn); }
  // Sync button
  const syncBtn = document.getElementById('btn-sync');
  if (syncBtn) { syncBtn.textContent = syncOn ? t('syncOn') : t('syncOff'); syncBtn.classList.toggle('active', syncOn); }
  // Mode buttons
  const editBtn = document.getElementById('btn-mode-edit');
  const playBtn = document.getElementById('btn-mode-play');
  if (editBtn) { editBtn.textContent = t('editMode'); editBtn.classList.toggle('active', mode === 'edit'); }
  if (playBtn) { playBtn.textContent = t('playMode'); playBtn.classList.toggle('active', mode === 'play'); }
  // Drive button
  const driveBtn = document.getElementById('btn-drive');
  if (driveBtn) driveBtn.textContent = Drive.isSignedIn() ? t('driveDiscon') : t('driveConnect');
  // Labels
  const lblVol   = document.getElementById('lbl-vol');
  const lblPitch = document.getElementById('lbl-pitch');
  const lblBpm   = document.getElementById('lbl-bpm');
  const lblTrim  = document.getElementById('lbl-trim');
  if (lblVol)   lblVol.textContent   = t('masterVol');
  if (lblPitch) lblPitch.textContent = t('masterPitch');
  if (lblBpm)   lblBpm.textContent   = t('bpm');
  if (lblTrim)  lblTrim.textContent  = t('trimLabel');
}

function renderEditRow(btnId) {
  const row = document.querySelector(`[data-edit-row="${btnId}"]`);
  if (!row) return;
  const btn    = buttons[btnId];
  const isRec  = recordingBtnId === btnId;
  const hasAud = !!btn.buffer;

  row.querySelector('.btn-name-input').value = btn.name;
  row.querySelector('.btn-has-audio').textContent = hasAud ? (btn.fileName ? `📄 ${btn.fileName}` : '🎙') : t('noSound');
  row.querySelector('.btn-has-audio').classList.toggle('has-audio', hasAud);

  const recBtn  = row.querySelector('.rec-btn');
  const stopBtn = row.querySelector('.stop-rec-btn');
  recBtn.textContent  = t('record');
  stopBtn.textContent = t('stopRec');
  recBtn.style.display  = isRec ? 'none' : '';
  stopBtn.style.display = isRec ? '' : 'none';
  if (isRec) recBtn.classList.add('recording');
  else recBtn.classList.remove('recording');

  row.querySelector('.play-prev-btn').textContent  = t('play');
  row.querySelector('.file-btn').textContent       = t('fileLoad');
  row.querySelector('.save-btn').textContent       = t('save');
  row.querySelector('.erase-btn').textContent      = t('erase');
  row.querySelector('.move-up-btn').textContent    = t('moveUp');
  row.querySelector('.move-down-btn').textContent  = t('moveDown');

  // Disable buttons appropriately
  row.querySelector('.play-prev-btn').disabled = !hasAud;
  row.querySelector('.save-btn').disabled      = !hasAud || !!btn.fileName;
  row.querySelector('.erase-btn').disabled     = !hasAud;
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
        <button class="rec-btn noise-btn"></button>
        <button class="stop-rec-btn noise-btn btn-danger" style="display:none"></button>
        <button class="play-prev-btn noise-btn"></button>
        <button class="file-btn noise-btn"></button>
        <button class="save-btn noise-btn"></button>
        <button class="erase-btn noise-btn btn-danger"></button>
        <button class="move-up-btn noise-btn btn-move"></button>
        <button class="move-down-btn noise-btn btn-move"></button>
      </div>
    `;

    // Name input
    row.querySelector('.btn-name-input').addEventListener('input', e => {
      buttons[idx].name = e.target.value;
      saveToDb();
    });
    // Drag-to-reorder (simple touch/mouse drag by index swap via buttons)
    row.querySelector('.rec-btn').addEventListener('click', () => startRecord(idx));
    row.querySelector('.stop-rec-btn').addEventListener('click', () => stopRecord(idx));
    row.querySelector('.play-prev-btn').addEventListener('click', () => previewButton(idx));
    row.querySelector('.file-btn').addEventListener('click', () => loadFile(idx));
    row.querySelector('.save-btn').addEventListener('click', () => downloadWav(btn));
    row.querySelector('.erase-btn').addEventListener('click', () => eraseButton(idx));
    row.querySelector('.move-up-btn').addEventListener('click', () => moveButton(idx, -1));
    row.querySelector('.move-down-btn').addEventListener('click', () => moveButton(idx, +1));

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
  if (active.length === 0) {
    pad.innerHTML = `<p class="pad-empty">${t('noSound')}</p>`;
    return;
  }
  active.forEach(btn => {
    const el = document.createElement('button');
    el.className = 'pad-btn';
    el.setAttribute('data-play-id', btn.id);
    el.textContent = btn.name || `#${btn.id + 1}`;

    // Touch & mouse events for immediate response
    const fire = (e) => { e.preventDefault(); triggerPlay(btn.id); };
    el.addEventListener('pointerdown', fire);

    pad.appendChild(el);
  });
}

// ── Mode switch ────────────────────────────────────────────────────────────
function setMode(m) {
  mode = m;
  // Resume AudioContext on iOS (must be called in user gesture handler)
  const actx = AudioEngine.getCtx();
  if (actx && actx.state === 'suspended') actx.resume();
  document.getElementById('edit-panel').style.display = m === 'edit' ? '' : 'none';
  document.getElementById('play-panel').style.display = m === 'play' ? '' : 'none';
  if (m === 'play') renderPlayPad();
  renderControls();
}

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  await openDb();
  AudioEngine.init();  // safe after splash tap
  await loadFromDb();

  // Apply saved settings
  AudioEngine.setMasterVolume(masterVol);
  AudioEngine.setMasterPitch(masterPitch);
  Metro.setBpm(bpm);

  renderEditList();
  renderControls();
  setMode('edit');

  // Try silent Drive reconnect
  try {
    const ok = await Drive.signInSilent();
    if (ok) { await loadFromDrive(); renderEditList(); showToast(t('driveOk')); }
  } catch(e) {}

  // Wire controls
  document.getElementById('ctrl-vol').addEventListener('input', e => {
    masterVol = parseFloat(e.target.value);
    AudioEngine.setMasterVolume(masterVol);
    saveToDb();
  });
  document.getElementById('ctrl-pitch').addEventListener('input', e => {
    masterPitch = parseFloat(e.target.value);
    AudioEngine.setMasterPitch(masterPitch);
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
  document.getElementById('btn-metro').addEventListener('click', toggleMetro);
  document.getElementById('btn-sync').addEventListener('click', () => { syncOn = !syncOn; renderControls(); saveToDb(); });
  document.getElementById('btn-mode-edit').addEventListener('click', () => setMode('edit'));
  document.getElementById('btn-mode-play').addEventListener('click', () => setMode('play'));
  document.getElementById('btn-drive').addEventListener('click', async () => {
    if (Drive.isSignedIn()) {
      Drive.signOut();
      renderControls();
    } else {
      showToast(t('driveConnect') + '…');
      try { await Drive.signIn(); showToast(t('driveOk')); } catch(e) { showToast(t('driveErr')); }
      renderControls();
    }
  });
  document.getElementById('btn-drive-save').addEventListener('click', saveToDrive);

  applyLang();
}

// Splash screen handler
document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash');
  const main   = document.getElementById('main');

  function startApp() {
    splash.style.display = 'none';
    main.style.display   = '';
    init();
  }

  splash.addEventListener('click', startApp);
  splash.addEventListener('touchend', e => { e.preventDefault(); startApp(); });
});
