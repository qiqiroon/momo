// MOMO Darts - エントリーモジュール
// 段階2-A: screen 切り替え、ボタンハンドラ、退出確認モーダル
// 段階2-B: センサー許可フロー (SPEC 14.4) + キャリブレーション (SPEC 4.3)
// 段階2-C: 3D 空間 + 的描画（SPEC 4章 / 16章）

import * as Sensor from './darts-sensor.js';
import * as Render from './darts-render.js';

const $ = (id) => document.getElementById(id);

// ===== screen 切り替え =====
const SCREENS = ['lobby', 'room', 'calibration', 'game', 'end'];

function showScreen(name) {
  if (!SCREENS.includes(name)) return;
  for (const s of SCREENS) {
    $(`screen-${s}`).classList.toggle('active', s === name);
  }
  document.body.classList.toggle('in-game', name === 'game');
  window.scrollTo(0, 0);
}

// ===== モーダル =====
let modalResolver = null;
function confirm(text) {
  $('modal-text').textContent = text;
  $('modal-mask').classList.add('active');
  return new Promise((resolve) => { modalResolver = resolve; });
}
function closeModal(answer) {
  $('modal-mask').classList.remove('active');
  if (modalResolver) {
    modalResolver(answer);
    modalResolver = null;
  }
}
$('modal-yes').addEventListener('click', () => closeModal(true));
$('modal-no').addEventListener('click', () => closeModal(false));
$('modal-mask').addEventListener('click', (e) => {
  if (e.target === $('modal-mask')) closeModal(false);
});

// ===== 許可手順案内パネル（SPEC 14.4） =====
function showPermissionPanel() {
  // UA 別手順を挿入
  const kind = Sensor.detectBrowserKind();
  const stepsEl = $('permission-steps');
  let html = '';
  if (kind === 'ios-safari') {
    html = `
      <b>iOS Safari の場合</b>
      1. 「設定」アプリを開く<br>
      2. 「Safari」を選択<br>
      3. 「動きと方向のアクセス」を ON<br>
      4. このページに戻ってリロード
    `;
  } else if (kind === 'ios-other') {
    html = `
      <b>iOS の場合</b>
      お使いのブラウザの設定から<br>
      「動きと方向のアクセス」を許可してください。<br>
      （Safari でのプレイを推奨します）
    `;
  } else if (kind === 'android-chrome') {
    html = `
      <b>Android Chrome の場合</b>
      1. アドレスバー左の鍵アイコンをタップ<br>
      2. 「サイトの設定」 → 「動きセンサー」を許可<br>
      3. このページに戻ってリロード
    `;
  } else if (kind === 'android-other') {
    html = `
      <b>Android の場合</b>
      お使いのブラウザの設定から<br>
      動きセンサーへのアクセスを許可してください。
    `;
  } else {
    // その他のブラウザ：汎用テキストのみ（手順併記なし、SPEC 14.4 検出フォールバック）
    html = `
      <b>その他の環境</b>
      お使いのブラウザの設定から<br>
      動きと方向センサーへのアクセスを許可してください。
    `;
  }
  stepsEl.innerHTML = html;
  $('permission-panel').classList.add('active');
}
function hidePermissionPanel() {
  $('permission-panel').classList.remove('active');
}

// ===== ゲーム開始フロー（SPEC 2.7 / 14.4 / 4.3） =====
async function startGameFlow() {
  // 1. センサー利用可能性チェック
  if (!Sensor.isDeviceOrientationAvailable()) {
    // 利用不可（DeviceOrientationEvent そのものが無い）→ 許可案内パネル表示
    showPermissionPanel();
    return;
  }

  // 2. 明示許可が必要なブラウザ(iOS Safari 13+ 等)は毎回 user-gesture から requestPermission を呼ぶ。
  //    localStorage の許可済フラグだけでは iOS のイベント配信が始まらないケースに対応。
  if (Sensor.needsExplicitPermission()) {
    const result = await Sensor.requestPermission();
    if (result === 'granted') {
      proceedToCalibration();
    } else {
      // 拒否 or 利用不可 → 許可案内パネル表示
      showPermissionPanel();
    }
    return;
  }

  // 3. Android Chrome 等は明示許可不要 → そのままキャリブへ
  proceedToCalibration();
}

// 許可手順案内パネルの「許可しました(OK)」 → 再チェック
$('btn-perm-ok').addEventListener('click', async () => {
  hidePermissionPanel();
  // localStorage を一度クリアして再要求
  Sensor.setStoredPermission(false);
  const result = await Sensor.requestPermission();
  if (result === 'granted') {
    proceedToCalibration();
  } else {
    // まだ許可されていない → ループ（SPEC 14.4）
    showPermissionPanel();
  }
});

// 「ゲーム終了」 → ロビーへ
$('btn-perm-quit').addEventListener('click', () => {
  hidePermissionPanel();
  showScreen('lobby');
});

// ===== キャリブレーション（SPEC 4.3） =====
let _calibSensorActive = false;
let _calibTimeoutId = null;

async function proceedToCalibration() {
  showScreen('calibration');
  const statusEl = $('calib-status');
  const btnFix = $('btn-calib-fix');
  statusEl.classList.remove('error');
  statusEl.textContent = 'センサーを検出中…';
  btnFix.disabled = true;
  _calibSensorActive = false;

  // 診断用: 検出期間中のイベント数と最新値を記録（失敗時のみ画面に表示）
  let diagEventCount = 0;
  let diagLastValues = null;
  const diagListener = (e) => {
    diagEventCount++;
    diagLastValues = { a: e.alpha, b: e.beta, g: e.gamma };
  };
  window.addEventListener('deviceorientation', diagListener);

  // センサーリスナー開始
  Sensor.startListening();

  // 5秒タイムアウトで非搭載判定（SPEC 18.7）
  const detected = await Sensor.detectSensorActive(5000);
  window.removeEventListener('deviceorientation', diagListener);

  if (detected) {
    _calibSensorActive = true;
    statusEl.textContent = 'センサーOK。楽な姿勢で「正面に固定」を押してください';
    btnFix.disabled = false;
  } else {
    // 5秒で値が来ない → 非搭載扱い（SPEC 14.4 / 18.7）
    Sensor.stopListening();
    statusEl.classList.add('error');
    const fmt = (v) => (v === null || v === undefined) ? '–' : (typeof v === 'number' ? v.toFixed(1) : String(v));
    const valStr = diagLastValues
      ? `α=${fmt(diagLastValues.a)} β=${fmt(diagLastValues.b)} γ=${fmt(diagLastValues.g)}`
      : '値未受信';
    statusEl.innerHTML =
      `センサーが検出できません<br>` +
      `<small style="font-size:11px;opacity:0.75;display:block;margin-top:6px;line-height:1.4;">` +
      `events=${diagEventCount} ${valStr}<br>browser=${Sensor.detectBrowserKind()}` +
      `</small>`;
    btnFix.disabled = true;
    // 自動ロビー戻りは廃止 — 退出ボタンで戻る
  }
}

$('btn-calib-fix').addEventListener('click', () => {
  if (!_calibSensorActive) return;
  const ok = Sensor.setCalibration();
  if (!ok) {
    $('calib-status').textContent = 'まだセンサー値が取れていません。少し動かしてからもう一度試してください。';
    return;
  }
  // キャリブ完了 → ゲーム画面へ
  enterGameScreen();
});

$('btn-calib-cancel').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
    Sensor.stopListening();
    Sensor.clearCalibration();
    showScreen('room');
  }
});

// ===== ボタンハンドラ =====
$('btn-solo-start').addEventListener('click', () => showScreen('room'));

$('btn-game-start').addEventListener('click', () => {
  startGameFlow();
});

$('btn-room-leave').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) showScreen('lobby');
});

// ===== ゲーム画面ライフサイクル（段階2-C で追加） =====
function enterGameScreen() {
  showScreen('game');
  const debugEl = $('game-debug-info');
  Render.start({
    viewEl: $('game-3d-view'),
    sceneEl: $('game-3d-scene'),
    boardEl: $('game-3d-board'),
    arrowEl: $('game-3d-arrow'),
    debugCallback: (info) => {
      // 開発用：センサー値と画面位置を表示（段階2-G で残り点数 UI に置換）
      debugEl.textContent =
        `yaw=${info.yawDelta.toFixed(1)}° pitch=${info.pitchDelta.toFixed(1)}° roll=${info.roll.toFixed(1)}°\n` +
        `target=(${info.target.yaw.toFixed(1)}°,${info.target.pitch.toFixed(1)}°) screen=(${info.x.toFixed(0)},${info.y.toFixed(0)})`;
    },
  });
  Render.placeTargetForTurn();
}

function leaveGameScreen() {
  Render.stop();
}

$('btn-next-turn').addEventListener('click', () => {
  Render.placeTargetForTurn();
});

// 中央リセット (v1.15): 現在の姿勢を新キャリブとして登録し、
// 的は新ゲーム同様にランダムシフト配置
$('btn-recenter').addEventListener('click', () => {
  const ok = Sensor.setCalibration();
  if (!ok) {
    // 値未受信時は何もしない
    return;
  }
  Render.placeTargetForTurn();
  $('settings-menu').classList.remove('active');  // メニューを閉じる
});

// v1.15: 歯車メニュー
$('gear-icon').addEventListener('click', (e) => {
  e.stopPropagation();
  $('settings-menu').classList.toggle('active');
});
$('btn-open-tune').addEventListener('click', () => {
  $('settings-menu').classList.remove('active');
  $('tune-panel').classList.add('active');
});
// メニュー外タップで閉じる
document.addEventListener('click', (e) => {
  const menu = $('settings-menu');
  if (menu.classList.contains('active') &&
      !menu.contains(e.target) &&
      e.target.id !== 'gear-icon') {
    menu.classList.remove('active');
  }
});

// ログ共有: navigator.share（iOS Safari の共有シート → Mail/メモ等）優先、
// 利用不可ならクリップボードへフォールバック
$('btn-copy-log').addEventListener('click', async () => {
  const log = Render.getLog();
  const btn = $('btn-copy-log');
  const original = btn.textContent;
  try {
    if (navigator.share) {
      // iOS Safari / Android Chrome: 共有シートを出す
      await navigator.share({
        title: 'MOMO Darts sensor log',
        text: log,
      });
      btn.textContent = '✅ 共有しました';
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(log);
      btn.textContent = '✅ クリップボードへコピー';
    } else {
      const ta = document.createElement('textarea');
      ta.value = log;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '✅ クリップボードへコピー';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') {
      // ユーザーが共有シートを閉じた → 何も表示しない
      return;
    }
    btn.textContent = '⚠️ 失敗: ' + (e.message || e.name || 'unknown');
  }
  setTimeout(() => { btn.textContent = original; }, 1800);
});

$('btn-sim-finish').addEventListener('click', () => {
  // 段階2-A のスタブ：投擲をシミュレートせず即結果画面へ
  leaveGameScreen();
  $('end-result-msg').textContent = 'FINISH!';
  $('end-result-msg').classList.remove('lose');
  $('end-result-msg').classList.add('win');
  $('end-result-sub').textContent = '21 ダーツでフィニッシュ（仮表示）';
  showScreen('end');
});

$('btn-game-leave').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
    leaveGameScreen();
    Sensor.stopListening();
    Sensor.clearCalibration();
    showScreen('room');
  }
});

$('btn-end-replay').addEventListener('click', () => {
  // SPEC 12.6: 再戦時はキャリブをセッション中スキップ
  // calibration を残したまま game へ直行
  if (Sensor.getCalibration()) {
    enterGameScreen();
  } else {
    startGameFlow();
  }
});
$('btn-end-rule-change').addEventListener('click', () => showScreen('room'));
$('btn-end-back-room').addEventListener('click', () => showScreen('room'));

// ===== v1.14: 感度調整パネル（直感的ラベル + 倍率/%表示） =====
const TUNE_DEFAULTS = { roll: 0.7, sens: 1.0, smooth: 0.4 };
const TUNE_STEPS = { roll: 0.1, sens: 0.1, smooth: 0.1 };
const TUNE_LIMITS = {
  roll:   { min: 0.3, max: 1.5 },
  sens:   { min: 0.5, max: 2.0 },
  smooth: { min: 0.1, max: 1.0 },
};
const TUNE_LS_KEY = 'momoDartsTune';

function loadTuneFromStorage() {
  try {
    const saved = JSON.parse(localStorage.getItem(TUNE_LS_KEY) || '{}');
    return {
      roll:   typeof saved.roll   === 'number' ? saved.roll   : TUNE_DEFAULTS.roll,
      sens:   typeof saved.sens   === 'number' ? saved.sens   : TUNE_DEFAULTS.sens,
      smooth: typeof saved.smooth === 'number' ? saved.smooth : TUNE_DEFAULTS.smooth,
    };
  } catch {
    return { ...TUNE_DEFAULTS };
  }
}
function saveTuneToStorage(t) {
  try { localStorage.setItem(TUNE_LS_KEY, JSON.stringify(t)); } catch {}
}

function applyTune(t) {
  Render.setRollScale(t.roll);
  Render.setYawPitchScale(t.sens);
  Render.setSmoothFactor(t.smooth);
  $('tune-roll-val').textContent   = `${t.roll.toFixed(1)}×`;
  $('tune-sens-val').textContent   = `${t.sens.toFixed(1)}×`;
  $('tune-smooth-val').textContent = `${Math.round(t.smooth * 100)}%`;
}

const _tune = loadTuneFromStorage();
applyTune(_tune);

$('btn-tune').addEventListener('click', () => {
  $('tune-panel').classList.toggle('active');
});
$('btn-tune-close').addEventListener('click', () => {
  $('tune-panel').classList.remove('active');
});
$('btn-tune-reset').addEventListener('click', () => {
  Object.assign(_tune, TUNE_DEFAULTS);
  applyTune(_tune);
  saveTuneToStorage(_tune);
});

document.querySelectorAll('.tune-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.tune;  // 'roll' | 'sens' | 'smooth'
    const dir = btn.dataset.dir === '+' ? 1 : -1;
    const step = TUNE_STEPS[key];
    const limit = TUNE_LIMITS[key];
    let v = _tune[key] + dir * step;
    v = Math.max(limit.min, Math.min(limit.max, v));
    v = Math.round(v * 100) / 100;
    _tune[key] = v;
    applyTune(_tune);
    saveTuneToStorage(_tune);
  });
});

// ===== 言語切替（段階2-A: サブタイトルのみ。本格 i18n は段階4） =====
const SUBTITLES = {
  ja: 'Concealed Edge, Single Touch',
  en: 'Concealed Edge, Single Touch',
  zh: '不露鋒心，一指乾坤',
};

function applyLang(lang) {
  const subtitleEl = $('subtitle');
  if (lang === 'cat') return; // 猫語選択時はサブタイトルだけ前言語のまま維持
  if (SUBTITLES[lang]) {
    subtitleEl.textContent = SUBTITLES[lang];
    subtitleEl.classList.toggle('zh', lang === 'zh');
  }
}

const langSelect = $('lang-select');
langSelect.addEventListener('change', (e) => applyLang(e.target.value));

// ===== 起動時 =====
applyLang('ja');
showScreen('lobby');
