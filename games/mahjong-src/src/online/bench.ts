// 錠前で配る山の速さを測る（段階5の1）。npm run lockbench
// 通信は入れない＝計算だけの時間。1 人ぶんの手番の時間（＝通信で順に回すときに待つ時間）も出す。
import { decoder, encode, groupOf, newLocker, relockPass, shufflePass, unlock, verifyDeal, type LockBits } from './lock';

const IDS = Array.from({ length: 136 }, (_, i) => i);
// 1 局で開ける牌のおおよその数：配牌 52＋ツモ 70＋嶺上 4＋ドラ・裏ドラ 10
const OPENS = 136;

for (const bits of [1024, 2048] as LockBits[]) {
  const g = groupOf(bits);
  const dec = decoder(g, IDS);
  const t0 = performance.now();
  const lockers = Array.from({ length: 4 }, () => newLocker(g, IDS.length));
  const t1 = performance.now();
  const start = IDS.map((id) => encode(g, id));
  const shuffled: bigint[][] = [];
  const relocked: bigint[][] = [];
  let deck = start;
  const shuffleEach: number[] = [];
  for (const lk of lockers) {
    const s = performance.now();
    shuffled.push((deck = shufflePass(g, deck, lk)));
    shuffleEach.push(performance.now() - s);
  }
  const relockEach: number[] = [];
  for (const lk of lockers) {
    const s = performance.now();
    relocked.push((deck = relockPass(g, deck, lk)));
    relockEach.push(performance.now() - s);
  }
  const t2 = performance.now();
  for (let i = 0; i < OPENS; i++) dec(unlock(g, deck[i], lockers.map((lk) => lk.perCard[i].d)));
  const t3 = performance.now();
  verifyDeal(g, IDS, { start, shuffled, relocked }, lockers, new Map());
  const t4 = performance.now();
  const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(0);
  console.log(`--- ${bits}bit ---`);
  console.log(`鍵を作る（4 人ぶん）         ${(t1 - t0).toFixed(0)} ms（1 人 ${((t1 - t0) / 4).toFixed(0)} ms）`);
  console.log(`混ぜる（1 人の手番）         ${avg(shuffleEach)} ms × 4 人`);
  console.log(`掛け直す（1 人の手番）       ${avg(relockEach)} ms × 4 人`);
  console.log(`配る前の合計（順に回す）     ${(t2 - t1).toFixed(0)} ms`);
  console.log(`牌を開ける 1 枚              ${((t3 - t2) / OPENS).toFixed(1)} ms（1 局 ${OPENS} 枚で ${(t3 - t2).toFixed(0)} ms）`);
  console.log(`局の終わりの検算             ${(t4 - t3).toFixed(0)} ms`);
}
