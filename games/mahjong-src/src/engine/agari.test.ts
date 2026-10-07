import { isSevenPairs, isStandardWin, isThirteenOrphans, isWinningHand, kindCounts } from './agari';
import { createRng } from './rng';

/** 確かめ役：判定とは別のやり方（どの牌からでも面子・雀頭を抜いてみる総当たり＋覚え書き）。遅いが素直 */
function slowWin(counts: readonly number[]): boolean {
  const memo = new Map<string, boolean>();
  const go = (c: number[], pairLeft: boolean): boolean => {
    const total = c.reduce((a, b) => a + b, 0);
    if (total === 0) return !pairLeft;
    const key = c.join(',') + pairLeft;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let ok = false;
    for (let k = 0; k < 34 && !ok; k++) {
      if (c[k] >= 3) { c[k] -= 3; ok = go(c, pairLeft); c[k] += 3; }
      if (!ok && pairLeft && c[k] >= 2) { c[k] -= 2; ok = go(c, false); c[k] += 2; }
      if (!ok && k < 27 && k % 9 <= 6 && c[k] && c[k + 1] && c[k + 2]) {
        c[k]--; c[k + 1]--; c[k + 2]--; ok = go(c, pairLeft); c[k]++; c[k + 1]++; c[k + 2]++;
      }
    }
    memo.set(key, ok);
    return ok;
  };
  return go(counts.slice(), true);
}

/** kinds の範囲で、各 0〜4 枚・合計 size 枚の枚数の組をすべて返す */
function allCounts(kinds: number[], size: number): number[][] {
  const out: number[][] = [];
  const c = new Array<number>(34).fill(0);
  const rec = (i: number, left: number) => {
    if (i === kinds.length) { if (left === 0) out.push(c.slice()); return; }
    for (let n = 0; n <= Math.min(4, left); n++) { c[kinds[i]] = n; rec(i + 1, left - n); }
    c[kinds[i]] = 0;
  };
  rec(0, size);
  return out;
}

/** 確かめ役その2：作る側から数える。kinds の範囲で「雀頭 1 つ＋面子 0〜4 組」を足し合わせてできる枚数の組を全部集める */
function buildWins(kinds: number[]): Set<string> {
  const groups: number[][] = [];
  for (const k of kinds) groups.push([k, k, k]);
  for (const k of kinds) if (k < 27 && k % 9 <= 6 && kinds.includes(k + 2)) groups.push([k, k + 1, k + 2]);
  const key = (c: number[]) => c.join(',');
  const out = new Set<string>();
  const rec = (c: number[], from: number, left: number) => {
    out.add(key(c));
    if (left === 0) return;
    for (let g = from; g < groups.length; g++) {
      const n = c.slice();
      for (const k of groups[g]) n[k]++;
      if (groups[g].every((k) => n[k] <= 4)) rec(n, g, left - 1);
    }
  };
  for (const p of kinds) {
    const c = new Array<number>(34).fill(0);
    c[p] = 2;
    rec(c, 0, 4);
  }
  return out;
}

const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);

describe('アガリの形（4面子1雀頭）', () => {
  it('例：平和形・刻子・字牌・同じ牌4枚を雀頭と順子に分ける形', () => {
    const hand = (s: string) => {
      // "123m456p789s11z" のような書き方を枚数にする
      const c = new Array<number>(34).fill(0);
      for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
        const base = { m: 0, p: 9, s: 18, z: 27 }[suit as 'm']!;
        for (const d of nums) c[base + Number(d) - 1]++;
      }
      return c;
    };
    expect(isStandardWin(hand('123m456p789s23455s'))).toBe(true);
    expect(isStandardWin(hand('111m222p333s444z55z'))).toBe(true);
    expect(isStandardWin(hand('11112345678999m'))).toBe(true); // 九蓮宝燈の形
    expect(isStandardWin(hand('11122233344455m'))).toBe(true);
    expect(isStandardWin(hand('1112m'))).toBe(false);
    expect(isStandardWin(hand('123m456p789s1234z'))).toBe(false);
    expect(isStandardWin(hand('11223344556677z'))).toBe(false); // 七対子は 4面子1雀頭ではない（別の判定）
    expect(isStandardWin(hand('19m19p19s1234567z1m'))).toBe(false); // 国士無双も別の判定
    expect(isStandardWin(hand('789m123z11z456p789s'))).toBe(false); // 字牌は順子にならない
    expect(isStandardWin(hand('891m'))).toBe(false); // 9 と 1 はつながらない
    expect(isStandardWin(hand('89m1p111222333s55z'))).toBe(false); // 9萬と1筒もつながらない
  });

  it('1 色だけの手：2・5・8・11・14 枚のすべての組（約18万）で、作る側から数えたアガリ形の一覧と一致する', () => {
    const suitWins = buildWins(range(0, 9));
    let n = 0;
    let wins = 0;
    const wrong: string[] = [];
    for (const size of [2, 5, 8, 11, 14]) {
      for (const c of allCounts(range(0, 9), size)) {
        const w = isStandardWin(c);
        if (w !== suitWins.has(c.join(','))) wrong.push(c.slice(0, 9).join(''));
        n++;
        if (w) wins++;
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(10000); // 走った件数を見る
    expect(wins).toBeGreaterThan(1000);
  }, 60000);

  it('字牌だけの手：2〜14 枚のすべての組で、作る側から数えたアガリ形の一覧と一致する', () => {
    const honorWins = buildWins(range(27, 34));
    let n = 0;
    const wrong: string[] = [];
    for (const size of [2, 5, 8, 11, 14]) {
      for (const c of allCounts(range(27, 34), size)) {
        if (isStandardWin(c) !== honorWins.has(c.join(','))) wrong.push(c.slice(27).join(''));
        n++;
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(1000);
  }, 60000);

  it('色の境目（9萬と1筒・9筒と1索・9索と東）をまたぐ手：すべての組で一覧と一致する＝境目で順子を作らない', () => {
    let n = 0;
    const wrong: string[] = [];
    for (const kinds of [range(5, 13), range(14, 22), range(23, 30)]) {
      const wins = buildWins(kinds);
      for (const size of [2, 5, 8, 11, 14]) {
        for (const c of allCounts(kinds, size)) {
          if (isStandardWin(c) !== wins.has(c.join(','))) wrong.push(kinds.map((k) => c[k]).join(''));
          n++;
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(50000);
  }, 60000);

  it('いろいろ混ざった手：アガリ形を作って 1 枚入れ替えたもの 5000 組で、確かめ役と一致する', () => {
    const rng = createRng('agari-mixed');
    const pick = (n: number) => Math.floor(rng() * n);
    let wins = 0;
    let losses = 0;
    const wrong: string[] = [];
    for (let trial = 0; trial < 5000; trial++) {
      const c = new Array<number>(34).fill(0);
      const add = (k: number, n: number) => (c[k] + n <= 4 ? ((c[k] += n), true) : false);
      while (!add(pick(34), 2));
      for (let m = 0; m < 4; ) {
        if (pick(3) === 0) { if (add(pick(34), 3)) m++; continue; }
        const k = pick(3) * 9 + pick(7);
        if (c[k] < 4 && c[k + 1] < 4 && c[k + 2] < 4) { c[k]++; c[k + 1]++; c[k + 2]++; m++; }
      }
      if (trial % 2 === 1) {
        // 1 枚入れ替える（アガリのままのこともある）
        const from = range(0, 34).filter((k) => c[k] > 0)[pick(34) % range(0, 34).filter((k) => c[k] > 0).length];
        const to = pick(34);
        if (c[to] < 4) { c[from]--; c[to]++; }
      }
      const w = isStandardWin(c);
      if (w !== slowWin(c)) wrong.push(c.join(''));
      if (w) wins++; else losses++;
    }
    expect(wrong).toEqual([]);
    expect(wins).toBeGreaterThan(2500);
    expect(losses).toBeGreaterThan(500);
  }, 60000);

  it('枚数が 3 で割って 2 余らなければアガリでない', () => {
    expect(isStandardWin(kindCounts([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16]))).toBe(false);
  });

  it('赤5も普通の5として数える・花牌は数えない', () => {
    // 5萬の 1 枚目（背番号 16）は赤5になりうる牌
    expect(kindCounts([16, 17, 140])[4]).toBe(2);
    expect(kindCounts([140]).reduce((a, b) => a + b, 0)).toBe(0);
    // 123m 456m(赤5含む) 789m 111p 99p
    expect(isWinningHand([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 37, 38, 68, 69])).toBe(true);
  });
});

/** "123m456p789s11z" のような書き方を枚数にする */
function hand(s: string): number[] {
  const c = new Array<number>(34).fill(0);
  for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[suit as 'm']!;
    for (const d of nums) c[base + Number(d) - 1]++;
  }
  return c;
}

/** 枚数の組を背番号の並びにする（種類 k の n 枚目＝k*4+n） */
function tilesOf(c: readonly number[]): number[] {
  const out: number[] = [];
  c.forEach((n, k) => { for (let i = 0; i < n; i++) out.push(k * 4 + i); });
  return out;
}

describe('七対子', () => {
  it('例', () => {
    expect(isSevenPairs(hand('1199m1199p1199s11z'))).toBe(true);
    expect(isSevenPairs(hand('11223344556677z'))).toBe(true);
    expect(isSevenPairs(hand('1122334455z7777z'))).toBe(false); // 同じ牌 4 枚は 2 組と数えない
    expect(isSevenPairs(hand('112233445566z7z1m'))).toBe(false); // 対子 6 組＋ばらばら 2 枚
    expect(isSevenPairs(hand('112233445566z'))).toBe(false); // 12 枚
  });

  it('同じ牌 4 枚を含む形は、4面子1雀頭になっていればアガリ・なっていなければアガリでない', () => {
    expect(isWinningHand(tilesOf(hand('11223344555566m')))).toBe(true); // 123 123 456 456＋55
    expect(isWinningHand(tilesOf(hand('1122334455z7777z')))).toBe(false);
  });

  it('字牌だけ・1色だけの 14 枚のすべての組で「0 枚か 2 枚だけで、2 枚がちょうど 7 種」と一致する', () => {
    let n = 0;
    let wins = 0;
    const wrong: string[] = [];
    for (const kinds of [range(27, 34), range(0, 9), range(5, 13)]) {
      for (const c of allCounts(kinds, 14)) {
        const expected = kinds.filter((k) => c[k] === 2).length === 7 && kinds.every((k) => c[k] === 0 || c[k] === 2);
        const w = isSevenPairs(c);
        if (w !== expected) wrong.push(kinds.map((k) => c[k]).join(''));
        n++;
        if (w) wins++;
      }
    }
    expect(wrong).toEqual([]);
    expect(n).toBeGreaterThan(1000); // 走った件数を見る
    expect(wins).toBe(1 + 36 + 8); // 字牌 7 種から 7 種＝1／9 種から 7 種＝36／8 種から 7 種＝8
  });
});

describe('国士無双', () => {
  it('例', () => {
    expect(isThirteenOrphans(hand('19m19p19s1234567z1m'))).toBe(true);
    expect(isThirteenOrphans(hand('19m19p19s1234567z7z'))).toBe(true);
    expect(isThirteenOrphans(hand('19m19p19s1234567z2m'))).toBe(false); // 2萬は么九牌でない
    expect(isThirteenOrphans(hand('19m19p19s123456z11m'))).toBe(false); // 中が無い
    expect(isThirteenOrphans(hand('19m19p19s1234567z'))).toBe(false); // 13 枚
  });

  it('13 種を 1 枚ずつ＋13 種それぞれをもう 1 枚の 13 通りがアガリ・么九牌でない牌を 1 枚混ぜた 21 通りはアガリでない', () => {
    const base = new Array<number>(34).fill(0);
    for (const k of [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33]) base[k] = 1;
    let wins = 0;
    let losses = 0;
    for (let k = 0; k < 34; k++) {
      const c = base.slice();
      c[k]++;
      const w = isThirteenOrphans(c);
      expect(isWinningHand(tilesOf(c))).toBe(w);
      if (w) wins++; else losses++;
    }
    expect(wins).toBe(13);
    expect(losses).toBe(21);
  });
});
