// 牌の背番号と表。
// 背番号は、どのルールでも使いうる最大の 144 枚ぶん（数牌 108＋字牌 28＋花牌 8）を固定で振る。
// どの牌を使うかはルールで選ぶ（日本式 136・四川 108・国標 144・香港 136 など）。
//
// 背番号の並び：
//   0〜135   種類 0〜33 の各 4 枚（背番号 = 種類 × 4 ＋ 何枚目）
//   136〜143 花牌 8 種の各 1 枚（春夏秋冬梅蘭菊竹）

import type { Rules } from './rules';

export type TileId = number;
/** 種類の番号。0〜8 萬子／9〜17 筒子／18〜26 索子／27〜33 字牌／34〜41 花牌 */
export type KindId = number;

export const MAX_TILES = 144;
export const KIND_COUNT = 42;

const SUIT_LETTERS = ['m', 'p', 's'] as const;
const FLOWER_CODES = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'] as const;

/** 種類ごとの短い名前。数牌は「5m」、字牌は「1z〜7z（東南西北白發中）」、花牌は「f1〜f8（春夏秋冬梅蘭菊竹）」 */
export const KIND_CODES: readonly string[] = [
  ...SUIT_LETTERS.flatMap((s) => Array.from({ length: 9 }, (_, i) => `${i + 1}${s}`)),
  ...Array.from({ length: 7 }, (_, i) => `${i + 1}z`),
  ...FLOWER_CODES,
];

export function kindOf(id: TileId): KindId {
  if (id < 0 || id >= MAX_TILES || !Number.isInteger(id)) throw new Error(`背番号が範囲外: ${id}`);
  return id < 136 ? Math.floor(id / 4) : 34 + (id - 136);
}

export function codeOf(id: TileId): string {
  return KIND_CODES[kindOf(id)];
}

export const isSuit = (k: KindId) => k < 27;
export const isHonor = (k: KindId) => k >= 27 && k < 34;
export const isFlower = (k: KindId) => k >= 34;

/** 赤5になりうる背番号（5萬・5筒・5索の 1 枚目）。赤にするかはルールで決まる */
const RED_CANDIDATES: ReadonlySet<TileId> = new Set([4 * 4, 13 * 4, 22 * 4]);

export function isRed(id: TileId, rules: Rules): boolean {
  return rules.family === 'jp' && rules.values.aka === 'on' && RED_CANDIDATES.has(id);
}

/** そのルールで使う牌の背番号を、背番号の小さい順に返す */
export function tileSetFor(rules: Rules): TileId[] {
  const useHonors = rules.family === 'jp' || rules.values.honors === 'on';
  const useFlowers = rules.family === 'cn' && rules.values.flower === 'on';
  const ids: TileId[] = [];
  for (let id = 0; id < MAX_TILES; id++) {
    const k = kindOf(id);
    if (isHonor(k) && !useHonors) continue;
    if (isFlower(k) && !useFlowers) continue;
    ids.push(id);
  }
  return ids;
}
