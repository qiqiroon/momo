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
const SCREENS = ['lobby', 'waiting', 'room', 'calibration', 'game', 'end'];

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
  // v1.31 (3-B): 対戦時は両者キャリブ完了で同時遷移
  if (_mode === 'battle') {
    onMyCalibDone();
  } else {
    enterGameScreen();
  }
});

$('btn-calib-cancel').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
    Sensor.stopListening();
    Sensor.clearCalibration();
    if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
      // 対戦中の離脱は部屋ごと抜ける扱い
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
  _mode = 'solo';
  resetRoomToSolo();
  showScreen('room');
});

$('btn-game-start').addEventListener('click', () => {
  // v1.31 (3-B): 対戦時は両者押下を待つ。Solo は即実行
  if (_mode === 'battle') {
    pressBattleStart();
  } else {
    startGameFlow();
  }
});

$('btn-room-leave').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
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
  if (_mode !== 'battle') return true;
  return _activeRole === _myRole;
}

// アクティブな投擲者の state（shots 表示・ターン情報用）
function activeState() {
  if (_mode !== 'battle') return _gameState;
  return isMyTurn() ? _gameState : _oppState;
}

function getMyName() {
  if (typeof MomoMatchmaking === 'undefined') return 'あなた';
  return MomoMatchmaking.getState().isHost ? (_hostName || 'ホスト') : (_guestName || 'ゲスト');
}
function getOppName() {
  if (typeof MomoMatchmaking === 'undefined') return '相手';
  return MomoMatchmaking.getState().isHost ? (_guestName || 'ゲスト') : (_hostName || 'ホスト');
}

function updateScoreUI() {
  if (!_gameState) return;
  // 自分の残り点数（左上・赤）
  $('ui-remaining').textContent = String(_gameState.remaining);
  $('ui-turn-total').textContent =
    `TURN +${_gameState.turnShots.reduce((a, s) => a + s.value, 0)}`;
  // 相手の残り点数（右上・青、対戦時のみ）
  if (_mode === 'battle' && _oppState) {
    $('ui-score-opp').style.display = 'flex';
    $('ui-remaining-opp').textContent = String(_oppState.remaining);
    $('ui-turn-total-opp').textContent =
      `TURN +${_oppState.turnShots.reduce((a, s) => a + s.value, 0)}`;
  } else {
    $('ui-score-opp').style.display = 'none';
  }
  // ショットスロット（中央上）— アクティブ投擲者の現ターン
  const active = activeState();
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
}

// v1.34: ターン情報を 2 行に（"あなた/相手のターン" + 名前）
function updateTurnInfo() {
  const wrap = $('ui-turn-info');
  const mainEl = $('ui-turn-info-main');
  const nameEl = $('ui-turn-info-name');
  if (_mode !== 'battle') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  const myTurn = isMyTurn();
  mainEl.textContent = myTurn ? 'あなたのターン' : '相手のターン';
  nameEl.textContent = myTurn ? getMyName() : getOppName();
  wrap.classList.toggle('self', myTurn);
  wrap.classList.toggle('opp', !myTurn);
}

// v1.33 (3-C): ターン枠 4px（自分=明赤発光 / 相手=暗青）
function updateTurnFrame() {
  const fr = $('turn-frame');
  if (_mode !== 'battle') {
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
  _gameState = Rules.createInitialState();
  _pendingTurnDisplay = null;
  // v1.33 (3-C): 対戦時は相手 state も初期化、先攻決定
  if (_mode === 'battle') {
    _oppState = Rules.createInitialState();
    _activeRole = 'first';  // 先攻が常に最初に投げる
  } else {
    _oppState = null;
    _activeRole = null;
  }
  updateScoreUI();
  Render.placeTargetForTurn();

  // v1.17: ホールドボタン入力を起動（Input.start 内で setDisabled(false) されるので
  //        対戦時の観戦者は start のあとに改めて disable する）
  Input.start({ onRelease: onDartReleased });
  if (_mode === 'battle') {
    Input.setDisabled(!isMyTurn());
  }
}

function leaveGameScreen() {
  Render.stop();
  Input.stop();
}

// v1.23: 投擲リリース → 物理シミュ → 着弾後にスコア計算
// v1.33 (3-C): 対戦時は relAim + impactBoard を相手に送信、両者で同じ shot を処理
function onDartReleased({ hand, strength, durationMs }) {
  // 対戦時、相手のターン中はそもそもボタン disabled だが念のためガード
  if (_mode === 'battle' && !isMyTurn()) return;

  const aim = Render.getCurrentAim();
  const aimYawRad   = (aim.yawDeg   * Math.PI) / 180;
  const aimPitchRad = (aim.pitchDeg * Math.PI) / 180;

  const sim = Physics.simulateThrow({ hand, strength, aimYawRad, aimPitchRad });
  const myImpactBoard = Render.boardImpactFromSim(sim);  // null or {x, y}

  // v1.33 (3-C): 投擲データを即座に相手へ送信（フライト中に相手側でも飛ぶ）
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    const target = Render.getTargetWorld();
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
    // result = { world, board: { x, y } | null } — local の物理結果
    const shot = Rules.scoreFromImpactSVG(result.board);
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
  // 受信側の自分の的位置に relAim を載せて再シミュレート
  const target = Render.getTargetWorld();
  const aimYawRad   = ((target.yaw   + (relYawDeg   || 0)) * Math.PI) / 180;
  const aimPitchRad = ((target.pitch + (relPitchDeg || 0)) * Math.PI) / 180;
  const sim = Physics.simulateThrow({ hand, strength, aimYawRad, aimPitchRad });

  Render.fireFlight(sim, (_result) => {
    // 着弾点は送信者の authoritative 値で上書き → スコアも一致
    const shot = Rules.scoreFromImpactSVG(impactBoard);
    processShot(_oppState, shot, _activeRole);
  }, { thrower: 'opp', authoritativeBoard: impactBoard });
}

// v1.33 (3-C): shot 後の共通処理（ローカル/受信どちらからも呼ぶ）
function processShot(throwerState, shot, throwerRole) {
  const r = Rules.applyShot(throwerState, shot);
  // v1.26: ターン終了時の表示保持
  if (r.turnEnded && throwerState.history.length > 0) {
    _pendingTurnDisplay = throwerState.history[throwerState.history.length - 1].shots;
  }
  updateScoreUI();

  // === FINISH ===
  if (r.finished) {
    const isMyWin = (throwerRole === _myRole) || (_mode !== 'battle');
    let mainText, subText;
    if (_mode === 'battle') {
      mainText = isMyWin ? 'WIN!' : 'LOSE!';
      subText = `${isMyWin ? getMyName() : getOppName()} の勝利`;
    } else {
      mainText = 'FINISH!';
      subText = `${throwerState.dartCount} ダーツ`;
    }
    console.log('[darts] FINISH! darts=' + throwerState.dartCount + ' winner=' + (isMyWin ? 'self' : 'opp'));
    Render.logEvent({ type: 'finish', dartCount: throwerState.dartCount, turns: throwerState.turnIndex, winner: isMyWin ? 'self' : 'opp' });
    showAnnouncement(_mode === 'battle' && !isMyWin ? 'lose' : 'finish', mainText, subText);
    setTimeout(() => {
      _pendingTurnDisplay = null;
      showEndScreen({ winner: isMyWin ? 'self' : 'opp', finishedState: throwerState });
    }, 2200);
    return;
  }

  // === BUST ===
  if (r.bust) {
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
  if (_mode === 'battle') {
    Input.setDisabled(!isMyTurn());
    updateScoreUI();  // turn-info の N 投目更新
  } else {
    Input.setDisabled(false);
  }
}

// v1.33 (3-C): ターン終了 → 役割交代 + 新しい的位置（両者ローカル）
function endTurnAndPlace() {
  if (_mode === 'battle') {
    _activeRole = (_activeRole === 'first') ? 'second' : 'first';
    Input.setDisabled(!isMyTurn());
  } else {
    Input.setDisabled(false);
  }
  Render.placeTargetForTurn();
  updateScoreUI();
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

// v1.25: 結果画面の表示（FINISH 時に呼ばれる）
function showEndScreen(opts) {
  if (!_gameState) return;
  // v1.33 (3-C): 対戦時は WIN/LOSE 表示
  if (_mode === 'battle' && opts && opts.winner) {
    const isMyWin = opts.winner === 'self';
    const winner = isMyWin ? getMyName() : getOppName();
    const loser  = isMyWin ? getOppName() : getMyName();
    const winnerState = isMyWin ? _gameState : _oppState;
    $('end-result-msg').textContent = isMyWin ? '🏆 WIN!' : '😢 LOSE!';
    $('end-result-msg').className = `result-message ${isMyWin ? 'win' : 'lose'}`;
    $('end-result-sub').textContent =
      `${winner} の勝利！ ${winnerState ? winnerState.dartCount + ' ダーツ' : ''}`;
    $('end-stat-darts').textContent = winnerState ? winnerState.dartCount : '-';
    $('end-stat-turns').textContent = (winnerState ? winnerState.history.length : '-');
    $('end-stat-busts').textContent = winnerState ? winnerState.history.filter(h => h.bust).length : '-';
    const turnScores = winnerState
      ? winnerState.history.filter(h => !h.bust).map(h => h.shots.reduce((a, s) => a + s.value, 0))
      : [];
    $('end-stat-best').textContent = turnScores.length ? Math.max(...turnScores) : 0;
  } else {
    // 1人プレイ
    const ach = Rules.getAchievement(_gameState.dartCount);
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
  }

  leaveGameScreen();
  showScreen('end');
}

$('btn-next-turn').addEventListener('click', () => {
  // v1.23: 強制ターン進行（デバッグ用）。現在のターンの shot は破棄
  if (_gameState) {
    _gameState.turnShots = [];
    _gameState.turnIndex++;
    _gameState.turnStartRemaining = _gameState.remaining;
    _pendingTurnDisplay = null;
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

// v1.33 (3-C): 対戦終了後の lobby 戻り共通処理
function exitBattleToLobby() {
  if (_mode === 'battle' && typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.leaveRoom();
  }
  _mode = 'solo';
  _guestName = '';
  resetRoomToSolo();
  showScreen('lobby');
}

$('btn-end-replay').addEventListener('click', () => {
  // v1.33 (3-C): 対戦の再戦合意フローは 3-E で実装。それまでは部屋を抜けて lobby
  if (_mode === 'battle') { exitBattleToLobby(); return; }
  // SPEC 12.6: 再戦時はキャリブをセッション中スキップ
  // calibration を残したまま game へ直行
  if (Sensor.getCalibration()) {
    enterGameScreen();
  } else {
    startGameFlow();
  }
});
$('btn-end-rule-change').addEventListener('click', () => {
  if (_mode === 'battle') { exitBattleToLobby(); return; }
  showScreen('room');
});
$('btn-end-back-room').addEventListener('click', () => {
  if (_mode === 'battle') { exitBattleToLobby(); return; }
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

// =====================================================================
// v1.27 (3-A): 対戦マッチング統合（global MomoMatchmaking、SPEC 8章 / 21.5）
// =====================================================================

const SIGNALING_URL = 'wss://momo-server-reversi.onrender.com';
const GAME_TYPE = 'darts';
const NAME_KEY = 'momo-darts-name';

// 'solo' | 'battle' — 現在の遊び方モード
let _mode = 'solo';
let _hostName = '';
let _guestName = '';
let _currentRoomName = '';

// 名前は localStorage で永続化
const _savedName = localStorage.getItem(NAME_KEY);
if (_savedName) $('my-name').value = _savedName;

function setLobbyStatus(text, highlight) {
  const el = $('lobby-status');
  el.textContent = text;
  el.classList.toggle('highlight', !!highlight);
}

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
  $('room-rule-mode-dt').textContent = '練習モード';
  $('room-rule-mode-dd').textContent = '勝敗判定なし、フィニッシュまでのターン数を記録';
  $('room-hint').textContent = '※ ゲーム開始時にセンサー許可・キャリブレーションを実行します';
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

function renderRoomList(rooms) {
  const list = $('room-list');
  const visible = (rooms || []).filter(r => r.isPublic);
  if (visible.length === 0) {
    list.innerHTML = '<div class="room-empty">公開中の部屋はまだありません</div>';
    return;
  }
  list.innerHTML = '';
  for (const r of visible) {
    const div = document.createElement('div');
    div.className = 'room-item';
    const lock = r.hasPassword ? '<span class="room-lock">🔒</span>' : '';
    div.innerHTML =
      `<div class="room-meta">` +
      `<div class="room-name">${escapeHtml(r.name)}</div>` +
      `<div class="room-host">ホスト：${escapeHtml(r.hostName)}</div>` +
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
    setError('private-error', 'パスワードに一致する非公開の部屋がありません');
    return;
  }
  setError('private-error', '');
  list.style.display = 'flex';
  list.innerHTML = '';
  for (const r of visible) {
    const div = document.createElement('div');
    div.className = 'room-item';
    div.innerHTML =
      `<div class="room-meta">` +
      `<div class="room-name">${escapeHtml(r.name)}</div>` +
      `<div class="room-host">ホスト：${escapeHtml(r.hostName)}</div>` +
      `</div><span class="room-lock">🔒</span>`;
    div.addEventListener('click', () => {
      const myName = ($('my-name').value || '').trim() || 'ゲスト';
      localStorage.setItem(NAME_KEY, myName);
      MomoMatchmaking.joinRoom(r.id, password, myName);
    });
    list.appendChild(div);
  }
}

function clickJoinRoom(room) {
  const myName = ($('my-name').value || '').trim();
  if (!myName) {
    alert('「あなたの名前」を入力してください');
    $('my-name').focus();
    return;
  }
  let pw = '';
  if (room.hasPassword) {
    pw = prompt('パスワードを入力してください');
    if (pw === null) return;
  }
  localStorage.setItem(NAME_KEY, myName);
  MomoMatchmaking.joinRoom(room.id, pw, myName);
}

function enterBattleRoom() {
  $('room-status').style.display = 'block';
  $('room-status').textContent =
    `${_currentRoomName} ｜ ${_hostName}${_guestName ? ' vs ' + _guestName : '（ゲスト待機中）'}`;
  $('room-rule-mode-dt').textContent = '勝敗判定';
  $('room-rule-mode-dd').textContent = '0 ぴったりでフィニッシュ。先にフィニッシュした方が勝ち';
  $('room-hint').textContent = '※ ゲーム開始時にセンサー許可・キャリブレーションを実行します';
  // v1.31 (3-B): 先攻/後攻 選択パネル表示 + 状態リセット（新たな相手と最初から）
  $('role-select-panel').style.display = 'flex';
  resetBattleAgreementState();
  updateKickButton();
  showScreen('room');
}

function initMatchmaking() {
  if (typeof MomoMatchmaking === 'undefined') {
    console.warn('[darts] MomoMatchmaking module not loaded');
    setLobbyStatus('マッチングモジュール未読込', false);
    return;
  }
  MomoMatchmaking.init({
    signalingUrl: SIGNALING_URL,
    gameType: GAME_TYPE,

    onWsOpen: () => setLobbyStatus('接続中', true),
    onWsClose: () => setLobbyStatus('接続切断、再接続中…', false),

    onRoomList: (rooms) => {
      renderRoomList(rooms);
      if (_showingPrivate) {
        renderPrivateRoomList(rooms, _pendingPrivatePw);
        _showingPrivate = false;
      }
    },

    onRoomCreated: (roomId, roomName) => {
      _mode = 'battle';
      _currentRoomName = roomName;
      _hostName = ($('my-name').value || '').trim() || 'ホスト';
      _guestName = '';
      $('waiting-room-name').textContent = roomName;
      $('waiting-status').textContent = 'ゲストの参加を待っています…';
      showScreen('waiting');
    },

    onJoinedRoom: (roomId, roomName, hostName) => {
      _mode = 'battle';
      _currentRoomName = roomName;
      _hostName = hostName;
      _guestName = ($('my-name').value || '').trim() || 'ゲスト';
      enterBattleRoom();
    },

    onGuestJoined: (guestName) => {
      _guestName = guestName;
      enterBattleRoom();
    },

    onGuestLeft: () => {
      _guestName = '';
      updateKickButton();
      // v1.31 (3-B): 合意・キャリブ状態を全リセット（次のゲストと最初から）
      resetBattleAgreementState();
      $('waiting-status').textContent = 'ゲストが退出しました。新しいゲストを待っています…';
      showScreen('waiting');
    },

    onConnected: () => {
      // DataChannel 確立。3-C 以降で利用
    },

    onDisconnected: (msg) => {
      if (_mode === 'battle') {
        alert(msg || '接続が切断されました');
      }
      _mode = 'solo';
      _guestName = '';
      resetRoomToSolo();
      showScreen('lobby');
    },

    onError: (msg) => {
      setError('create-error', msg || 'エラーが発生しました');
    },

    onKicked: () => {
      alert('ホストから退出させられました');
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
    setError('create-error', '「あなたの名前」を入力してください');
    return;
  }
  if (!roomName) {
    setError('create-error', '「部屋の名前」を入力してください');
    return;
  }
  setError('create-error', '');
  localStorage.setItem(NAME_KEY, myName);
  MomoMatchmaking.createRoom({
    hostName: myName,
    name: roomName,
    password,
    isPublic,
    rules: { preset: '501-single' },  // 3-B でルール選択を拡張
  });
});

$('btn-refresh-rooms').addEventListener('click', () => {
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.refreshRooms();
  }
});

$('btn-show-private').addEventListener('click', () => {
  const pw = ($('private-room-pw').value || '').trim();
  if (!pw) {
    setError('private-error', 'パスワードを入力してください');
    return;
  }
  setError('private-error', '');
  _showingPrivate = true;
  _pendingPrivatePw = pw;
  MomoMatchmaking.refreshRooms();
});

$('btn-waiting-leave').addEventListener('click', async () => {
  if (await confirm('退出しますか？')) {
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
  $('calib-opp-wait').style.display = 'none';
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
    if (_myRole === role) parts.push('あなた');
    if (_oppRole === role) parts.push('相手');
    return parts.join(' + ');
  };
  $('who-first').textContent = labelFor('first');
  $('who-second').textContent = labelFor('second');
}

function renderAgreementHint() {
  const hint = $('agreement-hint');
  if (!hint) return;
  hint.classList.remove('ready', 'waiting');
  if (!rolesConsistent()) {
    hint.textContent = '先攻と後攻をそれぞれ選択するとゲーム開始できます';
    return;
  }
  if (_myStartPressed && !_oppStartPressed) {
    hint.textContent = '相手のゲーム開始を待っています…';
    hint.classList.add('waiting');
  } else if (!_myStartPressed && _oppStartPressed) {
    hint.textContent = '相手は準備完了。ゲーム開始を押してください';
    hint.classList.add('waiting');
  } else if (_myStartPressed && _oppStartPressed) {
    hint.textContent = '両者準備完了！ゲームに移ります…';
    hint.classList.add('ready');
  } else {
    hint.textContent = '準備完了！ゲーム開始を押してください';
    hint.classList.add('ready');
  }
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
  $('calib-opp-wait').style.display = 'none';
  await startGameFlow();
}

// 自分のキャリブ完了。両者揃ったらゲーム画面へ
function onMyCalibDone() {
  _myCalibDone = true;
  if (typeof MomoMatchmaking !== 'undefined') {
    MomoMatchmaking.send({ type: 'calib_done' });
  }
  if (_oppCalibDone) {
    $('calib-opp-wait').style.display = 'none';
    enterGameScreen();
  } else {
    $('calib-opp-wait').style.display = 'block';
    // 「正面に固定」を不可に（既にキャリブ済み）
    $('btn-calib-fix').disabled = true;
  }
}

function handleBattleMessage(data) {
  if (!data || typeof data.type !== 'string') return;
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
      $('calib-opp-wait').style.display = 'none';
      enterGameScreen();
    }
    return;
  }
  // v1.33 (3-C): 投擲データ
  if (data.type === 'throw') {
    handleOppThrow(data);
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
  if (await confirm(`${_guestName} さんをキックしますか？`)) {
    // 確認中にゲストが自発的に退出している可能性があるので再チェック
    if (!_guestName) return;
    MomoMatchmaking.kickGuest();
  }
});

// ===== 起動時 =====
applyLang('ja');
showScreen('lobby');
initMatchmaking();
