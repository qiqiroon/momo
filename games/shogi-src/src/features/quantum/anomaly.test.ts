import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { register, clear } from '../../core/plugin/registry';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate, type QuantumConstraint } from './candidate-update';
import { basicConstraints } from './constraints/basic';
import { quantumInit } from './init';
import { findEmptyCandidatePiece, QuantumAnomalyError } from './anomaly';

/** 盤上の 1 マスの駒を差し替えた Position を返す。 */
function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) => (ri === row ? r.map((cell, ci) => (ci === col ? piece : cell)) : r)),
  };
}

describe('features/quantum/anomaly (Phase 5-13 §Q8.8 C-901 / §Q7.9.1)', () => {
  afterEach(() => {
    clear();
  });

  describe('findEmptyCandidatePiece', () => {
    it('候補が空の駒が無ければ null', () => {
      const pos = quantumInit(initPosition(hondou));
      expect(findEmptyCandidatePiece(pos)).toBeNull();
    });

    it('盤上に候補が空の駒があればその駒を返す', () => {
      const pos = quantumInit(initPosition(hondou));
      const target = pos.board[6][4]!;
      const broken = withBoardPiece(pos, 6, 4, { ...target, candidates: new Set<string>() });
      expect(findEmptyCandidatePiece(broken)?.pieceId).toBe(target.pieceId);
    });

    it('本将棋モード (candidates を持たない駒) は対象外', () => {
      const pos = initPosition(hondou);
      expect(findEmptyCandidatePiece(pos)).toBeNull();
    });
  });

  describe('candidate_update が異常を知らせる', () => {
    it('入口で既に候補が空なら例外を投げる (外側の C-201・打ち歩詰め絞り込み由来)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      const target = pos.board[6][4]!;
      const broken = withBoardPiece(pos, 6, 4, { ...target, candidates: new Set<string>() });
      expect(() => candidateUpdate(broken, hondou)).toThrow(QuantumAnomalyError);
    });

    it('制約の適用で候補が空になったら empty_candidates で止まる', () => {
      // どの駒も候補ゼロを返す制約 = 必ず矛盾する
      const emptyEverything: QuantumConstraint = () => new Set<string>();
      register<QuantumConstraint[]>('quantum:constraints', [...basicConstraints, emptyEverything]);
      const pos = quantumInit(initPosition(hondou));
      try {
        candidateUpdate(pos, hondou);
        throw new Error('例外が投げられなかった');
      } catch (e) {
        expect(e).toBeInstanceOf(QuantumAnomalyError);
        const err = e as QuantumAnomalyError;
        expect(err.anomalyCause).toBe('empty_candidates');
        expect(err.pieceId).not.toBeNull();
        // 打ち切り時点の局面が付いてくる (盤に残して投票 UI の背景に使う)
        expect(err.position.board.length).toBe(pos.board.length);
      }
    });

    it('矛盾していなければ従来どおり安定状態を返す (縮退互換)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      expect(() => candidateUpdate(pos, hondou)).not.toThrow();
    });

    it('いつまでも収まらない絞り込みは iteration_limit で止まる', () => {
      // 候補は交わりで狭まる一方なので「振動して終わらない」は作れない。
      // 代わりに「1 周につき 1 駒の候補を 1 個だけ減らす」極端に遅い制約にする。
      // 40 駒 × 39 個 = 1560 周ぶんの仕事があり、上限 (512) の手前では終わらない。
      const PIECES = 40;
      let call = 0;
      const verySlow: QuantumConstraint = (piece) => {
        const all = Array.from(piece.candidates ?? []);
        const no = call++;
        const round = Math.floor(no / PIECES);
        // 周ごとに減らす対象を 1 枚ずつずらす (同じ駒だけ削ると先に底を打って安定してしまう)
        if (no % PIECES !== round % PIECES) return new Set(all);
        if (all.length <= 1) return new Set(all);
        return new Set(all.slice(0, all.length - 1));
      };
      register<QuantumConstraint[]>('quantum:constraints', [verySlow]);
      const pos = quantumInit(initPosition(hondou));
      try {
        candidateUpdate(pos, hondou);
        throw new Error('例外が投げられなかった');
      } catch (e) {
        expect(e).toBeInstanceOf(QuantumAnomalyError);
        expect((e as QuantumAnomalyError).anomalyCause).toBe('iteration_limit');
      }
    });
  });
});
