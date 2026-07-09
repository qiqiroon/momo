import type { Mgf, Player } from '../mgf/types';
import type { Position, Square } from '../position/types';
import { generatePieceMoves } from './generator';

export function findKing(mgf: Mgf, position: Position, player: Player): Square | null {
  const royalKinds = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (cell && royalKinds.has(cell.kind) && cell.owner === player) {
        return { row, col };
      }
    }
  }
  return null;
}

/**
 * 指定マスが player の擬合法手で捕獲可能か判定する (王手判定用)。
 * player の手番でなくても計算可能。
 */
export function isSquareAttackedBy(
  mgf: Mgf,
  position: Position,
  target: Square,
  attacker: Player,
): boolean {
  const attackerTurnPos: Position = { ...position, sideToMove: attacker };
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (!cell || cell.owner !== attacker) continue;
      const moves = generatePieceMoves(mgf, attackerTurnPos, { row, col });
      if (moves.some((m) => m.to.row === target.row && m.to.col === target.col)) {
        return true;
      }
    }
  }
  return false;
}

export function isInCheck(mgf: Mgf, position: Position, player: Player): boolean {
  const king = findKing(mgf, position, player);
  if (!king) return false;
  const opponent: Player = player === 'player1' ? 'player2' : 'player1';
  return isSquareAttackedBy(mgf, position, king, opponent);
}
