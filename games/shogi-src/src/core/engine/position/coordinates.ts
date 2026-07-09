import type { Square } from './types';
import type { Player } from '../mgf/types';

/**
 * Shogi 座標（筋段, 1-indexed, 筋 x=1 が最右）と内部座標（row, col, 0-indexed）の変換。
 *
 * 内部座標: board[row][col]
 *   row 0 = 段1 (player2 の最奥・盤上端)
 *   row height-1 = 段 height (player1 の最奥・盤下端)
 *   col 0 = 筋 width (盤左端・player1 視点)
 *   col width-1 = 筋 1 (盤右端・player1 視点)
 *
 * Shogi 標準: 51 = 筋5, 段1 (盤上端の中央)
 */
export function shogiToInternal(x: number, y: number, width: number): Square {
  return { row: y - 1, col: width - x };
}

export function internalToShogi(sq: Square, width: number): { x: number; y: number } {
  return { x: width - sq.col, y: sq.row + 1 };
}

/** 段 (rank, 1-indexed from top / player2's back). Universal for both players. */
export function rankFromRow(row: number): number {
  return row + 1;
}

export function isInPromotionZone(
  row: number,
  zoneMinRank: number,
  zoneMaxRank: number,
): boolean {
  const rank = rankFromRow(row);
  return rank >= zoneMinRank && rank <= zoneMaxRank;
}

/** 自陣視点で敵最奥からの段数 (must_promote_at 判定用)。 */
export function distanceFromEnemyBack(row: number, height: number, player: Player): number {
  const rank = rankFromRow(row);
  const enemyBackRank = player === 'player1' ? 1 : height;
  return Math.abs(rank - enemyBackRank);
}
