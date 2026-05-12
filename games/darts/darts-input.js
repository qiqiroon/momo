// MOMO Darts - 投擲操作入力モジュール（SPEC 5章）
// 段階2-D: ホールドボタン + 強さバー
//   - 左右両側に常時表示、好きな方を押す
//   - 先押し優先・持ち替え不可
//   - チョイ押し(<100ms)救済
//   - 押下開始から 1.75 秒で最弱→最強
//   - 離した瞬間に release callback ({ hand, strength, durationMs })
//   - 画面切替直後の継続タッチは Pointer Events の semantics で自然に弾かれる
//     (pointerdown は up→down 遷移時のみ fire)

// ======================================================================
// 定数（SPEC 5.1 / 5.2）
// ======================================================================
const HOLD_FILL_DURATION_MS = 1750;  // 最弱→最強の伸び時間（チューニング項目）
const TAP_REJECT_MS = 100;           // チョイ押し救済しきい値

// ======================================================================
// モジュール状態
// ======================================================================
let _stackL = null, _stackR = null;
let _fillL = null, _fillR = null;
let _onRelease = null;       // callback({ hand, strength, durationMs })

let _activeHand = null;       // 'L' | 'R' | null
let _activePointerId = null;
let _pressStartTime = 0;
let _animFrameId = null;
let _disabled = false;

function $(id) { return document.getElementById(id); }

function stackFor(hand) { return hand === 'L' ? _stackL : _stackR; }
function fillFor(hand)  { return hand === 'L' ? _fillL  : _fillR; }

function getStrength() {
  if (!_activeHand) return 0;
  const elapsed = performance.now() - _pressStartTime;
  return Math.min(1, elapsed / HOLD_FILL_DURATION_MS);
}

function updateBar() {
  if (!_activeHand) { _animFrameId = null; return; }
  const s = getStrength();
  const fill = fillFor(_activeHand);
  if (fill) fill.style.height = `${(s * 100).toFixed(2)}%`;
  _animFrameId = requestAnimationFrame(updateBar);
}

function startHold(hand, pointerId) {
  _activeHand = hand;
  _activePointerId = pointerId;
  _pressStartTime = performance.now();
  stackFor(hand).classList.add('active');
  const fill = fillFor(hand);
  if (fill) fill.style.height = '0%';
  if (_animFrameId) cancelAnimationFrame(_animFrameId);
  _animFrameId = requestAnimationFrame(updateBar);
}

function cancelHold() {
  if (!_activeHand) return;
  const stack = stackFor(_activeHand);
  stack.classList.remove('active');
  const fill = fillFor(_activeHand);
  if (fill) fill.style.height = '0%';
  _activeHand = null;
  _activePointerId = null;
  if (_animFrameId) { cancelAnimationFrame(_animFrameId); _animFrameId = null; }
}

function endHold() {
  if (!_activeHand) return;
  const durationMs = performance.now() - _pressStartTime;
  const hand = _activeHand;

  // チョイ押し救済（SPEC 5.1）
  if (durationMs < TAP_REJECT_MS) {
    cancelHold();
    return;
  }

  const strength = Math.min(1, durationMs / HOLD_FILL_DURATION_MS);

  // UI 確定（バーを即座に消す）
  cancelHold();

  // 飛行中はホールドを受け付けない
  setDisabled(true);

  if (_onRelease) {
    try {
      _onRelease({ hand, strength, durationMs });
    } catch (e) {
      console.error('[darts-input] onRelease threw:', e);
    }
  }
}

// ======================================================================
// Pointer Events ハンドラ
//   - pointerdown は up→down 遷移時のみ fire するため、
//     画面切替時に既に触っている指は弾かれる（SPEC 5.1）
// ======================================================================
function onPointerDown(hand, e) {
  if (_disabled) return;
  if (_activeHand) return;   // 先押し優先：もう片方が押されているなら無視

  // 念のため: pointerType === 'mouse' でも左ボタンだけ受け付ける
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  e.preventDefault();
  startHold(hand, e.pointerId);

  // pointer をボタン要素に capture して、指がボタン外に出ても up を確実に取る
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {}
}

function onPointerUp(hand, e) {
  if (_activeHand !== hand) return;
  if (e.pointerId !== _activePointerId) return;
  e.preventDefault();
  endHold();
}

function onPointerCancel(hand, e) {
  if (_activeHand !== hand) return;
  if (e.pointerId !== _activePointerId) return;
  // SPEC 5.1 のキャンセル手段は明示的に提供しないが、
  // OS によるタッチ中断（電話着信等）はキャンセル扱い
  cancelHold();
}

// ======================================================================
// 公開 API
// ======================================================================
export function start({ onRelease }) {
  _onRelease = onRelease || null;
  _stackL = $('hold-stack-L');
  _stackR = $('hold-stack-R');
  _fillL = $('strength-fill-L');
  _fillR = $('strength-fill-R');

  for (const [hand, stack] of [['L', _stackL], ['R', _stackR]]) {
    stack.addEventListener('pointerdown', (e) => onPointerDown(hand, e));
    stack.addEventListener('pointerup',    (e) => onPointerUp(hand, e));
    stack.addEventListener('pointercancel',(e) => onPointerCancel(hand, e));
  }

  setDisabled(false);
}

export function stop() {
  cancelHold();
  // 簡易: cloneNode で listener 全削除はせず、disabled で実質止める
  setDisabled(true);
  _onRelease = null;
}

export function setDisabled(d) {
  _disabled = !!d;
  if (_stackL) _stackL.classList.toggle('disabled', _disabled);
  if (_stackR) _stackR.classList.toggle('disabled', _disabled);
  if (_disabled) cancelHold();
}
export function isDisabled() { return _disabled; }
