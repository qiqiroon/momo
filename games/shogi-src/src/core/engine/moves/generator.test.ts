import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { Position, Square } from '../position/types';
import { generateAllBoardMoves, generatePieceMoves } from './generator';

describe('generatePieceMoves (initial hondou position)', () => {
  const pos: Position = initPosition(hondou);

  it('sente 歩 at 77 (row6col2) has 1 forward move to 76', () => {
    const from: Square = { row: 6, col: 2 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 5, col: 2 });
    expect(moves[0].promote).toBe(false);
  });

  it('sente 香 at 99 (row8col0) has 1 forward move to 98', () => {
    const from: Square = { row: 8, col: 0 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 7, col: 0 });
  });

  it('sente 桂 at 89 (row8col1) has 0 moves at initial (own pieces block)', () => {
    const from: Square = { row: 8, col: 1 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });

  it('sente 角 at 88 (row7col1) has 0 moves at initial (all diagonals blocked)', () => {
    const from: Square = { row: 7, col: 1 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });

  it('sente 飛 at 28 (row7col7) has 6 sideways moves', () => {
    const from: Square = { row: 7, col: 7 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(6);
  });

  it('sente 王 at 59 (row8col4) has 3 moves at initial (to 68/58/48)', () => {
    const from: Square = { row: 8, col: 4 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(3);
  });

  it('sente 銀 at 79 (row8col6) has 2 moves at initial', () => {
    const from: Square = { row: 8, col: 6 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(2);
  });

  it('sente 金 at 69 (row8col3) has 3 moves at initial', () => {
    const from: Square = { row: 8, col: 3 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(3);
  });

  it('does not generate moves for opponent (gote) pieces on sente turn', () => {
    const from: Square = { row: 0, col: 4 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });
});

describe('generateAllBoardMoves (initial hondou position)', () => {
  it('sente has exactly 30 pseudo-legal moves at initial (matches known count)', () => {
    // 9歩×1 + 2香×1 + 0桂 + 2銀×2 + 2金×3 + 0角 + 1飛×6 + 1王×3
    // = 9 + 2 + 0 + 4 + 6 + 0 + 6 + 3 = 30
    const pos: Position = initPosition(hondou);
    const moves = generateAllBoardMoves(hondou, pos);
    expect(moves).toHaveLength(30);
  });

  it('gote also has 30 pseudo-legal moves (symmetric)', () => {
    const pos: Position = initPosition(hondou);
    const goteTurn: Position = { ...pos, sideToMove: 'player2' };
    const moves = generateAllBoardMoves(hondou, goteTurn);
    expect(moves).toHaveLength(30);
  });
});
