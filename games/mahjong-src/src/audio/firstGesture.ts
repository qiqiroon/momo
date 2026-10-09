/**
 * MOMO Shogi の core/audio/first-gesture.ts を移したもの（2026-10-09）。
 *
 * ★v2.01 最初の操作で「音を鳴らしますか」を尋ね、**その操作は選んだあとに生かす**
 * (2026-10-03 ユーザー指示・MOMO Fireworks と同じ)。
 *
 * v2.00 までは**指が触れた瞬間 (pointerdown)** に窓を出していたので、指を離したときの
 * クリックが出てきた窓の背景に当たり、**最初のクリックが無かったことになっていた**。
 *
 * いまは**クリックそのもの**を見張り、最初の 1 回は止めて預かる。窓で鳴らす／鳴らさないを
 * 選んだら、預かったクリックをもう一度起こす (押した物がまだ画面にあれば)。
 * キーボードで始めたときは窓を出すだけで、そのキー操作は生かさない (v2.00 までと同じ)。
 *
 * 1 時間以上離れて戻ったときは `rearmAudioAsk()` でもう一度「最初の操作」を待つ。
 */

let enabled = true;
let bound = false;
let asked = false;
let showing = false;
let pending: EventTarget | null = null;
let openPrompt: (() => void) | null = null;

/** 検査用。画面の検査はクリックを素通しにする (src/test/setup.ts)。 */
export function setFirstGestureCapture(on: boolean): void {
  enabled = on;
}

function onClick(e: MouseEvent): void {
  if (!enabled || asked || showing || !openPrompt) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  pending = e.target;
  showing = true;
  openPrompt();
}

function onKey(): void {
  if (!enabled || asked || showing || !openPrompt) return;
  showing = true;
  openPrompt();
}

/** 見張りを付ける (1 回だけ)。`open` は窓を出す。 */
export function armAudioAsk(open: () => void): void {
  openPrompt = open;
  if (bound) return;
  bound = true;
  // 捕まえる段で見る＝画面の部品より先に止められる
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
}

/** 1 時間以上離れて戻った＝次の操作でもう一度尋ねる。 */
export function rearmAudioAsk(): void {
  asked = false;
}

/** 窓で選び終えた。預かっていたクリックを起こす。 */
export function finishAudioAsk(): void {
  asked = true;
  showing = false;
  const target = pending;
  pending = null;
  if (!target || !(target instanceof Node) || !target.isConnected) return;
  // 窓が閉じて画面が描き直されてから起こす
  setTimeout(() => {
    if (target.isConnected) target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, 0);
}

/** 検査用。 */
export function resetFirstGestureForTest(): void {
  asked = false;
  showing = false;
  pending = null;
}
