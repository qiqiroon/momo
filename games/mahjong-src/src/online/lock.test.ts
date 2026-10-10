import { describe, expect, it } from 'vitest';
import {
  type DealLog,
  type Locker,
  decoder,
  encode,
  groupOf,
  newLocker,
  relockPass,
  shufflePass,
  unlock,
  verifyDeal,
} from './lock';

// 検査は速さのため 1024bit で回す（計算の形は 2048bit と同じ）
const g = groupOf(1024);
const IDS = Array.from({ length: 136 }, (_, i) => i);
const dec = decoder(g, IDS);

/** 4 人で混ぜて掛け直すまで（通信は使わず、順に手渡しした形） */
function deal(n = 4): { log: DealLog; lockers: Locker[] } {
  const lockers = Array.from({ length: n }, () => newLocker(g, IDS.length));
  const start = IDS.map((id) => encode(g, id));
  const shuffled: bigint[][] = [];
  const relocked: bigint[][] = [];
  let deck = start;
  for (const lk of lockers) shuffled.push((deck = shufflePass(g, deck, lk)));
  for (const lk of lockers) relocked.push((deck = relockPass(g, deck, lk)));
  return { log: { start, shuffled, relocked }, lockers };
}

const finalDeck = (log: DealLog) => log.relocked[log.relocked.length - 1];

// 計算が重いので、ほかの重い検査と並んで走っても間に合う長さにする
describe('錠前で配る山', { timeout: 60_000 }, () => {
  it('全員の鍵がそろうと、どの位置も背番号に戻り、136 枚がちょうど 1 枚ずつある', () => {
    const { log, lockers } = deal();
    const wall = finalDeck(log).map((c, i) => dec(unlock(g, c, lockers.map((lk) => lk.perCard[i].d))));
    expect(new Set(wall).size).toBe(136);
    expect(wall.includes(-1)).toBe(false);
  });

  it('1 人でも鍵が欠けると、その位置の牌は分からない', () => {
    const { log, lockers } = deal();
    for (let miss = 0; miss < 4; miss++) {
      const ds = lockers.filter((_, k) => k !== miss).map((lk) => lk.perCard[0].d);
      expect(dec(unlock(g, finalDeck(log)[0], ds))).toBe(-1);
    }
  });

  it('同じ種類の牌でも、暗号の数は全部違う（1 枚が明かされても同じ種類の残りの位置は分からない）', () => {
    const { log } = deal();
    expect(new Set(finalDeck(log).map(String)).size).toBe(136);
    expect(new Set(log.shuffled[3].map(String)).size).toBe(136);
  });

  it('並びは毎回変わる（2 回配って同じ並びにならない）', () => {
    const a = deal();
    const b = deal();
    const wallOf = ({ log, lockers }: ReturnType<typeof deal>) =>
      finalDeck(log).map((c, i) => dec(unlock(g, c, lockers.map((lk) => lk.perCard[i].d))));
    expect(wallOf(a)).not.toEqual(wallOf(b));
  });

  it('検算：正しく配った山は問題なし。山の中身と、引いた牌の申告が一致する', () => {
    const { log, lockers } = deal();
    const { problems, wall } = verifyDeal(g, IDS, log, lockers, new Map());
    expect(problems).toEqual([]);
    const claimed = new Map([[5, wall[5]], [100, wall[100]]]);
    expect(verifyDeal(g, IDS, log, lockers, claimed).problems).toEqual([]);
  });

  it('検算：混ぜる人が牌をすり替えた（同じ牌を 2 枚にした）ら見つかる', () => {
    const { log, lockers } = deal();
    log.shuffled[1][7] = log.shuffled[1][8];
    expect(verifyDeal(g, IDS, log, lockers, new Map()).problems).toContainEqual({ kind: 'shuffle', seat: 1 });
  });

  it('検算：掛け直しで 1 枚だけ別の数にしたら、その人と位置が分かる', () => {
    const { log, lockers } = deal();
    log.relocked[2][40] = (log.relocked[2][40] * 4n) % g.p;
    expect(verifyDeal(g, IDS, log, lockers, new Map()).problems).toContainEqual({ kind: 'relock', seat: 2, pos: 40 });
  });

  it('検算：引いた牌の申告が山と違えば見つかる', () => {
    const { log, lockers } = deal();
    const { wall } = verifyDeal(g, IDS, log, lockers, new Map());
    const claimed = new Map([[10, wall[11]]]);
    expect(verifyDeal(g, IDS, log, lockers, claimed).problems).toEqual([{ kind: 'claimed', pos: 10 }]);
  });

  it('検算：明かした鍵が偽物なら見つかる', () => {
    const { log, lockers } = deal();
    const liar = { ...lockers[3], global: newLocker(g, 1).global };
    const problems = verifyDeal(g, IDS, log, [lockers[0], lockers[1], lockers[2], liar], new Map()).problems;
    expect(problems.some((p) => p.kind === 'shuffle' && p.seat === 3)).toBe(true);
  });
});
