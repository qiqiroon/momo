// ルールブックの牌の並びの書き方。'123m'＝1・2・3萬、'55z'＝白白（z は 1〜7＝東南西北白發中）、
// '12f'＝花牌の春・夏（f は 1〜8＝春夏秋冬梅蘭菊竹）。例の手を短く書くためだけのもので、ルール部分は使わない。

import type { KindId } from '../engine/tiles';

const SUIT_BASE: Record<string, number> = { m: 0, p: 9, s: 18, z: 27, f: 34 };
const SUIT_MAX: Record<string, number> = { m: 9, p: 9, s: 9, z: 7, f: 8 };

/** '123m' → [0, 1, 2]。数字の並びの後ろに色の文字を 1 つ */
export function parseKinds(s: string): KindId[] {
  const m = /^(\d+)([mpszf])$/.exec(s);
  if (!m) throw new Error(`牌の並びが読めない: ${s}`);
  const base = SUIT_BASE[m[2]];
  return [...m[1]].map((d) => {
    const n = Number(d);
    if (n < 1 || n > SUIT_MAX[m[2]]) throw new Error(`牌の数字が範囲外: ${s}`);
    return base + n - 1;
  });
}

/** 絵に出す背番号（その種類の 2 枚目＝赤5にならない。花牌は 1 種類 1 枚） */
export const idOfKind = (k: KindId) => (k < 34 ? k * 4 + 1 : 136 + (k - 34));
