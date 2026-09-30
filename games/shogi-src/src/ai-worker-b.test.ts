/**
 * ★v1.93: 思考用の別スレッドも、頼まれた「後処理の決まり」で読む。
 *
 * PC では思考はこの別スレッドで走る。ここで決まりを読み捨てると、画面側がいくら正しく
 * 渡しても**本番の PC だけが v1.92 までと同じ別のゲームを読む** (同じスレッドで読む検査は
 * 緑のまま)。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hondou } from './core/engine/mgf/loader';
import { initPosition } from './core/engine/position/init';
import { quantumInit } from './features/quantum/init';
import type { PieceInstance, Position } from './core/engine/position/types';
import type { WorkerRequest, WorkerResponse } from './adapters/selfmade-alphabeta/worker-protocol';

type Listener = (ev: { data: WorkerRequest }) => void;
const listeners: Listener[] = [];
const posted: WorkerResponse[] = [];

beforeAll(async () => {
  (globalThis as unknown as { self: unknown }).self = {
    addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
    postMessage: (msg: WorkerResponse) => posted.push(msg),
  };
  await import('./ai-worker-b');
});

function findPiece(pos: Position, owner: string, kind: string): PieceInstance {
  for (const r of pos.board) for (const c of r) if (c && c.initialOwner === owner && c.initialKind === kind) return c;
  throw new Error(`${owner} ${kind} が無い`);
}

describe('思考用の別スレッド (★v1.93)', () => {
  it('量子の決まりを受け取ったら、王と確定した駒を取る', () => {
    const base = quantumInit(initPosition(hondou));
    const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
    const put = (p: PieceInstance, row: number, col: number) => {
      board[row][col] = { ...p, candidates: new Set([p.pieceId]), confirmed: true };
    };
    put(findPiece(base, 'player1', 'ou'), 8, 4);
    put(findPiece(base, 'player1', 'kin'), 6, 0);
    put(findPiece(base, 'player2', 'hi'), 3, 4);
    put(findPiece(base, 'player2', 'kaku'), 3, 3);
    put(findPiece(base, 'player2', 'ou'), 0, 8);
    const position: Position = { ...base, board, hands: { player1: [], player2: [] }, sideToMove: 'player2' };

    for (const fn of listeners) {
      fn({ data: { type: 'go', id: 1, mgf: hondou, position, rules: { quantum: true }, movetimeMs: 3000, maxDepth: 4, jitter: 0 } });
    }
    const result = posted.find((m) => m.type === 'result' && m.id === 1);
    expect(result).toBeDefined();
    const move = result!.type === 'result' ? result!.move : null;
    expect(move && move.type === 'move' && move.to.row === 8 && move.to.col === 4).toBe(true);
  });
});
