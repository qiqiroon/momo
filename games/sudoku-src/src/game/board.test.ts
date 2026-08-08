/**
 * 盤面状態（第2分冊 3章）と判定（4章）の検査。
 *
 * 受入条件 4-2（Easy は自動再算出／Hard・Apocalypse は手動編集のみ）をここで確かめる。
 * 在庫のある5サイズは実物の配信データ、36×36 / 49×49 は合成の完成盤で代用する。
 */

import { describe, expect, it } from 'vitest';

import type { BoardSize, Difficulty, Puzzle } from '../data/types';
import { RELEASED_SIZES, firstChunkPuzzles } from '../test/fixtures';
import { identityParams } from '../transform/params';
import * as board from './board';
import type { BoardState } from './board';
import * as notes from './notes';
import { isComplete, rebuildErrorFlags, summary } from './validate';

const ALL_SIZES: readonly BoardSize[] = RELEASED_SIZES;

function sourceOf(n: BoardSize): Puzzle {
  return firstChunkPuzzles(n)[0];
}

/** 変換は恒等にする。ここで確かめたいのは盤面の振る舞いであって変換ではない */
function makeBoard(n: BoardSize, difficulty: Difficulty): BoardState {
  const b = Math.round(Math.sqrt(n));
  const created = board.create({
    puzzle: sourceOf(n),
    params: identityParams(n, b),
    difficulty,
  });
  if (!created.ok) throw new Error(`${n}×${n} の盤面を作れない: ${created.error.message}`);
  return created.value;
}

/** 最初の空セルを返す */
function firstEmpty(state: BoardState): number {
  for (let i = 0; i < state.n * state.n; i++) {
    if (state.given[i] === 0 && state.entered[i] === 0) return i;
  }
  throw new Error('空セルが無い');
}

/** 解と異なる値を1つ選ぶ（1×1 では存在しないので呼ばない） */
function wrongValueFor(state: BoardState, index: number): number {
  for (let v = 1; v <= state.n; v++) {
    if (v !== state.solution[index]) return v;
  }
  throw new Error('誤った値を選べない');
}

describe('盤面の初期化（3.2 / 3.6.3）', () => {
  it.each(ALL_SIZES)('%i×%i: 全サイズで盤面を作れる', (n) => {
    const state = makeBoard(n, 'Hard');
    expect(state.given.length).toBe(n * n);
    expect(state.solution.length).toBe(n * n);
    expect(state.entered.every((v) => v === 0)).toBe(true);
    expect(state.errorFlags.every((v) => v === 0)).toBe(true);
    expect(state.sourceId).toBe(sourceOf(n).id);
  });

  it('Easy は開始時に候補が全面算出され、Hard は空で始まる', () => {
    const easy = makeBoard(9, 'Easy');
    const hard = makeBoard(9, 'Hard');
    const empty = firstEmpty(easy);

    expect(notes.count(easy.notes, empty)).toBeGreaterThan(0);
    expect(notes.count(hard.notes, empty)).toBe(0);

    // 固定セルには候補が付かない
    const given = easy.given.findIndex((v) => v !== 0);
    if (given >= 0) expect(notes.count(easy.notes, given)).toBe(0);
  });

  it('Easy の初期候補は、関連セルに現れる値を除いた集合である（単純消去のみ・1.3）', () => {
    const state = makeBoard(9, 'Easy');
    const index = firstEmpty(state);
    const used = new Set<number>();
    for (const peer of board.peers(state, index)) {
      const value = state.given[peer] !== 0 ? state.given[peer] : state.entered[peer];
      if (value !== 0) used.add(value);
    }
    const expected: number[] = [];
    for (let v = 1; v <= state.n; v++) if (!used.has(v)) expected.push(v);
    expect(notes.values(state.notes, index)).toEqual(expected);
    // 正解が候補から漏れていないこと
    expect(expected).toContain(state.solution[index]);
  });
});

describe('関連セル（peer）', () => {
  it.each(ALL_SIZES)('%i×%i: 件数が 2(N-1) + (b-1)² と一致し、重複が無い', (n) => {
    const b = Math.round(Math.sqrt(n));
    const state = makeBoard(n, 'Hard');
    const list = board.peers(state, 0);
    expect(list.length).toBe(2 * (n - 1) + (b - 1) * (b - 1));
    expect(new Set(list).size).toBe(list.length);
    expect(list).not.toContain(0);
  });

  it('1×1 に関連セルは無い（分岐ではなく式の帰結）', () => {
    expect(board.peers(makeBoard(1, 'Hard'), 0)).toEqual([]);
  });
});

describe('確定値の入力（3.4 place）', () => {
  it('固定セルへの入力は拒否され、履歴にも積まれない', () => {
    const state = makeBoard(9, 'Hard');
    const given = state.given.findIndex((v) => v !== 0);
    const outcome = board.place(state, given, 1);
    expect(outcome.ignored).toBe(true);
    expect(outcome.entry).toBeNull();
    expect(state.entered[given]).toBe(0);
  });

  it('範囲外の索引・値は無効操作になる', () => {
    const state = makeBoard(9, 'Hard');
    expect(board.place(state, -1, 1).ignored).toBe(true);
    expect(board.place(state, 0, 0).ignored).toBe(true);
    expect(board.place(state, 0, 10).ignored).toBe(true);
  });

  it('正しい値を置くと誤りマークは付かず、誤った値は残ったままマークが付く（C-20）', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);

    const wrong = wrongValueFor(state, index);
    const bad = board.place(state, index, wrong);
    expect(bad.ignored).toBe(false);
    expect(bad.wasMistake).toBe(true);
    // 入力を拒否も自動消去もしない
    expect(state.entered[index]).toBe(wrong);
    expect(state.errorFlags[index]).toBe(1);

    const good = board.place(state, index, state.solution[index]);
    expect(good.wasMistake).toBe(false);
    expect(state.errorFlags[index]).toBe(0);
  });

  it('置いた値は関連セルの候補から消える。**誤った値でも消し込む**（3.6.2）', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    const peer = board.peers(state, index)[0];
    const wrong = wrongValueFor(state, index);

    notes.setValues(state.notes, peer, [wrong]);
    board.place(state, index, wrong);
    expect(notes.has(state.notes, peer, wrong)).toBe(false);
    // 値が入ったセル自身の候補も空になる
    expect(notes.count(state.notes, index)).toBe(0);
  });

  it('履歴エントリに、変更前の値・誤りマーク・候補差分が入る（7.3）', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    const outcome = board.place(state, index, state.solution[index]);
    expect(outcome.entry).not.toBeNull();
    const entry = outcome.entry!;
    expect(entry.kind).toBe('PLACE');
    expect(entry.index).toBe(index);
    expect(entry.prevValue).toBe(0);
    expect(entry.nextValue).toBe(state.solution[index]);
    expect(entry.prevError).toBe(false);
    // 当該セル＋関連セルぶんが採られている
    expect(entry.noteDelta.length).toBe(1 + board.peers(state, index).length);
  });
});

describe('確定値の消去（3.4 erase / C-22）', () => {
  it('固定セルと空セルの消去は無効操作である', () => {
    const state = makeBoard(9, 'Hard');
    const given = state.given.findIndex((v) => v !== 0);
    expect(board.erase(state, given).ignored).toBe(true);
    expect(board.erase(state, firstEmpty(state)).ignored).toBe(true);
  });

  it('Hard では、手で消しても候補は戻らない（C-22）', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    const peer = board.peers(state, index)[0];
    const value = state.solution[index];

    notes.setValues(state.notes, peer, [value]);
    board.place(state, index, value);
    expect(notes.has(state.notes, peer, value)).toBe(false);

    board.erase(state, index);
    expect(state.entered[index]).toBe(0);
    // 戻っていないこと
    expect(notes.has(state.notes, peer, value)).toBe(false);
  });

  it('Easy では、消したあとの自動算出により候補が盤面と整合する（規則の例外ではない）', () => {
    const state = makeBoard(9, 'Easy');
    const index = firstEmpty(state);
    const value = state.solution[index];
    // **その値を実際に候補として持っている**関連セルを選ぶ。
    // 関連セルの中には、別の理由で最初からその値を持たないものがある
    const peer = board.peers(state, index).find((p) => notes.has(state.notes, p, value));
    expect(peer, 'その値を候補に持つ関連セルが1つも無い').toBeDefined();

    board.place(state, index, value);
    expect(notes.has(state.notes, peer!, value)).toBe(false);

    board.erase(state, index);
    // 自動算出（②）の結果として、その値がまた候補に現れる
    expect(notes.has(state.notes, peer!, value)).toBe(true);
  });
});

describe('受入条件 4-2: 難易度による候補の扱い', () => {
  it('Easy は入力のたびに候補が自動で作り直される', () => {
    const state = makeBoard(9, 'Easy');
    const index = firstEmpty(state);
    const value = state.solution[index];
    const holders = board.peers(state, index).filter((p) => notes.has(state.notes, p, value));

    expect(holders.length, 'その値を候補に持つ関連セルが1つも無い').toBeGreaterThan(0);
    board.place(state, index, value);
    for (const peer of holders) expect(notes.has(state.notes, peer, value)).toBe(false);
    // 置いたセル自身の候補も空になる
    expect(notes.count(state.notes, index)).toBe(0);
  });

  it('Easy では候補の手動編集を受け付けない（C-03）', () => {
    const state = makeBoard(9, 'Easy');
    const index = firstEmpty(state);
    const before = notes.values(state.notes, index);

    expect(board.addNote(state, index, 1).ignored).toBe(true);
    expect(board.removeNote(state, index, 1).ignored).toBe(true);
    expect(board.toggleNote(state, index, 1).ignored).toBe(true);
    expect(board.clearNotes(state, index).ignored).toBe(true);
    expect(notes.values(state.notes, index)).toEqual(before);
  });

  it.each(['Hard', 'Apocalypse'] as const)('%s では手動編集だけが効き、自動算出は走らない', (difficulty) => {
    const state = makeBoard(9, difficulty);
    const index = firstEmpty(state);

    // 自動算出は走っていない
    expect(notes.count(state.notes, index)).toBe(0);

    const added = board.addNote(state, index, 5);
    expect(added.ignored).toBe(false);
    expect(notes.has(state.notes, index, 5)).toBe(true);
    expect(added.entry?.kind).toBe('NOTE_EDIT');
    // 候補編集は当該セルのみに効く（7.3）
    expect(added.entry?.noteDelta.length).toBe(1);
    // 意味を持たない項目にも値が入っている（省略可能にしない）
    expect(added.entry?.prevValue).toBe(added.entry?.nextValue);

    board.toggleNote(state, index, 5);
    expect(notes.has(state.notes, index, 5)).toBe(false);

    board.addNote(state, index, 7);
    board.clearNotes(state, index);
    expect(notes.count(state.notes, index)).toBe(0);
  });

  it('確定値が入っているセルの候補は編集できない', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    board.place(state, index, state.solution[index]);
    expect(board.addNote(state, index, 1).ignored).toBe(true);

    const given = state.given.findIndex((v) => v !== 0);
    expect(board.addNote(state, given, 1).ignored).toBe(true);
  });
});

describe('セル区分（3.3）', () => {
  it('4区分と表示値が仕様どおりに決まる', () => {
    const state = makeBoard(9, 'Hard');
    const given = state.given.findIndex((v) => v !== 0);
    const empty = firstEmpty(state);

    expect(board.cellState(state, given)).toMatchObject({
      kind: 'GIVEN',
      value: state.given[given],
      notes: [],
    });
    expect(board.cellState(state, empty).kind).toBe('EMPTY');

    board.place(state, empty, state.solution[empty]);
    expect(board.cellState(state, empty).kind).toBe('FILLED_CORRECT');
    // 正しく置いた値も、消したり書き換えたりできる状態のままにする
    expect(board.erase(state, empty).ignored).toBe(false);

    board.place(state, empty, wrongValueFor(state, empty));
    expect(board.cellState(state, empty).kind).toBe('FILLED_WRONG');
  });

  it('確定値のあるセルは候補を返さない', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    board.addNote(state, index, 3);
    expect(board.cellState(state, index).notes).toEqual([3]);
    board.place(state, index, state.solution[index]);
    expect(board.cellState(state, index).notes).toEqual([]);
  });
});

describe('判定（4章）', () => {
  it.each(ALL_SIZES)('%i×%i: 解を全部入れると完成する', (n) => {
    const state = makeBoard(n, 'Hard');
    let completed = false;
    for (let index = 0; index < n * n; index++) {
      if (state.given[index] !== 0) continue;
      completed = board.place(state, index, state.solution[index]).completed;
    }
    expect(completed).toBe(true);
    expect(isComplete(state)).toBe(true);
    expect(summary(state).emptyCount).toBe(0);
  });

  it('1×1 は、唯一のマスに 1 を入れた時点で完成する（4.5・特別分岐なし）', () => {
    const state = makeBoard(1, 'Hard');
    expect(isComplete(state)).toBe(state.given[0] !== 0);
    if (state.given[0] === 0) {
      const outcome = board.place(state, 0, 1);
      expect(outcome.completed).toBe(true);
    }
  });

  it('誤りが1つでもあると完成しない', () => {
    const state = makeBoard(4, 'Hard');
    const empties: number[] = [];
    for (let i = 0; i < 16; i++) if (state.given[i] === 0) empties.push(i);

    for (const index of empties) board.place(state, index, state.solution[index]);
    expect(isComplete(state)).toBe(true);

    board.place(state, empties[0], wrongValueFor(state, empties[0]));
    expect(isComplete(state)).toBe(false);
    expect(summary(state).errorCount).toBe(1);
  });

  it('値ごとの残数は、誤って置いた値を数えない（C-115）', () => {
    const state = makeBoard(9, 'Hard');
    const before = summary(state).remainingByValue;
    const index = firstEmpty(state);
    const wrong = wrongValueFor(state, index);

    board.place(state, index, wrong);
    const after = summary(state).remainingByValue;
    // 誤った値の残数は減らない＝パレットが早すぎる時点で使えなくならない
    expect(after[wrong - 1]).toBe(before[wrong - 1]);

    board.place(state, index, state.solution[index]);
    const fixed = summary(state).remainingByValue;
    expect(fixed[state.solution[index] - 1]).toBe(before[state.solution[index] - 1] - 1);
  });

  it('誤りマークは記入値から作り直せる（3.7 手順[3]。保存しないための仕掛け）', () => {
    const state = makeBoard(9, 'Hard');
    const index = firstEmpty(state);
    board.place(state, index, wrongValueFor(state, index));

    state.errorFlags.fill(0); // 中断復元の直後を模す
    rebuildErrorFlags(state);
    expect(state.errorFlags[index]).toBe(1);
    expect(summary(state).errorCount).toBe(1);
  });
});
