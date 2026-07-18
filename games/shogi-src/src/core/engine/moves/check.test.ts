import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { PieceInstance, Position } from '../position/types';
import { findKing, isInCheck, isSquareAttackedBy } from './check';

function emptyBoard(): (PieceInstance | null)[][] {
  return Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
}

function buildPos(pieces: Array<{ row: number; col: number; piece: PieceInstance }>): Position {
  const board = emptyBoard();
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

describe('findKing', () => {
  it('locates both kings in initial position', () => {
    const pos = initPosition(hondou);
    expect(findKing(hondou, pos, 'player1')).toEqual({ row: 8, col: 4 });
    expect(findKing(hondou, pos, 'player2')).toEqual({ row: 0, col: 4 });
  });
});

describe('isInCheck', () => {
  it('initial position: no player is in check', () => {
    const pos = initPosition(hondou);
    expect(isInCheck(hondou, pos, 'player1')).toBe(false);
    expect(isInCheck(hondou, pos, 'player2')).toBe(false);
  });

  it('sente 王 in check by gote 飛 on same file', () => {
    const pos = buildPos([
      {
        row: 8,
        col: 4,
        piece: {
          pieceId: 'K',
          kind: 'ou',
          owner: 'player1',
          initialOwner: 'player1',
          initialKind: 'ou',
          initialSquare: { row: 8, col: 4 },
          promoted: false,
        },
      },
      {
        row: 4,
        col: 4,
        piece: {
          pieceId: 'r',
          kind: 'hi',
          owner: 'player2',
          initialOwner: 'player2',
          initialKind: 'hi',
          initialSquare: { row: 4, col: 4 },
          promoted: false,
        },
      },
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(true);
  });

  it('sente 王 not in check when gote 飛 is blocked by an own piece', () => {
    const pos = buildPos([
      {
        row: 8,
        col: 4,
        piece: {
          pieceId: 'K',
          kind: 'ou',
          owner: 'player1',
          initialOwner: 'player1',
          initialKind: 'ou',
          initialSquare: { row: 8, col: 4 },
          promoted: false,
        },
      },
      {
        row: 6,
        col: 4,
        piece: {
          pieceId: 'p1',
          kind: 'fu',
          owner: 'player1',
          initialOwner: 'player1',
          initialKind: 'fu',
          initialSquare: { row: 6, col: 4 },
          promoted: false,
        },
      },
      {
        row: 4,
        col: 4,
        piece: {
          pieceId: 'r',
          kind: 'hi',
          owner: 'player2',
          initialOwner: 'player2',
          initialKind: 'hi',
          initialSquare: { row: 4, col: 4 },
          promoted: false,
        },
      },
    ]);
    expect(isInCheck(hondou, pos, 'player1')).toBe(false);
  });
});

describe('isSquareAttackedBy', () => {
  it('detects 桂 attack (jump over)', () => {
    const pos = buildPos([
      {
        row: 8,
        col: 4,
        piece: {
          pieceId: 'K',
          kind: 'ou',
          owner: 'player1',
          initialOwner: 'player1',
          initialKind: 'ou',
          initialSquare: { row: 8, col: 4 },
          promoted: false,
        },
      },
      // Gote 桂 at row 6 col 3: knight moves down-and-side for player2, so 8,4 = row+2, col+1 = attacked
      {
        row: 6,
        col: 3,
        piece: {
          pieceId: 'n',
          kind: 'kei',
          owner: 'player2',
          initialOwner: 'player2',
          initialKind: 'kei',
          initialSquare: { row: 6, col: 3 },
          promoted: false,
        },
      },
      // Blocker in between (should not affect knight)
      {
        row: 7,
        col: 4,
        piece: {
          pieceId: 'p',
          kind: 'fu',
          owner: 'player1',
          initialOwner: 'player1',
          initialKind: 'fu',
          initialSquare: { row: 7, col: 4 },
          promoted: false,
        },
      },
    ]);
    expect(isSquareAttackedBy(hondou, pos, { row: 8, col: 4 }, 'player2')).toBe(true);
  });
});
