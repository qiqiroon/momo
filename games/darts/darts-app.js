// MOMO Darts - エントリーモジュール
// 段階2-A: screen 切り替え、ボタンハンドラ、退出確認モーダル
// 段階2-B: センサー許可フロー (SPEC 14.4) + キャリブレーション (SPEC 4.3)
// 段階2-C: 3D 空間 + 的描画（SPEC 4章 / 16章）

import * as Sensor from './darts-sensor.js';
import * as Render from './darts-render.js';
import * as Input from './darts-input.js';
import * as Physics from './darts-physics.js';
import * as Rules from './darts-rules.js';

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

// ===== ゲーム画面ライフサイクル =====
let _gameState = null;  // v1.23: Rules.createInitialState() の戻り値

function updateScoreUI() {
  if (!_gameState) return;
  $('ui-remaining').textContent = String(_gameState.remaining);
  $('ui-turn-total').textContent = `TURN +${Rules.turnTotal(_gameState)}`;
  for (let i = 0; i < 3; i++) {
    const slot = $(`ui-shot-${i + 1}`);
    const shot = _gameState.turnShots[i];
    if (shot) {
      slot.textContent = `${shot.label}=${shot.value}`;
      slot.classList.remove('pending');
      slot.classList.toggle('miss', shot.kind === 'MISS');
    } else {
      slot.textContent = '—';
      slot.classList.add('pending');
      slot.classList.remove('miss');
    }
  }
}

function enterGameScreen() {
  showScreen('game');
  const debugEl = $('game-debug-info');
  Render.start({
    viewEl: $('game-3d-view'),
    sceneEl: $('game-3d-scene'),
    boardEl: $('game-3d-board'),
    arrowEl: $('game-3d-arrow'),
    debugCallback: (info) => {
      debugEl.textContent =
        `yaw=${info.yawDelta.toFixed(1)}° pitch=${info.pitchDelta.toFixed(1)}° roll=${info.roll.toFixed(1)}°\n` +
        `target=(${info.target.yaw.toFixed(1)}°,${info.target.pitch.toFixed(1)}°)`;
    },
  });
  // ゲーム状態を初期化
  _gameState = Rules.createInitialState();
  updateScoreUI();
  Render.placeTargetForTurn();

  // v1.17: ホールドボタン入力を起動
  Input.start({ onRelease: onDartReleased });
}

function leaveGameScreen() {
  Render.stop();
  Input.stop();
}

// v1.23: 投擲リリース → 物理シミュ → 着弾後にスコア計算
function onDartReleased({ hand, strength, durationMs }) {
  const aim = Render.getCurrentAim();
  const aimYawRad   = (aim.yawDeg   * Math.PI) / 180;
  const aimPitchRad = (aim.pitchDeg * Math.PI) / 180;

  const sim = Physics.simulateThrow({ hand, strength, aimYawRad, aimPitchRad });

  Render.fireFlight(sim, (result) => {
    // result = { world, board: { x, y } | null }
    const shot = Rules.scoreFromImpactSVG(result.board);
    console.log(`[darts] hand=${hand} s=${strength.toFixed(2)} → ${shot.label} (${shot.value}pt) ` +
                `imp=${result.board ? `(${result.board.x.toFixed(1)},${result.board.y.toFixed(1)})` : 'MISS-FALL'}`);

    // v1.24: 投擲イベントをログ
    const shotInTurn = _gameState.turnShots.length + 1;
    Render.logEvent({
      type: 'shot',
      turn: _gameState.turnIndex,
      shotInTurn,
      hand,
      strength: +strength.toFixed(3),
      durationMs: +durationMs.toFixed(0),
      aim: { yaw: +aim.yawDeg.toFixed(2), pitch: +aim.pitchDeg.toFixed(2) },
      impactWorld: {
        x: +result.world.x.toFixed(3),
        y: +result.world.y.toFixed(3),
        z: +result.world.z.toFixed(3),
        t: +result.world.t.toFixed(3),
        hit: result.world.hit,
        stopReason: result.world.stopReason,
      },
      impactBoard: result.board
        ? { x: +result.board.x.toFixed(1), y: +result.board.y.toFixed(1) }
        : null,
      score: shot,
      remainingBefore: _gameState.remaining,
    });

    const r = Rules.applyShot(_gameState, shot);
    updateScoreUI();

    // === FINISH (v1.25) ===
    if (r.finished) {
      console.log('[darts] FINISH! darts=' + _gameState.dartCount);
      Render.logEvent({ type: 'finish', dartCount: _gameState.dartCount, turns: _gameState.turnIndex });
      showAnnouncement('finish', 'FINISH!', `${_gameState.dartCount} ダーツ`);
      setTimeout(() => {
        showEndScreen();
      }, 2200);
      return;
    }

    // === BUST (v1.25) ===
    if (r.bust) {
      console.log('[darts] BUST! reverted to ' + _gameState.remaining);
      Render.logEvent({ type: 'bust', remainingAfter: _gameState.remaining });
      showAnnouncement('bust', 'BUST!', '');
      // バースト時もターンは終了
      setTimeout(() => {
        Render.placeTargetForTurn();
        updateScoreUI();
        Input.setDisabled(false);
      }, 2000);
      return;
    }

    // === 通常のターン進行 ===
    if (r.turnEnded) {
      // v1.24: 3投目を 2 秒見せてからターン進行
      setTimeout(() => {
        Render.placeTargetForTurn();
        updateScoreUI();
        Input.setDisabled(false);
      }, 2000);
      return;
    }
    Input.setDisabled(false);
  });
}

// v1.25: BUST / FINISH の中央オーバーレイ
function showAnnouncement(kind, main, sub) {
  const el = $('big-announcement');
  el.className = '';
  el.classList.add(kind);
  el.innerHTML = sub ? `${main}<span class="sub">${sub}</span>` : main;
  // reflow trick to retrigger animation
  void el.offsetWidth;
  el.classList.add('show');
  // フェードアウト
  setTimeout(() => {
    el.classList.remove('show');
  }, 1700);
}

// v1.25: 結果画面の表示（FINISH 時に呼ばれる）
function showEndScreen() {
  if (!_gameState) return;
  const ach = Rules.getAchievement(_gameState.dartCount);

  // 統計集計
  const turns = _gameState.history.length;
  const busts = _gameState.history.filter(h => h.bust).length;
  const turnScores = _gameState.history
    .filter(h => !h.bust)
    .map(h => h.shots.reduce((a, s) => a + s.value, 0));
  const bestTurn = turnScores.length ? Math.max(...turnScores) : 0;

  $('end-result-msg').textContent = `${ach.emoji} ${ach.label}`;
  $('end-result-msg').className = 'result-message win';
  $('end-result-sub').textContent = `${_gameState.dartCount} ダーツでフィニッシュ`;
  $('end-stat-darts').textContent = _gameState.dartCount;
  $('end-stat-turns').textContent = turns;
  $('end-stat-busts').textContent = busts;
  $('end-stat-best').textContent = bestTurn;

  leaveGameScreen();
  showScreen('end');
}

$('btn-next-turn').addEventListener('click', () => {
  // v1.23: 強制ターン進行（デバッグ用）。現在のターンの shot は破棄
  if (_gameState) {
    _gameState.turnShots = [];
    _gameState.turnIndex++;
    _gameState.turnStartRemaining = _gameState.remaining;
    updateScoreUI();
  }
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

// ===== ログ送信: Google Drive (Apps Script Web App 経由) =====
// 失敗時は navigator.share → クリップボードへフォールバック
const DEBUG_LOG_URL = 'https://script.google.com/macros/s/AKfycbzzauKNWW1D_uKy5gZZ9jDqzMpVgScOJWzxijTCXdP1RpbNyuQMdb29Flek-ffn87bf/exec';

async function uploadLogToDrive(logObj, tag) {
  const payload = {
    app: 'momo-darts',
    version: $('version-tag')?.textContent || '?',
    ts: new Date().toISOString(),
    ua: navigator.userAgent,
    screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    log: logObj,  // v1.24: object（config / samples / events）
  };
  // Content-Type: text/plain で CORS preflight を回避（Apps Script の制約）
  const url = `${DEBUG_LOG_URL}?tag=${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'apps-script error');
  return data;
}

$('btn-copy-log').addEventListener('click', async () => {
  const log = Render.getLog();
  const btn = $('btn-copy-log');
  const original = btn.textContent;
  btn.textContent = '⏳ 送信中…';
  btn.disabled = true;
  try {
    const data = await uploadLogToDrive(log, 'darts-sensor');
    btn.textContent = '✅ Drive 保存';
    console.log('[darts] log uploaded:', data);
  } catch (e) {
    console.warn('[darts] Drive upload failed:', e);
    // フォールバック: navigator.share / クリップボード
    const logText = JSON.stringify(log, null, 2);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'MOMO Darts log', text: logText });
        btn.textContent = '✅ 共有(代替)';
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(logText);
        btn.textContent = '✅ コピー(代替)';
      } else {
        throw e;
      }
    } catch (e2) {
      if (e2 && e2.name === 'AbortError') {
        btn.textContent = original;
        btn.disabled = false;
        return;
      }
      btn.textContent = '⚠️ ' + (e.message || 'fail');
    }
  }
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 2200);
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

// v1.15 で削除: btn-tune はゲーム画面下バーから歯車メニュー (btn-open-tune) へ移動
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
