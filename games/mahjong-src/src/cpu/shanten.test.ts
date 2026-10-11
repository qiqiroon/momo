import { describe, expect, it } from 'vitest';
import { isSevenPairs, isStandardWin, isThirteenOrphans, kindCounts } from '../engine/agari';
import { createRng, shuffle } from '../engine/rng';
import { acceptance, orphansShanten, sevenPairsShanten, shanten, standardShanten } from './shanten';

/** "123m456p789s11z" の形から種類ごとの枚数を作る */
function hand(code: string): number[] {
  const c = new Array<number>(34).fill(0);
  let digits: number[] = [];
  for (const ch of code) {
    if (ch >= '0' && ch <= '9') digits.push(Number(ch) - 1);
    else {
      const base = { m: 0, p: 9, s: 18, z: 27 }[ch]!;
      for (const d of digits) c[base + d]++;
      digits = [];
    }
  }
  return c;
}

const wins = (c: number[]) => isStandardWin(c) || isSevenPairs(c) || isThirteenOrphans(c);

/** 13 枚の手で、何か 1 種類（4 枚持ちでも）足せばアガリの形になるか */
const tenpaiAnyKind = (c: number[]) =>
  Array.from({ length: 34 }, (_, k) => k).some((k) => {
    c[k]++;
    const ok = wins(c);
    c[k]--;
    return ok;
  });

/** 種から 136 枚を混ぜて先頭 n 枚の手を作る */
function randomHands(n: number, count: number, seed: string): number[][] {
  const rng = createRng(seed);
  const all = Array.from({ length: 136 }, (_, i) => i);
  return Array.from({ length: count }, () => kindCounts(shuffle(all, rng).slice(0, n)));
}

describe('向聴数（段階7の1）', () => {
  it('手で数えた例', () => {
    expect(shanten(hand('123m456p789s1122z'))).toBe(0); // 雀頭と対子のシャンポン
    expect(shanten(hand('123m456p789s1123z'))).toBe(1); // 雀頭＋孤立した字牌 2 枚
    expect(shanten(hand('123m456p789s111z22z'))).toBe(-1);
    expect(standardShanten(hand('19m19p19s1234567z'))).toBe(8);
    expect(orphansShanten(hand('19m19p19s1234567z'))).toBe(0);
    expect(shanten(hand('19m19p19s1234567z'))).toBe(0);
    expect(sevenPairsShanten(hand('1133m5577p99s1122z'))).toBe(-1);
    expect(sevenPairsShanten(hand('1111m3355p77s1122z'))).toBe(1); // 4 枚は 1 組
    expect(shanten(hand('147m258p369s1234z'))).toBe(6); // 国士 9 種よりバラバラの普通の形が遠い
    // 鳴いた面子が 2 つ（手牌 7 枚）
    expect(shanten(hand('123m45p11z'), 2)).toBe(0);
    expect(shanten(hand('13m45p9s11z'), 2)).toBe(1);
  });

  it('アガリの形の判定と食い違わない（14 枚 2000 手）', () => {
    for (const c of randomHands(14, 2000, 'sh14')) expect(shanten(c) === -1).toBe(wins(c));
    // 偶然のアガリはほぼ無いので、アガリの形も混ぜる
    for (const code of ['123m456p789s11122z', '1133m5577p99s1122z', '19m19p19s12345677z', '11122233344455m']) {
      expect(shanten(hand(code))).toBe(-1);
    }
  });

  it('テンパイの判定と食い違わない（13 枚 2000 手）', () => {
    let tenpai = 0;
    for (const c of randomHands(13, 2000, 'sh13')) {
      const t = tenpaiAnyKind(c);
      if (t) tenpai++;
      expect(shanten(c) === 0).toBe(t);
    }
    // 混ぜただけの手はテンパイがほぼ無いので、アガリの形を組んで 1 枚抜いた手でも確かめる
    const rng = createRng('built');
    let built = 0;
    for (let n = 0; n < 1000; n++) {
      const c = new Array<number>(34).fill(0);
      const put = (k: number, x: number) => (c[k] += x);
      for (let i = 0; i < 4; i++) {
        if (rng() < 0.5) {
          const suit = Math.floor(rng() * 3);
          const s = suit * 9 + Math.floor(rng() * 7);
          put(s, 1); put(s + 1, 1); put(s + 2, 1);
        } else put(Math.floor(rng() * 34), 3);
      }
      put(Math.floor(rng() * 34), 2);
      if (c.some((x) => x > 4) || !wins(c)) continue;
      expect(shanten(c)).toBe(-1);
      const held = c.flatMap((x, k) => (x > 0 ? [k] : []));
      const k = held[Math.floor(rng() * held.length)];
      c[k]--;
      expect(shanten(c)).toBe(0);
      expect(tenpaiAnyKind(c)).toBe(true);
      built++;
    }
    expect(built).toBeGreaterThan(300);
  });

  it('1 枚引いて 1 枚切ると、ちょうど 1 つだけ近づける（13 枚 200 手）', () => {
    let checked = 0;
    for (const c of randomHands(13, 200, 'step')) {
      const s = shanten(c);
      if (s < 1) continue;
      let best = 99;
      for (let k = 0; k < 34; k++) {
        if (c[k] >= 4) continue;
        c[k]++;
        for (let j = 0; j < 34; j++) {
          if (c[j] === 0) continue;
          c[j]--;
          best = Math.min(best, shanten(c));
          c[j]++;
        }
        c[k]--;
      }
      expect(best).toBe(s - 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('受け入れ：両面とカンチャン、見えた枚数を引く', () => {
    // 23m の両面待ち（1m・4m）＝ 8 枚
    const a = acceptance(hand('23m456p789s111z22z'));
    expect(a.shanten).toBe(0);
    expect(a.kinds).toEqual([0, 3]);
    expect(a.tiles).toBe(8);
    // 1m が 2 枚見えていれば 6 枚
    const seen = hand('23m456p789s111z22z');
    seen[0] += 2;
    expect(acceptance(hand('23m456p789s111z22z'), 0, seen).tiles).toBe(6);
    // 24m の嵌張＝3m だけ
    expect(acceptance(hand('24m456p789s111z22z')).kinds).toEqual([2]);
  });
});
