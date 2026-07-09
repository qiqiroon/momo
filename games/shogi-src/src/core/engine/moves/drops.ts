import type { Mgf } from '../mgf/types';
import type { DropMove, Position } from '../position/types';

/**
 * 現手番の持ち駒から可能な打つ手 (擬合法) を全て生成する。
 * nifu / uchifu_tsume / dead_zone / suicide の除外は generateLegalMoves 側で行う。
 */
export function generateDropMoves(mgf: Mgf, position: Position): DropMove[] {
  const player = position.sideToMove;
  const hand = position.hands[player];
  const moves: DropMove[] = [];
  const seenKinds = new Set<string>();

  for (const piece of hand) {
    if (seenKinds.has(piece.kind)) continue;
    seenKinds.add(piece.kind);
    const def = mgf.pieces.find((p) => p.id === piece.kind);
    if (!def?.is_hand_piece) continue;

    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        if (position.board[row][col]) continue;
        moves.push({ type: 'drop', pieceId: piece.pieceId, to: { row, col } });
      }
    }
  }
  return moves;
}
