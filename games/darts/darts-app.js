// MOMO Darts - エントリーモジュール
// 段階2-A: screen 切り替え、ボタンハンドラ、退出確認モーダル
// 段階2-B: センサー許可フロー (SPEC 14.4) + キャリブレーション (SPEC 4.3)
// 段階2-C: 3D 空間 + 的描画（SPEC 4章 / 16章）

import * as Sensor from './darts-sensor.js';
import * as Render from './darts-render.js';
import * as Sound from './darts-sound.js';
import * as Input from './darts-input.js';
import * as Physics from './darts-physics.js';
import * as Rules from './darts-rules.js';

const $ = (id) => document.getElementById(id);

// ===== screen 切り替え =====
const SCREENS = ['lobby', 'rule-select', 'difficulty', 'waiting', 'room', 'calibration', 'game', 'end'];

function showScreen(name) {
  if (!SCREENS.includes(name)) return;
  for (const s of SCREENS) {
    $(`screen-${s}`).classList.toggle('active', s === name);
  }
  document.body.classList.toggle('in-game', name === 'game');
  window.scrollTo(0, 0);
  // v1.32: ロビー以外では画面 sleep を抑制（iOS Safari 16.4+ 等の Wake Lock API）
  if (name === 'lobby') {
    releaseWakeLock();
  } else {
    requestWakeLock();
  }
  // v1.48: lobby に戻ったら対戦時のロビーチャット履歴を確実にクリア＆非表示
  if (name === 'lobby' && typeof showLobbyChatPanels === 'function') {
    showLobbyChatPanels(false);
    clearLobbyChat();
  }
  // v2.09 (v1.5): BGM カテゴリを切替
  //   - game           → play (4 曲ランダム)
  //   - end            → 即停止 (showEndScreen 内でファンファーレ後に lobby 開始)
  //   - それ以外       → lobby (2 曲ランダム)
  // v2.11 (v1.5): ゲストとして他人の部屋に入っている間は lobby BGM を停止
  refreshBgmForScreen(name);
}

// v2.11/v2.12 (v1.5): 現在の screen から BGM カテゴリを決定して適用
//   v2.12: ホスト/ゲストの区別なく、プレイ中以外は lobby BGM を再生する仕様に修正
//          (v2.11 で誤って入れた「ゲスト時は停止」ロジックを削除)
function refreshBgmForScreen(name) {
  if (!Sound || !Sound.setBgmCategory) return;
  const cur = name || (SCREENS.find((s) => {
    const el = document.getElementById(`screen-${s}`);
    return el && el.classList.contains('active');
  }) || 'lobby');
  if (cur === 'game') { Sound.setBgmCategory('play'); return; }
  if (cur === 'end')  { Sound.setBgmCategory('none'); return; }
  Sound.setBgmCategory('lobby');
}

// ===== v1.32: Wake Lock — 画面ブラックアウトによる回線切断を防ぐ =====
let _wakeLock = null;
async function requestWakeLock() {
  if (_wakeLock) return;
  if (!('wakeLock' in navigator)) return;
  try {
    _wakeLock = await navigator.wakeLock.request('screen');
    _wakeLock.addEventListener('release', () => { _wakeLock = null; });
  } catch (e) {
    // 許可拒否 / 非対応ブラウザは無音で諦める（SPEC 18.5 流儀）
  }
}
function releaseWakeLock() {
  if (_wakeLock) {
    _wakeLock.release().catch(() => {});
    _wakeLock = null;
  }
}
// バックグラウンド復帰時に WakeLock が解放されているので再取得
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('screen-lobby').classList.contains('active')) {
    requestWakeLock();
  }
});

// ===== モーダル =====
let modalResolver = null;
function confirm(text) {
  $('modal-text').textContent = text;
  $('modal-yesno-row').style.display = '';
  $('modal-ok-row').style.display = 'none';
  $('modal-mask').classList.add('active');
  return new Promise((resolve) => { modalResolver = resolve; });
}
// v1.41: ブラウザ標準 alert はドメイン名（"qiqiroon.github.io の内容"）が出るため独自モーダルへ
function alertInfo(text) {
  $('modal-text').textContent = text;
  $('modal-yesno-row').style.display = 'none';
  $('modal-ok-row').style.display = '';
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
$('modal-ok').addEventListener('click', () => closeModal(true));
$('modal-mask').addEventListener('click', (e) => {
  if (e.target === $('modal-mask')) closeModal(false);
});

// ===== 許可手順案内パネル（SPEC 14.4） =====
// v1.49: UA別ステップキーを記録 → 言語切替時にも再描画できる
let _permStepsKey = null;
function refreshPermissionSteps() {
  const stepsEl = $('permission-steps');
  if (!stepsEl || !_permStepsKey) return;
  stepsEl.innerHTML = t(_permStepsKey);
}
function showPermissionPanel() {
  const kind = Sensor.detectBrowserKind();
  if      (kind === 'ios-safari')     _permStepsKey = 'perm.steps.iosSafari_html';
  else if (kind === 'ios-other')      _permStepsKey = 'perm.steps.iosOther_html';
  else if (kind === 'android-chrome') _permStepsKey = 'perm.steps.androidChrome_html';
  else if (kind === 'android-other')  _permStepsKey = 'perm.steps.androidOther_html';
  else                                _permStepsKey = 'perm.steps.other_html';
  refreshPermissionSteps();
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
  // v1.40 (SPEC 11.5 / 14.4): 対戦中にここから抜けた場合も部屋を畳んでハートビート停止
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    stopHeartbeat();
    _gameInProgress = false;
    MomoMatchmaking.leaveRoom();
    _mode = 'solo';
    _guestName = '';
    resetRoomToSolo();
  }
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
  statusEl.textContent = t('calib.status.detecting');
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
    statusEl.textContent = t('calib.status.ok');
    btnFix.disabled = false;
  } else {
    // 5秒で値が来ない → 非搭載扱い（SPEC 14.4 / 18.7）
    Sensor.stopListening();
    statusEl.classList.add('error');
    const fmt = (v) => (v === null || v === undefined) ? '–' : (typeof v === 'number' ? v.toFixed(1) : String(v));
    const valStr = diagLastValues
      ? `α=${fmt(diagLastValues.a)} β=${fmt(diagLastValues.b)} γ=${fmt(diagLastValues.g)}`
      : t('calib.status.notSampled');
    statusEl.innerHTML =
      t('calib.status.errorPrefix_html') +
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
    $('calib-status').textContent = t('calib.status.needMove');
    return;
  }
  // v1.31 (3-B): 対戦時は両者キャリブ完了で同時遷移
  if (_mode === 'battle') {
    onMyCalibDone();
  } else {
    enterGameScreen();
  }
});

$('btn-calib-cancel').addEventListener('click', async () => {
  if (await confirm(t('modal.confirm.leave'))) {
    Sensor.stopListening();
    Sensor.clearCalibration();
    if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
      // 対戦中の離脱は部屋ごと抜ける扱い
      // v1.40 (SPEC 11.5): キャリブ中に走らせていたハートビートを停止
      stopHeartbeat();
      _gameInProgress = false;
      MomoMatchmaking.leaveRoom();
      _mode = 'solo';
      _guestName = '';
      resetRoomToSolo();
      showScreen('lobby');
    } else {
      showScreen('room');
    }
  }
});

// ===== ボタンハンドラ =====
$('btn-solo-start').addEventListener('click', () => {
  // v1.91 (v1.4): screen-rule-select 経由 → 決定で screen-room へ
  showRuleSelectScreen('solo');
});

// v2.14 (v1.5): AI と対戦 → ルール選択 (scope='ai') → 難度選択 → ゲーム
$('btn-ai-start').addEventListener('click', () => {
  _mode = 'ai';
  showRuleSelectScreen('ai');
});

// 難度選択画面
// v2.15 (v1.5): $('#difficulty-tabs') は ID プレフィックスがズレるため null だった (v2.14 のバグ)
//   getElementById ベースに修正
if (document.getElementById('difficulty-tabs')) {
  document.querySelectorAll('#difficulty-tabs .rule-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      // v2.17: rule-tab のハイライトは .active クラスで定義されているため active に統一
      document.querySelectorAll('#difficulty-tabs .rule-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const diff = btn.getAttribute('data-difficulty');
      _aiDifficulty = diff;
      try { localStorage.setItem(AI_DIFFICULTY_LS_KEY, diff); } catch {}
      const descEl = document.getElementById('difficulty-desc');
      if (descEl) descEl.textContent = t('difficulty.' + diff + '.desc');
    });
  });
}
const _btnDifficultyBack = $('btn-difficulty-back');
if (_btnDifficultyBack) _btnDifficultyBack.addEventListener('click', () => {
  showRuleSelectScreen('ai');
});
const _btnDifficultyOk = $('btn-difficulty-ok');
if (_btnDifficultyOk) _btnDifficultyOk.addEventListener('click', () => {
  // 決定 → 直接ゲーム開始フロー (キャリブ + game)
  _currentRule = { ..._aiRule };
  startGameFlow();
});
// 難度画面表示時に現在の選択を反映
function refreshDifficultyUI() {
  document.querySelectorAll('#difficulty-tabs .rule-tab').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-difficulty') === _aiDifficulty);
  });
  const descEl = document.getElementById('difficulty-desc');
  if (descEl) descEl.textContent = t('difficulty.' + _aiDifficulty + '.desc');
}

$('btn-game-start').addEventListener('click', () => {
  // v1.61 (5-a): AudioContext 初期化（SPEC 13.11、iOS Safari autoplay 対策・ユーザー操作起点）
  Sound.init();
  // v1.31 (3-B): 対戦時は両者押下を待つ。Solo は即実行
  if (_mode === 'battle') {
    pressBattleStart();
  } else {
    startGameFlow();
  }
});

// v2.09/v2.11 (v1.5): AudioContext のプリロードを起動時に開始し、最初の user
//   gesture で resume + 現在画面に応じた BGM カテゴリで再生開始する。
//   - DOMContentLoaded で Sound.init() を呼ぶと AudioContext は suspended 状態で
//     作られ、mp3 の fetch+decode はバックグラウンドで進む。
//   - 最初の pointerdown/keydown で Sound.resumeAudio() → BGM 開始。
//     こうすることで「アプリ起動 → 最初のタップ → 即 BGM 再生」を最短で実現。
Sound.init();  // ページロード直後に AudioContext 作成 + プリロード開始

function initSoundOnFirstGesture() {
  Sound.resumeAudio().then(() => {
    refreshBgmForScreen();
  });
  document.removeEventListener('pointerdown', initSoundOnFirstGesture);
  document.removeEventListener('keydown', initSoundOnFirstGesture);
}
document.addEventListener('pointerdown', initSoundOnFirstGesture, { once: true });
document.addEventListener('keydown', initSoundOnFirstGesture, { once: true });

// v2.11/v2.15/v2.16 (v1.5): バックグラウンド時の BGM 停止 + 長時間放置時の抑止
//   Android Chrome は visibility hidden でも AudioContext が走り続けるため、
//   アプリを閉じても BGM が鳴り続ける問題があった。明示的に AudioContext を
//   suspend する。
//   v2.16: 「ずっと前に閉じたアプリをいつか開いたら勝手に BGM が再生される」
//   問題への対策として、 hidden 期間が 1 分以上なら復帰時 BGM を再開せず
//   'none' のままにする。 ユーザーが画面遷移 (showScreen 内で refreshBgm) や
//   音量変更などで「能動的に」操作した瞬間に BGM が再開する。
const BGM_SUPPRESS_MS = 60 * 1000;  // 1 分以上閉じていたら復帰時に BGM を鳴らさない
let _lastHiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    _lastHiddenAt = Date.now();
    Sound.suspendAudio();
  } else {
    const hiddenDur = _lastHiddenAt ? (Date.now() - _lastHiddenAt) : 0;
    Sound.resumeAudio().then(() => {
      if (hiddenDur < BGM_SUPPRESS_MS) {
        // 1 分未満 → 通常復帰
        refreshBgmForScreen();
      } else {
        // 1 分以上閉じていた → BGM を停止状態のまま維持
        // (ユーザーが画面遷移や音量変更を行えば showScreen / 音量UI から
        //  refreshBgmForScreen が呼ばれ、 BGM 再開)
        Sound.setBgmCategory('none');
      }
    });
  }
});
// pagehide でも明示的に止める (タブ閉じ / iOS の bfcache 退避)
window.addEventListener('pagehide', () => {
  _lastHiddenAt = Date.now();
  Sound.suspendAudio();
});

$('btn-room-leave').addEventListener('click', async () => {
  if (await confirm(t('modal.confirm.leave'))) {
    if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
      MomoMatchmaking.leaveRoom();
    }
    _mode = 'solo';
    _guestName = '';
    resetRoomToSolo();
    showScreen('lobby');
  }
});

// ===== ゲーム画面ライフサイクル =====
let _gameState = null;  // v1.23: Rules.createInitialState() の戻り値（自分の状態）
let _oppState = null;   // v1.33 (3-C): 対戦時の相手状態
let _activeRole = null; // v1.33 (3-C): 'first' | 'second' | null（null=solo）
// v1.26: ターン終了後 2 秒間「直前ターンの3投」を表示するためのオーバーライド。
// applyShot 後 turnShots は即クリアされるため、これを介して表示を保持する。
let _pendingTurnDisplay = null;  // shots[] | null

function isMyTurn() {
  if (!isVersus()) return true;
  return _activeRole === _myRole;
}

// アクティブな投擲者の state（shots 表示・ターン情報用）
function activeState() {
  if (!isVersus()) return _gameState;
  return isMyTurn() ? _gameState : _oppState;
}

function getMyName() {
  if (typeof MomoMatchmaking === 'undefined') return t('lobby.you');
  // v2.14 (v1.5): AI 対戦時は「自分 = プレイヤー名 (input か lobby.you)」
  if (isAi()) {
    const myInputName = ($('my-name') && $('my-name').value && $('my-name').value.trim()) || _hostName;
    return myInputName || t('lobby.you');
  }
  return MomoMatchmaking.getState().isHost ? (_hostName || t('lobby.host')) : (_guestName || t('lobby.guest'));
}
// v2.15 (v1.5): 内部 ID → 表示ラベル
const AI_DIFFICULTY_LABEL = { easy: 'EASY', normal: 'HARD', hard: 'APOCALYPSE' };
function getOppName() {
  if (typeof MomoMatchmaking === 'undefined') return t('lobby.opp');
  // v2.14/v2.15 (v1.5): AI 対戦時は「CPU(難度)」 表示
  if (isAi()) {
    return 'CPU(' + (AI_DIFFICULTY_LABEL[_aiDifficulty] || _aiDifficulty.toUpperCase()) + ')';
  }
  return MomoMatchmaking.getState().isHost ? (_guestName || t('lobby.guest')) : (_hostName || t('lobby.host'));
}

function updateScoreUI() {
  if (!_gameState) return;
  // v1.62: ターン終了直後 (_pendingTurnDisplay 中) は active のターン合計も
  // 直前の3投合計を維持する（_gameState.turnShots は applyShot で空にされるため）
  const active = activeState();
  const pendingSum = _pendingTurnDisplay
    ? _pendingTurnDisplay.reduce((a, s) => a + (s.value || 0), 0)
    : null;
  const selfSum = (pendingSum !== null && active === _gameState)
    ? pendingSum
    : _gameState.turnShots.reduce((a, s) => a + s.value, 0);
  // v2.04 (v1.5): ラウンド (ターン) 表示 — 中央上部
  //   countup は N/M 形式、それ以外は N
  const roundInfoEl = $('ui-round-info');
  if (roundInfoEl) {
    const cur = _gameState.turnIndex || 1;
    if (_currentRule.type === 'countup') {
      roundInfoEl.textContent = t('ui.round.label.dyn', { current: cur, total: _currentRule.rounds });
    } else {
      roundInfoEl.textContent = t('ui.round.label', { current: cur });
    }
  }
  // v1.88 (v1.3): 01 = 残り点数 / countup = 累積得点 を表示
  $('ui-remaining').textContent = String(Rules.currentScore(_gameState));
  $('ui-turn-total').textContent = `TURN +${selfSum}`;
  if (isVersus() && _oppState) {
    $('ui-score-opp').style.display = 'flex';
    const oppSum = (pendingSum !== null && active === _oppState)
      ? pendingSum
      : _oppState.turnShots.reduce((a, s) => a + s.value, 0);
    $('ui-remaining-opp').textContent = String(Rules.currentScore(_oppState));
    $('ui-turn-total-opp').textContent = `TURN +${oppSum}`;
  } else {
    $('ui-score-opp').style.display = 'none';
  }
  // ショットスロット（中央上）— アクティブ投擲者の現ターン
  const shotsForDisplay = _pendingTurnDisplay || (active ? active.turnShots : []);
  for (let i = 0; i < 3; i++) {
    const slot = $(`ui-shot-${i + 1}`);
    const shot = shotsForDisplay[i];
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
  updateTurnInfo();
  updateTurnFrame();
  updateCricketScoreboard();
}

// v2.08 (v1.5): クリケット用 スコア表
//   3 投表示の下に 20/19/18/17/16/15/Bull の自分/相手マークを並べる
//   自分=オレンジ(左)、相手=グレー(右)、数字=白(中央)
function updateCricketScoreboard() {
  const sb = $('cricket-scoreboard');
  if (!sb) return;
  if (!_currentRule || _currentRule.type !== 'cricket') {
    sb.style.display = 'none';
    return;
  }
  sb.style.display = 'flex';
  const myMarks  = (_gameState && _gameState.marks) || {};
  const oppMarks = (isVersus() && _oppState && _oppState.marks) || {};
  const charOf = (n) => {
    if (n === 1) return '/';
    if (n === 2) return 'X';
    if (n >= 3)  return 'Ⓧ';
    return '';
  };
  const rows = sb.querySelectorAll('.cricket-row');
  const order = [20, 19, 18, 17, 16, 15, 'bull'];
  rows.forEach((row, i) => {
    const segKey = order[i];
    const my  = myMarks[segKey]  || 0;
    const opp = oppMarks[segKey] || 0;
    const selfEl = row.querySelector('.cri-self');
    const oppEl  = row.querySelector('.cri-opp');
    if (selfEl) selfEl.textContent = charOf(my);
    if (oppEl)  oppEl.textContent  = isVersus() ? charOf(opp) : '';
  });
}

// v1.34: ターン情報を 2 行に（"あなた/相手のターン" + 名前）
// v2.14 (v1.5): AI 対戦でも表示する
function updateTurnInfo() {
  const wrap = $('ui-turn-info');
  const mainEl = $('ui-turn-info-main');
  const nameEl = $('ui-turn-info-name');
  if (!isVersus()) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  const myTurn = isMyTurn();
  mainEl.textContent = myTurn ? t('game.turn.self') : t('game.turn.opp');
  nameEl.textContent = myTurn ? getMyName() : getOppName();
  wrap.classList.toggle('self', myTurn);
  wrap.classList.toggle('opp', !myTurn);
}

// v1.33 (3-C): ターン枠 4px（自分=明赤発光 / 相手=暗青）
// v2.14 (v1.5): AI 対戦でも表示する
function updateTurnFrame() {
  const fr = $('turn-frame');
  if (!isVersus()) {
    fr.classList.remove('self', 'opp');
    return;
  }
  fr.classList.toggle('self', isMyTurn());
  fr.classList.toggle('opp', !isMyTurn());
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
  _gameState = Rules.createInitialState(_currentRule);
  _pendingTurnDisplay = null;
  // v1.33 (3-C) / v2.14 (v1.5): 対戦 / AI 対戦時は相手 state も初期化、先攻決定
  if (isVersus()) {
    _oppState = Rules.createInitialState(_currentRule);
    _activeRole = 'first';  // 先攻が常に最初に投げる
    // AI モードは「プレイヤー = first / AI = second」固定
    if (isAi()) _myRole = 'first';
  } else {
    _oppState = null;
    _activeRole = null;
  }
  updateScoreUI();
  Render.placeTargetForTurn();
  // v1.71 (5-c): 最初のターン開始でもターン切替音（SPEC 13.8）
  //   solo は常時自分、battle は先攻=自分のときのみ
  if (_mode !== 'battle' || isMyTurn()) Sound.playTurnStart();

  // v1.17: ホールドボタン入力を起動（Input.start 内で setDisabled(false) されるので
  //        対戦時の観戦者は start のあとに改めて disable する）
  Input.start({ onRelease: onDartReleased });
  if (isVersus()) {
    Input.setDisabled(!isMyTurn());
    // v1.40: ハートビート/`_gameInProgress` は proceedToBattleGameStart で起動済み
    // （SPEC 11.5: キャリブ中も有効）
    // v2.14 (v1.5): AI モードで AI が先攻なら最初の投擲をスケジュール (player=first 固定なので通常 player から)
    if (isAi() && !isMyTurn()) scheduleAiShot();
  }
  // v1.47 (3-E): チャット要素は対戦時のみ表示 (AI モードはチャットなし)、メッセージスタックを毎ゲーム開始でクリア
  const chatAreaGame = $('chat-area-game');
  if (chatAreaGame) chatAreaGame.style.display = (_mode === 'battle') ? '' : 'none';
  clearChatStack();
  // v1.51: チャットプリセットは「ゲーム画面遷移時の言語」で確定（Q2A）。
  //   以後は言語切替しても変わらない（ユーザー編集のみで上書き可）。
  //   sessionStorage に編集済みデータがあればそれを優先。
  loadChatPresets();
  applyChatPresetsToButtons();
  // v1.96 (v1.5): rtc 初期セグメント色付け
  refreshRtcSegmentHighlight();
  // v2.05 (v1.5): クリケット初期ボード色付け
  refreshCricketBoard();
}

// v1.47 (3-E): チャットスタックをクリア（試合開始/再戦時に呼ぶ）
function clearChatStack() {
  _chatMessages = [];
  if (_chatFadeTimer)  { clearTimeout(_chatFadeTimer);  _chatFadeTimer = null; }
  if (_chatClearTimer) { clearTimeout(_chatClearTimer); _chatClearTimer = null; }
  renderChatStack();
}

// v1.96 (v1.5): ラウンド・ザ・クロックのセグメント色付け更新
//   自分の current target = オレンジ、相手 = グレー、両者同じならオレンジ優先
//   nextTarget が 21 以上 (クリア済) は null (色付け対象外)
function refreshRtcSegmentHighlight() {
  if (!_currentRule || _currentRule.type !== 'rtc') return;
  const my = (_gameState && _gameState.nextTarget >= 1 && _gameState.nextTarget <= 20)
    ? _gameState.nextTarget : null;
  const opp = (isVersus() && _oppState
            && _oppState.nextTarget >= 1 && _oppState.nextTarget <= 20)
    ? _oppState.nextTarget : null;
  Render.setSegmentHighlight(my, opp);
}

// v2.05 (v1.5): クリケットのボード色付け更新
//   自分の marks (15-20+bull) と相手の marks をボードに反映
function refreshCricketBoard() {
  if (!_currentRule || _currentRule.type !== 'cricket') return;
  const myMarks = (_gameState && _gameState.marks) || {};
  const oppMarks = (isVersus() && _oppState && _oppState.marks) || {};
  Render.setCricketBoard(myMarks, oppMarks);
}

function leaveGameScreen() {
  Render.stop();
  Input.stop();
  // v1.37 (3-D): ハートビート停止
  stopHeartbeat();
  _gameInProgress = false;
  // v1.96 (v1.5): rtc セグメント色付けをクリア（次のゲームに残らないように）
  Render.clearSegmentHighlight();
  // v2.05 (v1.5): クリケットボード色付けもクリア
  Render.clearCricketBoard();
}

// v1.68: 着弾点が「的盤面に当たったか」判定（数字エリアまでを的内とする）
//   - null/undefined → 床落ち/視界外 → false
//   - r > R_BORDER → 完全に枠外 → false
//   - それ以外 → 数字エリアを含む的内 → true
//   スコアは Rules.scoreFromImpactSVG が R_DOUBLE_OUT で MISS 判定するので
//   「数字エリアに当たった = hit 音 + MISS スコア」を実現できる
function isOnBoard(boardSV) {
  if (!boardSV) return false;
  const r = Math.hypot(boardSV.x, boardSV.y);
  return r <= Rules.R_BORDER;
}

// v1.23: 投擲リリース → 物理シミュ → 着弾後にスコア計算
// v1.33 (3-C): 対戦時は relAim + impactBoard を相手に送信、両者で同じ shot を処理
// v1.61 (5-b): 投擲音 + 着弾音（SPEC 13.4/13.5/13.6）
function onDartReleased({ hand, strength, durationMs }) {
  // 対戦時、相手のターン中はそもそもボタン disabled だが念のためガード
  if (isVersus() && !isMyTurn()) return;

  // v1.61: 投擲音（強さで pitch+volume 変調、SPEC 13.5）
  Sound.playThrow(strength);

  const aim = Render.getCurrentAim();
  const aimYawRad   = (aim.yawDeg   * Math.PI) / 180;
  const aimPitchRad = (aim.pitchDeg * Math.PI) / 180;

  const sim = Physics.simulateThrow({ hand, strength, aimYawRad, aimPitchRad });
  const myImpactBoard = Render.boardImpactFromSim(sim);  // null or {x, y}

  // v1.33 (3-C): 投擲データを即座に相手へ送信（フライト中に相手側でも飛ぶ）
  // v1.37 (3-D): throw_start も送信（受信側のハートビートタイムアウト計時を一時停止）
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    const target = Render.getTargetWorld();
    MomoMatchmaking.send({ type: 'throw_start' });
    MomoMatchmaking.send({
      type: 'throw',
      hand,
      strength,
      relYawDeg:   aim.yawDeg   - target.yaw,
      relPitchDeg: aim.pitchDeg - target.pitch,
      impactBoard: myImpactBoard,  // authoritative for scoring
    });
  }

  Render.fireFlight(sim, (result) => {
    // v1.37 (3-D): 着弾完了 → throw_end を送信
    if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
      MomoMatchmaking.send({ type: 'throw_end' });
    }
    // result = { world, board: { x, y } | null } — local の物理結果
    const shot = Rules.scoreFromImpactSVG(result.board);
    // v1.61 (5-b): 着弾音（命中時、SPEC 13.6 共通の「ストッ」）
    // v1.67/v1.68: 「数字エリア(R_DOUBLE_OUT〜R_BORDER)」は的内なので hit 音、
    //              スコアは MISS のまま。完全に枠外/床落ちのみ miss 音「ボヨン」
    // v1.69 (5-c): 命中時のみ振動音（SPEC 13.7、カサカサ系合成）
    // v1.70: 振動音は強さに比例（最適範囲上限 0.56 超のみ、超過量で音量増）
    // v1.81 (v1.1): 視覚的振動演出も命中時に発火（SPEC 7.3 振幅12度/6Hz/0.1^t/1.2秒）
    // v1.82: 振動も強さ・当たり位置で物理風に変化（支点=上端中央、下当たりはピッチ、横当たりはヨー）
    if (isOnBoard(result.board)) {
      Sound.playHit();
      Sound.playVibrate(strength);
      Render.startTargetVibrate(strength, result.board);
    } else {
      Sound.playMiss();
    }
    logShotEvent(_gameState, hand, strength, durationMs, aim, result, shot);
    processShot(_gameState, shot, _myRole);
  }, { thrower: 'self' });
}

// v1.33 (3-C): 相手の投擲を受信して再生
function handleOppThrow(data) {
  if (_mode !== 'battle' || !_oppState) return;
  if (isMyTurn()) {
    // 自分のターン中に相手 throw が来たら無視（タイミング異常）
    console.warn('[darts] received opp throw during my turn — ignoring');
    return;
  }
  const { hand, strength, relYawDeg, relPitchDeg, impactBoard } = data;
  // v1.61 (5-b): 相手投擲音（自分と同音量、SPEC 13.7 相手振動音と同方針）
  Sound.playThrow(strength);
  // 受信側の自分の的位置に relAim を載せて再シミュレート
  const target = Render.getTargetWorld();
  const aimYawRad   = ((target.yaw   + (relYawDeg   || 0)) * Math.PI) / 180;
  const aimPitchRad = ((target.pitch + (relPitchDeg || 0)) * Math.PI) / 180;
  const sim = Physics.simulateThrow({ hand, strength, aimYawRad, aimPitchRad });

  Render.fireFlight(sim, (_result) => {
    // 着弾点は送信者の authoritative 値で上書き → スコアも一致
    const shot = Rules.scoreFromImpactSVG(impactBoard);
    // v1.61 (5-b): 着弾音（命中時、SPEC 13.6 共通の「ストッ」）
    // v1.68: 数字エリアまでは的内として hit 音、枠外/床落ちのみ miss 音
    // v1.69 (5-c): 相手投擲も命中時のみ振動音（SPEC 13.7「相手も自分と同音量」）
    // v1.70: 強さに比例（相手側も同じ閾値・減衰）
    // v1.81 (v1.1): 相手投擲時も視覚的振動演出（SPEC 7.3）
    // v1.82: 当たり位置で振動方向（相手の impactBoard を使用）
    if (isOnBoard(impactBoard)) {
      Sound.playHit();
      Sound.playVibrate(strength);
      Render.startTargetVibrate(strength, impactBoard);
    } else {
      Sound.playMiss();
    }
    processShot(_oppState, shot, _activeRole);
  }, { thrower: 'opp', authoritativeBoard: impactBoard });
}

// v1.33 (3-C): shot 後の共通処理（ローカル/受信どちらからも呼ぶ）
function processShot(throwerState, shot, throwerRole) {
  // v1.96 (v1.5): rtc 用に投擲前の current target を保存（正解音判定用）
  const isRtc = (throwerState.rule && throwerState.rule.type === 'rtc');
  const isCricket = (throwerState.rule && throwerState.rule.type === 'cricket');
  const rtcPrevTarget = isRtc ? throwerState.nextTarget : null;

  // v2.03 (v1.5): クリケット時は相手の marks を applyShot に渡す（得点判定のため）
  let applyOpts;
  let cricketBeforeMy;
  let cricketBeforeOpp;
  if (isCricket) {
    const oppOfThrower = (throwerState === _gameState) ? _oppState : _gameState;
    applyOpts = { oppMarks: oppOfThrower ? oppOfThrower.marks : {} };
    // v2.06: 投擲前の自分・相手の mark スナップショット (オープン/クローズ判定用)
    cricketBeforeMy = { ..._gameState.marks };
    cricketBeforeOpp = _oppState ? { ..._oppState.marks } : {};
  }

  const r = Rules.applyShot(throwerState, shot, applyOpts);

  // v2.05/v2.06 (v1.5): クリケット音 + ボード色付け更新
  //   オープン/クローズ判定は Rules の applyShotCricket と同じ流儀:
  //     - 自分 3 mark 達成 + 相手 < 3 = 自分のオープン (得点取得 ready) → 正解音
  //     - 両者 3 mark 達成 = クローズ (ロック) → bust 音
  //     - それ以外 (mark 取得中) = 無音
  if (isCricket && cricketBeforeMy) {
    const myAfter  = _gameState ? _gameState.marks : {};
    const oppAfter = _oppState ? _oppState.marks : {};
    let anySelfOpen = false;
    let anyLockClose = false;
    [15,16,17,18,19,20,'bull'].forEach((k) => {
      const myB = cricketBeforeMy[k]  || 0;
      const myA = myAfter[k]  || 0;
      const opB = cricketBeforeOpp[k] || 0;
      const opA = oppAfter[k] || 0;
      const wasSelfOpen = (myB >= 3 && opB < 3);
      const isSelfOpen  = (myA >= 3 && opA < 3);
      const wasLocked   = (myB >= 3 && opB >= 3);
      const isLocked    = (myA >= 3 && opA >= 3);
      if (!wasSelfOpen && isSelfOpen) anySelfOpen = true;
      if (!wasLocked && isLocked) anyLockClose = true;
    });
    if (anyLockClose) Sound.playBust();
    else if (anySelfOpen) Sound.playCorrect();
    refreshCricketBoard();
  }

  // v2.03 (v1.5): クリケット勝敗判定（相手 state を見て finished を立てる）
  if (isCricket && r.turnEnded && _gameState && _oppState) {
    const winner = Rules.cricketWinner(_gameState, _oppState);
    if (winner !== null) {
      _gameState.finished = true;
      _oppState.finished = true;
      r.finished = true;
      r.cricketWinner = winner;
    }
  }
  // v1.26: ターン終了時の表示保持
  if (r.turnEnded && throwerState.history.length > 0) {
    _pendingTurnDisplay = throwerState.history[throwerState.history.length - 1].shots;
  }
  updateScoreUI();

  // v1.96/v1.97 (v1.5): rtc 投擲音 (正解時のみ) + セグメント色更新
  //   shot.segment が prevTarget と一致 (S/D/T) なら正解音、外したときは音なし (v1.97 ユーザー指示)
  //   自分・相手の投擲とも正解音を鳴らす (両者の状況把握のため)
  if (isRtc) {
    const isCorrect = (shot.segment === rtcPrevTarget)
                   && (shot.kind === 'S' || shot.kind === 'D' || shot.kind === 'T');
    if (isCorrect) Sound.playCorrect();
    refreshRtcSegmentHighlight();
  }

  // v1.61〜v1.84: TON80/ハットトリック/トン ジングル
  // v1.99 (v1.5): rtc / cricket では turnSum/ハットトリック演出を発火させない
  //   (得点ベースのルールではないため、ユーザー指示で無効化)
  // BUST 時は無視（バーストは加算されない）。FINISH と同時の場合は重ね鳴らし（SPEC 13.9）
  const ruleType = throwerState.rule && throwerState.rule.type;
  const allowTonJingles = (ruleType === '01' || ruleType === 'countup');
  if (r.turnEnded && !r.bust && throwerState.history.length > 0 && allowTonJingles) {
    const lastShots = throwerState.history[throwerState.history.length - 1].shots;
    const turnSum = lastShots.reduce((a, s) => a + (s.value || 0), 0);
    if (turnSum === 180) { Sound.playTon80(); Render.startCelebrateVibrate(); }
    else if (r.hatTrick) { Sound.playTon80(); Render.startCelebrateVibrate(); }
    else if (turnSum >= 100) Sound.playTon();
  }

  // === FINISH ===
  if (r.finished) {
    // v1.89 (v1.3) / v2.14: 対戦/AI カウントアップは両者 全投終了まで待ち、 total 比較で勝敗判定
    const isVersusCountup = (isVersus() && _currentRule.type === 'countup');
    if (isVersusCountup && _oppState && !_oppState.finished) {
      // 相手はまだ投擲中 → 自分はこれ以上投げず通常のターン交代
      setTimeout(() => {
        _pendingTurnDisplay = null;
        endTurnAndPlace();
      }, 2000);
      return;
    }

    // 勝者判定
    // v2.03 (v1.5): クリケット — r.cricketWinner で確定済み (processShot 内で set)
    const isVersusCricket = (isVersus() && _currentRule.type === 'cricket');
    let winner;  // 'self' | 'opp' | 'draw'
    if (isVersusCricket && r.cricketWinner) {
      winner = r.cricketWinner;
    } else if (isVersusCountup) {
      if (_gameState.total > _oppState.total) winner = 'self';
      else if (_gameState.total < _oppState.total) winner = 'opp';
      else winner = 'draw';
    } else if (isVersus()) {
      winner = (throwerRole === _myRole) ? 'self' : 'opp';
    } else {
      winner = 'self';  // solo
    }
    const isMyWin = (winner === 'self');
    const isDraw = (winner === 'draw');

    let mainText, subText;
    if (isVersus()) {
      if (isDraw) {
        mainText = 'DRAW';
        subText = isVersusCricket
          ? t('end.cricket.draw.sub', { selfScore: _gameState.score, oppScore: _oppState.score })
          : t('end.countup.draw.sub', { selfTotal: _gameState.total, oppTotal: _oppState.total });
      } else {
        mainText = isMyWin ? 'WIN!' : 'LOSE!';
        if (isVersusCricket) {
          subText = t('end.cricket.battle.sub', { selfScore: _gameState.score, oppScore: _oppState.score });
        } else if (isVersusCountup) {
          subText = t('end.countup.battle.sub', { selfTotal: _gameState.total, oppTotal: _oppState.total });
        } else {
          subText = t('end.win.lineNoDarts', { winner: isMyWin ? getMyName() : getOppName() });
        }
      }
    } else if (_currentRule.type === 'countup') {
      mainText = 'COMPLETE!';
      subText = t('end.countup.solo.finish', { total: _gameState.total });
    } else {
      mainText = 'FINISH!';
      subText = `${throwerState.dartCount} ${t('end.dartsUnit')}`;
    }
    console.log('[darts] FINISH! winner=' + winner + ' rule=' + _currentRule.type);
    Render.logEvent({ type: 'finish', dartCount: throwerState.dartCount, turns: throwerState.turnIndex, winner });
    showAnnouncement(isDraw ? 'finish' : (isVersus() && !isMyWin ? 'lose' : 'finish'), mainText, subText);

    // v1.75 (5-c): 特別演出ジングル → 勝利/敗北ジングル → 勝利画面の順次再生
    let delayMs = 0;
    const NINE_DARTS_FALLBACK_MS = 2500;
    const JINGLE_FALLBACK_MS = 2200;
    // 1. 9 ダーツ達成ジングル（01 のみ、カウントアップでは概念なし）
    if (_currentRule.type === '01' && throwerState.dartCount <= 9) {
      Sound.playNineDarts();
      Render.startCelebrateVibrate();
      delayMs += Math.ceil((Sound.getDuration('nineDarts') || NINE_DARTS_FALLBACK_MS / 1000) * 1000);
    }
    // 2. 勝利/敗北ジングル
    //    draw 時は勝利ジングルを軽めに（loseJingle 流用は重すぎ、winJingle が祝賀感）
    const jingleKey = (isMyWin || isDraw) ? 'win' : 'lose';
    setTimeout(() => {
      if (isMyWin || isDraw) Sound.playWinJingle();
      else Sound.playLoseJingle();
    }, delayMs);
    delayMs += Math.ceil((Sound.getDuration(jingleKey) || JINGLE_FALLBACK_MS / 1000) * 1000);
    // 3. 勝利画面遷移
    setTimeout(() => {
      _pendingTurnDisplay = null;
      showEndScreen({ winner, finishedState: throwerState });
    }, delayMs);
    return;
  }

  // === BUST ===
  if (r.bust) {
    // v1.61 (5-b): BUST 残念音（SPEC 13.3 P0）
    Sound.playBust();
    console.log('[darts] BUST! thrower=' + throwerRole + ' reverted to ' + throwerState.remaining);
    Render.logEvent({ type: 'bust', thrower: throwerRole, remainingAfter: throwerState.remaining });
    showAnnouncement('bust', 'BUST!', '');
    setTimeout(() => {
      _pendingTurnDisplay = null;
      endTurnAndPlace();
    }, 2000);
    return;
  }

  // === 通常のターン進行 ===
  if (r.turnEnded) {
    setTimeout(() => {
      _pendingTurnDisplay = null;
      endTurnAndPlace();
    }, 2000);
    return;
  }

  // === 同じプレイヤー継続 ===
  // ボタン状態: 自分のターンで自分が投げ終わった直後 → 次の投げのため有効化。
  // 相手のターン受信中 → 引き続き無効。
  if (isVersus()) {
    Input.setDisabled(!isMyTurn());
    updateScoreUI();  // turn-info の N 投目更新
    // v2.14 (v1.5): AI モードで AI のターン継続中なら次の投擲をスケジュール
    if (isAi() && !isMyTurn() && !throwerState.finished) scheduleAiShot();
  } else {
    Input.setDisabled(false);
  }
}

// v1.33 (3-C): ターン終了 → 役割交代 + 新しい的位置（両者ローカル）
function endTurnAndPlace() {
  if (isVersus()) {
    _activeRole = (_activeRole === 'first') ? 'second' : 'first';
    Input.setDisabled(!isMyTurn());
  } else {
    Input.setDisabled(false);
  }
  // v2.10 (v1.5): ターン切替を診断ログに記録（再現時の同期ズレ調査用）
  Render.logEvent({
    type: 'turn-end',
    activeRole: _activeRole,
    myRole: _myRole,
    selfTurnIdx: _gameState ? _gameState.turnIndex : null,
    oppTurnIdx: _oppState ? _oppState.turnIndex : null,
  });
  Render.placeTargetForTurn();
  updateScoreUI();
  // v1.71 (5-c): 自分のターン開始時のみターン切替音（SPEC 13.8）
  //   solo: 毎ターン自分 → 毎回鳴らす
  //   battle / ai: isMyTurn() のときだけ
  if (!isVersus() || isMyTurn()) Sound.playTurnStart();
  // v2.14 (v1.5): AI モードで AI のターンに切替わった場合、 1.0〜2.0 秒後に AI 投擲
  if (isAi() && !isMyTurn()) scheduleAiShot();
}

// v2.14 (v1.5): AI 投擲のスケジューリング (SPEC 22.4 「1.0〜2.0 秒待機」)
let _aiShotTimer = null;
function scheduleAiShot() {
  if (!isAi() || isMyTurn()) return;
  if (_aiShotTimer) clearTimeout(_aiShotTimer);
  const delay = 1000 + Math.random() * 1000;  // 1.0〜2.0 秒
  _aiShotTimer = setTimeout(() => {
    _aiShotTimer = null;
    aiTakeShot();
  }, delay);
}
function aiTakeShot() {
  if (!isAi() || !_oppState || _oppState.finished) return;
  if (isMyTurn()) return;  // 切替で既に自分のターンに戻っていれば中止
  const targetWorld = Render.getTargetWorld();
  const { aimYawDeg, aimPitchDeg, strength } =
    Rules.aiChooseShot(_oppState, _gameState, targetWorld, _aiDifficulty);
  Sound.playThrow(strength);
  const aimYawRad   = aimYawDeg   * Math.PI / 180;
  const aimPitchRad = aimPitchDeg * Math.PI / 180;
  const sim = Physics.simulateThrow({ hand: 'R', strength, aimYawRad, aimPitchRad });
  Render.fireFlight(sim, (result) => {
    const shot = Rules.scoreFromImpactSVG(result.board);
    if (isOnBoard(result.board)) {
      Sound.playHit();
      Sound.playVibrate(strength);
      Render.startTargetVibrate(strength, result.board);
    } else {
      Sound.playMiss();
    }
    processShot(_oppState, shot, 'second');
  }, { thrower: 'opp' });
}

// v2.10 (v1.5): デッドロック解除「投擲権移譲」
//   - 仕様: 「次のターン」ボタンを押すと、自分の投擲権を相手に移譲する。
//     自分のターン中か否かに関わらず、押すと _activeRole を相手のロールに固定。
//     受信側は「相手のターン」表示中なら自分のターンに変わる、「自分のターン」中なら no-op。
//   - 両者のターン認識が「お互い相手」になるデッドロック (例: バックグラウンド復帰時の状態
//     破損や WS 送信ロス) から脱出する手段。
//   - 自分のターン情報 (_gameState.turnIndex / turnShots) はリセットしない (= 「最初から」
//     にはならない、 進行中のターンはそのまま継続)。
function passMyTurnToOpp() {
  if (_mode !== 'battle' || !_myRole) return;
  const oppRole = (_myRole === 'first') ? 'second' : 'first';
  _activeRole = oppRole;
  Input.setDisabled(true);
  Render.logEvent({
    type: 'pass-turn',
    actor: 'self',
    newActiveRole: _activeRole,
    myRole: _myRole,
  });
  updateScoreUI();
}
function handleRemotePassTurn() {
  if (_mode !== 'battle' || !_myRole) return;
  if (_activeRole === _myRole) {
    // 既に自分のターンなら no-op（仕様通り）
    Render.logEvent({ type: 'pass-turn', actor: 'opp', result: 'noop', activeRole: _activeRole, myRole: _myRole });
    return;
  }
  _activeRole = _myRole;
  Input.setDisabled(false);
  Render.logEvent({
    type: 'pass-turn',
    actor: 'opp',
    result: 'taken',
    newActiveRole: _activeRole,
    myRole: _myRole,
  });
  updateScoreUI();
  Sound.playTurnStart();
}

// v1.33 (3-C): shot ログを記録（既存のログ機構を踏襲）
function logShotEvent(state, hand, strength, durationMs, aim, result, shot) {
  Render.logEvent({
    type: 'shot',
    turn: state.turnIndex,
    shotInTurn: state.turnShots.length + 1,
    hand,
    strength: +strength.toFixed(3),
    durationMs: +durationMs.toFixed(0),
    aim: { yaw: +aim.yawDeg.toFixed(2), pitch: +aim.pitchDeg.toFixed(2) },
    impactWorld: result.world ? {
      x: +result.world.x.toFixed(3),
      y: +result.world.y.toFixed(3),
      z: +result.world.z.toFixed(3),
      t: +result.world.t.toFixed(3),
      hit: result.world.hit,
      stopReason: result.world.stopReason,
    } : null,
    impactBoard: result.board
      ? { x: +result.board.x.toFixed(1), y: +result.board.y.toFixed(1) }
      : null,
    score: shot,
    remainingBefore: state.remaining,
  });
  console.log(`[darts] hand=${hand} s=${strength.toFixed(2)} → ${shot.label} (${shot.value}pt) ` +
              `imp=${result.board ? `(${result.board.x.toFixed(1)},${result.board.y.toFixed(1)})` : 'MISS-FALL'}`);
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

// v1.44 (3-E): 結果画面ボタンのラベル設定ヘルパー
function setEndBtnLabel(btnId, label) {
  const labelEl = $(btnId).querySelector('.end-btn-label');
  if (labelEl) labelEl.textContent = label;
  else $(btnId).textContent = label;  // 子要素なし時のフォールバック（abort 画面の単独ボタン用）
}

// v1.25: 結果画面の表示（FINISH 時に呼ばれる）
function showEndScreen(opts) {
  if (!_gameState) return;
  // v1.41: 表示状態を毎回リセット（前回 abort で隠した場合に備える）
  $('end-stats').style.display = '';
  $('btn-end-replay').style.display = '';
  $('btn-end-rule-change').style.display = '';
  $('btn-end-back-room').style.display = '';
  // v1.44 (3-E): 自選択ハイライトをリセット（自分はまだ未選択）
  // v1.46: `_oppEndChoice` は触らない。相手が先に試合終了 → end_choice を
  //        送信し、自分がまだ game 画面の段階で受信 → showEndScreen 直前で
  //        既に値が入っているケースがあるため、ここでリセットすると相手の
  //        選択を取りこぼす（「相手選択中」が表示されないバグの原因）。
  //        前試合の残骸は次のゲーム開始時 (proceedToBattleGameStart) で
  //        クリアする。
  _myEndChoice = null;
  $('btn-end-replay').classList.remove('selected');
  $('btn-end-rule-change').classList.remove('selected');
  // 既受信済みの相手選択を opp-* テキストに反映（前試合残骸は proceedToBattleGameStart 側でクリア）
  $('opp-end-replay').textContent      = _oppEndChoice === 'swap' ? t('end.opp.selecting') : '';
  $('opp-end-rule-change').textContent = _oppEndChoice === 'same' ? t('end.opp.selecting') : '';

  // v1.41: 切断による対戦中止（勝敗なし、戦績記録なし）
  if (_mode === 'battle' && opts && opts.abort) {
    $('end-result-msg').textContent = t('end.abort.title');
    $('end-result-msg').className = 'result-message abort';
    $('end-result-sub').textContent = t('end.abort.reason');
    $('end-stats').style.display = 'none';
    $('btn-end-replay').style.display = 'none';
    $('btn-end-rule-change').style.display = 'none';
    setEndBtnLabel('btn-end-back-room', t('end.btn.toLobby'));
  } else if (_mode === 'battle' && opts && opts.winner) {
    // v1.33 (3-C): 対戦時は WIN/LOSE 表示（通常勝敗時）
    // v1.89 (v1.3): カウントアップ対応 — DRAW / total 比較
    // v2.03 (v1.5): クリケット対応 — WIN/LOSE/DRAW + score 比較
    const isCountup = (_currentRule.type === 'countup');
    const isCricket = (_currentRule.type === 'cricket');
    const isDraw = (opts.winner === 'draw');
    const isMyWin = (opts.winner === 'self');
    const winnerName = isDraw ? '' : (isMyWin ? getMyName() : getOppName());
    if (isDraw) {
      $('end-result-msg').textContent = '🤝 DRAW';
      $('end-result-msg').className = 'result-message';
      if (isCricket) {
        $('end-result-sub').textContent = t('end.cricket.draw.sub', {
          selfScore: _gameState.score, oppScore: _oppState.score,
        });
      } else {
        $('end-result-sub').textContent = t('end.countup.draw.sub', {
          selfTotal: _gameState.total, oppTotal: _oppState.total,
        });
      }
    } else {
      $('end-result-msg').textContent = isMyWin ? '🏆 WIN!' : '😢 LOSE!';
      $('end-result-msg').className = `result-message ${isMyWin ? 'win' : 'lose'}`;
      if (isCricket) {
        $('end-result-sub').textContent = t('end.cricket.battle.sub', {
          selfScore: _gameState.score, oppScore: _oppState.score,
        });
      } else if (isCountup) {
        $('end-result-sub').textContent = t('end.countup.battle.sub', {
          selfTotal: _gameState.total, oppTotal: _oppState.total,
        });
      } else {
        const winnerState = isMyWin ? _gameState : _oppState;
        $('end-result-sub').textContent = winnerState
          ? t('end.win.line', { winner: winnerName, darts: winnerState.dartCount })
          : t('end.win.lineNoDarts', { winner: winnerName });
      }
    }
    // stat 表示の rule 別切替
    if (isCountup) {
      $('end-stat-darts').textContent = String(_gameState.dartCount);
      $('end-stat-turns').textContent = String(_gameState.history.length);
      $('end-stat-busts').textContent = '—';
      const turnScores = _gameState.history.map(h => h.shots.reduce((a, s) => a + s.value, 0));
      $('end-stat-best').textContent = turnScores.length ? String(Math.max(...turnScores)) : '0';
    } else if (isCricket) {
      $('end-stat-darts').textContent = String(_gameState.dartCount);
      $('end-stat-turns').textContent = String(_gameState.history.length);
      $('end-stat-busts').textContent = '—';
      $('end-stat-best').textContent = String(_gameState.score);
    } else {
      // 01 系 battle WIN/LOSE
      const winnerState = isMyWin ? _gameState : _oppState;
      $('end-stat-darts').textContent = winnerState ? winnerState.dartCount : '-';
      $('end-stat-turns').textContent = (winnerState ? winnerState.history.length : '-');
      $('end-stat-busts').textContent = winnerState ? winnerState.history.filter(h => h.bust).length : '-';
      const turnScores = winnerState
        ? winnerState.history.filter(h => !h.bust).map(h => h.shots.reduce((a, s) => a + s.value, 0))
        : [];
      $('end-stat-best').textContent = turnScores.length ? Math.max(...turnScores) : 0;
    }
  } else {
    // 1人プレイ
    // v1.88 (v1.3): カウントアップ対応 — total ベースで achievement
    if (_gameState.rule && _gameState.rule.type === 'countup') {
      const ach = Rules.getAchievementCountup(_gameState.total);
      const turns = _gameState.history.length;
      const turnScores = _gameState.history.map(h => h.shots.reduce((a, s) => a + s.value, 0));
      const bestTurn = turnScores.length ? Math.max(...turnScores) : 0;
      $('end-result-msg').textContent = `${ach.emoji} ${ach.label}`;
      $('end-result-msg').className = 'result-message win';
      $('end-result-sub').textContent = t('end.countup.solo.finish', { total: _gameState.total });
      $('end-stat-darts').textContent = String(_gameState.dartCount);
      $('end-stat-turns').textContent = String(turns);
      $('end-stat-busts').textContent = '—';
      $('end-stat-best').textContent = String(bestTurn);
    } else {
      const ach = Rules.getAchievement(_gameState.dartCount);
      const turns = _gameState.history.length;
      const busts = _gameState.history.filter(h => h.bust).length;
      const turnScores = _gameState.history
        .filter(h => !h.bust)
        .map(h => h.shots.reduce((a, s) => a + s.value, 0));
      const bestTurn = turnScores.length ? Math.max(...turnScores) : 0;
      $('end-result-msg').textContent = `${ach.emoji} ${ach.label}`;
      $('end-result-msg').className = 'result-message win';
      $('end-result-sub').textContent = t('end.solo.finish', { darts: _gameState.dartCount });
      $('end-stat-darts').textContent = _gameState.dartCount;
      $('end-stat-turns').textContent = turns;
      $('end-stat-busts').textContent = busts;
      $('end-stat-best').textContent = bestTurn;
    }
  }

  // v1.44 (3-E): ボタンラベルを mode に応じて設定（abort 時は上書き済み）
  if (!(opts && opts.abort)) {
    if (_mode === 'battle') {
      setEndBtnLabel('btn-end-replay',      t('end.btn.replay.battle'));
      setEndBtnLabel('btn-end-rule-change', t('end.btn.rule.battle'));
      setEndBtnLabel('btn-end-back-room',   t('end.btn.quit.battle'));
    } else {
      setEndBtnLabel('btn-end-replay',      t('end.btn.replay.solo'));
      setEndBtnLabel('btn-end-rule-change', t('end.btn.rule.solo'));
      setEndBtnLabel('btn-end-back-room',   t('end.btn.quit.solo'));
    }
  }
  // v1.47 (3-E): end 画面のチャット枠は対戦時のみ（SPEC 12.1）
  const chatAreaEnd = $('chat-area-end');
  if (chatAreaEnd) chatAreaEnd.style.display = (_mode === 'battle') ? '' : 'none';

  // v1.85 (v1.2): 紙吹雪演出（SPEC 7章 / 10.5）
  //   - 対戦勝者(winner==='self') or 1人プレイ完走時のみ発動
  //   - abort では発動しない
  //   - 性能フォールバック段階4 で粒子数半減（Render 側で処理）
  const isVictory =
    (opts && opts.abort) ? false
    : (_mode === 'battle') ? (opts && opts.winner === 'self')
    : true;  // solo 完走
  if (isVictory) {
    Render.startConfetti();
  }

  leaveGameScreen();
  showScreen('end');
  // v2.09 (v1.5): ファンファーレ (win/lose jingle) は showEndScreen 呼出前に
  //   delayMs 経過させてから呼ばれているため、ここに到達した時点でジングルは
  //   既に再生開始済。showScreen('end') で BGM は一旦停止される。
  //   end 画面に入ってから lobby BGM を開始 (他の SE と重なってよい)。
  if (Sound && Sound.setBgmCategory) Sound.setBgmCategory('lobby');
}

// v1.44 (3-E): 対戦終了時の再戦合意・退出フロー（reversi 流儀踏襲）
let _myEndChoice = null;   // 'swap' | 'same' | null
let _oppEndChoice = null;  // 'swap' | 'same' | null

function chooseEnd(choice) {
  if (_mode !== 'battle') return;
  if (choice === 'quit') {
    if (typeof MomoMatchmaking !== 'undefined') {
      try { MomoMatchmaking.send({ type: 'end_choice', choice: 'quit' }); } catch (e) {}
    }
    // v1.44: 後続の room_closed → onDisconnected で「通信切断」alert が出ないようガード
    _disconnectDeclared = true;
    exitBattleToLobby();
    return;
  }
  _myEndChoice = choice;
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.send({ type: 'end_choice', choice });
  }
  updateEndUI();
  checkEndMatch();
}

function updateEndUI() {
  $('btn-end-replay').classList.toggle('selected',      _myEndChoice === 'swap');
  $('btn-end-rule-change').classList.toggle('selected', _myEndChoice === 'same');
  $('opp-end-replay').textContent      = _oppEndChoice === 'swap' ? t('end.opp.selecting') : '';
  $('opp-end-rule-change').textContent = _oppEndChoice === 'same' ? t('end.opp.selecting') : '';
}

function checkEndMatch() {
  if (!_myEndChoice || !_oppEndChoice) return;
  if (_myEndChoice !== _oppEndChoice) return;  // 不一致は待機
  // 合意成立 → 即試合再開（SPEC 12.6: キャリブはセッション中スキップ）
  if (_myEndChoice === 'swap') {
    _myRole = (_myRole === 'first') ? 'second' : 'first';
  }
  _myEndChoice = null;
  _oppEndChoice = null;
  // 再戦のための状態初期化（proceedToBattleGameStart 相当だがキャリブはスキップ）
  _gameInProgress = true;
  _gameState = Rules.createInitialState(_currentRule);
  _oppState = Rules.createInitialState(_currentRule);
  startHeartbeat();  // 内部で _disconnectDeclared / _lastHeartbeatRcvd / _lastHeartbeatSent を初期化
  enterGameScreen();
}

$('btn-next-turn').addEventListener('click', async () => {
  // v2.10 (v1.5): 対戦時はデッドロック解除「投擲権移譲」、ソロは従来の強制ターン進行
  if (_mode === 'battle') {
    // 確認モーダル: 誤タップで投擲権を失わないよう
    const ok = await confirm(t('confirm.passTurn'));
    if (!ok) return;
    passMyTurnToOpp();
    if (typeof MomoMatchmaking !== 'undefined') {
      MomoMatchmaking.send({ type: 'pass_turn' });
    }
    return;
  }
  // v1.23: ソロ用 強制ターン進行（デバッグ用）。現在のターンの shot は破棄
  // v1.88: turnStartRemaining は 01 ルールのみ
  if (_gameState) {
    _gameState.turnShots = [];
    _gameState.turnIndex++;
    if (_gameState.rule && _gameState.rule.type === '01') {
      _gameState.turnStartRemaining = _gameState.remaining;
    }
    _pendingTurnDisplay = null;
    updateScoreUI();
  }
  Render.placeTargetForTurn();
});

// 0リセット再実行 (v1.15→v1.52): 現在の姿勢を新キャリブとして登録し、
// 的は新ゲーム同様にランダムシフト配置。
// v1.52: SPEC 14.2 の「ゲーム外限定」を撤廃。的のランダム再配置でズル防止は担保済み、
// 「常に一方向を向く強制」を緩和するため対戦中も実行可能とする。
$('btn-recenter').addEventListener('click', () => {
  const ok = Sensor.setCalibration();
  if (!ok) return;  // 値未受信時は何もしない
  Render.placeTargetForTurn();
  closeSettingsPanel();
});

// v1.55 (4-C-4): fps 表示の定期更新（200ms 間隔）。SPEC 17.4
// v1.79 (段階6): 「30fps 割れ時のみ中立表示」に切替。閾値超は非表示
// v1.59 (4-C-6): 自動モードのときは fps に応じて段階的にフォールバックを発動
const _fpsEl = $('fps-display');
setInterval(() => {
  if (!document.body.classList.contains('in-game')) {
    _fpsEl.style.display = 'none';
    return;
  }
  const fps = Render.getFps();
  if (fps === null || fps >= AUTO_DROP_THRESHOLD) {
    // 30fps 以上は非表示。「機種が古い」等の直接表現は使わず、中立に隠す
    _fpsEl.style.display = 'none';
    return;
  }
  _fpsEl.textContent = `${fps} fps`;
  _fpsEl.style.display = 'block';

  // 自動モード時のレベル調整
  if (_qualityMode !== 'auto') return;
  if (fps < AUTO_DROP_THRESHOLD) {
    _lowFpsCount++;
    _highFpsCount = 0;
    if (_lowFpsCount >= AUTO_DROP_TICKS && _qualityLevel < QUALITY_MAX_LEVEL) {
      applyQualityLevel(_qualityLevel + 1);
      _lowFpsCount = 0;
      refreshQualityUI();
    }
  } else if (fps >= AUTO_RECOVER_THRESHOLD) {
    _highFpsCount++;
    _lowFpsCount = 0;
    if (_highFpsCount >= AUTO_RECOVER_TICKS && _qualityLevel > 0) {
      applyQualityLevel(_qualityLevel - 1);
      _highFpsCount = 0;
      refreshQualityUI();
    }
  } else {
    // 30〜49 fps の中間帯ではカウントを増減させず維持
    _lowFpsCount = 0;
    _highFpsCount = 0;
  }
}, 200);

// v1.59 (4-C-5/6): 性能フォールバック + 描画品質モード（SPEC 14.2 + 17.4）
// モード: 'auto' | 'standard' | 'light'。永続化キー: momoDartsQuality
// level: 0=標準、1=木目→単色、2=+履歴1、3=+軌道線即時消去、4=+紙吹雪簡素化
// v1.80 (段階6): 段階3/4 を SPEC 19 残課題に移動、max level=2 に縮約
// v1.85 (v1.2): 軌道線・紙吹雪を実装したので段階3/4 復活、max level=4 に戻す
const QUALITY_LS_KEY = 'momoDartsQuality';
let _qualityMode = localStorage.getItem(QUALITY_LS_KEY) || 'auto';
let _qualityLevel = 0;
const QUALITY_MAX_LEVEL = 4;
// 自動発動: 30fps を下回る連続回数で 1 段階上げ、回復したら戻す
let _lowFpsCount = 0;
let _highFpsCount = 0;
const AUTO_DROP_THRESHOLD = 30;
const AUTO_RECOVER_THRESHOLD = 50;
const AUTO_DROP_TICKS = 5;     // 200ms × 5 = 1秒継続で発動
const AUTO_RECOVER_TICKS = 25; // 200ms × 25 = 5秒継続で回復
function applyQualityLevel(level) {
  _qualityLevel = Math.max(0, Math.min(QUALITY_MAX_LEVEL, level | 0));
  const wall = document.getElementById('game-3d-wall');
  // 段階1: 木目 → 単色（v1.55 で .no-texture クラス実装済み）
  if (wall) wall.classList.toggle('no-texture', _qualityLevel >= 1);
  // 段階2: 着弾履歴を 1 投のみに制限
  Render.setMaxImpactMarks(_qualityLevel >= 2 ? 1 : Infinity);
  // 段階3: 軌道線即時消去（trail 蓄積自体を止める）
  Render.setTrailEnabled(_qualityLevel < 3);
  // 段階4: 紙吹雪粒子数を半減
  Render.setConfettiSimplified(_qualityLevel >= 4);
}
function getQualityLevel() { return _qualityLevel; }
function refreshQualityUI() {
  // セグメントボタンの selected 状態
  document.querySelectorAll('#settings-quality-seg button').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.quality === _qualityMode);
  });
  // ヒント文（自動は現在の level も表示）
  const hint = document.getElementById('settings-quality-status');
  if (hint) {
    if (_qualityMode === 'auto') {
      if (_qualityLevel === 0) {
        hint.textContent = t('settings.quality.hint.auto');
      } else {
        hint.textContent = t('settings.quality.hint.autoLevel', { level: _qualityLevel });
      }
    } else if (_qualityMode === 'light') {
      hint.textContent = t('settings.quality.hint.light');
    } else {
      hint.textContent = t('settings.quality.hint.standard');
    }
  }
}
function applyQualityMode(mode) {
  _qualityMode = mode;
  localStorage.setItem(QUALITY_LS_KEY, mode);
  if (mode === 'standard') applyQualityLevel(0);
  else if (mode === 'light') applyQualityLevel(QUALITY_MAX_LEVEL);
  else { _lowFpsCount = 0; _highFpsCount = 0; applyQualityLevel(0); }
  refreshQualityUI();
}
// v1.60: 起動時に level のみ即時適用。UI 更新（refreshQualityUI）は
// applyLang 完了後に refreshDynamicI18n が呼んでくれる。
// ここで applyQualityMode() を直接呼ぶと t() が _currentLang を TDZ で参照しエラーになり、
// 以降の MomoMatchmaking.init / btn-solo-start.addEventListener が登録されなくなる。
if (_qualityMode === 'light') applyQualityLevel(QUALITY_MAX_LEVEL);
else applyQualityLevel(0);

// クリックハンドラ
document.querySelectorAll('#settings-quality-seg button').forEach(btn => {
  btn.addEventListener('click', () => {
    applyQualityMode(btn.dataset.quality || 'auto');
  });
});

// v1.52: 設定パネル（SPEC 14章。v1.15 のドロップダウン式 settings-menu を置き換え）
// v1.53: 開発用パネル ON/OFF トグル廃止。感度調整は設定パネル内に直接組み込み、
// game-overlay-bottom（次のターン/ログ/退出）は常時表示に戻す。
// 歯車クリック → モーダル表示。マスククリック / 閉じるボタンで閉じる。
// 0リセットは設定パネル内、対戦中も常時有効（SPEC 14.2 を実装追従更新）。
function openSettingsPanel() {
  $('settings-mask').classList.add('active');
}
function closeSettingsPanel() {
  $('settings-mask').classList.remove('active');
}
// v1.61 (5-a): 音量スライダー配線（SPEC 13.10 / 14.2 / 14.5）
// - input 中: 連続反映、テスト音は鳴らさない
// - change（離した瞬間）: テスト音（投擲音流用、ただし 0%/ミュート時は鳴らさない）
// - 0%: 🔊 → 🔇 アイコンと表示テキストも切替
function refreshVolumeUI() {
  const v = Sound.getVolume();
  const sld = $('settings-volume-slider');
  if (sld && document.activeElement !== sld) sld.value = String(v);
  const val = document.getElementById('volume-value');
  if (val) val.textContent = `${v}%`;
  const icon = document.getElementById('volume-icon');
  if (icon) {
    const use = icon.querySelector('use');
    if (use) use.setAttribute('href', v === 0 ? '#icon-volume-off' : '#icon-volume-up');
  }
}
refreshVolumeUI();
$('settings-volume-slider').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10) || 0;
  Sound.setVolume(v);
  refreshVolumeUI();
});
$('settings-volume-slider').addEventListener('change', (e) => {
  // 離した瞬間にテスト音（SPEC 14.2）。ミュート時は鳴らさない
  const v = parseInt(e.target.value, 10) || 0;
  if (v > 0 && Sound.isReady()) Sound.playThrow(0.7);
});

// v2.09 (v1.5): BGM 音量スライダー配線
//   - input 中: 連続反映
//   - 0%: 🔊 → 🔇 アイコンと表示テキストも切替
function refreshBgmVolumeUI() {
  const v = Sound.getBgmVolume();
  const sld = $('settings-bgm-volume-slider');
  if (sld && document.activeElement !== sld) sld.value = String(v);
  const val = document.getElementById('bgm-volume-value');
  if (val) val.textContent = `${v}%`;
  const icon = document.getElementById('bgm-volume-icon');
  if (icon) {
    const use = icon.querySelector('use');
    if (use) use.setAttribute('href', v === 0 ? '#icon-volume-off' : '#icon-volume-up');
  }
}
refreshBgmVolumeUI();
$('settings-bgm-volume-slider').addEventListener('input', (e) => {
  const v = parseInt(e.target.value, 10) || 0;
  Sound.setBgmVolume(v);
  refreshBgmVolumeUI();
  // v2.16: 「1 分以上閉じていた」抑止後でも、 音量変更を「能動的な再開意思」
  //  と見なして refresh
  if (v > 0) refreshBgmForScreen();
});

$('gear-icon').addEventListener('click', (e) => {
  e.stopPropagation();
  openSettingsPanel();
});
$('btn-settings-close').addEventListener('click', closeSettingsPanel);
// マスク（パネル外）クリックで閉じる
$('settings-mask').addEventListener('click', (e) => {
  if (e.target.id === 'settings-mask') closeSettingsPanel();
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

// v1.57: SVG アイコン化に伴い textContent → innerHTML ベースに変更
// 状態表示も Material Icons SVG（hourglass / check / warning）+ ラベルに統一
function statusHtml(iconId, label) {
  return `<svg class="icon" aria-hidden="true"><use href="#${iconId}"/></svg> ${label}`;
}
$('btn-copy-log').addEventListener('click', async () => {
  const log = Render.getLog();
  const btn = $('btn-copy-log');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = statusHtml('icon-hourglass', t('log.send.sending'));
  btn.disabled = true;
  try {
    const data = await uploadLogToDrive(log, 'darts-sensor');
    btn.innerHTML = statusHtml('icon-check', t('log.send.driveOk'));
    console.log('[darts] log uploaded:', data);
  } catch (e) {
    console.warn('[darts] Drive upload failed:', e);
    // フォールバック: navigator.share / クリップボード
    const logText = JSON.stringify(log, null, 2);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'MOMO Darts log', text: logText });
        btn.innerHTML = statusHtml('icon-check', t('log.send.shareOk'));
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(logText);
        btn.innerHTML = statusHtml('icon-check', t('log.send.clipOk'));
      } else {
        throw e;
      }
    } catch (e2) {
      if (e2 && e2.name === 'AbortError') {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        return;
      }
      btn.innerHTML = statusHtml('icon-warning', e.message || 'fail');
    }
  }
  setTimeout(() => {
    btn.innerHTML = originalHTML;
    btn.disabled = false;
  }, 2200);
});

$('btn-game-leave').addEventListener('click', async () => {
  if (await confirm(t('modal.confirm.leave'))) {
    leaveGameScreen();
    Sensor.stopListening();
    Sensor.clearCalibration();
    // v2.14 (v1.5): AI モードは pending AI タイマーをクリアしてロビーへ戻す
    if (_aiShotTimer) { clearTimeout(_aiShotTimer); _aiShotTimer = null; }
    if (isAi()) {
      _mode = 'solo';
      showScreen('lobby');
    } else {
      showScreen('room');
    }
  }
});

// v1.33 (3-C): 対戦終了後の lobby 戻り共通処理
function exitBattleToLobby() {
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.leaveRoom();
  }
  _mode = 'solo';
  _guestName = '';
  // v1.42: abort 宣言フラグをここでリセット（end→lobby 遷移完了で次のゲームに備える）
  _disconnectDeclared = false;
  // v1.48: ロビーチャット履歴をクリアしてパネル非表示
  if (typeof clearLobbyChat === 'function') clearLobbyChat();
  if (typeof showLobbyChatPanels === 'function') showLobbyChatPanels(false);
  resetRoomToSolo();
  showScreen('lobby');
}

$('btn-end-replay').addEventListener('click', () => {
  // v1.44 (3-E): 対戦時は「先後入れ替えて再戦」の合意フロー
  if (_mode === 'battle') { chooseEnd('swap'); return; }
  // SPEC 12.6: 1人用の再戦はキャリブをセッション中スキップ
  if (Sensor.getCalibration()) {
    enterGameScreen();
  } else {
    startGameFlow();
  }
});
$('btn-end-rule-change').addEventListener('click', () => {
  // v1.44 (3-E): 対戦時は「先後そのままで再戦」の合意フロー
  if (_mode === 'battle') { chooseEnd('same'); return; }
  // v2.14 (v1.5): AI モードは「ルール変更」 → ロビーに戻る
  if (isAi()) { _mode = 'solo'; showScreen('lobby'); return; }
  showScreen('room');
});
$('btn-end-back-room').addEventListener('click', () => {
  // v1.44 (3-E): 対戦時は確認なしで退出（abort 経路は exitBattleToLobby 直行で OK）
  if (_mode === 'battle') { chooseEnd('quit'); return; }
  // v2.14 (v1.5): AI モードは ロビーに戻る + _mode リセット
  if (isAi()) { _mode = 'solo'; showScreen('lobby'); return; }
  showScreen('room');
});

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
// v1.52: 「閉じる」は開発用パネル全体を OFF にする → v1.53 で開発用パネル別UI廃止
// 感度調整は設定パネル内に統合、専用「閉じる」は不要（パネル全体の「閉じる」を使う）
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

// ===== 言語切替（段階4-A v1.49 / v1.50: 4言語 i18n ランタイム、SPEC 15章 + cat-lang-spec.docx v1.0） =====
//   - 辞書は darts-i18n.json から fetch ロード（ja/en/zh のみ）
//   - CAT モードは catSpeak(key) でランダム鳴き声を返す（catBase = 直前選択言語）
//     ・error 系キー: HISS! / シャー！ / 嘶！ などの威嚇音
//     ・calm 系キー（接続中・待機中など）: purrrr... / ごろごろ… / 咕噜… などの低い喉鳴き
//     ・その他: MEOW / にゃあ / 喵 などの通常鳴き声
//   - data-i18n / data-i18n-html / data-i18n-placeholder / data-i18n-title 属性で
//     静的テキストを一括書き換え
//   - 動的テキスト（agreement-hint / status 表示等）は t(key, params) を都度呼ぶ
//   - 永続化キーは momoLang（MOMO Works 全体で共通、SPEC 14章）
//   - CAT 選択時のみサブタイトルは前言語そのまま固定（SPEC 15章）
const SUBTITLES = {
  ja: 'Concealed Edge, Single Touch',
  en: 'Concealed Edge, Single Touch',
  zh: '不露鋒心，一指乾坤',
};
const LANG_STORAGE_KEY = 'momoLang';
const CAT_BASE_STORAGE_KEY = 'momoCatBase';
const FALLBACK_LANG = 'ja';

let _i18nDict = null;
let _currentLang = FALLBACK_LANG;
let _catBaseLang = FALLBACK_LANG;  // CAT 選択直前の言語（ja/en/zh）

// --- 猫語語彙テーブル（cat-lang-spec.docx v1.0 §3-4） ---
const CAT_VOCAB = {
  ja: {
    error:  ['シャー！', 'フーッ！', 'シャシャシャ！'],
    calm:   ['ごろごろ…', 'にゃ…', 'ぐるぐる…'],
    normal: ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！'],
  },
  en: {
    error:  ['HISS!', 'SPIT!', 'FSSST!'],
    calm:   ['purrrr...', 'mrrr...', 'prrr...'],
    normal: ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'],
  },
  zh: {
    error:  ['嘶！', '哈！', '嘶嘶！'],
    calm:   ['咕噜…', '喵…', '噜噜…'],
    normal: ['喵', '喵呜', '咪', '喵！'],
  },
};

// error / calm 分類対象キー（Darts 固有、docx の汎用キーを本アプリのキーにマッピング）
const CAT_ERROR_KEYS = new Set([
  'lobby.error.nameRequired',
  'lobby.error.roomNameRequired',
  'lobby.error.passwordRequired',
  'lobby.error.passwordMismatch',
  'lobby.error.generic',
  'alert.kicked',
  'alert.disconnected',
  'alert.oppLeft',
  'announce.abort',
  'announce.abort.reason',
  'end.abort.title',
  'end.abort.reason',
  'calib.status.notSampled',
  'calib.status.errorPrefix_html',
]);
const CAT_CALM_KEYS = new Set([
  'lobby.status.connecting',
  'lobby.status.connected',
  'lobby.status.reconnecting',
  'lobby.status.notLoaded',
  'waiting.status.title',
  'waiting.status.left',
  'calib.status.detecting',
  'calib.status.ok',
  'calib.status.needMove',
  'calib.status.done',
  'room.agreement.idle',
  'room.agreement.waitOpp',
  'room.agreement.youReady',
  'room.agreement.bothReady',
  'room.agreement.localReady',
  'game.disconnect.warn',
]);

// v1.51: params が渡された場合（ユーザー名・数値などの動的データ）は、
//   鳴き声の間に params の値をそのまま挟む形で残す。
//   例: t('end.win.line', {winner:'TARO', darts:42}) (catBase=ja)
//       → "にゃあ TARO ニャ！ 42 にゃ"
//   ユーザー入力データの可読性を保ちつつ猫語っぽさも維持する。
function catSpeak(key, params) {
  const vocab = CAT_VOCAB[_catBaseLang] || CAT_VOCAB.ja;
  let list;
  if (CAT_ERROR_KEYS.has(key))      list = vocab.error;
  else if (CAT_CALM_KEYS.has(key))  list = vocab.calm;
  else                              list = vocab.normal;
  const pick = () => list[Math.floor(Math.random() * list.length)];
  if (!params) return pick();
  const values = Object.values(params).filter(v => v !== undefined && v !== null && v !== '');
  if (values.length === 0) return pick();
  const parts = [pick()];
  for (const v of values) {
    parts.push(String(v));
    parts.push(pick());
  }
  return parts.join(' ');
}

async function loadI18n() {
  if (_i18nDict) return _i18nDict;
  const res = await fetch('./darts-i18n.json', { cache: 'no-cache' });
  _i18nDict = await res.json();
  return _i18nDict;
}

// 訳文取得。CAT は catSpeak へ。それ以外は fallback: 現言語 → ja → key そのもの。{var} を params で置換。
function t(key, params) {
  if (_currentLang === 'cat') return catSpeak(key, params);
  if (!_i18nDict) return key;
  const cur = _i18nDict[_currentLang] || {};
  const fb  = _i18nDict[FALLBACK_LANG] || {};
  let str = cur[key];
  if (str === undefined) str = fb[key];
  if (str === undefined) return key;
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, name) => (params[name] !== undefined ? params[name] : m));
}

// data-i18n* 属性を一括反映
function applyI18nAttrs(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
}

async function applyLang(lang) {
  await loadI18n();
  // v1.50: CAT 選択直前の言語を catBase として保存（docx §3-2）
  if (lang === 'cat' && _currentLang !== 'cat') {
    _catBaseLang = _currentLang;
    try { localStorage.setItem(CAT_BASE_STORAGE_KEY, _catBaseLang); } catch {}
  }
  _currentLang = lang;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch {}
  // html lang 属性: CAT は catBase の言語として扱う（フォント・改行ヒューリスティクスのため）
  document.documentElement.lang = (lang === 'cat') ? (_catBaseLang || 'ja') : lang;

  // サブタイトル: CAT 選択時のみ前言語そのまま（SPEC 15章）
  const subtitleEl = $('subtitle');
  if (subtitleEl && lang !== 'cat') {
    subtitleEl.textContent = SUBTITLES[lang] || SUBTITLES.ja;
    subtitleEl.classList.toggle('zh', lang === 'zh');
  }

  // 静的テキストを一括反映
  applyI18nAttrs();

  // 動的テキストの再描画フック（既描画の status/hint/preset 等）
  refreshDynamicI18n();
}

// 言語切替時に動的内容を再描画。state を関数群に持たせて t() で書き直す。
function refreshDynamicI18n() {
  // lobby chat 空メッセージ（::before の attr 経由）
  document.querySelectorAll('.lobby-chat-list').forEach(el => {
    el.setAttribute('data-empty', t('chat.lobby.empty'));
  });
  // v1.51: チャットプリセットは「ゲーム画面遷移時に決定、以後言語切替で変更しない」
  //        ため、ここでは loadChatPresets/applyChatPresetsToButtons を呼ばない。
  //        enterGameScreen() 内で言語決定済みプリセットを生成する。
  // 各 status / hint / room status の再描画
  refreshLobbyStatus();
  refreshWaitingStatus();
  refreshRoomStatusBar();
  if (typeof renderAgreementHint === 'function') renderAgreementHint();
  if (typeof renderRoleSelection === 'function') renderRoleSelection();
  // game 画面 turn-info（現在表示中なら）
  if (typeof updateTurnInfo === 'function' && document.body.classList.contains('in-game')) {
    updateTurnInfo();
  }
  // 部屋一覧（last cache から再描画）
  if (_lastPublicRooms) renderRoomList();
  // 許可手順案内（表示中なら）
  refreshPermissionSteps();
  // v1.59: 描画品質ヒント
  if (typeof refreshQualityUI === 'function') refreshQualityUI();
  // v1.88 (v1.3): ルール選択 UI（言語変更時にラベル・詳細を再描画）
  if (typeof applyRuleToUI === 'function') applyRuleToUI();
}

const langSelect = $('lang-select');
langSelect.addEventListener('change', (e) => applyLang(e.target.value));

// =====================================================================
// v1.27 (3-A): 対戦マッチング統合（global MomoMatchmaking、SPEC 8章 / 21.5）
// =====================================================================

const SIGNALING_URL = 'wss://momo-server-reversi.onrender.com';
const GAME_TYPE = 'darts';
// v1.79 (段階6): MOMO Works 共通キーに揃える（reversi / gomoku-go と同じ）
//   - 旧 'momo-darts-name' は v0.x の名残。マイグレーションで新キーへ移行
const NAME_KEY = 'momoPlayerName';
const ROOM_NAME_KEY = 'momoRoomName';
const LEGACY_NAME_KEY = 'momo-darts-name';

// 'solo' | 'battle' | 'ai' — 現在の遊び方モード (v2.14: 'ai' 追加)
let _mode = 'solo';
// v2.14 (v1.5): AI 対戦の難度。 'easy' | 'normal' | 'hard'
let _aiDifficulty = 'normal';

// v2.14 (v1.5): 「相手あり」モード (battle / ai 共通)
function isVersus() { return _mode === 'battle' || _mode === 'ai'; }
function isAi() { return _mode === 'ai'; }

// v1.88〜v1.91 (v1.4): ルール状態
//   _soloRule:    「一人で遊ぶ」用の選択状態（localStorage `momoDartsSoloRule`）
//   _createRule:  「部屋を作る」用の選択状態（localStorage `momoDartsCreateRule`）
//   _currentRule: ゲーム実行中のルール（solo 開始時=_soloRule、battle 入室時=サーバーから受信）
//   _ruleSelectScope: 'solo' | 'create' (screen-rule-select 表示中にどちらを編集しているか)
//   SPEC 3.2: { type:'01', startScore:301..1501, outRule:'single'|'double'|'master' }
//             | { type:'countup', rounds:8 }
const DEFAULT_RULE = { type: '01', startScore: 501, outRule: 'single' };
const SOLO_RULE_LS_KEY   = 'momoDartsSoloRule';
const CREATE_RULE_LS_KEY = 'momoDartsCreateRule';
function loadRuleFromLS(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_RULE };
    const parsed = JSON.parse(raw);
    return Rules.isValidRule(parsed) ? parsed : { ...DEFAULT_RULE };
  } catch { return { ...DEFAULT_RULE }; }
}
function saveRuleToLS(key, rule) {
  try { localStorage.setItem(key, JSON.stringify(rule)); } catch {}
}
// v2.14 (v1.5): AI 対戦用のルール永続化キー
const AI_RULE_LS_KEY     = 'momoDartsAiRule';
const AI_DIFFICULTY_LS_KEY = 'momoDartsAiDifficulty';

let _soloRule   = loadRuleFromLS(SOLO_RULE_LS_KEY);
let _createRule = loadRuleFromLS(CREATE_RULE_LS_KEY);
let _aiRule     = loadRuleFromLS(AI_RULE_LS_KEY);
let _currentRule = { ..._soloRule };  // 既定は solo 経路
let _ruleSelectScope = 'solo';
// 起動時 AI 難度を localStorage から復元
try {
  const d = localStorage.getItem(AI_DIFFICULTY_LS_KEY);
  if (d === 'easy' || d === 'normal' || d === 'hard') _aiDifficulty = d;
} catch {}

function getRuleByScope(scope) {
  if (scope === 'create') return _createRule;
  if (scope === 'ai')     return _aiRule;
  return _soloRule;
}
function setRuleByScope(scope, rule) {
  if (scope === 'create') { _createRule = rule; saveRuleToLS(CREATE_RULE_LS_KEY, rule); }
  else if (scope === 'ai') { _aiRule    = rule; saveRuleToLS(AI_RULE_LS_KEY,     rule); }
  else                    { _soloRule   = rule; saveRuleToLS(SOLO_RULE_LS_KEY,   rule); }
}

// v1.91/v1.95 (v1.5): screen-rule-select の表示反映（scope の現状ルール → UI）
function applyRuleSelectUI() {
  const rule = getRuleByScope(_ruleSelectScope);
  // タブ
  document.querySelectorAll('#rule-select-tabs .rule-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.ruleType === rule.type);
  });
  // タブコンテンツ
  ['01', 'countup', 'rtc', 'cricket'].forEach((t) => {
    const el = $(`rule-select-content-${t}`);
    if (el) el.style.display = rule.type === t ? 'block' : 'none';
  });
  // v1.95/v2.03 (v1.5): クリケットは対戦専用 (solo では disabled、対戦では選択可)
  // v2.14 (v1.5): クリケットは対戦専用だが、 AI 対戦 (scope='ai') でも有効化
  const cricketTab = document.querySelector('#rule-select-tabs .rule-tab[data-rule-type="cricket"]');
  if (cricketTab) {
    const isSoloScope = (_ruleSelectScope === 'solo');
    cricketTab.disabled = isSoloScope;
    cricketTab.style.opacity = isSoloScope ? '0.4' : '1';
    cricketTab.title = isSoloScope ? 'Cricket — 対戦専用' : '';
  }
  // ボタンのハイライト
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-start-score]').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.startScore) === rule.startScore);
  });
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-out-rule]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.outRule === rule.outRule);
  });
  // v1.94 (v1.4): インルール ハイライト
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-in-rule]').forEach((b) => {
    const cur = rule.inRule || 'normal';
    b.classList.toggle('selected', b.dataset.inRule === cur);
  });
  // v1.94 (v1.4): カウントアップ ラウンド数 ハイライト
  document.querySelectorAll('#rule-select-content-countup .rule-btn[data-rounds]').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.rounds) === rule.rounds);
  });
  // 詳細表示 (screen-rule-select 内)
  updateRuleSelectDetail();
  // status-bar 文言
  const sb = $('rule-select-status');
  if (sb) {
    if (_ruleSelectScope === 'solo')      sb.textContent = t('ruleSelect.status.solo');
    else if (_ruleSelectScope === 'ai')   sb.textContent = t('ruleSelect.status.ai');
    else                                   sb.textContent = t('ruleSelect.status.create');
  }
}

// v1.91/v1.94 (v1.4): screen-rule-select 内のルール詳細表示
function updateRuleSelectDetail() {
  const rule = getRuleByScope(_ruleSelectScope);
  const nameEl  = $('rule-select-name');
  const pointsEl= $('rs-points');
  const turnEl  = $('rs-turn');
  const winEl   = $('rs-win');
  const bustDt  = $('rs-bust-dt');
  const bustEl  = $('rs-bust');
  if (!nameEl) return;
  if (rule.type === '01') {
    const inSfx = (rule.inRule === 'doubleIn') ? ` (${t('room.rule.inRule.doubleIn')})` : '';
    nameEl.textContent = `${rule.startScore} ${t(`room.rule.outRule.${rule.outRule}`)}${inSfx}`;
    pointsEl.textContent = t('room.rule.points.value01', { score: rule.startScore });
    turnEl.textContent   = t('room.rule.turn.value');
    // 勝利条件: アウトルールに加えて、ダブルインなら冒頭注記
    const winBase = t(`room.rule.win.value.${rule.outRule}`);
    winEl.textContent = (rule.inRule === 'doubleIn')
      ? `${t('room.rule.in.value.doubleIn')} / ${winBase}`
      : winBase;
    bustEl.textContent = t('room.rule.bust.value');
    if (bustDt) bustDt.style.display = '';
    bustEl.style.display = '';
  } else if (rule.type === 'countup') {
    nameEl.textContent = t('room.rule.name.countup');
    pointsEl.textContent = t(`room.rule.rounds.value${rule.rounds}`);
    turnEl.textContent   = t('room.rule.countup.turn');
    winEl.textContent    = t('room.rule.countup.win.dyn', { rounds: rule.rounds, darts: rule.rounds * 3 });
    if (bustDt) bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  } else if (rule.type === 'rtc') {
    nameEl.textContent = t('room.rule.name.rtc');
    pointsEl.textContent = t('room.rule.rtc.points');
    turnEl.textContent   = t('room.rule.turn.value');
    winEl.textContent    = t('room.rule.rtc.win');
    if (bustDt) bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  } else if (rule.type === 'cricket') {
    nameEl.textContent = t('room.rule.name.cricket');
    pointsEl.textContent = t('room.rule.cricket.targets');
    turnEl.textContent   = t('room.rule.turn.value');
    winEl.textContent    = t('room.rule.cricket.win');
    if (bustDt) bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  }
}

// v1.91 (v1.4): screen-rule-select 遷移ヘルパー
function showRuleSelectScreen(scope) {
  _ruleSelectScope = scope;
  applyRuleSelectUI();
  showScreen('rule-select');
}

// 言語切替・他から呼ばれる UI 再描画
function applyRuleToUI() {
  applyRuleSelectUI();
  // 部屋画面のルール詳細は _currentRule に従って更新（入室・ゲーム開始時に決まる）
  updateRuleDetail();
}

// v1.88: ルール詳細表示の動的更新（SPEC 11.3）
function updateRuleDetail() {
  const nameEl  = $('room-rule-name');
  const pointsEl= $('rd-points');
  const turnEl  = $('rd-turn');
  const winEl   = $('rd-win');
  const bustDt  = $('rd-bust-dt');
  const bustEl  = $('rd-bust');
  if (!nameEl) return;

  if (_currentRule.type === '01') {
    const out = _currentRule.outRule;
    const inRule = _currentRule.inRule || 'normal';
    const outName = t(`room.rule.outRule.${out}`);
    const inSfx = (inRule === 'doubleIn') ? ` (${t('room.rule.inRule.doubleIn')})` : '';
    nameEl.textContent = `${_currentRule.startScore} ${outName}${inSfx}`;
    pointsEl.textContent = t('room.rule.points.value01', { score: _currentRule.startScore });
    turnEl.textContent   = t('room.rule.turn.value');
    const winBase = t(`room.rule.win.value.${out}`);
    winEl.textContent = (inRule === 'doubleIn') ? `${t('room.rule.in.value.doubleIn')} / ${winBase}` : winBase;
    if (bustDt) bustDt.textContent = t('room.rule.bust.label');
    bustEl.textContent   = t('room.rule.bust.value');
    bustDt.style.display = '';
    bustEl.style.display = '';
  } else if (_currentRule.type === 'countup') {
    nameEl.textContent = t('room.rule.name.countup');
    pointsEl.textContent = t(`room.rule.rounds.value${_currentRule.rounds}`);
    turnEl.textContent   = t('room.rule.countup.turn');
    winEl.textContent    = t('room.rule.countup.win.dyn', { rounds: _currentRule.rounds, darts: _currentRule.rounds * 3 });
    bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  } else if (_currentRule.type === 'rtc') {
    nameEl.textContent = t('room.rule.name.rtc');
    pointsEl.textContent = t('room.rule.rtc.points');
    turnEl.textContent   = t('room.rule.turn.value');
    winEl.textContent    = t('room.rule.rtc.win');
    bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  } else if (_currentRule.type === 'cricket') {
    nameEl.textContent = t('room.rule.name.cricket');
    pointsEl.textContent = t('room.rule.cricket.targets');
    turnEl.textContent   = t('room.rule.turn.value');
    winEl.textContent    = t('room.rule.cricket.win');
    bustDt.style.display = 'none';
    bustEl.style.display = 'none';
  }
}

// v1.91 (v1.4): screen-rule-select 内の UI イベントハンドラ
//   _ruleSelectScope ('solo' or 'create') の現在ルールを編集
function setupRuleUIHandlers() {
  document.querySelectorAll('#rule-select-tabs .rule-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled) return;
      const ruleType = tab.dataset.ruleType;
      const current = getRuleByScope(_ruleSelectScope);
      if (ruleType === current.type) return;
      let next;
      if (ruleType === '01')           next = { type: '01', startScore: 501, outRule: 'single' };
      else if (ruleType === 'countup') next = { type: 'countup', rounds: 8 };
      else if (ruleType === 'rtc')     next = { type: 'rtc' };
      else if (ruleType === 'cricket') next = { type: 'cricket' };
      else return;
      setRuleByScope(_ruleSelectScope, next);
      applyRuleSelectUI();
    });
  });
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-start-score]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = getRuleByScope(_ruleSelectScope);
      if (current.type !== '01') return;
      const next = { ...current, startScore: Number(btn.dataset.startScore) };
      setRuleByScope(_ruleSelectScope, next);
      applyRuleSelectUI();
    });
  });
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-out-rule]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = getRuleByScope(_ruleSelectScope);
      if (current.type !== '01') return;
      const next = { ...current, outRule: btn.dataset.outRule };
      setRuleByScope(_ruleSelectScope, next);
      applyRuleSelectUI();
    });
  });
  // v1.94 (v1.4): インルール (ダブルイン)
  document.querySelectorAll('#rule-select-content-01 .rule-btn[data-in-rule]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = getRuleByScope(_ruleSelectScope);
      if (current.type !== '01') return;
      const next = { ...current, inRule: btn.dataset.inRule };
      setRuleByScope(_ruleSelectScope, next);
      applyRuleSelectUI();
    });
  });
  // v1.94 (v1.4): ラウンド数 (4/8/12)
  document.querySelectorAll('#rule-select-content-countup .rule-btn[data-rounds]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = getRuleByScope(_ruleSelectScope);
      if (current.type !== 'countup') return;
      const next = { ...current, rounds: Number(btn.dataset.rounds) };
      setRuleByScope(_ruleSelectScope, next);
      applyRuleSelectUI();
    });
  });

  // 戻る・決定
  const btnBack = $('btn-rule-select-back');
  const btnOk = $('btn-rule-select-ok');
  if (btnBack) btnBack.addEventListener('click', () => { showScreen('lobby'); });
  if (btnOk) btnOk.addEventListener('click', onRuleSelectConfirm);
}

// v1.91 (v1.4): 「決定」ボタン押下 → scope に応じて次フロー
function onRuleSelectConfirm() {
  if (_ruleSelectScope === 'solo') {
    _mode = 'solo';
    _currentRule = { ..._soloRule };
    updateRuleDetail();
    resetRoomToSolo();
    showScreen('room');
  } else if (_ruleSelectScope === 'ai') {
    // v2.14 (v1.5): AI 対戦 → 難度選択画面へ
    _mode = 'ai';
    _currentRule = { ..._aiRule };
    refreshDifficultyUI();
    showScreen('difficulty');
  } else {
    // create
    _currentRule = { ..._createRule };
    updateRuleDetail();
    const myName = ($('my-name').value || '').trim();
    const roomName = ($('room-name-input').value || '').trim();
    const password = ($('room-password').value || '').trim();
    const isPublic = $('room-public').checked;
    if (typeof MomoMatchmaking !== 'undefined') {
      MomoMatchmaking.createRoom({
        hostName: myName,
        name: roomName,
        password,
        isPublic,
        rules: _createRule,
      });
    }
  }
}
let _hostName = '';
let _guestName = '';
let _currentRoomName = '';

// v1.79: プレイヤー名のレガシーキーから新キーへ自動マイグレーション
try {
  const legacy = localStorage.getItem(LEGACY_NAME_KEY);
  if (legacy && !localStorage.getItem(NAME_KEY)) {
    localStorage.setItem(NAME_KEY, legacy);
  }
  if (legacy) localStorage.removeItem(LEGACY_NAME_KEY);
} catch {}

// 名前は localStorage で永続化（MOMO Works 全体共通）
const _savedName = localStorage.getItem(NAME_KEY);
if (_savedName) $('my-name').value = _savedName;
// 部屋名も MOMO Works 全体共通でプリフィル（reversi / gomoku-go と同じ流儀）
try {
  const _savedRoomName = localStorage.getItem(ROOM_NAME_KEY);
  const roomInput = $('room-name-input');
  if (_savedRoomName && roomInput) roomInput.value = _savedRoomName;
} catch {}

// v1.49: i18n キーを保持し言語切替で再描画できるよう変更
let _lobbyStatusKey = 'lobby.status.connecting';
let _lobbyStatusHighlight = false;
function setLobbyStatus(key, highlight) {
  _lobbyStatusKey = key;
  _lobbyStatusHighlight = !!highlight;
  const el = $('lobby-status');
  el.textContent = t(key);
  el.classList.toggle('highlight', _lobbyStatusHighlight);
}
function refreshLobbyStatus() { setLobbyStatus(_lobbyStatusKey, _lobbyStatusHighlight); }

// waiting-status も同様（key ベース）。引数なしで再描画
let _waitingStatusKey = 'waiting.status.title';
function setWaitingStatus(key) {
  _waitingStatusKey = key;
  $('waiting-status').textContent = t(key);
}
function refreshWaitingStatus() { setWaitingStatus(_waitingStatusKey); }

function setError(elId, text) {
  $(elId).textContent = text || '';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// 対戦時の room → solo 標準表示への戻し
function resetRoomToSolo() {
  $('room-status').style.display = 'none';
  $('room-status').textContent = '';
  $('btn-game-start').disabled = false;
  // v1.49: i18n キーを data-i18n 経由で動的更新（言語切替時も自動追従）
  const dt = $('room-rule-mode-dt');
  const dd = $('room-rule-mode-dd');
  const hint = $('room-hint');
  dt.dataset.i18n   = 'room.rule.mode.solo.label';
  dd.dataset.i18n   = 'room.rule.mode.solo.value';
  hint.dataset.i18n = 'room.hint.prep';
  dt.textContent    = t('room.rule.mode.solo.label');
  dd.textContent    = t('room.rule.mode.solo.value');
  hint.textContent  = t('room.hint.prep');
  $('role-select-panel').style.display = 'none';
  updateKickButton();  // _mode='solo' 等を反映してキックを隠す
}

// 対戦時のキックボタン表示更新
//   - ホスト時のみ表示（ゲストには見せない）
//   - ゲスト不在時は disabled（クリックイベント自体発火しない＝確認ダイアログも出ない）
function updateKickButton() {
  const btn = $('btn-kick-guest');
  const isHost = (typeof MomoMatchmaking !== 'undefined') && MomoMatchmaking.getState().isHost;
  if (_mode === 'battle' && isHost) {
    btn.style.display = 'block';
    btn.disabled = !_guestName;
  } else {
    btn.style.display = 'none';
    btn.disabled = true;
  }
}

// v1.49: 言語切替時にも再描画できるよう、最後の rooms を保持
// v1.90/v1.95 (v1.5): rule オブジェクトを表示文字列にする
function formatRuleName(rule) {
  if (!Rules.isValidRule(rule)) return '';
  if (rule.type === '01') {
    const inSfx = (rule.inRule === 'doubleIn') ? ` (${t('room.rule.inRule.doubleIn')})` : '';
    return `${rule.startScore} ${t(`room.rule.outRule.${rule.outRule}`)}${inSfx}`;
  }
  if (rule.type === 'countup') {
    return `${t('room.rule.name.countup')} ${rule.rounds}R`;
  }
  if (rule.type === 'rtc')     return t('room.rule.name.rtc');
  if (rule.type === 'cricket') return t('room.rule.name.cricket');
  return '';
}

let _lastPublicRooms = null;
function renderRoomList(rooms) {
  if (rooms) _lastPublicRooms = rooms;
  const list = $('room-list');
  const visible = (_lastPublicRooms || []).filter(r => r.isPublic);
  if (visible.length === 0) {
    list.innerHTML = `<div class="room-empty">${escapeHtml(t('lobby.rooms.empty'))}</div>`;
    return;
  }
  list.innerHTML = '';
  for (const r of visible) {
    const div = document.createElement('div');
    div.className = 'room-item';
    const lock = r.hasPassword ? '<span class="room-lock">🔒</span>' : '';
    // v1.90 (v1.4): 部屋のルール名表示
    const ruleName = formatRuleName(r.rules);
    const ruleHtml = ruleName ? `<div class="room-rule">${escapeHtml(ruleName)}</div>` : '';
    div.innerHTML =
      `<div class="room-meta">` +
      `<div class="room-name">${escapeHtml(r.name)}</div>` +
      `<div class="room-host">${escapeHtml(t('lobby.room.host', { name: r.hostName }))}</div>` +
      `${ruleHtml}` +
      `</div>${lock}`;
    div.addEventListener('click', () => clickJoinRoom(r));
    list.appendChild(div);
  }
}

let _showingPrivate = false;
let _pendingPrivatePw = '';

function renderPrivateRoomList(rooms, password) {
  const list = $('private-room-list');
  const visible = (rooms || []).filter(r => !r.isPublic && r.hasPassword);
  if (visible.length === 0) {
    list.style.display = 'none';
    setError('private-error', t('lobby.error.passwordMismatch'));
    return;
  }
  setError('private-error', '');
  list.style.display = 'flex';
  list.innerHTML = '';
  for (const r of visible) {
    const div = document.createElement('div');
    div.className = 'room-item';
    const ruleName = formatRuleName(r.rules);
    const ruleHtml = ruleName ? `<div class="room-rule">${escapeHtml(ruleName)}</div>` : '';
    div.innerHTML =
      `<div class="room-meta">` +
      `<div class="room-name">${escapeHtml(r.name)}</div>` +
      `<div class="room-host">${escapeHtml(t('lobby.room.host', { name: r.hostName }))}</div>` +
      `${ruleHtml}` +
      `</div><span class="room-lock">🔒</span>`;
    div.addEventListener('click', () => {
      const myName = ($('my-name').value || '').trim() || t('lobby.guest');
      localStorage.setItem(NAME_KEY, myName);
      MomoMatchmaking.joinRoom(r.id, password, myName);
    });
    list.appendChild(div);
  }
}

function clickJoinRoom(room) {
  const myName = ($('my-name').value || '').trim();
  if (!myName) {
    alertInfo(t('lobby.error.nameRequired'));
    $('my-name').focus();
    return;
  }
  let pw = '';
  if (room.hasPassword) {
    pw = prompt(t('lobby.prompt.password'));
    if (pw === null) return;
  }
  localStorage.setItem(NAME_KEY, myName);
  MomoMatchmaking.joinRoom(room.id, pw, myName);
}

// v1.49: 言語切替時の再描画用に値を保持
function refreshRoomStatusBar() {
  if (_mode !== 'battle' || !_currentRoomName) return;
  const tail = _guestName ? ' vs ' + _guestName : `（${t('lobby.room.guestWaiting')}）`;
  $('room-status').textContent = `${_currentRoomName} ｜ ${_hostName}${tail}`;
}

function enterBattleRoom() {
  $('room-status').style.display = 'block';
  refreshRoomStatusBar();
  // v1.49: data-i18n 経由で battle 用ラベルに切替（言語切替に自動追従）
  const dt = $('room-rule-mode-dt');
  const dd = $('room-rule-mode-dd');
  const hint = $('room-hint');
  dt.dataset.i18n   = 'room.rule.mode.battle.label';
  dd.dataset.i18n   = 'room.rule.mode.battle.value';
  hint.dataset.i18n = 'room.hint.prep';
  dt.textContent    = t('room.rule.mode.battle.label');
  dd.textContent    = t('room.rule.mode.battle.value');
  hint.textContent  = t('room.hint.prep');
  // v1.31 (3-B): 先攻/後攻 選択パネル表示 + 状態リセット（新たな相手と最初から）
  $('role-select-panel').style.display = 'flex';
  resetBattleAgreementState();
  updateKickButton();
  showScreen('room');
}

function initMatchmaking() {
  if (typeof MomoMatchmaking === 'undefined') {
    console.warn('[darts] MomoMatchmaking module not loaded');
    setLobbyStatus('lobby.status.notLoaded', false);
    return;
  }
  MomoMatchmaking.init({
    signalingUrl: SIGNALING_URL,
    gameType: GAME_TYPE,

    onWsOpen: () => setLobbyStatus('lobby.status.connected', true),
    onWsClose: () => setLobbyStatus('lobby.status.reconnecting', false),

    onRoomList: (rooms) => {
      renderRoomList(rooms);
      if (_showingPrivate) {
        renderPrivateRoomList(rooms, _pendingPrivatePw);
        _showingPrivate = false;
      }
    },

    onRoomCreated: (roomId, roomName, rules) => {
      _mode = 'battle';
      _currentRoomName = roomName;
      _hostName = ($('my-name').value || '').trim() || t('lobby.host');
      _guestName = '';
      // v1.90 (v1.4): サーバーから返された rules を _currentRule に反映（fallback あり）
      if (Rules.isValidRule(rules)) _currentRule = rules;
      updateRuleDetail();
      $('waiting-room-name').textContent = roomName;
      setWaitingStatus('waiting.status.title');
      clearLobbyChat();
      showLobbyChatPanels(true);
      showScreen('waiting');
    },

    onJoinedRoom: (roomId, roomName, hostName, rules) => {
      _mode = 'battle';
      _currentRoomName = roomName;
      _hostName = hostName;
      _guestName = ($('my-name').value || '').trim() || t('lobby.guest');
      // v1.90 (v1.4): 入室時にホストのルールを受信して _currentRule に反映
      if (Rules.isValidRule(rules)) _currentRule = rules;
      updateRuleDetail();
      clearLobbyChat();
      showLobbyChatPanels(true);
      enterBattleRoom();
    },

    onGuestJoined: (guestName) => {
      _guestName = guestName;
      enterBattleRoom();
      // v1.90 (v1.4): rule_change protocol 削除済み（v1.89 暫定対応撤回）
      //   入室時にサーバーが返す rules を信頼するため、入室後の同期送信は不要
    },

    onGuestLeft: () => {
      _guestName = '';
      updateKickButton();
      // v1.42: 既に abort 宣言済み（end画面表示中）なら何もしない
      // （重複発火で end → lobby に巻き戻されるのを防ぐ）
      if (_disconnectDeclared) return;
      // v1.41: 試合中にゲスト退出 → 対戦中止（勝敗なし）
      if (_gameInProgress && _mode === 'battle') {
        declareDisconnectAbort('guest-left');
        return;
      }
      // 試合前（待機・部屋画面）の退出 → 新しいゲストを待つ
      resetBattleAgreementState();
      setWaitingStatus('waiting.status.left');
      showScreen('waiting');
    },

    onConnected: () => {
      // DataChannel 確立。3-C 以降で利用
    },

    onDisconnected: (msg) => {
      // v1.42: 既に abort 宣言済みなら何もしない。
      // 復帰タイミングの WS.onclose や buffered room_closed が遅れて発火し、
      // showEndScreen 後（_gameInProgress=false 時）に再入した場合に下の lobby
      // 分岐へ落ちて end 画面が上書きされる現象を防ぐ。
      if (_disconnectDeclared) return;
      // v1.41: 試合中の切断はすべて「対戦中止（勝敗なし）」扱いに統一。
      // currentRoomId の有無で reason だけ出し分け（ログ用途）。
      if (_gameInProgress && _mode === 'battle') {
        const stillInRoom = (typeof MomoMatchmaking !== 'undefined')
          && !!MomoMatchmaking.getState().currentRoomId;
        declareDisconnectAbort(stillInRoom ? 'self-ws-died' : 'opp-ws-died');
        return;
      }
      // v1.56: 1人プレイ中(_mode==='solo')は WS 切断と無関係に継続させる。
      // SPEC 1.4「ネット要件: 1人=不要」。サーバー未接続でも 1 人プレイは成立する。
      if (_mode === 'solo') {
        return;
      }
      // 対戦モードの非ゲーム時切断(ロビー/部屋/待機での切断) → ロビーに戻す
      alertInfo(t('alert.disconnected'));
      _mode = 'solo';
      _guestName = '';
      resetRoomToSolo();
      showScreen('lobby');
    },

    onError: (msg) => {
      setError('create-error', msg || t('lobby.error.generic'));
    },

    onKicked: () => {
      alertInfo(t('alert.kicked'));
      _mode = 'solo';
      _guestName = '';
      resetRoomToSolo();
      showScreen('lobby');
    },

    onMessage: (data) => {
      // v1.31 (3-B): 合意フローのメッセージはここで処理
      handleBattleMessage(data);
    },
  });
}

// ----- ロビーの対戦 UI ハンドラ -----
$('btn-create-room').addEventListener('click', () => {
  const myName = ($('my-name').value || '').trim();
  const roomName = ($('room-name-input').value || '').trim();
  const password = ($('room-password').value || '').trim();
  const isPublic = $('room-public').checked;
  if (!myName) {
    setError('create-error', t('lobby.error.nameRequired'));
    return;
  }
  if (!roomName) {
    setError('create-error', t('lobby.error.roomNameRequired'));
    return;
  }
  setError('create-error', '');
  localStorage.setItem(NAME_KEY, myName);
  // v1.79: 部屋名も永続化（reversi / gomoku-go と共通キー momoRoomName）
  try { localStorage.setItem(ROOM_NAME_KEY, roomName); } catch {}
  // v1.91 (v1.4): 入力バリデーション後、ルール選択画面に遷移
  //   実際の MomoMatchmaking.createRoom 呼出は決定ボタン押下時 (onRuleSelectConfirm)
  showRuleSelectScreen('create');
});

$('btn-refresh-rooms').addEventListener('click', () => {
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.refreshRooms();
  }
});

$('btn-show-private').addEventListener('click', () => {
  const pw = ($('private-room-pw').value || '').trim();
  if (!pw) {
    setError('private-error', t('lobby.error.passwordRequired'));
    return;
  }
  setError('private-error', '');
  _showingPrivate = true;
  _pendingPrivatePw = pw;
  MomoMatchmaking.refreshRooms();
});

$('btn-waiting-leave').addEventListener('click', async () => {
  if (await confirm(t('modal.confirm.leave'))) {
    if (typeof MomoMatchmaking !== 'undefined') MomoMatchmaking.leaveRoom();
    _mode = 'solo';
    _guestName = '';
    showScreen('lobby');
  }
});

// =====================================================================
// v1.31 (3-B): 先攻/後攻 合意フロー（SPEC 11.1, 11.4）
// =====================================================================

// 'first' | 'second' | null
let _myRole = null;
let _oppRole = null;
let _myStartPressed = false;
let _oppStartPressed = false;
let _myCalibDone = false;
let _oppCalibDone = false;

function resetBattleAgreementState() {
  _myRole = null;
  _oppRole = null;
  _myStartPressed = false;
  _oppStartPressed = false;
  _myCalibDone = false;
  _oppCalibDone = false;
  renderRoleSelection();
  renderAgreementHint();
  $('btn-game-start').disabled = (_mode === 'battle');
}

function rolesConsistent() {
  return _myRole && _oppRole && _myRole !== _oppRole;
}

function renderRoleSelection() {
  const cardF = $('role-card-first');
  const cardS = $('role-card-second');
  if (!cardF || !cardS) return;
  cardF.classList.toggle('selected-self', _myRole === 'first');
  cardS.classList.toggle('selected-self', _myRole === 'second');
  cardF.classList.toggle('selected-opp', _oppRole === 'first');
  cardS.classList.toggle('selected-opp', _oppRole === 'second');
  const labelFor = (role) => {
    const parts = [];
    if (_myRole === role) parts.push(t('lobby.you'));
    if (_oppRole === role) parts.push(t('lobby.opp'));
    return parts.join(' + ');
  };
  $('who-first').textContent = labelFor('first');
  $('who-second').textContent = labelFor('second');
}

// v1.49: i18n キーを保持して言語切替時にも再描画
function currentAgreementHintKey() {
  if (!rolesConsistent()) return { key: 'room.agreement.idle', cls: null };
  if (_myStartPressed && !_oppStartPressed) return { key: 'room.agreement.waitOpp', cls: 'waiting' };
  if (!_myStartPressed && _oppStartPressed) return { key: 'room.agreement.youReady', cls: 'waiting' };
  if (_myStartPressed && _oppStartPressed) return { key: 'room.agreement.bothReady', cls: 'ready' };
  return { key: 'room.agreement.localReady', cls: 'ready' };
}
function renderAgreementHint() {
  const hint = $('agreement-hint');
  if (!hint) return;
  hint.classList.remove('ready', 'waiting');
  const { key, cls } = currentAgreementHintKey();
  hint.dataset.i18n = key;  // 言語切替で自動再描画される
  hint.textContent = t(key);
  if (cls) hint.classList.add(cls);
}

function updateGameStartButton() {
  if (_mode !== 'battle') return;
  $('btn-game-start').disabled = !(rolesConsistent() && !_myStartPressed);
}

function selectRole(role) {
  if (_mode !== 'battle') return;
  if (_myRole === role) return;
  _myRole = role;
  // ロール変更すると自分の start_press は自動キャンセル（一貫性確保）
  _myStartPressed = false;
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.send({ type: 'role_select', role });
  }
  renderRoleSelection();
  renderAgreementHint();
  updateGameStartButton();
}

$('role-card-first').addEventListener('click', () => selectRole('first'));
$('role-card-second').addEventListener('click', () => selectRole('second'));

function pressBattleStart() {
  if (!rolesConsistent() || _myStartPressed) return;
  _myStartPressed = true;
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.send({ type: 'start_press' });
  }
  renderAgreementHint();
  updateGameStartButton();
  if (_oppStartPressed) {
    proceedToBattleGameStart();
  }
}

async function proceedToBattleGameStart() {
  // 両者押下成立 → センサー許可 → キャリブへ
  _myCalibDone = false;
  _oppCalibDone = false;
  // v1.40 (SPEC 11.5): キャリブ中もハートビート有効。`_gameInProgress` をここで立て、
  // `_gameState`/`_oppState` も先に初期化しておく（showEndScreen は `_gameState` が
  // 必要、キャリブ中の切断検知 → 結果画面遷移を成立させるため）
  _gameInProgress = true;
  _gameState = Rules.createInitialState(_currentRule);
  _oppState = Rules.createInitialState(_currentRule);
  // v1.46: 前試合の再戦合意状態をクリア（showEndScreen は `_oppEndChoice` を
  //        触らない方針に変えたので、新ゲーム開始でここを通る時に初期化する）
  _myEndChoice = null;
  _oppEndChoice = null;
  startHeartbeat();
  await startGameFlow();
}

// 自分のキャリブ完了。両者揃ったらゲーム画面へ
function onMyCalibDone() {
  _myCalibDone = true;
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.send({ type: 'calib_done' });
  }
  if (_oppCalibDone) {
    enterGameScreen();
  } else {
    // v1.43: 「相手のキャリブを待っています…」表示は廃止
    // （切断時に数秒で対戦中止になる挙動と矛盾するため）。ボタンを無効化して
    // 完了フィードバックだけステータスに残す。
    $('btn-calib-fix').disabled = true;
    $('calib-status').textContent = t('calib.status.done');
  }
}

function handleBattleMessage(data) {
  if (!data || typeof data.type !== 'string') return;
  // v1.90 (v1.4): rule_change protocol 削除済み（v1.89 で追加 → SPEC v1.4 で撤回）
  //   ルールは部屋作成時に確定、入室時に rules で受信。途中変更は不可
  if (data.type === 'role_select') {
    _oppRole = (data.role === 'first' || data.role === 'second') ? data.role : null;
    // 相手がロール変更したら相手の start_press も自動キャンセル
    _oppStartPressed = false;
    renderRoleSelection();
    renderAgreementHint();
    updateGameStartButton();
    return;
  }
  if (data.type === 'start_press') {
    _oppStartPressed = true;
    renderAgreementHint();
    if (_myStartPressed && rolesConsistent()) {
      proceedToBattleGameStart();
    }
    return;
  }
  if (data.type === 'calib_done') {
    _oppCalibDone = true;
    if (_myCalibDone) {
      enterGameScreen();
    }
    return;
  }
  // v1.33 (3-C): 投擲データ
  if (data.type === 'throw') {
    handleOppThrow(data);
    return;
  }
  // v2.10 (v1.5): 投擲権移譲（相手の「次のターン」ボタン押下）
  if (data.type === 'pass_turn') {
    handleRemotePassTurn();
    return;
  }
  // v1.37 (3-D): ハートビート機構（SPEC 8.8）
  if (data.type === 'heartbeat') {
    _lastHeartbeatRcvd = performance.now();
    showDisconnectWarning(false);
    return;
  }
  if (data.type === 'throw_start') {
    _oppInThrow = true;
    showDisconnectWarning(false);
    return;
  }
  if (data.type === 'throw_end') {
    _oppInThrow = false;
    _lastHeartbeatRcvd = performance.now();  // 着弾後に最新化
    return;
  }
  // v1.47 (3-E): チャット受信（SPEC 9章）
  // v1.48: ロビーチャット履歴にも反映（waiting/room 画面用）
  // v1.77 (5-d): 相手のチャット表示時に軽い「ポン」音（SPEC 13.8、自分送信時は鳴らさない）
  if (data.type === 'chat' && typeof data.text === 'string') {
    const text = data.text.slice(0, LOBBY_CHAT_MAX_LEN);
    if (text) {
      Sound.playChatReceive();
      addChatMessage(getOppName(), text, false);  // game/end のフェード型スタック
      addLobbyChat(getOppName(), text, false);    // waiting/room の履歴リスト
    }
    return;
  }
  // v1.44 (3-E): 対戦終了画面の再戦合意・退出
  if (data.type === 'end_choice') {
    if (data.choice === 'quit') {
      // 相手が退出ボタン押下 → 自分もロビーへ
      // v1.44: 後続の room_closed → onDisconnected で「通信切断」alert が出ないようガード
      _disconnectDeclared = true;
      alertInfo(t('alert.oppLeft'));
      exitBattleToLobby();
      return;
    }
    if (data.choice === 'swap' || data.choice === 'same') {
      _oppEndChoice = data.choice;
      updateEndUI();
      checkEndMatch();
    }
    return;
  }
  console.log('[darts] msg (unhandled)', data);
}

// v1.29: ゲスト在室時のみキック反応。多重クリック・幽霊ゲスト時の誤動作を防ぐ
$('btn-kick-guest').addEventListener('click', async () => {
  if (_mode !== 'battle') return;
  if (!_guestName) return;
  if (typeof MomoMatchmaking === 'undefined') return;
  if (!MomoMatchmaking.getState().isHost) return;
  if (await confirm(t('room.kick.confirm', { name: _guestName }))) {
    // 確認中にゲストが自発的に退出している可能性があるので再チェック
    if (!_guestName) return;
    MomoMatchmaking.kickGuest();
  }
});

// =====================================================================
// ハートビート機構（v1.37 で 3-D 導入、v1.41 で勝敗なし・対戦中止に変更）
// クライアント間で 5 秒間隔の ping、30 秒不達で切断確定。
// 投擲動作中（throw_start ～ throw_end）はタイムアウト計時を停止する。
//
// v1.41 仕様変更:
//   - 切断時の勝敗判定を廃止。両者「対戦中止（勝敗なし）」扱いに統一
//   - `_lastHeartbeatSent` を記録し、自分の送信が30秒以上止まっていれば
//     相手から見て切断扱いされている前提で自分も中止確定（公平のため）
//   - Page Visibility API で visible 復帰時に即チェック発火
//     （バックグラウンド中の setInterval throttle 対策）
// =====================================================================

const HEARTBEAT_SEND_INTERVAL_MS = 5000;
const HEARTBEAT_CHECK_INTERVAL_MS = 1000;
const HEARTBEAT_WARN_THRESHOLD_MS = 8000;     // 警告表示開始
const HEARTBEAT_TIMEOUT_MS = 30000;           // 切断確定

let _lastHeartbeatRcvd = 0;
let _lastHeartbeatSent = 0;
let _oppInThrow = false;
let _heartbeatSendTimer = null;
let _heartbeatCheckTimer = null;
let _disconnectWarnVisible = false;
let _gameInProgress = false;
let _disconnectDeclared = false;

function startHeartbeat() {
  const now = performance.now();
  _lastHeartbeatRcvd = now;
  _lastHeartbeatSent = now;
  _oppInThrow = false;
  _disconnectDeclared = false;
  showDisconnectWarning(false);
  if (_heartbeatSendTimer) clearInterval(_heartbeatSendTimer);
  _heartbeatSendTimer = setInterval(() => {
    if (typeof MomoMatchmaking !== 'undefined') {
      MomoMatchmaking.send({ type: 'heartbeat' });
      _lastHeartbeatSent = performance.now();
    }
  }, HEARTBEAT_SEND_INTERVAL_MS);
  if (_heartbeatCheckTimer) clearInterval(_heartbeatCheckTimer);
  _heartbeatCheckTimer = setInterval(checkHeartbeat, HEARTBEAT_CHECK_INTERVAL_MS);
}

function stopHeartbeat() {
  if (_heartbeatSendTimer) { clearInterval(_heartbeatSendTimer); _heartbeatSendTimer = null; }
  if (_heartbeatCheckTimer) { clearInterval(_heartbeatCheckTimer); _heartbeatCheckTimer = null; }
  showDisconnectWarning(false);
}

function checkHeartbeat() {
  if (_disconnectDeclared) return;
  if (_oppInThrow) return;  // SPEC 8.8: 投擲中は計時停止
  const now = performance.now();
  // v1.41: 自分の送信が長く停止していたら、相手側ではタイムアウト扱いされている
  //        前提で自分も中止確定（バックグラウンド throttle → visible 復帰時に検出）
  const sentElapsed = now - _lastHeartbeatSent;
  if (sentElapsed >= HEARTBEAT_TIMEOUT_MS) {
    declareDisconnectAbort('self-stalled');
    return;
  }
  const rcvdElapsed = now - _lastHeartbeatRcvd;
  if (rcvdElapsed >= HEARTBEAT_TIMEOUT_MS) {
    declareDisconnectAbort('opp-timeout');
  } else if (rcvdElapsed >= HEARTBEAT_WARN_THRESHOLD_MS) {
    showDisconnectWarning(true);
  } else {
    showDisconnectWarning(false);
  }
}

// v1.41: visible 復帰時に即チェック → バックグラウンドで止まっていた間の経過を検出
// v2.10 (v1.5): 復帰時にゲーム状態を診断ログに記録（バックグラウンド復帰時の同期ズレ調査用）
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _gameInProgress) {
    checkHeartbeat();
    if (_mode === 'battle') {
      Render.logEvent({
        type: 'visibility-resume',
        activeRole: _activeRole,
        myRole: _myRole,
        selfShots: _gameState ? _gameState.turnShots.length : null,
        selfTurnIdx: _gameState ? _gameState.turnIndex : null,
        oppShots: _oppState ? _oppState.turnShots.length : null,
        oppTurnIdx: _oppState ? _oppState.turnIndex : null,
        oppInThrow: _oppInThrow,
      });
    }
  } else if (document.visibilityState === 'hidden' && _gameInProgress) {
    Render.logEvent({
      type: 'visibility-hidden',
      activeRole: _activeRole,
      myRole: _myRole,
      selfShots: _gameState ? _gameState.turnShots.length : null,
      selfTurnIdx: _gameState ? _gameState.turnIndex : null,
    });
  }
});

function showDisconnectWarning(show) {
  const el = $('disconnect-warning');
  if (!el) return;
  if (show && !_disconnectWarnVisible) {
    _disconnectWarnVisible = true;
    el.style.display = 'block';
  } else if (!show && _disconnectWarnVisible) {
    _disconnectWarnVisible = false;
    el.style.display = 'none';
  }
}

// v1.41: 切断起因の対戦中止（勝敗なし）
// 旧 declareDisconnectWin / handleDisconnectLoss を統合。
// reason: 'self-stalled' / 'opp-timeout' / 'self-ws-died' / 'opp-ws-died' / 'guest-left'
function declareDisconnectAbort(reason) {
  if (_disconnectDeclared) return;
  _disconnectDeclared = true;
  stopHeartbeat();
  console.log('[darts] disconnect abort:', reason);
  showAnnouncement('abort', t('announce.abort'), t('announce.abort.reason'));
  setTimeout(() => {
    if (typeof MomoMatchmaking !== 'undefined') {
      try { MomoMatchmaking.leaveRoom(); } catch (e) {}
    }
    _gameInProgress = false;
    showEndScreen({ disconnect: true, abort: true });
  }, 2200);
}

// =====================================================================
// v1.47 (3-E): チャット機能（SPEC 9章）
//   - 3定型文ボタン、タップ送信／長押し編集
//   - 送受信メッセージを画面下部にスタック表示（最後から3秒で全消去）
//   - 編集内容は sessionStorage にセッション中のみ保持
// =====================================================================

const CHAT_PRESET_LS_KEY = 'momoDartsChatPresets';
const CHAT_PRESET_MAX_LEN = 20;
const CHAT_FADE_DELAY_MS = 3000;
const CHAT_EDIT_HOLD_MS = 700;
const CHAT_FADE_DURATION_MS = 600;  // CSS の transition と合わせる

// v1.49: 現在言語に応じた preset デフォルト（sessionStorage 未保存時はこれ）
function getDefaultChatPresets() {
  return [t('chat.preset.0'), t('chat.preset.1'), t('chat.preset.2')];
}

let _chatPresets = ['ナイス!', 'すごい!', 'がんばれ!']; // 初期化、loadChatPresets で上書き
let _chatMessages = [];        // {name, text, isSelf}
let _chatFadeTimer = null;
let _chatClearTimer = null;

function loadChatPresets() {
  const defs = getDefaultChatPresets();
  try {
    const saved = sessionStorage.getItem(CHAT_PRESET_LS_KEY);
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr) && arr.length === 3) {
        _chatPresets = arr.map((s, i) => {
          const text = String(s).slice(0, CHAT_PRESET_MAX_LEN).trim();
          return text || defs[i];
        });
        return;
      }
    }
  } catch (e) {}
  _chatPresets = [...defs];
}

function saveChatPresets() {
  try { sessionStorage.setItem(CHAT_PRESET_LS_KEY, JSON.stringify(_chatPresets)); } catch (e) {}
}

function applyChatPresetsToButtons() {
  document.querySelectorAll('.chat-preset-btn').forEach(btn => {
    if (btn.classList.contains('editing')) return;
    const slot = parseInt(btn.dataset.slot, 10);
    if (slot >= 0 && slot < 3) btn.textContent = _chatPresets[slot];
  });
}

function chatSend(slot) {
  if (slot < 0 || slot >= 3) return;
  const text = _chatPresets[slot];
  if (!text) return;
  addChatMessage(getMyName(), text, true);
  // v1.48: 試合中の preset 送信もロビー履歴に残す（戻ったとき会話を辿れるように）
  if (typeof addLobbyChat === 'function') addLobbyChat(getMyName(), text, true);
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    try { MomoMatchmaking.send({ type: 'chat', text }); } catch (e) {}
  }
}

function addChatMessage(name, text, isSelf) {
  _chatMessages.push({ name, text, isSelf });
  renderChatStack();
  scheduleChatFade();
}

function renderChatStack() {
  ['game', 'end'].forEach(scr => {
    const stackEl = $('chat-stack-' + scr);
    if (!stackEl) return;
    stackEl.classList.remove('fading');
    stackEl.innerHTML = '';
    _chatMessages.forEach(msg => {
      const div = document.createElement('div');
      div.className = 'chat-msg ' + (msg.isSelf ? 'self' : 'opp');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'chat-name';
      nameSpan.textContent = msg.name + ':';
      div.appendChild(nameSpan);
      div.appendChild(document.createTextNode(msg.text));
      stackEl.appendChild(div);
    });
  });
}

function scheduleChatFade() {
  if (_chatFadeTimer) clearTimeout(_chatFadeTimer);
  if (_chatClearTimer) clearTimeout(_chatClearTimer);
  _chatFadeTimer = setTimeout(() => {
    ['game', 'end'].forEach(scr => {
      const stackEl = $('chat-stack-' + scr);
      if (stackEl) stackEl.classList.add('fading');
    });
    _chatClearTimer = setTimeout(() => {
      _chatMessages = [];
      renderChatStack();
    }, CHAT_FADE_DURATION_MS);
  }, CHAT_FADE_DELAY_MS);
}

// 長押し編集制御（タップ=送信、700ms 長押し=編集モード）
function bindChatPresetButton(btn) {
  let pressTimer = null;
  let isPressing = false;
  btn.addEventListener('pointerdown', () => {
    if (btn.classList.contains('editing')) return;
    isPressing = true;
    pressTimer = setTimeout(() => {
      if (isPressing) {
        isPressing = false;
        startEditPreset(btn);
      }
    }, CHAT_EDIT_HOLD_MS);
  });
  const cancel = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };
  btn.addEventListener('pointerup', () => {
    if (btn.classList.contains('editing')) return;
    cancel();
    if (isPressing) {
      isPressing = false;
      const slot = parseInt(btn.dataset.slot, 10);
      chatSend(slot);
    }
  });
  btn.addEventListener('pointerleave', () => { cancel(); isPressing = false; });
  btn.addEventListener('pointercancel', () => { cancel(); isPressing = false; });
}

function startEditPreset(btn) {
  const slot = parseInt(btn.dataset.slot, 10);
  if (slot < 0 || slot >= 3) return;
  // v1.48: iOS Safari の contentEditable はキーボードが起動しないケースがあるため
  //        ボタンを hidden にして同じスタイルの <input> を挿入する方式に変更。
  //        この方式なら iOS でも確実にソフトウェアキーボードが出る。
  if (btn.classList.contains('editing')) return;  // 二重起動防止
  btn.classList.add('editing');
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = CHAT_PRESET_MAX_LEN;
  input.value = _chatPresets[slot];
  input.className = 'chat-preset-btn editing-input';
  input.dataset.slot = String(slot);
  // 同じ枠内でボタンと差し替え
  btn.style.display = 'none';
  btn.parentNode.insertBefore(input, btn);
  // iOS でフォーカス＋選択を確実に発火させるため setTimeout
  setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 0);
  let cancelled = false;
  const finish = () => {
    input.removeEventListener('blur', finish);
    input.removeEventListener('keydown', onKey);
    let newText = cancelled
      ? _chatPresets[slot]
      : input.value.replace(/\s+/g, ' ').trim().slice(0, CHAT_PRESET_MAX_LEN);
    if (!newText) newText = getDefaultChatPresets()[slot];
    _chatPresets[slot] = newText;
    saveChatPresets();
    // input を消してボタン復活
    input.remove();
    btn.style.display = '';
    btn.classList.remove('editing');
    applyChatPresetsToButtons();
  };
  const onKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; input.blur(); }
  };
  input.addEventListener('blur', finish);
  input.addEventListener('keydown', onKey);
}

// v1.49: loadChatPresets() は i18n 辞書読み込み後（applyLang 内 refreshDynamicI18n）に呼ぶ。
// ここではボタンのイベントバインドのみ。preset の初期文字列は HTML 既定値（ja）が一瞬出るが
// applyLang 完了時に上書きされる。
document.querySelectorAll('.chat-preset-btn').forEach(bindChatPresetButton);

// =====================================================================
// v1.48: ロビー（waiting/room）自由文章チャット（reversi 流儀）
//   - 試合中のフェード型チャットとは別系統。履歴は退室まで残る
//   - 通信プロトコルは試合中チャットと共用（{type:'chat', text}）
// =====================================================================

const LOBBY_CHAT_MAX_LEN = 100;

function sendLobbyChat(screen) {
  const input = $('lobby-chat-input-' + screen);
  if (!input) return;
  const text = input.value.replace(/\s+/g, ' ').trim().slice(0, LOBBY_CHAT_MAX_LEN);
  if (!text) return;
  if (_mode !== 'battle') return;
  addLobbyChat(getMyName(), text, true);
  if (typeof MomoMatchmaking !== 'undefined') {
    try { MomoMatchmaking.send({ type: 'chat', text }); } catch (e) {}
  }
  input.value = '';
}

function addLobbyChat(name, text, isSelf) {
  ['waiting', 'room'].forEach(scr => {
    const listEl = $('lobby-chat-list-' + scr);
    if (!listEl) return;
    const div = document.createElement('div');
    div.className = 'lobby-chat-msg ' + (isSelf ? 'self' : 'opp');
    div.textContent = `${name}: ${text}`;
    listEl.appendChild(div);
    listEl.scrollTop = listEl.scrollHeight;
  });
}

function clearLobbyChat() {
  ['waiting', 'room'].forEach(scr => {
    const listEl = $('lobby-chat-list-' + scr);
    if (listEl) listEl.innerHTML = '';
  });
}

function showLobbyChatPanels(show) {
  // v1.96 (v1.5): waiting 画面ではゲストがまだ入室していないためチャットを送信しても届かない
  //   → waiting のチャットパネルは常時非表示、room 画面のみ表示
  const waitingPanel = $('lobby-chat-waiting');
  const roomPanel = $('lobby-chat-room');
  if (waitingPanel) waitingPanel.style.display = 'none';
  if (roomPanel) roomPanel.style.display = show ? '' : 'none';
}

// 起動時に送信ボタン / Enter キーをバインド
document.querySelectorAll('.lobby-chat-send-btn').forEach(btn => {
  btn.addEventListener('click', () => sendLobbyChat(btn.dataset.screen));
});
document.querySelectorAll('.lobby-chat-input').forEach(input => {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const screen = input.id.replace('lobby-chat-input-', '');
      sendLobbyChat(screen);
    }
  });
});

// ===== 起動時 =====
// v1.49: momoLang を localStorage から復元（MOMO Works 共通キー、SPEC 14章）
// v1.50: momoCatBase も復元（CAT モードで起動した時の鳴き声の系統）
(async () => {
  let savedLang = FALLBACK_LANG;
  let savedCatBase = FALLBACK_LANG;
  try { savedLang = localStorage.getItem(LANG_STORAGE_KEY) || FALLBACK_LANG; } catch {}
  try { savedCatBase = localStorage.getItem(CAT_BASE_STORAGE_KEY) || FALLBACK_LANG; } catch {}
  if (!['ja', 'en', 'zh', 'cat'].includes(savedLang)) savedLang = FALLBACK_LANG;
  if (!['ja', 'en', 'zh'].includes(savedCatBase)) savedCatBase = FALLBACK_LANG;
  _catBaseLang = savedCatBase;
  if (langSelect) langSelect.value = savedLang;
  await applyLang(savedLang);
  // 言語ロード後の最終初期化
  // v1.88 (v1.3): ルール選択 UI のハンドラ登録（DOM は既に存在、i18n も applyLang 完了済み）
  setupRuleUIHandlers();
  applyRuleToUI();
  showScreen('lobby');
  initMatchmaking();
})();
