/**
 * ★v1.93: 強さ比べの物差しそのものの確かめ。
 *
 * 物差しが**同じ条件で同じ結果を出さない**と、改良の前後の差が改良のせいか揺らぎのせいか
 * 分からない。読む量を時間ではなく局面の数で揃えているのはそのため。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../core/engine/mgf/loader';
import { initPosition } from '../core/engine/position/init';
import { alphaBetaPlayer, openingFrom, playPair, summarize } from './harness';

const RULES = { quantum: false } as const;

describe('強さ比べの物差し (★v1.93)', () => {
  it('同じ条件で 2 回指すと、まったく同じ結果になる', () => {
    const run = () =>
      playPair({
        mgf: hondou,
        rules: RULES,
        initial: initPosition(hondou),
        a: alphaBetaPlayer(hondou, RULES, 300),
        b: alphaBetaPlayer(hondou, RULES, 300, { features: { tt: true } }),
        opening: 3,
        openingPlies: 4,
        maxPlies: 40,
      }).map((r) => ({ aScore: r.aScore, end: r.end, plies: r.plies, an: r.a.nodes, bn: r.b.nodes }));
    expect(run()).toEqual(run());
  }, 120_000);

  it('出だしは種で決まり、種が違えば別の局面になる', () => {
    const a = openingFrom(hondou, RULES, initPosition(hondou), 4, 1);
    const b = openingFrom(hondou, RULES, initPosition(hondou), 4, 1);
    const c = openingFrom(hondou, RULES, initPosition(hondou), 4, 2);
    expect(a.history).toEqual(b.history);
    expect(a.history).not.toEqual(c.history);
  });

  it('1 つの出だしで先後を入れ替えて 2 局指し、集計は A から見た点で数える', () => {
    const recs = playPair({
      mgf: hondou,
      rules: RULES,
      initial: initPosition(hondou),
      a: alphaBetaPlayer(hondou, RULES, 200),
      b: alphaBetaPlayer(hondou, RULES, 200),
      opening: 5,
      openingPlies: 4,
      maxPlies: 30,
    });
    expect(recs.map((r) => r.aIsP1)).toEqual([true, false]);
    const s = summarize(recs);
    expect(s.games).toBe(2);
    expect(s.wins + s.draws + s.losses).toBe(2);
    expect(s.score).toBe((recs[0].aScore + recs[1].aScore) / 2);
  }, 120_000);
});
