import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';

describe('initPosition (hondou)', () => {
  it('creates 9x9 board', () => {
    const pos = initPosition(hondou);
    expect(pos.width).toBe(9);
    expect(pos.height).toBe(9);
    expect(pos.board).toHaveLength(9);
    expect(pos.board[0]).toHaveLength(9);
  });

  it('has 40 pieces on board and 0 in hand at initial', () => {
    const pos = initPosition(hondou);
    let count = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (pos.board[r][c]) count++;
      }
    }
    expect(count).toBe(40);
    expect(pos.hands.player1).toHaveLength(0);
    expect(pos.hands.player2).toHaveLength(0);
  });

  it('sideToMove is player1 (sente) and moveNumber is 1', () => {
    const pos = initPosition(hondou);
    expect(pos.sideToMove).toBe('player1');
    expect(pos.moveNumber).toBe(1);
    expect(pos.history).toHaveLength(0);
  });

  it('places 王 at 5一 (player2) and 5九 (player1)', () => {
    const pos = initPosition(hondou);
    expect(pos.board[0][4]?.kind).toBe('ou');
    expect(pos.board[0][4]?.owner).toBe('player2');
    expect(pos.board[8][4]?.kind).toBe('ou');
    expect(pos.board[8][4]?.owner).toBe('player1');
  });

  it('places 香 at four corners', () => {
    const pos = initPosition(hondou);
    expect(pos.board[0][0]?.kind).toBe('kyo');
    expect(pos.board[0][0]?.owner).toBe('player2');
    expect(pos.board[0][8]?.kind).toBe('kyo');
    expect(pos.board[8][0]?.kind).toBe('kyo');
    expect(pos.board[8][0]?.owner).toBe('player1');
    expect(pos.board[8][8]?.kind).toBe('kyo');
  });

  it('assigns PieceIDs: P0..P19 for player1, p0..p19 for player2', () => {
    const pos = initPosition(hondou);
    const p1Ids: string[] = [];
    const p2Ids: string[] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const p = pos.board[r][c];
        if (!p) continue;
        if (p.owner === 'player1') p1Ids.push(p.pieceId);
        else p2Ids.push(p.pieceId);
      }
    }
    expect(p1Ids).toHaveLength(20);
    expect(p2Ids).toHaveLength(20);
    expect(new Set(p1Ids).size).toBe(20);
    expect(new Set(p2Ids).size).toBe(20);
    expect(p1Ids.every((id) => /^P\d+$/.test(id))).toBe(true);
    expect(p2Ids.every((id) => /^p\d+$/.test(id))).toBe(true);
  });

  it('places 9 sente 歩 in row 6 and 9 gote 歩 in row 2', () => {
    const pos = initPosition(hondou);
    for (let c = 0; c < 9; c++) {
      expect(pos.board[6][c]?.kind).toBe('fu');
      expect(pos.board[6][c]?.owner).toBe('player1');
      expect(pos.board[2][c]?.kind).toBe('fu');
      expect(pos.board[2][c]?.owner).toBe('player2');
    }
  });

  it('places sente 飛 at 27 (row 7 col 7) and 角 at 88 (row 7 col 1)', () => {
    const pos = initPosition(hondou);
    expect(pos.board[7][7]?.kind).toBe('hi');
    expect(pos.board[7][7]?.owner).toBe('player1');
    expect(pos.board[7][1]?.kind).toBe('kaku');
    expect(pos.board[7][1]?.owner).toBe('player1');
  });
});
