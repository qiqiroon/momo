import { describe, it, expect } from 'vitest';
import { thinkBudgetMs, movesLeftEstimate, MIN_THINK_MS } from './think-budget';
import type { ClockState } from '../engine/time-control';

const clock = (mainMs: number, byoyomiMs = 0, inByoyomi = false): ClockState => ({
  mainMs,
  byoyomiMs,
  inByoyomi,
});

const CAP = 29_000;
const FIRST = { ownMovesPlayed: 0, inCheck: false };

/**
 * ★v1.94 (ユーザー判断 2026-10-01・親 §7.4.1)。
 * 「1 手の時間」＝秒読みの秒数・フィッシャーの加算秒 (切れ負けは 0)。
 * 16 秒以上ならその − 1 秒、15 秒以下なら 本時間 ÷ 残り手数の見込み ＋ 1 手の時間。
 */
describe('AI の考える時間', () => {
  it('時間制限なしなら上限そのもの (Apocalypse は 29 秒)', () => {
    expect(thinkBudgetMs({ mode: 'no_limit', mainSeconds: 0 }, null, CAP, FIRST)).toBe(CAP);
  });

  it('1 手の時間が 16 秒以上なら、その秒数 − 1 秒 (30 秒の秒読みなら 29 秒)', () => {
    const tc = { mode: 'byoyomi' as const, mainSeconds: 600, byoyomiSeconds: 30 };
    expect(thinkBudgetMs(tc, clock(600_000), CAP, FIRST)).toBe(29_000);
    expect(thinkBudgetMs(tc, clock(0, 30_000, true), CAP, FIRST)).toBe(29_000);
    expect(thinkBudgetMs({ mode: 'fischer', mainSeconds: 600, incrementSeconds: 20 }, clock(600_000), CAP, FIRST)).toBe(19_000);
  });

  it('上限 (29 秒) は超えない (60 秒の秒読みでも 29 秒)', () => {
    const tc = { mode: 'byoyomi' as const, mainSeconds: 0, byoyomiSeconds: 60 };
    expect(thinkBudgetMs(tc, clock(0, 60_000, true), CAP, FIRST)).toBe(CAP);
  });

  it('★1 手 10 秒＋持ち時間 600 秒の 1 手目は 600 ÷ 40 ＋ 10 ＝ 25 秒 (ご指定の例)', () => {
    const tc = { mode: 'byoyomi' as const, mainSeconds: 600, byoyomiSeconds: 10 };
    expect(thinkBudgetMs(tc, clock(600_000), CAP, FIRST)).toBe(25_000);
  });

  it('切れ負けは 本時間 ÷ 残り手数の見込み (600 秒なら 1 手目 15 秒)', () => {
    const tc = { mode: 'sudden_death' as const, mainSeconds: 600 };
    expect(thinkBudgetMs(tc, clock(600_000), CAP, FIRST)).toBe(15_000);
  });

  it('残り手数の見込みは 40 から 1 手ごとに 0.5 減り、12 で止まる', () => {
    expect(movesLeftEstimate({ ownMovesPlayed: 0, inCheck: false })).toBe(40);
    expect(movesLeftEstimate({ ownMovesPlayed: 20, inCheck: false })).toBe(30);
    expect(movesLeftEstimate({ ownMovesPlayed: 56, inCheck: false })).toBe(12);
    expect(movesLeftEstimate({ ownMovesPlayed: 200, inCheck: false })).toBe(12);
  });

  it('王手をかけられているときは見込みを半分にする (＝その手に倍の時間)', () => {
    const tc = { mode: 'sudden_death' as const, mainSeconds: 600 };
    const calm = thinkBudgetMs(tc, clock(300_000), CAP, { ownMovesPlayed: 20, inCheck: false });
    const check = thinkBudgetMs(tc, clock(300_000), CAP, { ownMovesPlayed: 20, inCheck: true });
    expect(calm).toBe(10_000); // 300 ÷ 30
    expect(check).toBe(20_000); // 300 ÷ 15
  });

  it('秒読みに入ったら、その回の秒読み − 1 秒まで (時間切れにしない)', () => {
    const tc = { mode: 'byoyomi' as const, mainSeconds: 600, byoyomiSeconds: 10 };
    expect(thinkBudgetMs(tc, clock(0, 10_000, true), CAP, FIRST)).toBe(9_000);
  });

  it('切れ負けで残りが少なければ、残り − 1 秒を超えない', () => {
    const tc = { mode: 'sudden_death' as const, mainSeconds: 600 };
    const b = thinkBudgetMs(tc, clock(3_000), CAP, { ownMovesPlayed: 80, inCheck: true });
    expect(b).toBeLessThanOrEqual(2_000);
  });

  it('残りが尽きかけていても最低限は考える', () => {
    const budget = thinkBudgetMs({ mode: 'sudden_death', mainSeconds: 60 }, clock(500), CAP, FIRST);
    expect(budget).toBe(MIN_THINK_MS);
  });

  it('上限 (端末や段の値) を超えない', () => {
    const budget = thinkBudgetMs(
      { mode: 'fischer', mainSeconds: 600, incrementSeconds: 30 },
      clock(600_000),
      1200,
      FIRST,
    );
    expect(budget).toBeLessThanOrEqual(1200);
  });
});
