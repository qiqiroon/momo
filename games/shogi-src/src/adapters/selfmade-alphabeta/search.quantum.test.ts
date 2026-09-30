/**
 * ★v1.93: 思考ルーチンも対局と同じ後処理を通して読む。
 *
 * v1.92 までは読みの中で駒を動かすだけだったので、**王と確定した駒をタダで取れる局面
 * (取れば即勝ち) でも、最強段で 5 回とも取らなかった** (2026-09-30 実測)。王と確定した
 * 駒は材料として 0 点で、読みの中では取っても勝ちにならなかったため。
 */

import { describe, it, expect } from 'vitest';
import '../../features/quantum';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { quantumInit } from '../../features/quantum/init';
import type { Move, PieceInstance, Position } from '../../core/engine/position/types';
import { searchBestMove } from './search';
import { searchBestMoveMcts } from '../mcts-adapter/mcts';

const QUANTUM = { quantum: true } as const;

function findPiece(pos: Position, owner: string, kind: string): PieceInstance {
  for (const r of pos.board) for (const c of r) if (c && c.initialOwner === owner && c.initialKind === kind) return c;
  throw new Error(`${owner} ${kind} が無い`);
}

/**
 * 後手番。先手の王 (確定) を後手の飛が取れる。横に、後手の角がタダで取れる先手の金 (確定)
 * も置く＝**駒得だけを見れば金を取るほうが得に見える**局面。
 */
function royalOnTheTable(): Position {
  const base = quantumInit(initPosition(hondou));
  const K1 = findPiece(base, 'player1', 'ou');
  const G1 = findPiece(base, 'player1', 'kin');
  const R2 = findPiece(base, 'player2', 'hi');
  const B2 = findPiece(base, 'player2', 'kaku');
  const K2 = findPiece(base, 'player2', 'ou');
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  const put = (p: PieceInstance, row: number, col: number) => {
    board[row][col] = { ...p, candidates: new Set([p.pieceId]), confirmed: true };
  };
  put(K1, 8, 4);
  put(G1, 6, 0);
  put(R2, 3, 4);
  put(B2, 3, 3);
  put(K2, 0, 8);
  return { ...base, board, hands: { player1: [], player2: [] }, sideToMove: 'player2' };
}

function takesKing(m: Move | null): boolean {
  return !!m && m.type === 'move' && m.to.row === 8 && m.to.col === 4;
}

describe('量子: 読みの中でも対局と同じ後処理を通す (★v1.93)', () => {
  it('自作探索は王と確定した駒を取る (どの段でも・毎回)', () => {
    const pos = royalOnTheTable();
    for (const [maxDepth, jitter] of [
      [2, 100],
      [4, 20],
      [4, 0],
    ] as const) {
      for (let seed = 0; seed < 3; seed++) {
        let s = seed + 1;
        const random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
        const r = searchBestMove(hondou, pos, { movetimeMs: 3000, maxDepth, jitter, rules: QUANTUM, random });
        expect(takesKing(r.move)).toBe(true);
      }
    }
  });

  it('決まりを渡さなければ v1.92 までと同じ＝王を取らない (壊れ方の見本)', () => {
    const r = searchBestMove(hondou, royalOnTheTable(), { movetimeMs: 3000, maxDepth: 4, jitter: 0 });
    expect(takesKing(r.move)).toBe(false);
  });

  it('汎用MCTS も王と確定した駒を取る', () => {
    let s = 7;
    const random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const r = searchBestMoveMcts(hondou, royalOnTheTable(), {
      playouts: 200,
      movetimeMs: 5000,
      rules: QUANTUM,
      random,
    });
    expect(takesKing(r.move)).toBe(true);
  });
});
