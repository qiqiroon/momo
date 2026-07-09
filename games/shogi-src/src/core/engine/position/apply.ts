import type { Mgf } from '../mgf/types';
import type { BoardCell, Move, PieceInstance, Position } from './types';

/**
 * Position に Move を適用して新しい Position を返す (immutable)。
 * 合法性チェックは行わない (呼び出し側の責務)。
 */
export function applyMove(mgf: Mgf, position: Position, move: Move): Position {
  const newBoard: BoardCell[][] = position.board.map((row) => row.slice());
  const newHands = {
    player1: position.hands.player1.slice(),
    player2: position.hands.player2.slice(),
  };

  if (move.type === 'move') {
    const piece = newBoard[move.from.row][move.from.col];
    if (!piece) throw new Error(`No piece at from (${move.from.row}, ${move.from.col})`);
    if (piece.pieceId !== move.pieceId) {
      throw new Error(`Piece ID mismatch at from: expected ${move.pieceId}, got ${piece.pieceId}`);
    }

    const captured = newBoard[move.to.row][move.to.col];
    if (captured) {
      const handPiece: PieceInstance = {
        pieceId: captured.pieceId,
        kind: captured.promoted ? getUnpromotedKind(mgf, captured.kind) : captured.kind,
        owner: piece.owner,
        initialOwner: captured.initialOwner,
        promoted: false,
      };
      newHands[piece.owner].push(handPiece);
    }

    let newKind = piece.kind;
    let newPromoted = piece.promoted;
    if (move.promote && !piece.promoted) {
      const def = mgf.pieces.find((p) => p.id === piece.kind);
      if (def?.promoted_id) {
        newKind = def.promoted_id;
        newPromoted = true;
      }
    }
    newBoard[move.from.row][move.from.col] = null;
    newBoard[move.to.row][move.to.col] = {
      ...piece,
      kind: newKind,
      promoted: newPromoted,
    };
  } else {
    const player = position.sideToMove;
    const handIdx = newHands[player].findIndex((p) => p.pieceId === move.pieceId);
    if (handIdx < 0) throw new Error(`Piece ${move.pieceId} not in hand for ${player}`);
    if (newBoard[move.to.row][move.to.col]) {
      throw new Error(`Drop target (${move.to.row}, ${move.to.col}) is occupied`);
    }
    const dropped = newHands[player][handIdx];
    newHands[player].splice(handIdx, 1);
    newBoard[move.to.row][move.to.col] = { ...dropped };
  }

  return {
    ...position,
    board: newBoard,
    hands: newHands,
    sideToMove: position.sideToMove === 'player1' ? 'player2' : 'player1',
    moveNumber: position.moveNumber + 1,
    history: [...position.history, move],
  };
}

function getUnpromotedKind(mgf: Mgf, kind: string): string {
  const base = mgf.pieces.find((p) => p.promoted_id === kind);
  return base ? base.id : kind;
}
