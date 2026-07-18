/**
 * 量子モード捕獲制約群 C-201 / C-202 / C-203 (Phase 5-7・§Q8.5)。
 *
 * 捕獲は候補更新反復 (propagation) とは別の「一発イベント」なので、apply.ts の後、
 * game-store の applyAndCommit から直接呼び出す。§Q8.5 の 3 制約:
 *
 * - **C-201 未確定王捕獲制約**: 王として確定していない駒が捕獲された場合、その駒の
 *   候補集合から王 (is_royal=true な初期 kind に対応する PieceID) を全除外する。
 * - **C-202 確定王捕獲**: 王として確定した駒が捕獲された場合、捕獲した側の勝利で
 *   ゲーム終了 (親§4.4「王として確定した駒の合法捕獲」)。候補更新は実行しない。
 * - **C-203 捕獲後候補保持**: 捕獲を直接の理由として候補集合を変更するのは C-201 の
 *   王候補除外だけで、他の削減は禁止 (=apply.ts の候補継承がそのまま守っている)。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import type { CandidateInfo } from './piece-lookup';
import { buildInitialInfoMap } from './piece-lookup';

function collectRoyalKinds(mgf: Mgf): Set<string> {
  const s = new Set<string>();
  for (const p of mgf.pieces) if (p.is_royal) s.add(p.id);
  return s;
}

function collectRoyalPieceIds(infoMap: Map<PieceId, CandidateInfo>, royalKinds: Set<string>): Set<PieceId> {
  const s = new Set<PieceId>();
  for (const [pid, info] of infoMap) if (royalKinds.has(info.initialKind)) s.add(pid);
  return s;
}

/**
 * §Q8.5 C-202 判定: 「王として確定した駒」か。
 *   - 通常将棋モード (candidates undefined) → piece.kind が royal ならそのまま王扱い。
 *   - 量子モード → candidates が単一で、その PieceID が royal な initialKind に対応する。
 * 候補集合が 2 個以上残っていれば未確定 (C-201 側へ)。
 */
export function isConfirmedKing(piece: PieceInstance, infoMap: Map<PieceId, CandidateInfo>, mgf: Mgf): boolean {
  const royalKinds = collectRoyalKinds(mgf);
  if (piece.candidates === undefined) return royalKinds.has(piece.kind);
  if (piece.candidates.size !== 1) return false;
  const only = piece.candidates.values().next().value as PieceId;
  const info = infoMap.get(only);
  return !!info && royalKinds.has(info.initialKind);
}

/**
 * §Q8.5 C-201: 捕獲された駒 (今回 apply で相手の手駒に加わった 1 個) の candidates から
 * 王 (is_royal) 系 PieceID を全除外する。
 *
 * - candidates が undefined (通常モード) → 変更なし。
 * - candidates.size <= 1 (既に確定) → 変更なし。C-202 で処理すべきケースなので通常は
 *   呼び出し側でここに来ないが、防御的に no-op で返す。
 * - candidates.size > 1 で王候補が混じっていれば narrow。混じっていなければ変化なし。
 */
export function applyC201(nextPos: Position, capturedPieceId: PieceId, mgf: Mgf): Position {
  const infoMap = buildInitialInfoMap(nextPos);
  const royalKinds = collectRoyalKinds(mgf);
  const royalPieceIds = collectRoyalPieceIds(infoMap, royalKinds);
  if (royalPieceIds.size === 0) return nextPos;

  const applyOn = (hand: PieceInstance[]): PieceInstance[] | null => {
    const idx = hand.findIndex((p) => p.pieceId === capturedPieceId);
    if (idx < 0) return null;
    const p = hand[idx];
    if (!p.candidates || p.candidates.size <= 1) return null;
    let changed = false;
    const narrowed = new Set<PieceId>();
    for (const pid of p.candidates) {
      if (royalPieceIds.has(pid)) {
        changed = true;
        continue;
      }
      narrowed.add(pid);
    }
    if (!changed) return null;
    const next = hand.slice();
    next[idx] = { ...p, candidates: narrowed };
    return next;
  };

  const newP1 = applyOn(nextPos.hands.player1);
  if (newP1) return { ...nextPos, hands: { ...nextPos.hands, player1: newP1 } };
  const newP2 = applyOn(nextPos.hands.player2);
  if (newP2) return { ...nextPos, hands: { ...nextPos.hands, player2: newP2 } };
  return nextPos;
}
