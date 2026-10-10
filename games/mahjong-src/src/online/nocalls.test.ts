import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { SEATS, type Seat } from '../engine/events';
import { legalActions } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { viewFor } from '../engine/state';
import { playOne } from '../selfplay/run';
import { OnlineTable } from './table';

// 自動対局の中から「誰かがポン・チーできる返事の番」を探し、その席から見た局面で確かめる
function findCallable() {
  for (let i = 1; i < 200; i += 2) {
    const log = playOne(`nocalls-${i}`, GENERAL_RULES, benchCpu).log;
    for (let n = 1; n <= log.length; n++) {
      for (const seat of SEATS) {
        const v = viewFor(log.slice(0, n), seat);
        if (v.phase !== 'claim') continue;
        const legal = legalActions(v, seat);
        if (legal.some((a) => a.type === 'pon' || a.type === 'chi')) return { v, seat: seat as Seat, legal };
      }
    }
  }
  throw new Error('鳴ける場面が見つからない');
}

describe('「鳴かない」（利用者 Q16=B）', () => {
  it('入れると、返事の番の選べることからチー・ポン・カンが消え、見送る（とロン）だけが残る。切ると元に戻る', () => {
    const { v, seat, legal } = findCallable();
    const t = new OnlineTable({ send: () => {}, isHost: false, myId: 'x', cpu: benchCpu });
    expect(t.choices(v, seat)).toEqual(legal);
    t.setNoCalls(true);
    const left = t.choices(v, seat);
    expect(left.some((a) => a.type === 'chi' || a.type === 'pon' || a.type === 'kan')).toBe(false);
    expect(left.some((a) => a.type === 'pass')).toBe(true);
    expect(left.length).toBe(legal.filter((a) => a.type === 'pass' || a.type === 'ron').length);
    t.setNoCalls(false);
    expect(t.choices(v, seat)).toEqual(legal);
  });
});
