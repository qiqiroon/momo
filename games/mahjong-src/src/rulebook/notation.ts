// ルールブックの牌の並びの書き方。'123m'＝1・2・3萬、'55z'＝白白（z は 1〜7＝東南西北白發中）。
// 例の手を短く書くためだけのもので、ルール部分は使わない。

import type { KindId } from '../engine/tiles';

const SUIT_BASE: Record<string, number> = { m: 0, p: 9, s: 18, z: 27 };

/** '123m' → [0, 1, 2]。数字の並びの後ろに色の文字を 1 つ */
export function parseKinds(s: string): KindId[] {
  const m = /^(\d+)([mpsz])$/.exec(s);
  if (!m) throw new Error(`牌の並びが読めない: ${s}`);
  const base = SUIT_BASE[m[2]];
  return [...m[1]].map((d) => {
    const n = Number(d);
    if (n < 1 || n > (m[2] === 'z' ? 7 : 9)) throw new Error(`牌の数字が範囲外: ${s}`);
    return base + n - 1;
  });
}

/** 絵に出す背番号（その種類の 2 枚目＝赤5にならない） */
export const idOfKind = (k: KindId) => k * 4 + 1;
