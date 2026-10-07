// 牌の背番号から絵のファイルを選ぶ。絵は public/tiles/ の SVG を <img> で読む
// （SVG は各ファイルが同じクラス名で色違いなので、画面に直接埋め込むと色が混ざる）。

import { HIDDEN } from '../engine/events';
import { isRed, kindOf, type TileId } from '../engine/tiles';
import type { Rules } from '../engine/rules';

const FLOWER_FILES = ['chun', 'xia', 'qiu', 'dong', 'mei', 'lan', 'ju', 'zu'];
const SUITS = ['m', 'p', 's'];

export function tileFile(id: TileId, rules: Rules | null): string {
  if (id === HIDDEN) return 'back';
  const k = kindOf(id);
  if (k < 27) return rules && isRed(id, rules) ? `0${SUITS[Math.floor(k / 9)]}` : `${(k % 9) + 1}${SUITS[Math.floor(k / 9)]}`;
  if (k < 34) return `${k - 26}z`;
  return FLOWER_FILES[k - 34];
}

export function tileUrl(id: TileId, rules: Rules | null): string {
  return `${import.meta.env.BASE_URL}tiles/${tileFile(id, rules)}.svg`;
}
