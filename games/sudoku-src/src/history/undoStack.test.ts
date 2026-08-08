/**
 * 履歴（第2分冊 7章）の検査。
 *
 * 受入条件 4-4（Undo で候補が復元され、Redo で完成に到達する経路が存在しない）をここで確かめる。
 */

import { describe, expect, it } from 'vitest';

import type { BoardSize, Difficulty, Puzzle } from '../data/types';
import * as board from './../game/board';
import type { BoardState } from './../game/board';
import { UNDO_LIMIT_DEFAULT } from '../game/config';
import * as notes from '../game/notes';
import { isComplete } from '../game/validate';
import { firstChunkPuzzles } from '../test/fixtures';
import { identityParams } from '../transform/params';
import * as undoStack from './undoStack';
import type { HistoryEntry } from './undoStack';

function sourceOf(n: BoardSize): Puzzle {
  return firstChunkPuzzles(n)[0];
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

function wrongValueFor(state: BoardState, index: number): number {
  for (let v = 1; v <= state.n; v++) {
    if (v !== state.solution[index]) return v;
  }
  throw new Error('誤った値を選べない');
}

/** 盤面の姿を丸ごと写す。Undo / Redo の往復で完全一致するかを見るため */
function snapshot(state: BoardState): string {
  return JSON.stringify({
    entered: state.entered,
    errorFlags: [...state.errorFlags],
    notes: [...state.notes.words],
  });
}

/** 操作して履歴へ積む、を1手にまとめる */
function placeAndPush(state: BoardState, undo: undoStack.UndoState, index: number, value: number) {
  const outcome = board.place(state, index, value);
  if (outcome.entry) undoStack.push(undo, outcome.entry);
  return outcome;
}

describe('リングバッファ（7.4 / C-14）', () => {
  it('既定は100手で、超えた分は古い側から捨てる', () => {
    const undo = undoStack.create();
    expect(undo.limit).toBe(UNDO_LIMIT_DEFAULT);

    const entry = (i: number): HistoryEntry => ({
      kind: 'PLACE',
      index: i,
      prevValue: 0,
      nextValue: 1,
      prevError: false,
      noteDelta: [],
    });
    for (let i = 0; i < UNDO_LIMIT_DEFAULT + 5; i++) undoStack.push(undo, entry(i));

    expect(undo.entries).toHaveLength(UNDO_LIMIT_DEFAULT);
    expect(undo.entries[0].index).toBe(5);
    expect(undo.entries[UNDO_LIMIT_DEFAULT - 1].index).toBe(UNDO_LIMIT_DEFAULT + 4);
  });

  it('空のときは取り消しもやり直しもできない', () => {
    const state = makeBoard(4);
    const undo = undoStack.create(10);
    expect(undoStack.canUndo(undo)).toBe(false);
    expect(undoStack.canRedo(undo)).toBe(false);
    expect(undoStack.undo(undo, state).applied).toBe(false);
    expect(undoStack.redo(undo, state).applied).toBe(false);
  });
});

describe('Undo で候補が復元される（7.5 / C-22 / 4-4）', () => {
  it('入力で消えた関連セルの候補が、取り消しで戻る（Hard）', () => {
    const state = makeBoard(9, 'Hard');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);
    const value = state.solution[index];

    // 関連セルへ手で候補を書いておく。入力の消込で消えるはずのもの
    const peer = board.peers(state, index).find((p) => state.given[p] === 0 && state.entered[p] === 0);
    if (peer === undefined) throw new Error('候補を置ける関連セルが無い');
    board.addNote(state, peer, value);
    board.addNote(state, index, value);
    const before = snapshot(state);

    placeAndPush(state, undo, index, value);
    expect(notes.has(state.notes, peer, value)).toBe(false);
    expect(notes.values(state.notes, index)).toEqual([]);

    const outcome = undoStack.undo(undo, state);
    expect(outcome.applied).toBe(true);
    // **盤面が操作前と完全に一致する**
    expect(snapshot(state)).toBe(before);
    expect(notes.has(state.notes, peer, value)).toBe(true);
    expect(outcome.changedIndices).toContain(index);
    expect(outcome.changedIndices).toContain(peer);
  });

  it('誤入力の取り消しで誤りマークが消える', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(10);
    const index = firstEmpty(state);

    placeAndPush(state, undo, index, wrongValueFor(state, index));
    expect(state.errorFlags[index]).toBe(1);

    undoStack.undo(undo, state);
    expect(state.entered[index]).toBe(0);
    expect(state.errorFlags[index]).toBe(0);
  });

  it('消去の取り消しで値が戻る。**候補は復元しない**（C-22）', () => {
    const state = makeBoard(9, 'Hard');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);
    const peer = board.peers(state, index).find((p) => state.given[p] === 0 && state.entered[p] === 0);
    if (peer === undefined) throw new Error('候補を置ける関連セルが無い');

    const value = state.solution[index];
    board.addNote(state, peer, value);
    placeAndPush(state, undo, index, value);
    expect(notes.has(state.notes, peer, value)).toBe(false);

    const erased = board.erase(state, index);
    if (erased.entry) undoStack.push(undo, erased.entry);
    // 手で消しても候補は戻らない
    expect(notes.has(state.notes, peer, value)).toBe(false);

    undoStack.undo(undo, state);
    expect(state.entered[index]).toBe(value);
    // 消去の取り消しでも戻らない（消去そのものが候補を触っていないため）
    expect(notes.has(state.notes, peer, value)).toBe(false);
  });

  it('候補メモの手動編集も取り消せる（NOTE_EDIT）', () => {
    const state = makeBoard(9, 'Apocalypse');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);

    board.addNote(state, index, 1);
    const before = snapshot(state);
    const outcome = board.toggleNote(state, index, 2);
    if (outcome.entry) undoStack.push(undo, outcome.entry);
    expect(notes.values(state.notes, index)).toEqual([1, 2]);

    undoStack.undo(undo, state);
    expect(snapshot(state)).toBe(before);
    expect(notes.values(state.notes, index)).toEqual([1]);
  });

  it('Easy では取り消し後に自動算出が走り、盤面と整合する', () => {
    const state = makeBoard(9, 'Easy');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);
    const before = snapshot(state);

    placeAndPush(state, undo, index, state.solution[index]);
    undoStack.undo(undo, state);
    expect(snapshot(state)).toBe(before);
  });

  it('取り消しを重ねると、操作前の姿へ順に戻る', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(10);
    const start = snapshot(state);

    const shots: string[] = [];
    let index = firstEmpty(state);
    for (let i = 0; i < 3; i++) {
      shots.push(snapshot(state));
      placeAndPush(state, undo, index, state.solution[index]);
      index = firstEmpty(state);
    }
    for (let i = 2; i >= 0; i--) {
      undoStack.undo(undo, state);
      expect(snapshot(state)).toBe(shots[i]);
    }
    expect(snapshot(state)).toBe(start);
    expect(undoStack.canUndo(undo)).toBe(false);
  });
});

describe('Redo（7.5）', () => {
  it('やり直すと取り消す直前の姿へ完全に戻る', () => {
    const state = makeBoard(9, 'Hard');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);

    placeAndPush(state, undo, index, wrongValueFor(state, index));
    const afterPlace = snapshot(state);

    undoStack.undo(undo, state);
    expect(undoStack.canRedo(undo)).toBe(true);

    const outcome = undoStack.redo(undo, state);
    expect(outcome.applied).toBe(true);
    expect(snapshot(state)).toBe(afterPlace);
    // 誤りマークの再付与は行う（盤面状態の復元であるため）
    expect(state.errorFlags[index]).toBe(1);
    expect(undoStack.canUndo(undo)).toBe(true);
  });

  it('取り消しとやり直しを何度往復しても姿が崩れない', () => {
    const state = makeBoard(9, 'Easy');
    const undo = undoStack.create(10);
    const index = firstEmpty(state);
    const before = snapshot(state);

    placeAndPush(state, undo, index, state.solution[index]);
    const after = snapshot(state);

    for (let i = 0; i < 5; i++) {
      undoStack.undo(undo, state);
      expect(snapshot(state)).toBe(before);
      undoStack.redo(undo, state);
      expect(snapshot(state)).toBe(after);
    }
  });

  it('取り消したあと新しい操作をすると、やり直しは消える（分岐なし履歴）', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(10);
    const first = firstEmpty(state);

    placeAndPush(state, undo, first, state.solution[first]);
    undoStack.undo(undo, state);
    expect(undoStack.canRedo(undo)).toBe(true);

    placeAndPush(state, undo, first, wrongValueFor(state, first));
    expect(undoStack.canRedo(undo)).toBe(false);
    expect(undoStack.redo(undo, state).applied).toBe(false);
  });

  it('**やり直しで完成に到達する経路は無い**（C-116）', () => {
    const state = makeBoard(4, 'Hard');
    const undo = undoStack.create(10);

    // 最後の1マスを残して正しく埋める
    const empties: number[] = [];
    for (let i = 0; i < 16; i++) if (state.given[i] === 0) empties.push(i);
    const last = empties[empties.length - 1];
    for (const i of empties) {
      if (i !== last) placeAndPush(state, undo, i, state.solution[i]);
    }
    expect(isComplete(state)).toBe(false);

    // 埋まりきった盤面を取り消せるのは、誤りを含むときだけである
    placeAndPush(state, undo, last, wrongValueFor(state, last));
    expect(state.entered.every((v, i) => v !== 0 || state.given[i] !== 0)).toBe(true);
    expect(isComplete(state)).toBe(false);

    undoStack.undo(undo, state);
    undoStack.redo(undo, state);
    // やり直しても誤りのままで、完成しない
    expect(isComplete(state)).toBe(false);

    // 正しい値を置いた瞬間に完成する。**この盤面を取り消す機会は存在しない**
    // （完成と同時にセッションが COMPLETED へ移り、プレイが終わるため。12.2）
    const completing = board.place(state, last, state.solution[last]);
    expect(completing.completed).toBe(true);
  });

  it('やり直しは履歴の上限も守る', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(2);
    const a = firstEmpty(state);
    placeAndPush(state, undo, a, state.solution[a]);
    const b = firstEmpty(state);
    placeAndPush(state, undo, b, state.solution[b]);

    undoStack.undo(undo, state);
    undoStack.redo(undo, state);
    expect(undo.entries.length).toBeLessThanOrEqual(2);
  });

  it('すべて捨てると取り消しもやり直しもできなくなる（再開時と同じ状態）', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(10);
    const index = firstEmpty(state);
    placeAndPush(state, undo, index, state.solution[index]);
    undoStack.undo(undo, state);

    undoStack.clear(undo);
    expect(undoStack.canUndo(undo)).toBe(false);
    expect(undoStack.canRedo(undo)).toBe(false);
  });
});

describe('無効操作は積まれない（7.2）', () => {
  it('固定セルへの入力・空セルの消去は履歴に残らない', () => {
    const state = makeBoard(9);
    const undo = undoStack.create(10);
    const given = state.given.findIndex((v) => v !== 0);

    const ignoredPlace = board.place(state, given, 1);
    expect(ignoredPlace.ignored).toBe(true);
    expect(ignoredPlace.entry).toBeNull();

    const ignoredErase = board.erase(state, firstEmpty(state));
    expect(ignoredErase.ignored).toBe(true);
    expect(ignoredErase.entry).toBeNull();

    expect(undo.entries).toHaveLength(0);
  });
});
