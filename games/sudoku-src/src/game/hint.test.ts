/**
 * ヒント（第2分冊 6章）の検査。
 *
 * いちばん大事な点は **ヒントが盤面を一切変えないこと**（C-24）である。
 * セルを埋めないため、完成判定・ミス計数・候補消込のどれにも影響しない。
 */

import { describe, expect, it } from 'vitest';

import type { BoardSize, Difficulty, Puzzle } from '../data/types';
import { RELEASED_SIZES, firstChunkPuzzles, syntheticPuzzle } from '../test/fixtures';
import { identityParams } from '../transform/params';
import * as board from './board';
import type { BoardState } from './board';
import * as hint from './hint';

function sourceOf(n: BoardSize): Puzzle {
  const b = Math.round(Math.sqrt(n));
  if (RELEASED_SIZES.includes(n)) return firstChunkPuzzles(n)[0];
  return syntheticPuzzle(n, b);
}

function makeBoard(n: BoardSize, difficulty: Difficulty = 'Hard'): BoardState {
  const b = Math.round(Math.sqrt(n));
  const created = board.create({ puzzle: sourceOf(n), params: identityParams(n, b), difficulty });
  if (!created.ok) throw new Error(`${n}×${n} の盤面を作れない: ${created.error.message}`);
  return created.value;
}

function firstEmpty(state: BoardState): number {
  for (let i = 0; i < state.n * state.n; i++) {
    if (state.given[i] === 0 && state.entered[i] === 0) return i;
  }
  throw new Error('空セルが無い');
}

function firstGiven(state: BoardState): number {
  for (let i = 0; i < state.n * state.n; i++) {
    if (state.given[i] !== 0) return i;
  }
  throw new Error('固定セルが無い');
}

function wrongValueFor(state: BoardState, index: number): number {
  for (let v = 1; v <= state.n; v++) {
    if (v !== state.solution[index]) return v;
  }
  throw new Error('誤った値を選べない');
}

/** 盤面の姿を丸ごと写す。ヒント操作の前後で一致することを見るため */
function snapshot(state: BoardState): string {
  return JSON.stringify({
    entered: state.entered,
    errorFlags: [...state.errorFlags],
    notes: [...state.notes.words],
  });
}

describe('ヒントの提示（6.2 / 6.3）', () => {
  it('空セルへ提示すると、変換後の解の値が返る', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const index = firstEmpty(state);

    const outcome = hint.requestForCell(h, state, index);
    expect(outcome.ignored).toBe(false);
    expect(outcome.display?.index).toBe(index);
    expect(outcome.display?.value).toBe(state.solution[index]);
    expect(outcome.usedCount).toBe(1);
  });

  it('**盤面を一切変えない**（C-24）', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const before = snapshot(state);

    hint.requestForCell(h, state, firstEmpty(state));
    hint.requestRandom(h, state);
    hint.dismissAll(h);

    expect(snapshot(state)).toBe(before);
  });

  it('固定セルへは提示しない（値が既知で意味がない）', () => {
    const state = makeBoard(9);
    const h = hint.create();

    const outcome = hint.requestForCell(h, state, firstGiven(state));
    expect(outcome.ignored).toBe(true);
    expect(outcome.display).toBeNull();
    expect(h.usedCount).toBe(0);
  });

  it('誤って埋めたセルへは提示する／正解済みのセルへは提示しない', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const wrongAt = firstEmpty(state);
    board.place(state, wrongAt, wrongValueFor(state, wrongAt));

    // 詰まった局面の救済として働く
    expect(hint.requestForCell(h, state, wrongAt).ignored).toBe(false);

    const correctAt = firstEmpty(state);
    board.place(state, correctAt, state.solution[correctAt]);
    expect(hint.requestForCell(h, state, correctAt).ignored).toBe(true);
    expect(h.usedCount).toBe(1);
  });

  it('範囲外のセルは無効操作', () => {
    const state = makeBoard(4);
    const h = hint.create();
    expect(hint.requestForCell(h, state, -1).ignored).toBe(true);
    expect(hint.requestForCell(h, state, 16).ignored).toBe(true);
    expect(h.usedCount).toBe(0);
  });

  it('1×1 は唯一のマスに 1 が入る旨を提示する（設計書 0章 / R-09）', () => {
    const state = makeBoard(1);
    const h = hint.create();
    const outcome = hint.requestForCell(h, state, 0);
    expect(outcome.ignored).toBe(false);
    expect(outcome.display?.value).toBe(1);
    // **埋めない。** 提示しても盤面は空のままである
    expect(state.entered[0]).toBe(0);
  });
});

describe('表示状態（6.4 / C-25）', () => {
  it('複数セルを同時に表示でき、同一セルは最大1件', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const a = firstEmpty(state);
    const b = state.entered.findIndex((v, i) => v === 0 && state.given[i] === 0 && i !== a);

    hint.requestForCell(h, state, a);
    hint.requestForCell(h, state, b);
    expect(h.displays).toHaveLength(2);

    // 表示中のセルへの再提示は無効操作。**使用回数も増えない**
    const again = hint.requestForCell(h, state, a);
    expect(again.ignored).toBe(true);
    expect(h.displays).toHaveLength(2);
    expect(h.usedCount).toBe(2);
  });

  it('× で1件だけ閉じる。使用回数は減らない（6.6）', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const a = firstEmpty(state);
    const b = state.entered.findIndex((v, i) => v === 0 && state.given[i] === 0 && i !== a);
    hint.requestForCell(h, state, a);
    hint.requestForCell(h, state, b);

    hint.dismiss(h, a);
    expect(h.displays.map((d) => d.index)).toEqual([b]);
    expect(h.usedCount).toBe(2);

    hint.dismissAll(h);
    expect(h.displays).toEqual([]);
    expect(h.usedCount).toBe(2);
  });

  it('正解入力で自動解除される。閉じたあとは同じセルへまた提示できる', () => {
    const state = makeBoard(9);
    const h = hint.create();
    const index = firstEmpty(state);
    hint.requestForCell(h, state, index);

    hint.dismissOnCorrectInput(h, index);
    expect(h.displays).toEqual([]);

    // 閉じた後の再提示は新しい提示として数える
    const again = hint.requestForCell(h, state, index);
    expect(again.ignored).toBe(false);
    expect(h.usedCount).toBe(2);
  });
});

describe('モードB（6.3）', () => {
  it('対象セルから選ぶ。選ばれるのは固定でも正解済みでもないセル', () => {
    const state = makeBoard(9);
    const h = hint.create();

    for (let i = 0; i < 5; i++) {
      const outcome = hint.requestRandom(h, state, () => i / 5);
      expect(outcome.ignored).toBe(false);
      const index = outcome.display?.index ?? -1;
      expect(state.given[index]).toBe(0);
      expect(outcome.display?.value).toBe(state.solution[index]);
    }
    expect(new Set(h.displays.map((d) => d.index)).size).toBe(5);
  });

  it('乱数が上限に振り切れても範囲外を選ばない', () => {
    const state = makeBoard(4);
    const h = hint.create();
    const outcome = hint.requestRandom(h, state, () => 0.999999999);
    expect(outcome.ignored).toBe(false);
    expect(outcome.display?.index).toBeLessThan(16);
  });

  it('完成していれば対象が無く、無効操作になる', () => {
    const state = makeBoard(4);
    for (let i = 0; i < 16; i++) {
      if (state.given[i] === 0) board.place(state, i, state.solution[i]);
    }
    const h = hint.create();
    expect(hint.requestRandom(h, state).ignored).toBe(true);
    expect(h.usedCount).toBe(0);
  });
});

describe('中断復元（C-27）', () => {
  it('表示は空、使用回数のみ戻る', () => {
    const restored = hint.restore(7);
    expect(restored.displays).toEqual([]);
    expect(restored.usedCount).toBe(7);
  });
});
