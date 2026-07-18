import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { quantumInit } from './init';
import { buildInitialInfoMap } from './piece-lookup';
import { applyC201, isConfirmedKing } from './capture-effects';

/** 初期量子局面から「initialKind='ou' な PieceID」の集合を取り出す。 */
function collectOuPieceIds(pos: Position): Set<PieceId> {
  const infoMap = buildInitialInfoMap(pos);
  const s = new Set<PieceId>();
  for (const [pid, info] of infoMap) if (info.initialKind === 'ou') s.add(pid);
  return s;
}

/**
 * 与えた駒を owner 側の hand に押し込む (捕獲を模擬)。捕獲後は promoted=false、
 * owner が反転しているのが自然だが、C-201/C-203 の判定は「手駒に居るその pieceId の
 * candidates」で完結するので、テストのために hand へ直接置いても意味論は同じ。
 */
function pushToHand(pos: Position, side: 'player1' | 'player2', piece: PieceInstance): Position {
  return {
    ...pos,
    hands: {
      ...pos.hands,
      [side]: [...pos.hands[side], piece],
    },
  };
}

describe('features/quantum/capture-effects (Phase 5-7 §Q8.5)', () => {
  describe('isConfirmedKing (C-202 判定)', () => {
    it('候補が単一の ou 系 PieceID なら true', () => {
      const pos = quantumInit(initPosition(hondou));
      const infoMap = buildInitialInfoMap(pos);
      const ouIds = collectOuPieceIds(pos);
      expect(ouIds.size).toBeGreaterThan(0);
      const anyOuId = ouIds.values().next().value as PieceId;
      const piece: PieceInstance = { ...pos.board[8][4]!, candidates: new Set([anyOuId]) };
      expect(isConfirmedKing(piece, infoMap, hondou)).toBe(true);
    });

    it('候補が 2 個以上なら (ou を含んでいても) false — まだ未確定', () => {
      const pos = quantumInit(initPosition(hondou));
      const infoMap = buildInitialInfoMap(pos);
      const ouIds = collectOuPieceIds(pos);
      const anyOuId = ouIds.values().next().value as PieceId;
      const anyOtherId = Array.from(pos.board[8][4]!.candidates!).find((pid) => pid !== anyOuId)!;
      const piece: PieceInstance = {
        ...pos.board[8][4]!,
        candidates: new Set([anyOuId, anyOtherId]),
      };
      expect(isConfirmedKing(piece, infoMap, hondou)).toBe(false);
    });

    it('候補が単一の非 ou 系 PieceID なら false', () => {
      const pos = quantumInit(initPosition(hondou));
      const infoMap = buildInitialInfoMap(pos);
      const ouIds = collectOuPieceIds(pos);
      const nonOuId = Array.from(pos.board[8][4]!.candidates!).find((pid) => !ouIds.has(pid))!;
      const piece: PieceInstance = { ...pos.board[8][4]!, candidates: new Set([nonOuId]) };
      expect(isConfirmedKing(piece, infoMap, hondou)).toBe(false);
    });

    it('通常将棋モード (candidates=undefined) では piece.kind=ou なら true', () => {
      const pos = initPosition(hondou);
      const infoMap = buildInitialInfoMap(pos);
      const ouPiece = pos.board[8][4]!; // 先手玉 (kind='ou')
      expect(ouPiece.kind).toBe('ou');
      expect(ouPiece.candidates).toBeUndefined();
      expect(isConfirmedKing(ouPiece, infoMap, hondou)).toBe(true);
    });

    it('通常将棋モードで piece.kind=fu なら false', () => {
      const pos = initPosition(hondou);
      const infoMap = buildInitialInfoMap(pos);
      const fu = pos.board[6][0]!;
      expect(fu.kind).toBe('fu');
      expect(isConfirmedKing(fu, infoMap, hondou)).toBe(false);
    });
  });

  describe('applyC201 (王候補除外)', () => {
    it('未確定 (候補 20 個・ou 含む) の駒が hand に居る → applyC201 で ou 系のみ除外・他候補は保持', () => {
      const pos0 = quantumInit(initPosition(hondou));
      // 手駒テストのため board[6][0] の駒 (fu, 候補 20) を「捕獲されたつもりで」player2 の hand に置く
      const captured = pos0.board[6][0]!;
      const posWithHand = pushToHand(pos0, 'player2', { ...captured, owner: 'player2', kind: 'fu' });
      const ouIds = collectOuPieceIds(posWithHand);
      expect(ouIds.size).toBeGreaterThan(0);

      const beforeSize = captured.candidates!.size;
      // hand piece の candidates は ou を含む
      const handCands = posWithHand.hands.player2[posWithHand.hands.player2.length - 1].candidates!;
      const beforeOus = [...handCands].filter((pid) => ouIds.has(pid));
      expect(beforeOus.length).toBeGreaterThan(0);

      const nextPos = applyC201(posWithHand, captured.pieceId, hondou);
      const afterPiece = nextPos.hands.player2[nextPos.hands.player2.length - 1];
      expect(afterPiece.candidates!.size).toBe(beforeSize - beforeOus.length);
      for (const ouId of ouIds) {
        expect(afterPiece.candidates!.has(ouId)).toBe(false);
      }
      // ou 以外の候補はそのまま (C-203)
      for (const pid of handCands) {
        if (ouIds.has(pid)) continue;
        expect(afterPiece.candidates!.has(pid)).toBe(true);
      }
    });

    it('捕獲された駒の候補に ou が無ければ変化なし (C-203)', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const captured = pos0.board[6][0]!;
      const ouIds = collectOuPieceIds(pos0);
      // 事前に ou を全部除いた候補を持たせておく
      const withoutOu = new Set<PieceId>();
      for (const pid of captured.candidates!) if (!ouIds.has(pid)) withoutOu.add(pid);
      const modified: PieceInstance = { ...captured, owner: 'player2', kind: 'fu', candidates: withoutOu };
      const posWithHand = pushToHand(pos0, 'player2', modified);

      const nextPos = applyC201(posWithHand, captured.pieceId, hondou);
      expect(nextPos).toBe(posWithHand); // 変化なしなら参照ごと同一
      const afterPiece = nextPos.hands.player2[nextPos.hands.player2.length - 1];
      expect(afterPiece.candidates!.size).toBe(withoutOu.size);
    });

    it('候補が単一 (既に確定) の駒は applyC201 で変化なし (防御的 no-op)', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const captured = pos0.board[6][0]!;
      const ouIds = collectOuPieceIds(pos0);
      const singleOu = ouIds.values().next().value as PieceId;
      const modified: PieceInstance = {
        ...captured,
        owner: 'player2',
        kind: 'fu',
        candidates: new Set([singleOu]),
      };
      const posWithHand = pushToHand(pos0, 'player2', modified);
      const nextPos = applyC201(posWithHand, captured.pieceId, hondou);
      expect(nextPos).toBe(posWithHand);
    });

    it('通常将棋モード (candidates=undefined) では applyC201 で変化なし', () => {
      const pos0 = initPosition(hondou);
      const captured = pos0.board[6][0]!;
      const posWithHand = pushToHand(pos0, 'player2', { ...captured, owner: 'player2', kind: 'fu' });
      const nextPos = applyC201(posWithHand, captured.pieceId, hondou);
      expect(nextPos).toBe(posWithHand);
    });

    it('存在しない pieceId を渡しても no-op', () => {
      const pos0 = quantumInit(initPosition(hondou));
      const nextPos = applyC201(pos0, 'nonexistent_id', hondou);
      expect(nextPos).toBe(pos0);
    });
  });
});
