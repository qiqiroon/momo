import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { applyMove } from '../position/apply';
import type { BoardMove, DropMove, PieceInstance } from '../position/types';
import { formatMove } from './format';

describe('formatMove', () => {
  it('▲76歩', () => {
    const pos = initPosition(hondou);
    const move: BoardMove = {
      type: 'move',
      pieceId: pos.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    };
    expect(formatMove(hondou, pos, move)).toBe('▲7六歩');
  });

  it('△34歩', () => {
    const pos0 = initPosition(hondou);
    const senteMove: BoardMove = {
      type: 'move',
      pieceId: pos0.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    };
    const pos1 = applyMove(hondou, pos0, senteMove);
    const goteMove: BoardMove = {
      type: 'move',
      pieceId: pos1.board[2][6]!.pieceId,
      from: { row: 2, col: 6 },
      to: { row: 3, col: 6 },
      promote: false,
    };
    expect(formatMove(hondou, pos1, goteMove)).toBe('△3四歩');
  });

  it('▲22角成', () => {
    let pos = initPosition(hondou);
    const senteKaku = pos.board[7][1]!;
    const newBoard = pos.board.map((r) => r.slice());
    newBoard[7][1] = null;
    newBoard[3][5] = senteKaku;
    pos = { ...pos, board: newBoard };
    const move: BoardMove = {
      type: 'move',
      pieceId: senteKaku.pieceId,
      from: { row: 3, col: 5 },
      to: { row: 1, col: 7 },
      promote: true,
    };
    expect(formatMove(hondou, pos, move)).toBe('▲2二角成');
  });

  it('▲55歩打', () => {
    let pos = initPosition(hondou);
    const droppedFu: PieceInstance = {
      pieceId: 'H1',
      kind: 'fu',
      owner: 'player1',
      initialOwner: 'player2',
      promoted: false,
    };
    pos = { ...pos, hands: { ...pos.hands, player1: [droppedFu] } };
    const move: DropMove = { type: 'drop', pieceId: 'H1', to: { row: 4, col: 4 } };
    expect(formatMove(hondou, pos, move)).toBe('▲5五歩打');
  });
});
