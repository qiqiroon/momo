import type { Mgf, Player } from '../mgf/types';
import type { BoardCell, PieceInstance, Position } from './types';

const SFEN_LETTER_TO_KIND: Record<string, string> = {
  p: 'fu',
  l: 'kyo',
  n: 'kei',
  s: 'gin',
  g: 'kin',
  b: 'kaku',
  r: 'hi',
  k: 'ou',
};

export function initPosition(mgf: Mgf): Position {
  const { width, height } = mgf.board;
  const board: BoardCell[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => null as BoardCell),
  );
  const placement = mgf.initial_placement;
  if (placement.format !== 'sfen' || !placement.sfen) {
    throw new Error('Phase 1-2 supports SFEN placement only');
  }

  const [boardStr, sideStr] = placement.sfen.split(/\s+/);
  const ranks = boardStr.split('/');
  if (ranks.length !== height) {
    throw new Error(`SFEN rank count ${ranks.length} does not match board height ${height}`);
  }

  const player1Pieces: PieceInstance[] = [];
  const player2Pieces: PieceInstance[] = [];

  for (let row = 0; row < height; row++) {
    let col = 0;
    let i = 0;
    const rankStr = ranks[row];
    while (i < rankStr.length && col < width) {
      let ch = rankStr[i];
      let promoted = false;
      if (ch === '+') {
        promoted = true;
        i++;
        ch = rankStr[i];
      }
      if (/[0-9]/.test(ch)) {
        col += Number.parseInt(ch, 10);
        i++;
        continue;
      }
      const isUpperCase = ch === ch.toUpperCase();
      const owner: Player = isUpperCase ? 'player1' : 'player2';
      const letter = ch.toLowerCase();
      const baseKind = SFEN_LETTER_TO_KIND[letter];
      if (!baseKind) throw new Error(`Unknown SFEN piece letter: ${ch}`);
      const kind = promoted ? getPromotedId(mgf, baseKind) : baseKind;
      const piece: PieceInstance = {
        pieceId: '',
        kind,
        owner,
        initialOwner: owner,
        initialKind: kind,
        initialSquare: { row, col },
        promoted,
      };
      board[row][col] = piece;
      if (owner === 'player1') player1Pieces.push(piece);
      else player2Pieces.push(piece);
      col++;
      i++;
    }
  }

  player1Pieces.forEach((p, idx) => {
    p.pieceId = `P${idx}`;
  });
  player2Pieces.forEach((p, idx) => {
    p.pieceId = `p${idx}`;
  });

  const sideToMove: Player = sideStr === 'w' ? 'player2' : 'player1';

  return {
    width,
    height,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

function getPromotedId(mgf: Mgf, baseId: string): string {
  const def = mgf.pieces.find((p) => p.id === baseId);
  if (!def?.promoted_id) throw new Error(`No promoted_id defined for ${baseId}`);
  return def.promoted_id;
}
