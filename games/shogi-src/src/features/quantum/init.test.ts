import { describe, it, expect } from 'vitest';
import { initPosition } from '../../core/engine/position/init';
import { hondou } from '../../core/engine/mgf/loader';
import { quantumInit } from './init';

describe('features/quantum/init (Phase 5-2 / Phase 5-6.5 移行後)', () => {
  it('本将棋モードでは candidates/confirmed は undefined', () => {
    const pos = initPosition(hondou);
    for (const row of pos.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates).toBeUndefined();
        expect(cell.confirmed).toBeUndefined();
      }
    }
  });

  it('quantumInit で各駒に candidates が付き confirmed=false になる', () => {
    const pos = quantumInit(initPosition(hondou));
    let count = 0;
    for (const row of pos.board) {
      for (const cell of row) {
        if (!cell) continue;
        count++;
        expect(cell.candidates).toBeDefined();
        expect(cell.confirmed).toBe(false);
        // Phase 5-6.5: 候補は「自陣営の全 PieceID 集合」= 20 個
        expect(cell.candidates!.size).toBe(20);
        // 自分自身の PieceID は候補に含まれる (自明)
        expect(cell.candidates!.has(cell.pieceId)).toBe(true);
      }
    }
    // 本将棋の初期配置は 40 駒 (両側 20 ずつ)
    expect(count).toBe(40);
  });

  it('quantumInit は元の Position を破壊しない', () => {
    const orig = initPosition(hondou);
    const first = orig.board[0][0];
    quantumInit(orig);
    expect(orig.board[0][0]).toBe(first);
    expect(orig.board[0][0]?.candidates).toBeUndefined();
  });

  it('自陣営と相手陣営で候補集合は独立に構築される', () => {
    const pos = quantumInit(initPosition(hondou));
    const p1Cells: string[] = [];
    const p2Cells: string[] = [];
    for (const row of pos.board) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.owner === 'player1') p1Cells.push(cell.kind);
        else p2Cells.push(cell.kind);
      }
    }
    expect(p1Cells).toHaveLength(20);
    expect(p2Cells).toHaveLength(20);

    // Phase 5-6.5: sente 駒の候補には gote PieceID は含まれない (独立)
    const sample1 = pos.board[8][4]; // 先手王 P16
    const sample2 = pos.board[0][4]; // 後手王 p16
    expect(sample1?.candidates).toBeDefined();
    expect(sample2?.candidates).toBeDefined();
    for (const pid of sample1!.candidates!) {
      // sente PieceID は 'P' で始まる
      expect(pid.startsWith('P')).toBe(true);
    }
    for (const pid of sample2!.candidates!) {
      // gote PieceID は 'p' で始まる
      expect(pid.startsWith('p')).toBe(true);
    }
  });
});
