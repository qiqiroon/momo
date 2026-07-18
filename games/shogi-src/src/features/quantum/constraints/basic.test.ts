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

describe('features/quantum/constraints/basic (Phase 5-5)', () => {
  afterEach(() => {
    clear();
  });

  describe('checkC001InitialOwnerPreserved', () => {
    it('initialOwner を変更しなければ throw しない', () => {
      const before = quantumInit(initPosition(hondou));
      const after = before; // 参照そのまま
      expect(() => checkC001InitialOwnerPreserved(before, after)).not.toThrow();
    });

    it('駒の initialOwner を意図的に反転させると C001Violation で throw する', () => {
      const before = quantumInit(initPosition(hondou));
      const boardCopy = before.board.map((row) => row.slice());
      const target = boardCopy[6][2]!; // sente 歩
      boardCopy[6][2] = { ...target, initialOwner: 'player2' }; // 違反
      const after: Position = { ...before, board: boardCopy };
      expect(() => checkC001InitialOwnerPreserved(before, after)).toThrow(C001Violation);
      expect(() => checkC001InitialOwnerPreserved(before, after)).toThrow(/initialOwner/);
    });

    it('持ち駒の initialOwner を反転させても検出する', () => {
      let before = quantumInit(initPosition(hondou));
      // 持ち駒を 1 個追加
      const handPiece: PieceInstance = {
        pieceId: 'H_test', kind: 'fu', owner: 'player1',
        initialOwner: 'player1', promoted: false,
        candidates: new Set(['fu']), confirmed: true,
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
          const narrower = new Set(Array.from(cell.candidates).slice(0, 4)); // 半分に絞る
          return { ...cell, candidates: narrower };
        }),
      );
      const after: Position = { ...before, board: boardCopy };
      expect(() => checkC002CandidatesMonotone(before, after)).not.toThrow();
    });

    it('元の候補集合に無い駒種を追加すると C002Violation で throw する', () => {
      const before = quantumInit(initPosition(hondou));
      // 全駒に candidates={fu,gin} を人工的に付ける (縮退) → after で {fu,gin,narikin} に増やす
      const setNarrow = (row: PieceInstance[][]): PieceInstance[][] =>
        row.map((line) =>
          line.map((cell) =>
            cell ? { ...cell, candidates: new Set(['fu', 'gin']), confirmed: false } : cell,
          ),
        );
      const beforeBoard = setNarrow(before.board as PieceInstance[][]);
      const beforeNarrow: Position = { ...before, board: beforeBoard };
      // after: 全駒に 'narikin' を追加 (元の {fu,gin} に無い → C-002 違反)
      const afterBoard = beforeNarrow.board.map((row) =>
        row.map((cell) => {
          if (!cell) return cell;
          return { ...cell, candidates: new Set(['fu', 'gin', 'narikin']) };
        }),
      );
      const after: Position = { ...beforeNarrow, board: afterBoard };
      expect(() => checkC002CandidatesMonotone(beforeNarrow, after)).toThrow(C002Violation);
      expect(() => checkC002CandidatesMonotone(beforeNarrow, after)).toThrow(/narikin/);
    });

    it('candidates=undefined (本将棋モード) の駒はチェック対象外', () => {
      const before = initPosition(hondou); // 本将棋モード (candidates 無し)
      const after = before;
      expect(() => checkC002CandidatesMonotone(before, after)).not.toThrow();
    });
  });

  describe('basicConstraints (register 統合)', () => {
    it('basicConstraints を register して量子初期局面に candidate_update を呼んでも変化なし (no-op)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      const result = candidateUpdate(pos, hondou);
      // basicConstraints は現状全て no-op なので pos そのまま
      expect(result).toBe(pos);
    });

    it('basicConstraints を通した candidate_update は C-001/C-002 不変を保つ (throw しない)', () => {
      register<QuantumConstraint[]>('quantum:constraints', basicConstraints);
      const pos = quantumInit(initPosition(hondou));
      expect(() => candidateUpdate(pos, hondou)).not.toThrow();
    });

    it('basicConstraints + 追加の narrowing 制約を通した candidate_update: 狭めるのは OK', () => {
      const shrinkToFu: QuantumConstraint = () => new Set(['fu']);
      register<QuantumConstraint[]>('quantum:constraints', [...basicConstraints, shrinkToFu]);
      const pos = quantumInit(initPosition(hondou));
      const result = candidateUpdate(pos, hondou);
      // 全駒 candidates={fu}, confirmed=true になる
      for (const row of result.board) {
        for (const cell of row) {
          if (!cell) continue;
          expect(cell.candidates!.size).toBe(1);
          expect(cell.candidates!.has('fu')).toBe(true);
          expect(cell.confirmed).toBe(true);
        }
      }
      // C-001/C-002 チェックは throw しなかった (= 制約適用が invariant を守った)
    });
  });
});
