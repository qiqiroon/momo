// 局をなかったことにする（段階10・利用者 Q5=A）：切れた人が戻らず鍵も無いとき、局の始まりの直前へ戻して同じ局を配り直す。
import type { Envelope } from './events';
import { apply, initialState, replay, type GameState } from './state';
import { GENERAL_RULES } from './rules';
import { playOne } from '../selfplay/run';
import { benchCpu } from '../cpu/bench';

/** 通し番号を付け直して当てはめる */
function applyAll(s: GameState, envs: readonly Envelope[]): GameState {
  for (const e of envs) s = apply(s, { ...e, seq: s.nextSeq });
  return s;
}

/** 局の途中でリーチ棒が出た局（点が局の途中で動いた局）を探す */
function findHand() {
  for (let i = 0; i < 40; i++) {
    const r = playOne(`void-${i}`, GENERAL_RULES, benchCpu, true);
    const log = r.log;
    const starts = log.flatMap((e, k) => (e.ev.type === 'roundStart' ? [k] : []));
    for (let h = 1; h < starts.length - 1; h++) {
      const from = starts[h];
      const to = starts[h + 1];
      const riichiAt = log.slice(from, to).findIndex((e) => e.ev.type === 'discard' && e.ev.riichi);
      if (riichiAt < 0) continue;
      // リーチ棒が出たのは、その打牌への返事が全員そろったあと＝もう少し先まで進める
      return { log, from, cut: Math.min(to - 1, from + riichiAt + 8) };
    }
  }
  throw new Error('リーチのある局が見つからない');
}

describe('局をなかったことにする（roundVoid）', () => {
  const { log, from, cut } = findHand();
  const before = replay(log.slice(0, from));
  const mid = replay(log.slice(0, cut));

  it('局の途中で点が動いている（検査の前提）', () => {
    expect(mid.scores.join()).not.toBe(before.scores.join());
  });

  it('局の始まりの直前の局面へ戻る（点・供託・局の数も戻り、通し番号だけ進む）', () => {
    const v = apply(mid, { seq: mid.nextSeq, to: 'all', ev: { type: 'roundVoid' } });
    expect(v.nextSeq).toBe(mid.nextSeq + 1);
    // 戻す先には、その前の局の「直前の局面」は持たない（2 局続けては戻せない＝要らない）
    expect({ ...v, nextSeq: 0, beforeRound: null }).toEqual({ ...before, nextSeq: 0, beforeRound: null });
    expect(v.scores).toEqual(before.scores);
    expect(v.kyotaku).toBe(before.kyotaku);
    expect(v.handCount).toBe(before.handCount);
  });

  it('戻したあとは同じ局・同じ本場を始められる。違う局は止める', () => {
    const v = apply(mid, { seq: mid.nextSeq, to: 'all', ev: { type: 'roundVoid' } });
    const again = applyAll(v, [log[from]]);
    expect(again.roundIndex).toBe(mid.roundIndex);
    expect(again.honba).toBe(mid.honba);
    const rs = log[from].ev;
    if (rs.type !== 'roundStart') throw new Error('前提');
    expect(() => apply(v, { seq: v.nextSeq, to: 'all', ev: { ...rs, roundIndex: rs.roundIndex + 1, dealer: ((rs.dealer + 1) % 4) as 0 } })).toThrow();
  });

  it('戻したあと、同じ局を最後までやり直せる（元の局の出来事をそのまま当てはめ直す）', () => {
    const v = apply(mid, { seq: mid.nextSeq, to: 'all', ev: { type: 'roundVoid' } });
    const end = applyAll(v, log.slice(from));
    const orig = replay(log);
    expect(end.scores).toEqual(orig.scores);
    expect(end.phase).toBe(orig.phase);
  });

  it('局が始まる前・対局が終わったあとは、なかったことにできない', () => {
    const s0 = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } });
    expect(() => apply(s0, { seq: s0.nextSeq, to: 'all', ev: { type: 'roundVoid' } })).toThrow();
    const over = replay(log);
    expect(over.phase).toBe('gameover');
    expect(() => apply(over, { seq: over.nextSeq, to: 'all', ev: { type: 'roundVoid' } })).toThrow();
  });
});
