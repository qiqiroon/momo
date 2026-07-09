import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { PieceInstance, Position } from '../position/types';
import { canDeclareNyugyoku, computeEnterZonePoints } from './nyugyoku';

function buildPos(pieces: Array<{ row: number; col: number; piece: PieceInstance }>, sideToMove: 'player1' | 'player2' = 'player1'): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const { row, col, piece } of pieces) board[row][col] = piece;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

const P = (kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance => ({
  pieceId: `${owner}_${kind}`,
  kind,
  owner,
  initialOwner: owner,
  promoted,
});

describe('computeEnterZonePoints', () => {
  it('initial position: 0 points for both (no piece in enemy zone yet)', () => {
    const pos = initPosition(hondou);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(0);
    expect(computeEnterZonePoints(hondou, pos, 'player2')).toBe(0);
  });

  it('sente 飛 at row 2 (rank 3): 5 points', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
    ]);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(5);
  });

  it('does not count 王 in enemy zone', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
    ]);
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(0);
  });

  it('counts hand pieces: 大駒 5点、小駒 1点', () => {
    let pos = buildPos([{ row: 8, col: 4, piece: P('ou', 'player1') }]);
    pos = {
      ...pos,
      hands: {
        player1: [
          P('hi', 'player1'),
          P('kaku', 'player1'),
          P('fu', 'player1'),
          P('fu', 'player1'),
        ],
        player2: [],
      },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBe(5 + 5 + 1 + 1);
  });
});

describe('canDeclareNyugyoku', () => {
  it('initial position: cannot declare (king not in enemy zone)', () => {
    const pos = initPosition(hondou);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
    expect(canDeclareNyugyoku(hondou, pos, 'player2')).toBe(false);
  });

  it('sente 王 in enemy zone + 24 points: declares', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 0, piece: P('hi', 'player1') },
      { row: 2, col: 1, piece: P('kaku', 'player1') },
      { row: 2, col: 2, piece: P('kin', 'player1') },
      { row: 2, col: 3, piece: P('gin', 'player1') },
      { row: 2, col: 5, piece: P('gin', 'player1') },
      { row: 2, col: 6, piece: P('kin', 'player1') },
      { row: 2, col: 7, piece: P('kei', 'player1') },
      { row: 2, col: 8, piece: P('kyo', 'player1') },
      { row: 1, col: 0, piece: P('fu', 'player1') },
      { row: 1, col: 1, piece: P('fu', 'player1') },
      { row: 1, col: 2, piece: P('fu', 'player1') },
      { row: 1, col: 3, piece: P('fu', 'player1') },
      { row: 1, col: 5, piece: P('fu', 'player1') },
      { row: 1, col: 6, piece: P('fu', 'player1') },
    ]);
    // Points: 飛5 + 角5 + 金1 + 銀1 + 銀1 + 金1 + 桂1 + 香1 + 歩1 × 6 = 22. Not yet 24.
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(20);
    // Add more to reach 24
    pos = {
      ...pos,
      hands: { player1: [P('kaku', 'player1')], player2: [] },
    };
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThanOrEqual(24);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(true);
  });

  it('king in enemy zone but only 10 points: cannot declare', () => {
    const pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
    ]);
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });

  it('king in enemy zone + high points but in check: cannot declare', () => {
    let pos = buildPos([
      { row: 0, col: 4, piece: P('ou', 'player1') },
      { row: 2, col: 5, piece: P('hi', 'player1') },
      { row: 2, col: 4, piece: P('hi', 'player2') }, // 王手 (gote 飛 attacks king via col 4)
    ]);
    pos = {
      ...pos,
      hands: {
        player1: Array.from({ length: 20 }, () => P('fu', 'player1', false)),
        player2: [],
      },
    };
    // Points would be way over 24
    expect(computeEnterZonePoints(hondou, pos, 'player1')).toBeGreaterThan(24);
    // But in check → cannot declare
    expect(canDeclareNyugyoku(hondou, pos, 'player1')).toBe(false);
  });
});
