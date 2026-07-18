/**
 * 量子モードの PieceID → 初期情報 lookup (Phase 5-6.5)。
 *
 * §Q4.1 の PieceID ベース候補集合に必要な resolver。各制約は候補 PieceID を
 * 「初期 kind」「初期位置」「初期陣営」に resolve するため buildInitialInfoMap で
 * 作った Map を context 経由で共有する。
 *
 * 対局中に initialKind/initialSquare/initialOwner は不変 (C-001 相当) なので、
 * candidate_update の反復開始時に 1 回作れば以後の全反復で使い回せる。
 */

import type { PieceId, PieceInstance, Position, Square } from '../../core/engine/position/types';
import type { Player } from '../../core/engine/mgf/types';

/** PieceID から取り出せる不変な初期情報。制約が候補 PieceID を判定するときに使う。 */
export interface CandidateInfo {
  pieceId: PieceId;
  initialKind: string;
  initialSquare: Square;
  initialOwner: Player;
}

/**
 * 盤上・両手駒を走査して PieceID → CandidateInfo の Map を作る。
 * 対局中 PieceID は追加削除されない (捕獲は owner 反転で pieceId 継続) ので、
 * この Map は Position 単位で 1 回作れば十分。
 */
export function buildInitialInfoMap(pos: Position): Map<PieceId, CandidateInfo> {
  const map = new Map<PieceId, CandidateInfo>();
  const add = (p: PieceInstance): void => {
    map.set(p.pieceId, {
      pieceId: p.pieceId,
      initialKind: p.initialKind,
      initialSquare: p.initialSquare,
      initialOwner: p.initialOwner,
    });
  };
  for (const row of pos.board) {
    for (const cell of row) if (cell) add(cell);
  }
  for (const p of pos.hands.player1) add(p);
  for (const p of pos.hands.player2) add(p);
  return map;
}

/**
 * PieceID を CandidateInfo に resolve するショートカット。map に無いキーは undefined。
 * 制約側の防御用に用意 (通常はスキャン漏れが無い前提で map[id] を直接使ってよい)。
 */
export function resolveInfo(
  map: Map<PieceId, CandidateInfo>,
  pieceId: PieceId,
): CandidateInfo | undefined {
  return map.get(pieceId);
}
