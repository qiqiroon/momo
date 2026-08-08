/**
 * ミス管理（第2分冊 5章）の検査。受入条件 4-3 をここで確かめる。
 *
 * **失敗はプレイの終了ではない。** 失敗しても入力・誤り検出・完成到達がすべて続くことを見る。
 */

import { describe, expect, it } from 'vitest';

import { firstChunkPuzzles } from '../test/fixtures';
import { identityParams } from '../transform/params';
import * as board from './board';
import { MISTAKE_LIMIT } from './config';
import * as mistake from './mistake';
import { isComplete, summary } from './validate';

function makeBoard(difficulty: 'Easy' | 'Hard' | 'Apocalypse') {
  const created = board.create({
    puzzle: firstChunkPuzzles(4)[0],
    params: identityParams(4, 2),
    difficulty,
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

describe('ミスの計数と上限（5.3 / 5.4）', () => {
  it('難易度別の上限が設定どおりである', () => {
    expect(mistake.create('Easy').limit).toBe(MISTAKE_LIMIT.Easy);
    expect(mistake.create('Hard').limit).toBe(3);
    expect(mistake.create('Apocalypse').limit).toBe(3);
  });

  it('Hard は3回目で失敗になり、その1回だけ「いま失敗した」が立つ', () => {
    const state = mistake.create('Hard');
    expect(mistake.record(state)).toMatchObject({ count: 1, failed: false, justFailed: false });
    expect(mistake.record(state)).toMatchObject({ count: 2, failed: false, justFailed: false });
    expect(mistake.record(state)).toMatchObject({ count: 3, failed: true, justFailed: true });
    // 以後も数え続けるが、通知は繰り返さない
    expect(mistake.record(state)).toMatchObject({ count: 4, failed: true, justFailed: false });
  });

  it('Easy は無制限なので、何回間違えても失敗にならない（分岐を設けない帰結）', () => {
    const state = mistake.create('Easy');
    for (let i = 0; i < 100; i++) mistake.record(state);
    expect(state.count).toBe(100);
    expect(state.failed).toBe(false);
  });

  it('中断から戻すと、回数と失敗の有無がそのまま復元される', () => {
    const state = mistake.restore('Apocalypse', 2, false);
    expect(state).toEqual({ count: 2, limit: 3, failed: false });
    expect(mistake.record(state).justFailed).toBe(true);

    const failed = mistake.restore('Hard', 5, true);
    expect(failed.failed).toBe(true);
  });
});

describe('受入条件 4-3: 誤入力で1増え、3回で失敗し、それでもプレイが続く（C-17）', () => {
  it('同じマスへ同じ誤りを繰り返しても、そのつど計上される（C-07）', () => {
    const state = makeBoard('Hard');
    const counter = mistake.create('Hard');
    const index = state.given.findIndex((v) => v === 0);
    const wrong = state.solution[index] === 1 ? 2 : 1;

    for (let i = 0; i < 3; i++) {
      const outcome = board.place(state, index, wrong);
      expect(outcome.wasMistake).toBe(true);
      mistake.record(counter);
    }
    expect(counter.count).toBe(3);
    expect(counter.failed).toBe(true);
  });

  it('失敗したあとも、入力・誤り検出・完成到達がすべて続く', () => {
    const state = makeBoard('Hard');
    const counter = mistake.create('Hard');
    const empties: number[] = [];
    for (let i = 0; i < state.n * state.n; i++) if (state.given[i] === 0) empties.push(i);

    // わざと3回間違えて失敗させる
    const victim = empties[0];
    const wrong = state.solution[victim] === 1 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      board.place(state, victim, wrong);
      mistake.record(counter);
    }
    expect(counter.failed).toBe(true);
    expect(state.errorFlags[victim]).toBe(1);

    // 失敗後も入力は通り、誤り検出も働き、ミスは数え続ける
    const stillWrong = board.place(state, empties[1], state.solution[empties[1]] === 1 ? 2 : 1);
    expect(stillWrong.ignored).toBe(false);
    expect(stillWrong.wasMistake).toBe(true);
    expect(mistake.record(counter).count).toBe(4);
    expect(summary(state).errorCount).toBe(2);

    // そのうえで最後まで解ける
    let completed = false;
    for (const index of empties) {
      completed = board.place(state, index, state.solution[index]).completed;
    }
    expect(completed).toBe(true);
    expect(isComplete(state)).toBe(true);
    // 完成しても失敗の事実は消えない（統計の計上規則にだけ効く）
    expect(counter.failed).toBe(true);
  });

  it('候補メモの操作はミスに数えない（5.3）', () => {
    const state = makeBoard('Hard');
    const index = state.given.findIndex((v) => v === 0);
    const outcome = board.addNote(state, index, 1);
    // 候補の操作は PlaceOutcome を返さない＝ミス計数の入力にならない
    expect(outcome).not.toHaveProperty('wasMistake');
  });
});
