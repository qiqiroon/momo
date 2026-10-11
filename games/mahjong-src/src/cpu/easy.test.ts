import { describe, expect, it } from 'vitest';
import { benchCpu } from './bench';
import { easyCpu } from './easy';
import { arena } from '../selfplay/arena';
import { playOne } from '../selfplay/run';

describe('CPU Easy（段階7の2）', () => {
  it('4 人とも Easy で半荘を最後まで打ち、見張り役に止められない', () => {
    for (let i = 0; i < 6; i++) {
      const r = playOne(`easy-${i}`, undefined, easyCpu, true);
      expect(r.failure).toBeNull();
      expect(r.final.phase).toBe('gameover');
    }
  }, 30_000);

  it('同じ局面では必ず同じ手（ぶれを入れていない）', () => {
    const a = playOne('easy-same', undefined, easyCpu, true).log;
    const b = playOne('easy-same', undefined, easyCpu, true).log;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('検査用の打ち手より成績が良い（種 10 組×席の入れ替え）', () => {
    const r = arena(easyCpu, benchCpu, 10, 'easy-vs-bench');
    expect(r.failures).toEqual([]);
    expect(r.a.rankSum / r.a.seats).toBeLessThan(r.b.rankSum / r.b.seats);
  }, 30_000); // 重い検査と並ぶと 5 秒を超える（結果は種で決まる）
});