import type { Mgf, Player } from '../mgf/types';
import type { Position } from '../position/types';
import { findKing, isInCheck } from '../moves/check';

const MAJOR_KINDS = new Set(['kaku', 'hi', 'uma', 'ryu']);
const HAND_MAJOR_KINDS = new Set(['kaku', 'hi']);
const REQUIRED_PIECE_COUNT = 10;

/**
 * 敵陣内の自駒 + 持ち駒の合計点数を計算する (24点法・27点法共通)。
 * 大駒 (角・飛・馬・龍) = 5点、小駒 = 1点、王・玉は数えない。
 */
export function computeEnterZonePoints(mgf: Mgf, position: Position, player: Player): number {
  const zone = mgf.board.promotion_zone?.[player];
  if (!zone) return 0;
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));

  let points = 0;
  for (let row = 0; row < position.height; row++) {
    const rank = row + 1;
    if (rank < zone.min_rank || rank > zone.max_rank) continue;
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== player) continue;
      if (royalKinds.has(cell.kind)) continue;
      points += MAJOR_KINDS.has(cell.kind) ? 5 : 1;
    }
  }
  for (const hand of position.hands[player]) {
    points += HAND_MAJOR_KINDS.has(hand.kind) ? 5 : 1;
  }
  return points;
}

/**
 * 敵陣内の自駒枚数を計算する (玉を除く)。24点法・27点法とも「10枚以上」が必須条件。
 */
export function countEnterZonePieces(mgf: Mgf, position: Position, player: Player): number {
  const zone = mgf.board.promotion_zone?.[player];
  if (!zone) return 0;
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));

  let count = 0;
  for (let row = 0; row < position.height; row++) {
    const rank = row + 1;
    if (rank < zone.min_rank || rank > zone.max_rank) continue;
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== player) continue;
      if (royalKinds.has(cell.kind)) continue;
      count++;
    }
  }
  return count;
}

/**
 * 入玉宣言が可能か判定する (24点法):
 * 1. 自玉が敵陣 (自身の promotion_zone) に入っている
 * 2. 王手されていない
 * 3. 敵陣内自駒枚数が 10 枚以上 (玉を除く・持ち駒は含まない)
 * 4. 敵陣内自駒 + 持ち駒 の合計点数が threshold 以上
 */
export function canDeclareNyugyoku(mgf: Mgf, position: Position, player: Player): boolean {
  const ek = mgf.victory?.entering_king;
  if (!ek?.enabled) return false;
  const threshold = ek.point_threshold ?? 24;

  const kingSq = findKing(mgf, position, player);
  if (!kingSq) return false;

  const zone = mgf.board.promotion_zone?.[player];
  if (!zone) return false;
  const kingRank = kingSq.row + 1;
  if (kingRank < zone.min_rank || kingRank > zone.max_rank) return false;

  if (isInCheck(mgf, position, player)) return false;

  if (countEnterZonePieces(mgf, position, player) < REQUIRED_PIECE_COUNT) return false;

  return computeEnterZonePoints(mgf, position, player) >= threshold;
}
