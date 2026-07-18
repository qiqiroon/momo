import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceId, Position } from '../../core/engine/position/types';
import { quantumInit } from './init';
import { buildInitialInfoMap } from './piece-lookup';
import { findConfirmedKing } from './king-detection';

/** 初期量子局面から「initialKind='ou' な PieceID」の集合を取り出す。 */
function collectOuPieceIds(pos: Position): Set<PieceId> {
  const infoMap = buildInitialInfoMap(pos);
  const s = new Set<PieceId>();
  for (const [pid, info] of infoMap) if (info.initialKind === 'ou') s.add(pid);
  return s;
}

/** 盤上の該当駒を新しい candidates 集合で差し替えた position を返す (immutable)。 */
function setCandidatesAt(pos: Position, row: number, col: number, cands: Set<PieceId>): Position {
  const newBoard = pos.board.map((r) => r.slice());
  const cell = newBoard[row][col];
  if (!cell) throw new Error(`empty cell at ${row},${col}`);
  newBoard[row][col] = { ...cell, candidates: cands };
  return { ...pos, board: newBoard };
}

describe('features/quantum/king-detection (Phase 5-10 §Q13.4)', () => {
  describe('findConfirmedKing', () => {
    it('量子初期局面 (全駒 20 候補) では両陣営とも王未確定 → null', () => {
      const pos = quantumInit(initPosition(hondou));
      expect(findConfirmedKing(hondou, pos, 'player1')).toBeNull();
      expect(findConfirmedKing(hondou, pos, 'player2')).toBeNull();
    });

    it('候補を単一 ou PieceID に絞った駒がある陣営だけ王が見つかる', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const ouIds = collectOuPieceIds(pos0);
      const ouId = ouIds.values().next().value as PieceId;
      // 先手玉初期位置 (8,4) を「ou 単一候補」に確定させる
      const pos = setCandidatesAt(pos0, 8, 4, new Set([ouId]));
      expect(findConfirmedKing(hondou, pos, 'player1')).toEqual({ row: 8, col: 4 });
      // 後手側は未確定のまま
      expect(findConfirmedKing(hondou, pos, 'player2')).toBeNull();
    });

    it('王を初期玉位置ではないマスで確定させても正しく見つかる', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const ouIds = collectOuPieceIds(pos0);
      const ouId = ouIds.values().next().value as PieceId;
      // 先手陣の (6,0) にある駒 (元は fu) を ou 単一候補に確定 → そこを王として返すべき
      const pos = setCandidatesAt(pos0, 6, 0, new Set([ouId]));
      expect(findConfirmedKing(hondou, pos, 'player1')).toEqual({ row: 6, col: 0 });
    });

    it('候補が単一でも非 ou PieceID なら王ではない → null', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const ouIds = collectOuPieceIds(pos0);
      const cell = pos0.board[8][4]!;
      const nonOuId = Array.from(cell.candidates!).find((pid) => !ouIds.has(pid))!;
      const pos = setCandidatesAt(pos0, 8, 4, new Set([nonOuId]));
      expect(findConfirmedKing(hondou, pos, 'player1')).toBeNull();
    });

    it('候補が 2 個以上 (ou を含んでいても) は未確定 → null', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const ouIds = collectOuPieceIds(pos0);
      const ouId = ouIds.values().next().value as PieceId;
      const cell = pos0.board[8][4]!;
      const anyOther = Array.from(cell.candidates!).find((pid) => pid !== ouId)!;
      const pos = setCandidatesAt(pos0, 8, 4, new Set([ouId, anyOther]));
      expect(findConfirmedKing(hondou, pos, 'player1')).toBeNull();
    });

    it('通常将棋モード (candidates=undefined) では kind ベースで初期玉位置を返す', () => {
      const pos = initPosition(hondou);
      expect(findConfirmedKing(hondou, pos, 'player1')).toEqual({ row: 8, col: 4 });
      expect(findConfirmedKing(hondou, pos, 'player2')).toEqual({ row: 0, col: 4 });
    });
  });
});
