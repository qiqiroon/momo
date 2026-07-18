import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import { clear, register } from '../../../core/plugin/registry';
import type { Position, PieceInstance } from '../../../core/engine/position/types';
import { quantumInit } from '../init';
import { candidateUpdate, type QuantumConstraint } from '../candidate-update';
import {
  basicConstraints,
  checkC001InitialOwnerPreserved,
  checkC002CandidatesMonotone,
  C001Violation,
  C002Violation,
} from './basic';

describe('features/quantum/constraints/basic (Phase 5-5 / Phase 5-6.5 移行後)', () => {
  afterEach(() => {
    clear();
  });

  describe('checkC001InitialOwnerPreserved', () => {
    it('initialOwner を変更しなければ throw しない', () => {
      const before = quantumInit(initPosition(hondou));
      const after = before;
      expect(() => checkC001InitialOwnerPreserved(before, after)).not.toThrow();
    });

    it('駒の initialOwner を意図的に反転させると C001Violation で throw する', () => {
      const before = quantumInit(initPosition(hondou));
      const boardCopy = before.board.map((row) => row.slice());
      const target = boardCopy[6][2]!;
      boardCopy[6][2] = { ...target, initialOwner: 'player2' };
      const after: Position = { ...before, board: boardCopy };
      expect(() => checkC001InitialOwnerPreserved(before, after)).toThrow(C001Violation);
      expect(() => checkC001InitialOwnerPreserved(before, after)).toThrow(/initialOwner/);
    });

    it('持ち駒の initialOwner を反転させても検出する', () => {
      let before = quantumInit(initPosition(hondou));
      const handPiece: PieceInstance = {
        pieceId: 'H_test', kind: 'fu', owner: 'player1',
        initialOwner: 'player1',
        initialKind: 'fu',
        initialSquare: { row: -1, col: -1 },
        promoted: false,
        candidates: new Set(['H_test']), confirmed: true,
      };
      before = { ...before, hands: { ...before.hands, player1: [...before.hands.player1, handPiece] } };
      const after: Position = {
        ...before,
        hands: {
          ...before.hands,
          player1: before.hands.player1.map((p) =>
            p.pieceId === 'H_test' ? { ...p, initialOwner: 'player2' as const } : p,
          ),
        },
      };
      expect(() => checkC001InitialOwnerPreserved(before, after)).toThrow(C001Violation);
    });
  });

  describe('checkC002CandidatesMonotone', () => {
    it('候補集合を狭めるだけなら throw しない', () => {
      const before = quantumInit(initPosition(hondou));
      const boardCopy = before.board.map((row) =>
        row.map((cell) => {
          if (!cell || cell.candidates === undefined) return cell;
          // 半分に絞る (単調非増加)
          const narrower = new Set(Array.from(cell.candidates).slice(0, 10));
          return { ...cell, candidates: narrower };
        }),
      );
      const after: Position = { ...before, board: boardCopy };
      expect(() => checkC002CandidatesMonotone(before, after)).not.toThrow();
    });

    it('元の候補集合に無い要素を追加すると C002Violation で throw する', () => {
      const before = quantumInit(initPosition(hondou));
      const afterBoard = before.board.map((row) =>
        row.map((cell) => {
          if (!cell || cell.candidates === undefined) return cell;
          return { ...cell, candidates: new Set([...cell.candidates, 'FAKE_ID']) };
        }),
      );
      const after: Position = { ...before, board: afterBoard };
      expect(() => checkC002CandidatesMonotone(before, after)).toThrow(C002Violation);
      expect(() => checkC002CandidatesMonotone(before, after)).toThrow(/FAKE_ID/);
    });

    it('candidates=undefined (本将棋モード) の駒はチェック対象外', () => {
      const before = initPosition(hondou);
      const after = before;
      expect(() => checkC002CandidatesMonotone(before, after)).not.toThrow();
    });
  });

  describe('basicConstraints (register 統合)', () => {
    it('basicConstraints を register して量子初期局面に candidate_update を呼んでも変化なし (no-op)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      const result = candidateUpdate(pos, hondou);
      expect(result).toBe(pos);
    });

    it('basicConstraints を通した candidate_update は C-001/C-002 不変を保つ (throw しない)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      expect(() => candidateUpdate(pos, hondou)).not.toThrow();
    });

    it('basicConstraints + 追加の narrowing 制約: 各駒 candidates が自 pieceId に絞られる', () => {
      const shrinkToSelf: QuantumConstraint = (piece) => new Set([piece.pieceId]);
      register<QuantumConstraint[]>('quantum:constraints', [...basicConstraints, shrinkToSelf]);
      const pos = quantumInit(initPosition(hondou));
      const result = candidateUpdate(pos, hondou);
      for (const row of result.board) {
        for (const cell of row) {
          if (!cell) continue;
          expect(cell.candidates!.size).toBe(1);
          expect(cell.candidates!.has(cell.pieceId)).toBe(true);
          expect(cell.confirmed).toBe(true);
        }
      }
    });
  });
});
