// 錠前で配る山（段階5の1・工程表 v0.03 段階5）。
// 錠前＝入れ替えのきく暗号（SRA 方式：m^e mod p）。誰の錠前から先に外してもよい。
//
// 流れ：
//  1. 混ぜる（shufflePass）：席順に 1 人ずつ、山の全部の牌に「全体の錠前」を掛けてから並びを混ぜる
//  2. 掛け直す（relockPass）：もう一度席順に 1 人ずつ、自分の全体の錠前を外して、牌ごとに別の錠前を掛ける
//     → 引くときは、引く人以外が「その位置の牌の鍵」を引く人にだけ渡せばよい（全員が同時に渡せる＝1 往復）
//  3. 引く（unlock）：渡された鍵と自分の鍵で全部外す。ドラなどは全員が全員に鍵を渡す
//  4. 検算（verifyDeal）：局の終わりに全員が鍵と並べ方を明かし、途中の山を作り直して確かめる
//
// 牌は背番号（0〜135 など）で区別する。同じ種類の 4 枚が同じ暗号文にならないようにするため。
// 牌を数にするときは平方数（(背番号+2)^2）にする＝暗号文から「平方数かどうか」で何も漏れない。
// ルール部分（engine）とは分けて置く。画面にも通信にも触らない。

/** 安全素数 p（p = 2q + 1）。RFC 2409 group 2（1024bit）と RFC 3526 group 14（2048bit） */
const PRIMES: Record<LockBits, string> = {
  1024:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE65381FFFFFFFFFFFFFFFF',
  2048:
    'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA051015728E5A8AACAA68FFFFFFFFFFFFFFFF',
};

export type LockBits = 1024 | 2048;

/**
 * 使う鍵の長さ＝1024bit（利用者 Q2=A・2026-10-09）。守るのは 1 局の間だけの手牌なので足りる。
 * この PC で配る前の準備が 4 人で約 0.9 秒（2048bit は約 5.1 秒）。測り直しは npm run lockbench
 */
export const LOCK_BITS: LockBits = 1024;

export interface Group {
  bits: LockBits;
  p: bigint;
  /** 平方数の集まりの大きさ（(p-1)/2）。鍵はこれを法として逆数を取る */
  q: bigint;
}

export function groupOf(bits: LockBits): Group {
  const p = BigInt('0x' + PRIMES[bits]);
  return { bits, p, q: (p - 1n) / 2n };
}

/** 掛ける側の鍵の長さ。外す側は逆数なので p と同じ長さになる */
const SHORT_BITS = 256;

/** 錠前 1 つ：e で掛け、d で外す（e・d ≡ 1 mod q） */
export interface Key {
  e: bigint;
  d: bigint;
}

export function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function modInv(a: bigint, m: bigint): bigint {
  let [r0, r1] = [a % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1 !== 0n) {
    const k = r0 / r1;
    [r0, r1] = [r1, r0 - k * r1];
    [s0, s1] = [s1, s0 - k * s1];
  }
  if (r0 !== 1n) throw new Error('逆数が無い');
  return ((s0 % m) + m) % m;
}

/** 偶然に頼る値はすべてここから（暗号用の乱数） */
function randomBits(bits: number): bigint {
  const words = new Uint32Array(Math.ceil(bits / 32));
  crypto.getRandomValues(words);
  let x = 0n;
  for (const w of words) x = (x << 32n) | BigInt(w);
  return x;
}

function randomBelow(n: number): number {
  // 偏りを避けるため、n の倍数に収まらない値は引き直す
  const lim = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(a);
    if (a[0] < lim) return a[0] % n;
  }
}

export function newKey(g: Group): Key {
  for (;;) {
    const e = randomBits(SHORT_BITS) | 1n;
    if (e < 3n || e % g.q === 0n) continue;
    return { e, d: modInv(e, g.q) };
  }
}

export function encode(g: Group, id: number): bigint {
  const x = BigInt(id + 2);
  return (x * x) % g.p;
}

/** 数から背番号へ。知らない数なら -1 */
export function decoder(g: Group, ids: readonly number[]): (m: bigint) => number {
  const map = new Map<bigint, number>();
  for (const id of ids) map.set(encode(g, id), id);
  return (m) => map.get(m) ?? -1;
}

/** 1 人ぶんの持ち物（鍵は本人だけが持ち、局の終わりに明かす） */
export interface Locker {
  global: Key;
  /** 位置ごとの錠前（掛け直しのあとの山の位置） */
  perCard: Key[];
  /** 混ぜたときの並べ方（新しい位置 i に、元の位置 perm[i] の牌を置いた） */
  perm: number[];
}

export function newLocker(g: Group, size: number): Locker {
  const perCard: Key[] = [];
  for (let i = 0; i < size; i++) perCard.push(newKey(g));
  // フィッシャー–イェーツ
  const perm = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return { global: newKey(g), perCard, perm };
}

/** 1. 混ぜる：全部に全体の錠前を掛けて、並べ方どおりに並べ替える */
export function shufflePass(g: Group, deck: readonly bigint[], me: Locker): bigint[] {
  const locked = deck.map((c) => modPow(c, me.global.e, g.p));
  return me.perm.map((from) => locked[from]);
}

/** 2. 掛け直す：全体の錠前を外し、位置ごとの錠前を掛ける（1 回の計算で済ませる） */
export function relockPass(g: Group, deck: readonly bigint[], me: Locker): bigint[] {
  return deck.map((c, i) => modPow(c, (me.global.d * me.perCard[i].e) % g.q, g.p));
}

/** 3. 外す：その位置の鍵（全員ぶん）をまとめて 1 回で外す */
export function unlock(g: Group, c: bigint, ds: readonly bigint[]): bigint {
  let d = 1n;
  for (const x of ds) d = (d * x) % g.q;
  return modPow(c, d, g.p);
}

/** 混ぜる・掛け直すの途中の山（全員に見える。検算に使う） */
export interface DealLog {
  /** start＝錠前の無い山、shuffled[k]＝k 人目が混ぜたあと、relocked[k]＝k 人目が掛け直したあと */
  start: bigint[];
  shuffled: bigint[][];
  relocked: bigint[][];
}

export type VerifyProblem =
  | { kind: 'shuffle'; seat: number }
  | { kind: 'relock'; seat: number; pos: number }
  | { kind: 'tiles' }
  | { kind: 'claimed'; pos: number };

/**
 * 4. 検算：全員が明かした鍵と並べ方で、途中の山を 1 つずつ作り直して突き合わせる。
 * claimed は「この位置の牌はこれだった」と画面や出来事で使った背番号（引いた牌・ドラなど）。
 * 何も見つからなければ空の配列と、山の中身（位置ごとの背番号）を返す。
 */
export function verifyDeal(
  g: Group,
  ids: readonly number[],
  log: DealLog,
  lockers: readonly Locker[],
  claimed: ReadonlyMap<number, number>,
): { problems: VerifyProblem[]; wall: number[] } {
  const problems: VerifyProblem[] = [];
  const startOk = log.start.length === ids.length && log.start.every((c, i) => c === encode(g, ids[i]));
  if (!startOk) problems.push({ kind: 'tiles' });
  let deck = log.start;
  lockers.forEach((lk, k) => {
    const expect = shufflePass(g, deck, lk);
    if (expect.some((c, i) => c !== log.shuffled[k][i])) problems.push({ kind: 'shuffle', seat: k });
    deck = log.shuffled[k];
  });
  lockers.forEach((lk, k) => {
    const expect = relockPass(g, deck, lk);
    expect.forEach((c, i) => {
      if (c !== log.relocked[k][i]) problems.push({ kind: 'relock', seat: k, pos: i });
    });
    deck = log.relocked[k];
  });
  const dec = decoder(g, ids);
  const wall = deck.map((c, i) => dec(unlock(g, c, lockers.map((lk) => lk.perCard[i].d))));
  if (new Set(wall).size !== ids.length || wall.includes(-1)) problems.push({ kind: 'tiles' });
  for (const [pos, id] of claimed) if (wall[pos] !== id) problems.push({ kind: 'claimed', pos });
  return { problems, wall };
}
