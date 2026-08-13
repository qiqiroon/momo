import { describe, it, expect } from 'vitest';
import { thinkBudgetMs, MIN_THINK_MS } from './think-budget';
import type { ClockState } from '../engine/time-control';

const clock = (mainMs: number, byoyomiMs = 0, inByoyomi = false): ClockState => ({
  mainMs,
  byoyomiMs,
  inByoyomi,
});

describe('AI の考える時間', () => {
  it('時間制限なしなら端末の既定どおり', () => {
    expect(thinkBudgetMs({ mode: 'no_limit', mainSeconds: 0 }, null, 2000)).toBe(2000);
  });

  it('秒読みなら秒読み時間の範囲に収まる', () => {
    const budget = thinkBudgetMs(
      { mode: 'byoyomi', mainSeconds: 0, byoyomiSeconds: 10 },
      clock(0, 10000, true),
      2000,
    );
    expect(budget).toBeLessThanOrEqual(10000 * 0.6);
    expect(budget).toBeLessThanOrEqual(2000);
  });

  it('切れ負けは残り時間が減るほど短く考える', () => {
    const tc = { mode: 'sudden_death' as const, mainSeconds: 900 };
    const early = thinkBudgetMs(tc, clock(900_000), 60_000);
    const late = thinkBudgetMs(tc, clock(30_000), 60_000);
    expect(late).toBeLessThan(early);
  });

  it('残りが尽きかけていても最低限は考える', () => {
    const budget = thinkBudgetMs({ mode: 'sudden_death', mainSeconds: 60 }, clock(500), 2000);
    expect(budget).toBe(MIN_THINK_MS);
  });

  it('端末の既定 (スマホの短い値) を超えない', () => {
    const budget = thinkBudgetMs(
      { mode: 'fischer', mainSeconds: 600, incrementSeconds: 30 },
      clock(600_000),
      1200,
    );
    expect(budget).toBeLessThanOrEqual(1200);
  });
});
