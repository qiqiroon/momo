/**
 * ★v1.93: 1 手進めて後処理まで済ませる道 (advancePosition)。
 *
 * 盤を進める者 (対局画面・成る/成らずの選択肢・自作探索・汎用MCTS) は全員ここを通る。
 * v1.92 までは後処理が対局画面の中にだけあり、**思考ルーチンは後処理の無い別のゲームを
 * 読んでいた** (2026-09-30 実測＝量子の初期局面から 12 手進めると 4 手で候補が食い違った)。
 */

import { describe, it, expect } from 'vitest';
import '../../../features/quantum';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';
import { applyMove } from './apply';
import { generateLegalMoves } from '../moves/legal';
import { quantumInit } from '../../../features/quantum/init';
import { get as pluginGet } from '../../plugin/registry';
import type { Mgf } from '../mgf/types';
import type { Move, PieceInstance, Position } from './types';
import { advancePosition, PLAIN_RULES } from './advance';

const QUANTUM = { quantum: true } as const;

function candidateSig(p: Position): string {
  const out: string[] = [];
  for (const row of p.board) {
    for (const c of row) {
      if (c) out.push(`${c.pieceId}:${c.candidates ? [...c.candidates].sort().join(',') : '-'}`);
    }
  }
  return out.join('|');
}

/** 大きく動く手を選ぶ (候補が絞れやすい)。無ければ最初の手。 */
function farMove(moves: Move[]): Move {
  return (
    moves.find(
      (x) => x.type === 'move' && Math.abs(x.to.row - x.from.row) + Math.abs(x.to.col - x.from.col) >= 2,
    ) ?? moves[0]
  );
}

function findPiece(pos: Position, owner: string, kind: string): PieceInstance {
  for (const r of pos.board) for (const c of r) if (c && c.initialOwner === owner && c.initialKind === kind) return c;
  throw new Error(`${owner} ${kind} が無い`);
}

/** 量子の盤を、指定した駒だけ・指定した候補で組む。 */
function quantumBoard(
  base: Position,
  placed: Array<{ piece: PieceInstance; row: number; col: number; cands: string[] }>,
  sideToMove: 'player1' | 'player2',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const { piece, row, col, cands } of placed) {
    board[row][col] = { ...piece, candidates: new Set(cands), confirmed: cands.length === 1 };
  }
  return { ...base, board, hands: { player1: [], player2: [] }, sideToMove };
}

describe('advancePosition (★v1.93)', () => {
  it('量子でない対局では applyMove とまったく同じ (本将棋の振る舞いは変わらない)', () => {
    let pos = initPosition(hondou);
    for (let i = 0; i < 10; i++) {
      const m = generateLegalMoves(hondou, pos)[i % 3];
      const r = advancePosition(hondou, pos, m, PLAIN_RULES);
      expect(r.royalCaptured).toBe(false);
      expect(r.anomaly).toBeNull();
      expect(r.position).toEqual(applyMove(hondou, pos, m));
      pos = r.position;
    }
  });

  it('量子では候補更新まで通す (駒を動かすだけの盤とは食い違う＝v1.92 までの思考ルーチンの盤)', () => {
    let pos = quantumInit(initPosition(hondou));
    let differed = 0;
    for (let ply = 0; ply < 12; ply++) {
      const m = farMove(generateLegalMoves(hondou, pos));
      const raw = applyMove(hondou, pos, m);
      const r = advancePosition(hondou, pos, m, QUANTUM);
      if (candidateSig(raw) !== candidateSig(r.position)) differed++;
      pos = r.position;
    }
    // 2026-09-30 実測で 4 手。後処理を通さなければ 0 になる。
    expect(differed).toBeGreaterThan(0);
  });

  it('量子の結果は「駒を動かす → 候補更新」を手で並べたものと一致する', () => {
    const update = pluginGet<(p: Position, m: Mgf) => Position>('quantum:candidateUpdate')!;
    let pos = quantumInit(initPosition(hondou));
    for (let ply = 0; ply < 8; ply++) {
      const m = farMove(generateLegalMoves(hondou, pos));
      const r = advancePosition(hondou, pos, m, QUANTUM);
      expect(candidateSig(r.position)).toBe(candidateSig(update(applyMove(hondou, pos, m), hondou)));
      pos = r.position;
    }
  });

  it('王と確定した駒を取ったら royalCaptured＝その場で勝ち (C-202)', () => {
    const base = quantumInit(initPosition(hondou));
    const K1 = findPiece(base, 'player1', 'ou');
    const R2 = findPiece(base, 'player2', 'hi');
    const K2 = findPiece(base, 'player2', 'ou');
    const pos = quantumBoard(
      base,
      [
        { piece: K1, row: 8, col: 4, cands: [K1.pieceId] },
        { piece: R2, row: 3, col: 4, cands: [R2.pieceId] },
        { piece: K2, row: 0, col: 8, cands: [K2.pieceId] },
      ],
      'player2',
    );
    const take = generateLegalMoves(hondou, pos).find((m) => m.type === 'move' && m.to.row === 8 && m.to.col === 4);
    expect(take).toBeDefined();
    const r = advancePosition(hondou, pos, take!, QUANTUM);
    expect(r.royalCaptured).toBe(true);
    // 量子でない決まりで進めると勝ちにならない (v1.92 までの思考ルーチンがこれ)
    expect(advancePosition(hondou, pos, take!, PLAIN_RULES).royalCaptured).toBe(false);
  });

  it('王と確定していない駒を取ったら C-201＝取られた駒の候補から王が外れる', () => {
    const base = quantumInit(initPosition(hondou));
    const K1 = findPiece(base, 'player1', 'ou');
    const G1 = findPiece(base, 'player1', 'kin');
    const R2 = findPiece(base, 'player2', 'hi');
    const K2 = findPiece(base, 'player2', 'ou');
    const pos = quantumBoard(
      base,
      [
        { piece: K1, row: 8, col: 0, cands: [K1.pieceId, G1.pieceId] },
        { piece: G1, row: 8, col: 4, cands: [K1.pieceId, G1.pieceId] },
        { piece: R2, row: 3, col: 4, cands: [R2.pieceId] },
        { piece: K2, row: 0, col: 8, cands: [K2.pieceId] },
      ],
      'player2',
    );
    const take = generateLegalMoves(hondou, pos).find((m) => m.type === 'move' && m.to.row === 8 && m.to.col === 4)!;
    const r = advancePosition(hondou, pos, take, QUANTUM);
    expect(r.royalCaptured).toBe(false);
    const captured = r.position.hands.player2.find((p) => p.pieceId === G1.pieceId)!;
    expect(captured.candidates?.has(K1.pieceId)).toBe(false);
  });
});
