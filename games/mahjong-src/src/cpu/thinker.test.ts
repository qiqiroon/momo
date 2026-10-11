import { describe, expect, it } from 'vitest';
import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import { legalActions } from '../engine/round';
import type { GameState } from '../engine/state';
import { kindOf } from '../engine/tiles';
import { playOne } from '../selfplay/run';
import { dangerOf, threats } from './defense';
import { shanten, visibleCounts } from './shanten';
import { twoStepAcceptance } from './simulate';
import { APOCALYPSE, HARD, makeThinker } from './thinker';

const hard = makeThinker(HARD);
const apoc = makeThinker(APOCALYPSE);

describe('CPU Hard・Apocalypse（段階7の3・4）', () => {
  it('4 人とも同じ強さで半荘を最後まで打ち、見張り役に止められない', () => {
    for (const [name, cpu] of [['hard', hard], ['apoc', apoc]] as const) {
      for (let i = 0; i < 3; i++) {
        const r = playOne(`${name}-${i}`, undefined, cpu, true);
        expect(r.failure).toBeNull();
        expect(r.final.phase).toBe('gameover');
      }
    }
  }, 60_000);

  it('同じ局面では必ず同じ手（ぶれを入れていない）', () => {
    const a = playOne('apoc-same', undefined, apoc, true).log;
    const b = playOne('apoc-same', undefined, apoc, true).log;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  }, 30_000);

  it('リーチされてテンパイから遠い（2 歩以上）ときは、いちばん危なくない牌を切る', () => {
    let checked = 0;
    for (const [name, cpu, fine] of [['hard', hard, false], ['apoc', apoc, true]] as const) {
      const watch = (view: GameState, seat: Seat) => {
        const action = cpu(view, seat);
        if (view.phase !== 'discard' || view.turn !== seat || view.riichi[seat] !== 'none') return action;
        if (threats(view, seat).length === 0 || action.type !== 'discard') return action;
        const counts = kindCounts(view.hands[seat]);
        const open = view.melds[seat].length;
        const visible = visibleCounts(view, seat);
        const options = legalActions(view, seat).filter((a) => a.type === 'discard');
        // どの牌を切ってもテンパイの 2 歩以上手前のときだけ（押し引きの境目を避ける）
        const nearest = Math.min(...options.map((a) => {
          if (a.type !== 'discard') return 99;
          counts[kindOf(a.tile)]--;
          const s = shanten(counts, open);
          counts[kindOf(a.tile)]++;
          return s;
        }));
        if (nearest < 2) return action;
        // Apocalypse は点数の状況（オーラスのラス目）で押すことがあるので、その場面は除く
        if (fine && view.roundIndex >= 7) return action;
        const least = Math.min(...options.map((a) => (a.type === 'discard' ? dangerOf(view, seat, kindOf(a.tile), visible, fine) : 99)));
        expect(dangerOf(view, seat, kindOf(action.tile), visible, fine)).toBe(least);
        checked++;
        return action;
      };
      for (let i = 0; i < 4; i++) playOne(`fold-${name}-${i}`, undefined, watch, true);
    }
    expect(checked).toBeGreaterThan(50);
  }, 60_000);

  it('2 歩先の受け入れ：手で数えた値と合う', () => {
    // 123m 456m 東東 45s 45p 白（1 シャンテン）。進む牌は 3s・6s・3p・6p の 16 枚。
    // どれを引いても白を切ってテンパイになり、待ちは残りの両面の 8 枚＝16×8＝128
    const c = new Array<number>(34).fill(0);
    for (const k of [0, 1, 2, 3, 4, 5, 27, 27, 21, 22, 12, 13, 31]) c[k]++;
    expect(shanten(c)).toBe(1);
    expect(twoStepAcceptance(c, 0, c)).toBe(128);
    // 3p が 2 枚見えていれば：3s・6s を引くと待ちは 3p6p の 6 枚／6p を引くと 3s6s の 8 枚／3p は残り 2 枚で、引けば 3s6s の 8 枚
    const seen = c.slice();
    seen[11] += 2;
    expect(twoStepAcceptance(c, 0, seen)).toBe(4 * 6 + 4 * 6 + 4 * 8 + 2 * 8);
  });
});
