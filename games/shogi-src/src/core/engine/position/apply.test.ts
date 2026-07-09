import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';
import { applyMove } from './apply';
import type { BoardMove, DropMove } from './types';

describe('applyMove (board move)', () => {
  it('sente 76歩: piece moves and turn advances', () => {
    const pos = initPosition(hondou);
    const move: BoardMove = {
      type: 'move',
      pieceId: pos.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    };
    const next = applyMove(hondou, pos, move);
    expect(next.board[6][2]).toBeNull();
    expect(next.board[5][2]?.kind).toBe('fu');
    expect(next.board[5][2]?.owner).toBe('player1');
    expect(next.sideToMove).toBe('player2');
    expect(next.moveNumber).toBe(2);
    expect(next.history).toHaveLength(1);
  });

  it('captured piece goes to hand (owner switches to mover)', () => {
    let pos = initPosition(hondou);
    // 24歩 sequence: sente 76 → gote 34 → sente 25 → gote 44歩 → sente 24歩→gote 24歩
    // Simpler: forcibly place a gote 歩 at row 5 col 2, then capture
    const goteFuId = pos.board[2][2]!.pieceId;
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[5][2] = { ...pos.board[2][2]!, pieceId: goteFuId };
    newBoard[2][2] = null;
    pos = { ...pos, board: newBoard };
    const move: BoardMove = {
      type: 'move',
      pieceId: pos.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
      capturedPieceId: goteFuId,
    };
    const next = applyMove(hondou, pos, move);
    expect(next.board[5][2]?.kind).toBe('fu');
    expect(next.board[5][2]?.owner).toBe('player1');
    expect(next.hands.player1).toHaveLength(1);
    expect(next.hands.player1[0].pieceId).toBe(goteFuId);
    expect(next.hands.player1[0].owner).toBe('player1');
    expect(next.hands.player1[0].initialOwner).toBe('player2');
    expect(next.hands.player1[0].kind).toBe('fu');
  });

  it('captured promoted piece is demoted to base kind in hand', () => {
    let pos = initPosition(hondou);
    // Replace board[5][2] with a gote と (promoted 歩)
    const goteFuId = pos.board[2][2]!.pieceId;
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[5][2] = {
      pieceId: goteFuId,
      kind: 'to',
      owner: 'player2',
      initialOwner: 'player2',
      promoted: true,
    };
    newBoard[2][2] = null;
    pos = { ...pos, board: newBoard };
    const move: BoardMove = {
      type: 'move',
      pieceId: pos.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
      capturedPieceId: goteFuId,
    };
    const next = applyMove(hondou, pos, move);
    expect(next.hands.player1[0].kind).toBe('fu');
    expect(next.hands.player1[0].promoted).toBe(false);
  });

  it('promote=true converts fu to to', () => {
    let pos = initPosition(hondou);
    // Place sente 歩 at row 1 col 2 (about to reach rank 1)
    const senteFuId = pos.board[6][2]!.pieceId;
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[1][2] = { ...pos.board[6][2]! };
    newBoard[6][2] = null;
    pos = { ...pos, board: newBoard };
    const move: BoardMove = {
      type: 'move',
      pieceId: senteFuId,
      from: { row: 1, col: 2 },
      to: { row: 0, col: 2 },
      promote: true,
    };
    const next = applyMove(hondou, pos, move);
    expect(next.board[0][2]?.kind).toBe('to');
    expect(next.board[0][2]?.promoted).toBe(true);
  });
});

describe('applyMove (drop)', () => {
  it('drops a piece from hand onto empty square', () => {
    const pos = initPosition(hondou);
    const dropId = 'H_test';
    // Put a fu in hand manually
    const withHand = {
      ...pos,
      hands: {
        player1: [
          {
            pieceId: dropId,
            kind: 'fu',
            owner: 'player1' as const,
            initialOwner: 'player2' as const,
            promoted: false,
          },
        ],
        player2: [],
      },
    };
    const move: DropMove = { type: 'drop', pieceId: dropId, to: { row: 4, col: 4 } };
    const next = applyMove(hondou, withHand, move);
    expect(next.board[4][4]?.pieceId).toBe(dropId);
    expect(next.board[4][4]?.owner).toBe('player1');
    expect(next.hands.player1).toHaveLength(0);
    expect(next.sideToMove).toBe('player2');
  });
});
