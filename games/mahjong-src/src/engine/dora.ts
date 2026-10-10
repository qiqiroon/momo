// ドラ・赤ドラ・裏ドラ（日本式）。
//
// 王牌（山の尻 14 枚）の並び：山の並びの最後の 14 枚を、2 枚ずつ上下に重ねた 7 山として読む。
//   王牌の i 枚目（0〜13）＝ wall[wall.length - 14 + i]。山 j（0〜6）の上段＝ 2j 枚目・下段＝ 2j+1 枚目
//   山 0・1（4 枚）＝嶺上牌（段階3のカンで引く）
//   山 2〜6 の上段＝ドラ表示牌（1 枚目・カンのたびに 2〜5 枚目）／同じ山の下段＝裏ドラ表示牌
// 表示牌は王牌に置いたまま見せるだけ（山の残り枚数は減らない）。

import type { Rules } from './rules';
import { isRed, kindOf, type KindId, type TileId } from './tiles';

const DEAD_WALL = 14;
/** ドラ表示牌は最大 5 枚（最初の 1 枚＋カン 4 回） */
export const MAX_INDICATORS = 5;

/** n 枚目（0 から）のドラ表示牌が、山の並びの何番目か（wallSize＝山の枚数）。
 *  オンラインでは山の並びを誰も知らないので、位置で指して鍵を集めてから開ける（段階5の3） */
export function doraIndicatorPos(wallSize: number, n: number): number {
  if (n < 0 || n >= MAX_INDICATORS) throw new Error(`ドラ表示牌は 5 枚まで（${n}）`);
  return wallSize - DEAD_WALL + 4 + 2 * n;
}

/** n 枚目（0 から）の裏ドラ表示牌が、山の並びの何番目か（ドラ表示牌の真下） */
export function uraIndicatorPos(wallSize: number, n: number): number {
  if (n < 0 || n >= MAX_INDICATORS) throw new Error(`裏ドラ表示牌は 5 枚まで（${n}）`);
  return wallSize - DEAD_WALL + 5 + 2 * n;
}

/** n 枚目（0 から）のドラ表示牌の背番号 */
export function doraIndicatorAt(wall: readonly TileId[], n: number): TileId {
  return wall[doraIndicatorPos(wall.length, n)];
}

/** n 枚目（0 から）の裏ドラ表示牌の背番号（ドラ表示牌の真下） */
export function uraIndicatorAt(wall: readonly TileId[], n: number): TileId {
  return wall[uraIndicatorPos(wall.length, n)];
}

/** 表示牌の次の牌＝ドラ。数牌は 9 の次が 1、風牌は東南西北東、三元牌は白發中白 */
export function doraOf(indicator: KindId): KindId {
  if (indicator < 27) return indicator - (indicator % 9) + ((indicator % 9) + 1) % 9;
  if (indicator < 31) return 27 + ((indicator - 27 + 1) % 4);
  if (indicator < 34) return 31 + ((indicator - 31 + 1) % 3);
  throw new Error(`花牌はドラ表示牌にならない（${indicator}）`);
}

export interface DoraCount {
  dora: number;
  aka: number;
  ura: number;
}

/**
 * アガった手（鳴いた面子の牌も含む全部の背番号）のドラの数。
 * indicators＝めくられたドラ表示牌（カンドラも含む）／ura＝めくった裏ドラ表示牌（リーチでアガったときだけ渡す）。
 * ルールの値：カンドラ「なし」なら 1 枚目だけ／裏ドラ「なし」なら裏は数えない／赤ドラは tiles.ts の isRed。
 */
export function countDora(tiles: readonly TileId[], indicators: readonly TileId[], ura: readonly TileId[], rules: Rules): DoraCount {
  if (rules.family !== 'jp') return { dora: 0, aka: 0, ura: 0 };
  const v = rules.values;
  const omote = v.kandora === 'on' ? indicators : indicators.slice(0, 1);
  const urahyo = v.ura === 'on' ? (v.kandora === 'on' ? ura : ura.slice(0, 1)) : [];
  const count = (ind: readonly TileId[]) => {
    const targets = ind.map((t) => doraOf(kindOf(t)));
    let n = 0;
    for (const t of tiles) {
      const k = kindOf(t);
      for (const d of targets) if (d === k) n++;
    }
    return n;
  };
  return { dora: count(omote), aka: tiles.filter((t) => isRed(t, rules)).length, ura: count(urahyo) };
}
