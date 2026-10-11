import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { arena } from './arena';

describe('CPU どうしの強さ比べ（段階7の1）', () => {
  it('席を入れ替えて打ち、点と順位の合計が合う', () => {
    const r = arena(benchCpu, tsumogiriCpu, 2, 'arena-test');
    expect(r.failures).toEqual([]);
    expect(r.games).toBe(4);
    expect(r.a.seats + r.b.seats).toBe(16);
    // 持ち点は 4 人で 100000（供託は受け取ったあと）・順位は 1 対局で 1+2+3+4
    expect(r.a.pointsSum + r.b.pointsSum).toBe(100000 * r.games);
    expect(r.a.rankSum + r.b.rankSum).toBe(10 * r.games);
    expect(r.hands).toBeGreaterThan(0);
    // ツモ切りはアガれない形を寄せないので、アガリは検査用の打ち手の側にしか出ない
    expect(r.b.wins).toBe(0);
    expect(r.a.wins).toBeGreaterThan(0);
  }, 30_000);
});