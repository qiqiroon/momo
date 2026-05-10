// MOMO Darts - エントリーモジュール
// 段階2-A: screen 切り替え、ボタンハンドラ、退出確認モーダル
// 段階2-B: センサー許可フロー (SPEC 14.4) + キャリブレーション (SPEC 4.3)

import * as Sensor from './darts-sensor.js';

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

  // 2. localStorage の許可済フラグを確認
  if (Sensor.getStoredPermission()) {
    // 既に許可済 → センサー動作確認 → キャリブへ
    proceedToCalibration();
    return;
  }

  // 3. 許可ダイアログを呼ぶ
  const result = await Sensor.requestPermission();
  if (result === 'granted') {
    proceedToCalibration();
  } else {
    // 拒否 or 利用不可 → 許可案内パネル表示
    showPermissionPanel();
  }
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

  // センサーリスナー開始
  Sensor.startListening();

  // 5秒タイムアウトで非搭載判定（SPEC 18.7）
  const detected = await Sensor.detectSensorActive(5000);
  if (detected) {
    _calibSensorActive = true;
    statusEl.textContent = 'センサーOK。楽な姿勢で「正面に固定」を押してください';
    btnFix.disabled = false;
  } else {
    // 5秒で値が来ない → 非搭載扱い（SPEC 14.4 / 18.7）
    Sensor.stopListening();
    statusEl.classList.add('error');
    statusEl.textContent = 'センサーが検出できません。この端末では遊べません。';
    btnFix.disabled = true;
    // 2秒後にロビーへ戻す
    setTimeout(() => showScreen('lobby'), 2000);
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
  showScreen('game');
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

$('btn-sim-finish').addEventListener('click', () => {
  // 段階2-A のスタブ：投擲をシミュレートせず即結果画面へ
  $('end-result-msg').textContent = 'FINISH!';
  $('end-result-msg').classList.remove('lose');
  $('end-result-msg').classList.add('win');
  $('end-result-sub').textContent = '21 ダーツでフィニッシュ（仮表示）';
  showScreen('end');
});

$('btn-game-leave').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
    Sensor.stopListening();
    Sensor.clearCalibration();
    showScreen('room');
  }
});

$('btn-end-replay').addEventListener('click', () => {
  // SPEC 12.6: 再戦時はキャリブをセッション中スキップ
  // calibration を残したまま game へ直行
  if (Sensor.getCalibration()) {
    showScreen('game');
  } else {
    startGameFlow();
  }
});
$('btn-end-rule-change').addEventListener('click', () => showScreen('room'));
$('btn-end-back-room').addEventListener('click', () => showScreen('room'));

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
