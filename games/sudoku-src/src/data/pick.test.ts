/**
 * 受入条件 2-5（既出が枯渇したら古い側から除外が解ける）／ 2-6（在庫1件でも出題が返る）
 */

import { describe, expect, it } from 'vitest';
import { readData } from '../test/fixtures';
import { pick } from './pick';
import { parseChunk, type Puzzle } from './types';

function puzzlesOf(relPath: string, n: 1 | 9): Puzzle[] {
  const parsed = parseChunk(readData(relPath), n);
  if (!parsed.ok) throw new Error('チャンクが読めない');
  return parsed.value.puzzles;
}

const EASY_N09 = puzzlesOf('n09/c0002.json', 9);
const MIXED_N09 = puzzlesOf('n09/c0000.json', 9);
const N01 = puzzlesOf('n01/c0000.json', 1);

describe('出題選択（3.5 / 4.5）', () => {
  it('既出でない問題があれば、そこから選ぶ', () => {
    const three = EASY_N09.slice(0, 3);
    const result = pick({ puzzles: three, difficulty: null, recentIds: [three[0].id, three[1].id] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.puzzle.id).toBe(three[2].id);
    expect(result.value.recentExhausted).toBe(false);
  });

  it('2-5: 全部が既出なら、いちばん古い1件だけ除外が解ける', () => {
    const three = EASY_N09.slice(0, 3);
    // 既出リストは新しい順。末尾 three[0] がいちばん古い
    const recentIds = [three[2].id, three[1].id, three[0].id];

    const result = pick({ puzzles: three, difficulty: null, recentIds });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentExhausted).toBe(true);
    expect(result.value.puzzle.id).toBe(three[0].id); // 新しい2件は避けられている
  });

  it('2-5: 古い側を1件解いても足りなければ、足りるまで順に解ける', () => {
    // 候補にはいちばん古い2件しか含まれないので、2件目まで解けて初めて選べる
    const three = EASY_N09.slice(0, 3);
    const recentIds = [three[2].id, three[1].id, 'N9-999999'];

    const result = pick({ puzzles: [three[1], three[2]], difficulty: null, recentIds });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.recentExhausted).toBe(true);
    expect(result.value.puzzle.id).toBe(three[1].id);
  });

  it('2-6: 在庫1件（1×1）でも、既出に入っていて出題が返る', () => {
    expect(N01).toHaveLength(1);
    const only = N01[0];

    // 一度遊んだあと、同じサイズをもう一度選んだ状況
    const result = pick({ puzzles: N01, difficulty: 'Easy', recentIds: [only.id] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.puzzle.id).toBe(only.id);
    expect(result.value.recentExhausted).toBe(true);
  });

  it('2-6: 在庫1件を何度続けて選んでも、出題は返り続ける', () => {
    const only = N01[0];
    for (let i = 0; i < 5; i++) {
      const result = pick({ puzzles: N01, difficulty: 'Easy', recentIds: [only.id] });
      expect(result.ok).toBe(true);
    }
  });

  it('指定の難易度が1件も無ければ、全難易度へ戻す（通知しない）', () => {
    // c0000 は Apocalypse だけのチャンク
    const result = pick({ puzzles: MIXED_N09, difficulty: 'Easy', recentIds: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fellBack).toBe(true);
    expect(result.value.puzzle.difficulty).toBe('Apocalypse');
  });

  it('指定の難易度があるときは、その難易度だけから選ぶ', () => {
    const result = pick({ puzzles: MIXED_N09, difficulty: 'Apocalypse', recentIds: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.fellBack).toBe(false);
    expect(result.value.puzzle.difficulty).toBe('Apocalypse');
  });

  it('候補が空なら不正として返す', () => {
    const result = pick({ puzzles: [], difficulty: null, recentIds: [] });
    expect(result.ok).toBe(false);
  });
});
