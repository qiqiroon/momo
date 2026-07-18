import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { register, clear } from '../../core/plugin/registry';
import type { Position } from '../../core/engine/position/types';
import { candidateUpdate, type QuantumConstraint } from './candidate-update';
import { quantumInit } from './init';

describe('features/quantum/candidate-update (Phase 5-4 / Phase 5-6.5 移行後)', () => {
  afterEach(() => {
    clear();
  });

  it('制約 0 個 (骨組み) の量子初期局面: 呼んでも Position は変化しない (idempotent)', () => {
    const pos: Position = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);
    expect(result).toBe(pos);
    for (let r = 0; r < pos.height; r++) {
      for (let c = 0; c < pos.width; c++) {
        expect(result.board[r][c]).toBe(pos.board[r][c]);
      }
    }
  });

  it('本将棋モード (candidates=undefined) の駒は制約が登録されていても触られない', () => {
    // 全駒を 1 PieceID (存在しない ID) に絞ろうとする nasty 制約
    const nastyConstraint: QuantumConstraint = () => new Set(['P_fake']);
    register<QuantumConstraint[]>('quantum:constraints', [nastyConstraint]);

    const pos = initPosition(hondou);
    const result = candidateUpdate(pos, hondou);
    for (const row of result.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates).toBeUndefined();
      }
    }
  });

  it('候補を狭める制約を 1 個登録: 全駒が「自分の PieceID」だけに絞られ confirmed=true になる', () => {
    // 各駒を自分の pieceId 1 個に絞る制約 (単調非増加なので C-002 を破らない)
    const shrinkToSelf: QuantumConstraint = (piece) => new Set([piece.pieceId]);
    register<QuantumConstraint[]>('quantum:constraints', [shrinkToSelf]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);

    for (const row of result.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates).toBeDefined();
        expect(cell.candidates!.size).toBe(1);
        expect(cell.candidates!.has(cell.pieceId)).toBe(true);
        // size==1 で confirmed=true になる
        expect(cell.confirmed).toBe(true);
      }
    }
  });

  it('固定点に到達しない制約でも MAX_ITERATIONS で強制停止する (無限ループ耐性)', () => {
    let toggle = 0;
    const nonMonotone: QuantumConstraint = (piece) => {
      toggle++;
      return toggle % 2 === 0
        ? new Set([piece.pieceId])
        : new Set(Array.from(piece.candidates ?? []).slice(0, 1));
    };
    register<QuantumConstraint[]>('quantum:constraints', [nonMonotone]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);
    expect(result).toBeDefined();
    expect(result.board.length).toBe(pos.height);
  });

  it('applyConstraintsToPiece の識別性: 候補が変化しない駒は同じ PieceInstance 参照を保つ (React memo 配慮)', () => {
    const noop: QuantumConstraint = (piece) => new Set(piece.candidates!);
    register<QuantumConstraint[]>('quantum:constraints', [noop]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);
    expect(result).toBe(pos);
  });
});
