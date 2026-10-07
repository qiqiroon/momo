// アガリの形の判定。形だけを見る（役は見ない）。
// 4面子1雀頭・七対子・国士無双の3つ（段階2で七対子・国士無双を足した）。
//
// 種類（KindId）ごとの枚数で考える。赤5も種類は普通の5なので、ここでは区別しない。

import { isSuit, kindOf, type KindId, type TileId } from './tiles';

/** 背番号の並びを、種類ごとの枚数（長さ 34。花牌は数えない）にする */
export function kindCounts(tiles: readonly TileId[]): number[] {
  const c = new Array<number>(34).fill(0);
  for (const t of tiles) {
    const k = kindOf(t);
    if (k < 34) c[k]++;
  }
  return c;
}

/** 1 色ぶん（9 種）または字牌 1 種が、面子だけに分けきれるか。c は書き換えて戻す */
function allMelds(c: number[], from: KindId, to: KindId): boolean {
  let i = from;
  while (i < to && c[i] === 0) i++;
  if (i >= to) return true;
  // 一番小さい牌は、刻子の頭か順子の頭のどちらか
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = allMelds(c, i, to);
    c[i] += 3;
    if (ok) return true;
  }
  if (isSuit(i) && (i % 9) <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = allMelds(c, i, to);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 面子 n 組＋雀頭 1 つに分けきれるか（n は枚数から決まる＝14 枚なら 4 組。鳴いた面子は段階3で別に持つ） */
export function isStandardWin(counts: readonly number[]): boolean {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total % 3 !== 2) return false;
  const c = counts.slice();
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok =
      allMelds(c, 0, 9) &&
      allMelds(c, 9, 18) &&
      allMelds(c, 18, 27) &&
      // 字牌は順子にならない＝1 種ずつ 0 枚か 3 枚
      c.slice(27, 34).every((n) => n === 0 || n === 3);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

/** 么九牌（1・9・字牌）13種 */
export const TERMINAL_HONOR_KINDS: readonly KindId[] = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

/**
 * 七対子：14 枚が違う種類の対子 7 組。日本式は同じ牌 4 枚を 2 組と数えない。
 * （中国式＝四川の「龍七対」などは 4 枚を 2 組と数える。段階9でルールの値として足す）
 */
export function isSevenPairs(counts: readonly number[]): boolean {
  let pairs = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    if (counts[k] !== 2) return false;
    pairs++;
  }
  return pairs === 7;
}

/** 国士無双：么九牌 13 種を 1 枚ずつ＋そのどれか 1 種がもう 1 枚（14 枚。鳴いていない手だけ） */
export function isThirteenOrphans(counts: readonly number[]): boolean {
  let total = 0;
  for (let k = 0; k < 34; k++) total += counts[k];
  if (total !== 14) return false;
  return TERMINAL_HONOR_KINDS.every((k) => counts[k] >= 1) &&
    TERMINAL_HONOR_KINDS.reduce((a, k) => a + counts[k], 0) === 14;
}

export function isWinningHand(tiles: readonly TileId[]): boolean {
  const c = kindCounts(tiles);
  return isStandardWin(c) || isSevenPairs(c) || isThirteenOrphans(c);
}
