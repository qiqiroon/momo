// 親決め（訂正26100917・サイコロ）の検査
import { rollForDealer, startRound } from './round';
import { GENERAL_RULES } from './rules';
import { apply, dealerByDice, initialState } from './state';
import { finalResult } from './final';
import type { Envelope, GameEvent } from './events';

const start = (ev?: GameEvent) => {
  let s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
  if (ev) s = apply(s, { seq: 1, to: 'all', ev });
  return s;
};

describe('親決め', () => {
  it('目の合計を振った人＝1 として下家の向きへ数える（5・9＝自分、2・6・10＝下家、3・7・11＝対面、4・8・12＝上家）', () => {
    const want: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 0, 6: 1, 7: 2, 8: 3, 9: 0, 10: 1, 11: 2, 12: 3 };
    for (let sum = 2; sum <= 12; sum++) {
      const dice: [number, number] = [Math.max(1, sum - 6), Math.min(6, sum - 1)];
      expect(dealerByDice(0, dice)).toBe(want[sum]);
      expect(dealerByDice(2, dice)).toBe((want[sum] + 2) % 4);
    }
  });

  it('同じ種なら同じ目。種によって 4 人とも起家になりうる', () => {
    expect(rollForDealer('abc')).toEqual(rollForDealer('abc'));
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const ev = rollForDealer(`seed-${i}`);
      if (ev.type === 'dealerDice') seen.add(ev.dealer);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it('目と起家が合わない・1〜6 でない・局のあと、は止める。最初の局の親は起家でなければ止める', () => {
    expect(() => start({ type: 'dealerDice', by: 0, dice: [1, 1], dealer: 0 })).toThrow('合わない');
    expect(() => start({ type: 'dealerDice', by: 0, dice: [0, 2], dealer: 1 })).toThrow('1〜6');
    const s = start({ type: 'dealerDice', by: 0, dice: [1, 2], dealer: 2 });
    expect(s.chicha).toBe(2);
    expect(() => apply(s, { seq: 2, to: 'all', ev: { type: 'roundStart', roundIndex: 0, dealer: 0 } })).toThrow('起家');
    const envs: Envelope[] = startRound(s, 'x', 0, 2);
    let t = s;
    for (const e of envs) t = apply(t, e);
    expect(t.dealer).toBe(2);
  });

  it('終局の同点は起家に近い人が上', () => {
    const s = { ...start({ type: 'dealerDice', by: 0, dice: [1, 2], dealer: 2 }), phase: 'gameover' as const, gameOver: 'last' as const, scores: [25000, 25000, 25000, 25000] as [number, number, number, number] };
    const rank = Object.fromEntries(finalResult(s).map((r) => [r.seat, r.rank]));
    // 同点は分け合わないルール（一般ルール）なら、起家（席 2）→ 席 3 → 席 0 → 席 1 の順
    if (GENERAL_RULES.family === 'jp' && GENERAL_RULES.values.tie !== 'split') expect([rank[2], rank[3], rank[0], rank[1]]).toEqual([1, 2, 3, 4]);
  });
});
