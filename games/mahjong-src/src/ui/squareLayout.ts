// 正方形の卓（広い画面）の大きさの決め方。値は卓の 1 辺に対する %（cqw）。
// 見本 L:\momo\games\mahjong\mock\table-layout.html で重ならないことを確かめた値（2026-10-07）。
//
// - 河：中央の四角の左の辺から 1 行 9 枚×3 行。28 枚目からは 3 行目だけ右へ伸ばす（29 枚まで重ならない）
// - 手牌の列（手牌＋鳴いた面子）は全部同じ大きさ。ふだんは基本の大きさ、列が長くなったら置ける幅に収まるまで列ごと縮める
// - 河は、いちばん小さい手牌の列より大きくしない
// - 4 人とも「左端を決めて右へ伸ばす」ので、角で隣の人とぶつからない

export const RIVER_BASE = 4.1;
export const RIVER_PER_ROW = 9;

/** 自分（手前）と、ほかの 3 人の手牌の列 */
export const HAND_ROW = {
  me: { base: 5.4, room: 84 },
  other: { base: 4.1, room: 77 },
} as const;

/** ツモ牌の前の隙間（牌何枚ぶんか） */
export const DRAWN_GAP = 0.45;

/** 鳴いた面子 1 組の長さ（チー・ポン＝牌 2 枚＋横に曲げた牌 1 枚＝縦の長さ 1.36 枚ぶん） */
export const MELD_UNITS = 3.36;
/** 手牌と鳴いた面子の間・面子どうしの間（牌何枚ぶんか） */
export const MELD_GAP = 0.3;

/** 面子の種類ごとの長さ。大明槓＝3 枚＋曲げた 1 枚／加槓＝2 枚＋曲げた 2 枚（鳴いた牌の隣に足した牌も曲げる）／暗槓＝4 枚（両端を伏せる） */
export function meldUnits(type: string): number {
  if (type === 'minkan') return 4.36;
  if (type === 'kakan') return 4.72;
  if (type === 'ankan') return 4;
  return MELD_UNITS;
}

/** 手牌の列の長さ（基本の大きさの牌で何枚ぶんか）。鳴いた面子も足す */
export function handRowUnits(tiles: number, drawnGap: boolean, melds: readonly { type: string }[] = []): number {
  return tiles + (drawnGap ? DRAWN_GAP : 0) + melds.reduce((n, m) => n + meldUnits(m.type) + MELD_GAP, 0);
}

/** 手牌の列の牌の幅：基本の大きさを超えず、置ける幅に収まる */
export function handTileWidth(units: number, row: { base: number; room: number }): number {
  return units <= 0 ? row.base : Math.min(row.base, row.room / units);
}

/** 河の牌の幅：基本の大きさを超えず、いちばん小さい手牌の列より大きくしない */
export function riverTileWidth(handWidths: readonly number[]): number {
  return Math.min(RIVER_BASE, ...handWidths);
}

/** 河を 3 行に分ける（3 行目は残り全部） */
export function riverRows<T>(tiles: readonly T[]): T[][] {
  return [tiles.slice(0, RIVER_PER_ROW), tiles.slice(RIVER_PER_ROW, RIVER_PER_ROW * 2), tiles.slice(RIVER_PER_ROW * 2)].filter(
    (r) => r.length > 0,
  );
}
