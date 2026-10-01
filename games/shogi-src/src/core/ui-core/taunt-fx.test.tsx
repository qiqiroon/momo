/**
 * ★v1.96 威嚇の動き (taunt-fx.ts)。
 *
 * 動きの見た目は人の目で確かめる (見本で「これでよい」と確認済み)。ここで固定するのは
 * **順番と後始末**:
 *   - 着地の合図 (音を鳴らす) は叩きつけた瞬間に 1 回だけ出る＝それより前には出ない
 *   - 演出の間、行き先と周り 8 マスの本物の駒は隠れ、写しが動く
 *   - 戻りきったら何も隠れておらず、演出の層も残らない
 *   - 途中で打ち切れば、すぐ本当の盤に戻る
 *   - 画面の部品が動きを持たない環境では、演出せずに合図だけすぐ出す (音は必ず鳴る)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runTauntFx, TAUNT_IMPACT_MS, TAUNT_TOTAL_MS } from './taunt-fx';

/** 9×9 の盤。駒のあるマスだけ .pc を置く。 */
function makeBoard(pieces: string[]): HTMLElement {
  const board = document.createElement('div');
  board.className = 'board';
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const sq = document.createElement('div');
      sq.className = 'sq';
      sq.setAttribute('data-sq', `${r},${c}`);
      if (pieces.includes(`${r},${c}`)) {
        const pc = document.createElement('div');
        pc.className = 'pc';
        sq.appendChild(pc);
      }
      board.appendChild(sq);
    }
  }
  document.body.appendChild(board);
  return board;
}

const hiddenSquares = (board: HTMLElement) =>
  Array.from(board.querySelectorAll('[data-taunt-hidden]')).map((e) => e.getAttribute('data-sq'));

// 行き先 4,4 (指した駒が着いている) と、周り 8 マスのうち 5 マスに駒。2,2 は周りの外。
const PIECES = ['4,4', '3,3', '3,4', '4,5', '5,3', '5,5', '2,2'];

describe('威嚇の動き (★v1.96)', () => {
  const original = Element.prototype.animate;
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.animate = vi.fn(() => ({ cancel() {}, finish() {} })) as unknown as typeof Element.prototype.animate;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    Element.prototype.animate = original;
  });

  it('着地の合図は叩きつけた瞬間に 1 回だけ (それより前には出ない)', () => {
    const board = makeBoard(PIECES);
    const onImpact = vi.fn();
    runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact, onDone: () => {} });
    vi.advanceTimersByTime(TAUNT_IMPACT_MS - 1);
    expect(onImpact).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(TAUNT_TOTAL_MS);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('持ち上げている間は行き先の駒が隠れ、着地で周り 8 マスの駒 (だけ) が隠れて写しが飛ぶ', () => {
    const board = makeBoard(PIECES);
    runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact: () => {}, onDone: () => {} });
    expect(hiddenSquares(board)).toEqual(['4,4']);
    expect(document.querySelectorAll('.taunt-fx-piece')).toHaveLength(1); // 持ち上げた駒の写し
    vi.advanceTimersByTime(TAUNT_IMPACT_MS);
    expect(hiddenSquares(board).sort()).toEqual(['3,3', '3,4', '4,4', '4,5', '5,3', '5,5'].sort());
    // 持ち上げた駒＋吹き飛ぶ 5 枚 (周りの外の 2,2 は飛ばない)
    expect(document.querySelectorAll('.taunt-fx-piece')).toHaveLength(6);
  });

  it('戻りきったら何も隠れておらず、演出の層も残らない (終わりの合図が出る)', () => {
    const board = makeBoard(PIECES);
    const onDone = vi.fn();
    runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact: () => {}, onDone });
    vi.advanceTimersByTime(TAUNT_TOTAL_MS + 100);
    expect(hiddenSquares(board)).toEqual([]);
    expect(document.querySelector('.taunt-fx-layer')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('途中で打ち切ると、すぐ本当の盤に戻る (隠した駒を見せ直し、層を捨てる)', () => {
    const board = makeBoard(PIECES);
    const cancel = runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact: () => {}, onDone: () => {} });
    vi.advanceTimersByTime(TAUNT_IMPACT_MS + 300);
    expect(hiddenSquares(board).length).toBeGreaterThan(0);
    cancel();
    expect(hiddenSquares(board)).toEqual([]);
    expect(document.querySelector('.taunt-fx-layer')).toBeNull();
    // 打ち切った後に残りの段取りが走って、また隠したりしない
    vi.advanceTimersByTime(TAUNT_TOTAL_MS);
    expect(hiddenSquares(board)).toEqual([]);
  });

  it('持ち上げている途中で打ち切ると、そのあと着地の音も吹き飛びも起きない', () => {
    const board = makeBoard(PIECES);
    const onImpact = vi.fn();
    const cancel = runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact, onDone: () => {} });
    vi.advanceTimersByTime(200);
    cancel();
    vi.advanceTimersByTime(TAUNT_TOTAL_MS);
    expect(onImpact).not.toHaveBeenCalled();
    expect(hiddenSquares(board)).toEqual([]);
    expect(document.querySelector('.taunt-fx-layer')).toBeNull();
  });

  it('打つ手 (元のマスが無い) でも、行き先の真上から叩きつける', () => {
    const board = makeBoard(PIECES);
    const onImpact = vi.fn();
    runTauntFx({ board, boardOuter: null, from: null, to: { row: 4, col: 4 }, onImpact, onDone: () => {} });
    vi.advanceTimersByTime(TAUNT_IMPACT_MS);
    expect(onImpact).toHaveBeenCalledTimes(1);
  });

  it('画面の部品が動きを持たない環境では、演出せずに合図だけすぐ出す (音は必ず鳴る)', () => {
    Element.prototype.animate = undefined as unknown as typeof Element.prototype.animate;
    const board = makeBoard(PIECES);
    const onImpact = vi.fn();
    const onDone = vi.fn();
    runTauntFx({ board, boardOuter: null, from: { row: 6, col: 3 }, to: { row: 4, col: 4 }, onImpact, onDone });
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(hiddenSquares(board)).toEqual([]);
  });
});
