import { describe, it, expect } from 'vitest';
import { initPosition } from '../../core/engine/position/init';
import { hondou } from '../../core/engine/mgf/loader';
import { quantumInit } from './init';

describe('features/quantum/init (Phase 5-2)', () => {
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
        // 本将棋の 8 駒種 (fu/kyo/kei/gin/kin/kaku/hi/ou) がすべて候補になる
        expect(cell.candidates!.size).toBe(8);
        expect(cell.candidates!.has(cell.kind)).toBe(true);
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
    // player1 の駒と player2 の駒はどちらも 8 駒種 (本将棋は対称)
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
  });
});
