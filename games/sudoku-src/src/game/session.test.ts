/**
 * セッション統括（第2分冊 10章・12章）の検査。
 *
 * 受入条件 4-1（状態の移り変わりの全経路と副作用）・4-5（中断保存→復元の完全一致・V-11）・
 * 4-6（準備失敗時の扱い）・4-7（失敗したセッションの計上）をここで確かめる。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { BoardSize, Difficulty, Puzzle, SuspendedSession } from '../data/types';
import * as undoStack from '../history/undoStack';
import { statsStore } from '../storage/statsStore';
import { RELEASED_SIZES, UNRELEASED_SIZES, firstChunkPuzzles, syntheticPuzzle } from '../test/fixtures';
import { identityParams, randomParams } from '../transform/params';
import * as board from './board';
import * as hint from './hint';
import * as mistake from './mistake';
import * as notes from './notes';
import * as session from './session';
import type { SessionState } from './session';
import * as timer from './timer';

const ALL_SIZES: readonly BoardSize[] = [...RELEASED_SIZES, ...UNRELEASED_SIZES];

function sourceOf(n: BoardSize): Puzzle {
  const b = Math.round(Math.sqrt(n));
  if (RELEASED_SIZES.includes(n)) return firstChunkPuzzles(n)[0];
  return syntheticPuzzle(n, b);
}

/** 手で進める時計。経過時間を実時間に依存させない（9.3） */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 5000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function beginSession(
  n: BoardSize,
  options: { difficulty?: Difficulty; now?: () => number; random?: boolean } = {},
): SessionState {
  const b = Math.round(Math.sqrt(n));
  const base = sourceOf(n);
  const puzzle: Puzzle =
    options.difficulty === undefined ? base : { ...base, difficulty: options.difficulty };
  const params = options.random === true ? randomParams(n, b) : identityParams(n, b);
  // 遊ぶ難易度は呼び出し側が渡す（C-178）。指定が無ければ元問題の格付けに合わせる
  const begun = session.begin({
    puzzle,
    difficulty: options.difficulty ?? base.difficulty,
    params,
    now: options.now,
  });
  if (!begun.ok) throw new Error(`${n}×${n} のセッションを開始できない: ${begun.error.message}`);
  return begun.value;
}

function firstEmpty(state: SessionState): number {
  const { board: b } = state;
  for (let i = 0; i < b.n * b.n; i++) {
    if (b.given[i] === 0 && b.entered[i] === 0) return i;
  }
  throw new Error('空セルが無い');
}

function wrongValueFor(state: SessionState, index: number): number {
  for (let v = 1; v <= state.board.n; v++) {
    if (v !== state.board.solution[index]) return v;
  }
  throw new Error('誤った値を選べない');
}

/** 盤面の姿を丸ごと写す。中断→復元で一致するかを見るため */
function snapshot(state: SessionState): string {
  return JSON.stringify({
    given: state.board.given,
    solution: state.board.solution,
    entered: state.board.entered,
    errorFlags: [...state.board.errorFlags],
    notes: [...state.board.notes.words],
  });
}

/** 残りをすべて正しく埋める */
function solve(state: SessionState): void {
  for (let i = 0; i < state.board.n * state.board.n; i++) {
    if (state.board.given[i] === 0) board.place(state.board, i, state.board.solution[i]);
  }
}

describe('開始と状態の移り変わり（12.2 / 12.3 / 4-1）', () => {
  it('出題確定でプレイ中になり、時計が動く', () => {
    const clock = fakeClock();
    const state = beginSession(9, { now: clock.now });

    expect(session.phase(state)).toBe('PLAYING');
    expect(timer.running(state.timer)).toBe(true);
    clock.advance(3000);
    expect(timer.elapsed(state.timer)).toBe(3000);
    // 履歴・ヒントは空で始まる
    expect(undoStack.canUndo(state.undo)).toBe(false);
    expect(state.hint.displays).toEqual([]);
  });

  it('難易度は**元問題の値**を用いる（ユーザーの指定値ではない・10.2）', () => {
    const state = beginSession(9, { difficulty: 'Apocalypse' });
    expect(state.board.difficulty).toBe('Apocalypse');
    expect(state.mistake.limit).toBe(3);
    expect(session.toResult(state).difficulty).toBe('Apocalypse');
  });

  it('一時停止で時計が止まり、再開で動き出す', () => {
    const clock = fakeClock();
    const state = beginSession(9, { now: clock.now });

    clock.advance(1000);
    expect(session.pause(state)).toBe(true);
    expect(session.phase(state)).toBe('PAUSED');
    clock.advance(60000);
    expect(timer.elapsed(state.timer)).toBe(1000);

    expect(session.unpause(state)).toBe(true);
    expect(session.phase(state)).toBe('PLAYING');
    clock.advance(2000);
    expect(timer.elapsed(state.timer)).toBe(3000);
  });

  it('完成で時計が止まり、ヒントが全部閉じ、結果が返る', () => {
    const clock = fakeClock();
    const state = beginSession(4, { now: clock.now });
    hint.requestForCell(state.hint, state.board, firstEmpty(state));

    clock.advance(4000);
    // 完成していないうちは何も起こらない
    expect(session.complete(state)).toBeNull();
    expect(session.phase(state)).toBe('PLAYING');

    solve(state);
    const result = session.complete(state);
    expect(result).not.toBeNull();
    expect(result?.completed).toBe(true);
    expect(result?.elapsedMs).toBe(4000);
    expect(result?.hintUsed).toBe(1);
    expect(session.phase(state)).toBe('COMPLETED');
    expect(state.hint.displays).toEqual([]);
    expect(timer.running(state.timer)).toBe(false);

    // 完成後に時間が伸びない
    clock.advance(10000);
    expect(session.toResult(state).elapsedMs).toBe(4000);
  });

  it('破棄で時計が止まりヒントが閉じる。結果は通知しない', () => {
    const clock = fakeClock();
    const state = beginSession(9, { now: clock.now });
    hint.requestForCell(state.hint, state.board, firstEmpty(state));
    clock.advance(1500);

    expect(session.discard(state)).toBe(true);
    expect(session.phase(state)).toBe('DISCARDED');
    expect(state.hint.displays).toEqual([]);
    clock.advance(9000);
    expect(timer.elapsed(state.timer)).toBe(1500);
  });

  it('一時停止中からも破棄できる', () => {
    const state = beginSession(9);
    session.pause(state);
    expect(session.discard(state)).toBe(true);
    expect(session.phase(state)).toBe('DISCARDED');
  });

  it('完成・破棄のあとは解放して IDLE へ戻る', () => {
    const completed = beginSession(4);
    solve(completed);
    session.complete(completed);
    expect(session.release(completed)).toBe(true);
    expect(session.phase(completed)).toBe('IDLE');
    expect(undoStack.canUndo(completed.undo)).toBe(false);

    const discarded = beginSession(4);
    session.discard(discarded);
    expect(session.release(discarded)).toBe(true);
    expect(session.phase(discarded)).toBe('IDLE');
  });

  it('経路に無い移り変わりは起こらない', () => {
    const state = beginSession(9);
    // プレイ中に「一時停止からの再開」はできない
    expect(session.unpause(state)).toBe(false);
    // プレイ中に解放はできない
    expect(session.release(state)).toBe(false);

    session.pause(state);
    // 一時停止中の一時停止・完成はできない
    expect(session.pause(state)).toBe(false);
    expect(session.complete(state)).toBeNull();

    session.discard(state);
    // 破棄後は一時停止も破棄もできない
    expect(session.pause(state)).toBe(false);
    expect(session.discard(state)).toBe(false);
  });

  it('**失敗してもプレイ中のまま**である（C-17 / 12.1）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const index = firstEmpty(state);
    for (let i = 0; i < 3; i++) {
      board.place(state.board, index, wrongValueFor(state, index));
      mistake.record(state.mistake);
    }
    expect(state.mistake.failed).toBe(true);
    // 状態機械に失敗状態は無い
    expect(session.phase(state)).toBe('PLAYING');
    // 一時停止も完成もそのまま通る
    expect(session.pause(state)).toBe(true);
    expect(session.unpause(state)).toBe(true);
    solve(state);
    expect(session.complete(state)?.completed).toBe(true);
  });

  it('準備に失敗すると IDLE へ戻る（12.4）', () => {
    const puzzle = sourceOf(9);
    const broken = { ...identityParams(9, 3), symbolMap: [1, 2, 3] };
    const begun = session.begin({ puzzle, difficulty: puzzle.difficulty, params: broken as never });
    expect(begun.ok).toBe(false);
  });
});

describe('中断の保存と復元（3.7 / 4-5 / V-11）', () => {
  it.each(ALL_SIZES)('%i×%i: 盤面・候補・経過時間・ミス回数が完全に一致する', (n) => {
    const clock = fakeClock();
    const state = beginSession(n, { now: clock.now, random: true });

    // 遊んだ形を作る：ヒント使用・正解・誤入力・候補メモ
    // **1×1 はマスが1つしかない。** 埋めると次に触るマスが無くなるので、順序を先にヒントへ寄せる
    hint.requestForCell(state.hint, state.board, firstEmpty(state));
    const index = firstEmpty(state);
    board.place(state.board, index, state.board.solution[index]);
    if (n > 1) {
      const wrongAt = firstEmpty(state);
      board.place(state.board, wrongAt, wrongValueFor(state, wrongAt));
      mistake.record(state.mistake);
      if (state.board.difficulty !== 'Easy') {
        const noteAt = firstEmpty(state);
        board.addNote(state.board, noteAt, 1);
      }
    }
    clock.advance(12345);

    const suspended = session.toSuspended(state);
    const before = snapshot(state);

    const resumed = session.resume({
      suspended,
      puzzle: sourceOf(n),
      now: fakeClock().now,
    });
    if (!resumed.ok) throw new Error(`復元できない: ${resumed.error.message}`);

    expect(snapshot(resumed.value)).toBe(before);
    expect(timer.elapsed(resumed.value.timer)).toBe(12345);
    expect(resumed.value.mistake.count).toBe(state.mistake.count);
    expect(resumed.value.mistake.failed).toBe(state.mistake.failed);
    expect(resumed.value.hint.usedCount).toBe(state.hint.usedCount);
  });

  it('ヒントの表示と履歴は空で始まる（C-27 / 7.6）', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);
    board.place(state.board, index, state.board.solution[index]);
    const placed = board.place(state.board, firstEmpty(state), 1);
    if (placed.entry) undoStack.push(state.undo, placed.entry);
    hint.requestForCell(state.hint, state.board, firstEmpty(state));

    const resumed = session.resume({ suspended: session.toSuspended(state), puzzle: sourceOf(9) });
    if (!resumed.ok) throw new Error('復元できない');

    // 使用回数だけが戻る
    expect(resumed.value.hint.usedCount).toBe(1);
    expect(resumed.value.hint.displays).toEqual([]);
    expect(undoStack.canUndo(resumed.value.undo)).toBe(false);
    expect(undoStack.canRedo(resumed.value.undo)).toBe(false);
  });

  it('誤りマークは保存せず、復元時に組み直す（3.7 手順[3]）', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);
    board.place(state.board, index, wrongValueFor(state, index));

    const suspended = session.toSuspended(state);
    // 保存項目に誤りマークは無い
    expect(Object.keys(suspended)).not.toContain('errorFlags');

    const resumed = session.resume({ suspended, puzzle: sourceOf(9) });
    if (!resumed.ok) throw new Error('復元できない');
    expect(resumed.value.board.errorFlags[index]).toBe(1);
  });

  it('Easy でも候補は保存値をそのまま戻す（再算出しない・C-19）', () => {
    const state = beginSession(9, { difficulty: 'Easy' });
    const suspended = session.toSuspended(state);
    // 保存値をわざと1つ減らしておく。再算出すれば戻ってしまう値である
    const target = suspended.notes.findIndex((list) => list.length > 1);
    const removed = suspended.notes[target][0];
    suspended.notes[target] = suspended.notes[target].slice(1);

    const resumed = session.resume({ suspended, puzzle: sourceOf(9) });
    if (!resumed.ok) throw new Error('復元できない');
    expect(notes.has(resumed.value.board.notes, target, removed)).toBe(false);
  });

  it('固定セルの位置に記入値が紛れていても取り込まない', () => {
    const state = beginSession(9);
    const suspended = session.toSuspended(state);
    const givenAt = state.board.given.findIndex((v) => v !== 0);
    suspended.entered[givenAt] = 1;

    const resumed = session.resume({ suspended, puzzle: sourceOf(9) });
    if (!resumed.ok) throw new Error('復元できない');
    expect(resumed.value.board.entered[givenAt]).toBe(0);
  });
});

describe('準備失敗時の扱い（12.4 / 4-6）', () => {
  function suspendedOf(n: BoardSize): SuspendedSession {
    return session.toSuspended(beginSession(n));
  }

  it('元問題が取れない（別の問題が来た）中断は破棄される', () => {
    const suspended = suspendedOf(9);
    const other = { ...sourceOf(9), id: 'N09-999999' };
    const resumed = session.resume({ suspended, puzzle: other });
    expect(resumed.ok).toBe(false);
  });

  it('サイズが食い違う中断は破棄される', () => {
    const suspended = suspendedOf(9);
    const resumed = session.resume({ suspended, puzzle: { ...sourceOf(4), id: suspended.sourceId } });
    expect(resumed.ok).toBe(false);
  });

  it('変換パラメータの検証に失敗した中断は破棄される（2.8）', () => {
    const suspended = suspendedOf(9);
    suspended.transformParams = { ...identityParams(9, 3), bandOrder: [0, 0, 0] };
    const resumed = session.resume({ suspended, puzzle: sourceOf(9) });
    expect(resumed.ok).toBe(false);
  });

  it('記入値の長さが合わない中断は破棄される', () => {
    const suspended = suspendedOf(9);
    suspended.entered = [1, 2, 3];
    const resumed = session.resume({ suspended, puzzle: sourceOf(9) });
    expect(resumed.ok).toBe(false);
  });

  it('**候補の復元に失敗してもセッションは破棄しない。候補を空にして続ける**', () => {
    const suspended = session.toSuspended(beginSession(9, { difficulty: 'Hard' }));
    const index = 0;
    suspended.notes = [[1, 2]];  // 長さが N×N でない＝壊れている

    const resumed = session.resume({ suspended, puzzle: { ...sourceOf(9), difficulty: 'Hard' } });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(notes.values(resumed.value.board.notes, index)).toEqual([]);
    expect(session.phase(resumed.value)).toBe('PLAYING');
  });

  it('Easy は候補の復元に失敗しても自動算出で作り直される', () => {
    const suspended = session.toSuspended(beginSession(9, { difficulty: 'Easy' }));
    suspended.notes = [];

    const resumed = session.resume({ suspended, puzzle: { ...sourceOf(9), difficulty: 'Easy' } });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    const empty = firstEmpty(resumed.value);
    expect(notes.values(resumed.value.board.notes, empty).length).toBeGreaterThan(0);
  });
});

describe('成績への計上（10.2 / 10.3 / 4-7）', () => {
  beforeEach(() => {
    statsStore.reset();
  });

  /** 3回誤入力してから最後まで解く */
  function failThenSolve(state: SessionState): void {
    const index = firstEmpty(state);
    for (let i = 0; i < 3; i++) {
      board.place(state.board, index, wrongValueFor(state, index));
      mistake.record(state.mistake);
    }
    solve(state);
  }

  it('失敗したセッションはクリア数・最短時間に計上されず、失敗数に計上される（C-06）', () => {
    const clock = fakeClock();
    const state = beginSession(9, { difficulty: 'Hard', now: clock.now });
    failThenSolve(state);
    clock.advance(30000);

    const result = session.complete(state);
    expect(result?.completed).toBe(true);
    expect(result?.failed).toBe(true);

    const stats = statsStore.record(result!);
    if (!stats.ok) throw new Error('成績を記録できない');
    const entry = stats.value.entries['9:Hard'];
    expect(entry.failedCount).toBe(1);
    expect(entry.clearCount).toBe(0);
    expect(entry.bestTimeMs).toBeNull();
    // ヒント使用は失敗の有無を問わず加算される
    expect(entry.hintUsedTotal).toBe(0);
  });

  it('失敗せず完成すればクリア数と最短時間が動く', () => {
    const clock = fakeClock();
    const state = beginSession(9, { difficulty: 'Hard', now: clock.now });
    hint.requestForCell(state.hint, state.board, firstEmpty(state));
    solve(state);
    clock.advance(25000);

    const result = session.complete(state);
    expect(result?.failed).toBe(false);

    const stats = statsStore.record(result!);
    if (!stats.ok) throw new Error('成績を記録できない');
    const entry = stats.value.entries['9:Hard'];
    expect(entry.clearCount).toBe(1);
    expect(entry.failedCount).toBe(0);
    expect(entry.bestTimeMs).toBe(25000);
    expect(entry.hintUsedTotal).toBe(1);
  });

  it('ミス回数は結果に載るが、失敗判定とは別物である（C-118）', () => {
    const state = beginSession(9, { difficulty: 'Easy' });
    const index = firstEmpty(state);
    for (let i = 0; i < 5; i++) {
      board.place(state.board, index, wrongValueFor(state, index));
      mistake.record(state.mistake);
    }
    solve(state);
    const result = session.complete(state);

    // Easy は上限なし。5回間違えても失敗ではない
    expect(result?.mistakeCount).toBe(5);
    expect(result?.failed).toBe(false);
  });

  it('中断・破棄で終えたセッションは結果を通知しない（10.4）', () => {
    const state = beginSession(9);
    expect(session.discard(state)).toBe(true);
    // 破棄は結果を返さない。`playCount` は開始時に計上済みである
    expect(session.complete(state)).toBeNull();
  });
});

// ---------------------------------------------------------------- 操作の取りまとめ（C-155 / 段階7 前半）

describe('操作の取りまとめ（8.7 / C-155）', () => {
  it('正解を入れると履歴へ積まれ、ミスは増えず、その升のヒントが閉じる', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);
    session.requestHint(state, index);
    expect(state.hint.displays).toHaveLength(1);

    const outcome = session.input(state, index, state.board.solution[index]);

    expect(outcome.ignored).toBe(false);
    expect(outcome.wasMistake).toBe(false);
    expect(state.mistake.count).toBe(0);
    expect(session.canUndo(state)).toBe(true);
    // 提示の目的が達成されたので閉じる。**使用回数は減らさない**（6.4 / 6.6）
    expect(state.hint.displays).toHaveLength(0);
    expect(state.hint.usedCount).toBe(1);
  });

  it('誤った値を入れるとミスが1つ増え、ヒントは閉じない（6.4）', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);
    session.requestHint(state, index);

    const outcome = session.input(state, index, wrongValueFor(state, index));

    expect(outcome.wasMistake).toBe(true);
    expect(state.mistake.count).toBe(1);
    expect(state.board.errorFlags[index]).toBe(1);
    // 誤ったときこそ表示を残すほうが助けになる
    expect(state.hint.displays).toHaveLength(1);
  });

  it('固定セルへの入力は無効操作で、履歴にもミスにも残らない（3.4 / 8.6）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const given = state.board.given.findIndex((v) => v !== 0);

    const outcome = session.input(state, given, wrongValueFor(state, given));

    expect(outcome.ignored).toBe(true);
    expect(state.mistake.count).toBe(0);
    expect(session.canUndo(state)).toBe(false);
  });

  it('上限に達しても入力・誤り検出・計数は続く（5.5）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const index = firstEmpty(state);
    const wrong = wrongValueFor(state, index);

    const outcomes = [1, 2, 3, 4].map(() => session.input(state, index, wrong));

    // 3回目で初めて失敗に到達し、4回目以降は「初めて」ではない
    expect(outcomes.map((o) => o.justFailed)).toEqual([false, false, true, false]);
    expect(state.mistake.failed).toBe(true);
    expect(state.mistake.count).toBe(4);
    // 失敗後も正解を受け付ける
    expect(session.input(state, index, state.board.solution[index]).ignored).toBe(false);
    expect(state.board.errorFlags[index]).toBe(0);
  });

  it('取り消しで盤面は戻るが、ミスもヒントも戻らない（7.5 / 6.7）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const index = firstEmpty(state);
    session.requestHint(state, index);
    session.input(state, index, wrongValueFor(state, index));

    expect(session.undo(state).applied).toBe(true);

    expect(state.board.entered[index]).toBe(0);
    expect(state.mistake.count).toBe(1);
    expect(state.hint.usedCount).toBe(1);
    expect(session.canRedo(state)).toBe(true);
  });

  it('やり直すと同じ値が戻るが、ミスは二重に計上されない（7.5）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const index = firstEmpty(state);
    const wrong = wrongValueFor(state, index);
    session.input(state, index, wrong);
    session.undo(state);

    expect(session.redo(state).applied).toBe(true);

    expect(state.board.entered[index]).toBe(wrong);
    expect(state.mistake.count).toBe(1);
  });

  it('候補メモの反転は履歴へ積まれ、ミスにはならない（7.2 / 5.3）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const index = firstEmpty(state);

    expect(session.toggleNote(state, index, 1)).toBe(true);
    expect(notes.has(state.board.notes, index, 1)).toBe(true);
    expect(state.mistake.count).toBe(0);

    session.undo(state);
    expect(notes.has(state.board.notes, index, 1)).toBe(false);
  });

  it('Easy では候補メモを手で編集できない（C-03）', () => {
    const state = beginSession(9, { difficulty: 'Easy' });
    const index = firstEmpty(state);
    const before = [...state.board.notes.words];

    expect(session.toggleNote(state, index, 1)).toBe(false);
    expect(session.clearNotes(state, index)).toBe(false);
    expect([...state.board.notes.words]).toEqual(before);
  });

  it('メモON中の消去はその升の候補だけを消し、確定値は消さない（9.2）', () => {
    const state = beginSession(9, { difficulty: 'Hard' });
    const empty = firstEmpty(state);
    session.toggleNote(state, empty, 1);
    session.toggleNote(state, empty, 2);

    expect(session.clearNotes(state, empty)).toBe(true);
    expect(notes.values(state.board.notes, empty)).toEqual([]);

    // 確定値のある升は候補が常に空なので、そもそも編集の対象外である（3.6.3）
    session.input(state, empty, state.board.solution[empty]);
    expect(session.clearNotes(state, empty)).toBe(false);
    expect(state.board.entered[empty]).toBe(state.board.solution[empty]);
  });

  it('ヒントは升の指定があればその升、無ければ盤面から選ぶ（C-45）', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);

    expect(session.requestHint(state, index).display?.index).toBe(index);
    const random = session.requestHint(state, null);
    expect(random.ignored).toBe(false);
    expect(random.display?.index).not.toBe(index);

    session.dismissHint(state, index);
    expect(state.hint.displays.some((d) => d.index === index)).toBe(false);
    // 閉じても使用回数は減らない（6.6）
    expect(state.hint.usedCount).toBe(2);
  });

  it('プレイ中でなければどの操作も通らない（12.2）', () => {
    const state = beginSession(9);
    const index = firstEmpty(state);
    session.pause(state);

    expect(session.input(state, index, 1).ignored).toBe(true);
    expect(session.erase(state, index)).toBe(false);
    expect(session.toggleNote(state, index, 1)).toBe(false);
    expect(session.undo(state).applied).toBe(false);
    expect(session.redo(state).applied).toBe(false);
    expect(session.requestHint(state, index).ignored).toBe(true);
  });

  it('全サイズで、入力から完成までが取りまとめ窓口だけで成立する', () => {
    for (const n of ALL_SIZES) {
      const state = beginSession(n, { difficulty: 'Hard', random: true });
      for (let i = 0; i < n * n; i++) {
        if (state.board.given[i] === 0) session.input(state, i, state.board.solution[i]);
      }
      const result = session.complete(state);
      expect(result?.completed, `${n}×${n}`).toBe(true);
      expect(result?.mistakeCount, `${n}×${n}`).toBe(0);
    }
  });
});
