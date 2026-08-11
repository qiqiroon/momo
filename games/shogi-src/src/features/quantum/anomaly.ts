/**
 * Phase 5-13: 異常状態 (anomaly) の検出。
 *
 * §Q8.8 C-901 「候補集合が空になってはならない」と §Q7.9.1 「観測ステップ上限」の
 * 2 つを「意味論起点」として検出し、呼び出し側 (game-store) に投げ返す。
 * UI 表示・投票・通信は上位層の仕事で、このモジュールは「起きたこと」だけを伝える。
 *
 * ## なぜ例外で伝えるのか
 *
 * candidate_update は「安定した Position を返す」契約なので、矛盾した局面を
 * 平然と返すと呼び出し側が異常に気付けない (v1.11 まではまさにそうで、候補が
 * 空になっても黙って続行していた)。返り値を { pos, anomaly } の組に変えると
 * 既存の呼び出し全部が影響を受けるため、異常時だけ例外に切り替える形にした。
 * 例外は「停止時点の局面」を抱えて飛ぶので、呼び出し側はそれを盤に残せる
 * (§5.7.3.3 「停止時点の盤面をそのまま背景表示」)。
 *
 * ## 縮退互換
 *
 * 通常将棋モードでは candidates 自体が undefined なので空集合は生まれず、
 * 制約も登録されないため反復も回らない = 本モジュールは発火しない (§Q8.8 縮退互換)。
 */

import type { PieceInstance, Position } from '../../core/engine/position/types';

/**
 * 異常の原因種別。UI 側は原因行の文言をこれで切り替える (画面機能 §3 S06.Q5)。
 * 音は原因で変えない (原因は視覚側で伝える・音響 §2.7.2)。
 */
export type QuantumAnomalyCause = 'empty_candidates' | 'iteration_limit';

/**
 * 候補更新が異常状態に達したときに投げる例外。
 *
 * position には「打ち切った時点の局面」が入る。呼び出し側はこれを盤に反映してから
 * 投票 UI を出すことで、両者に同じ不安定な盤面を見せられる。
 */
export class QuantumAnomalyError extends Error {
  /** core/ 側 (features/ を import できない) が duck typing で見分けるための目印。 */
  readonly quantumAnomaly = true as const;

  constructor(
    readonly anomalyCause: QuantumAnomalyCause,
    readonly position: Position,
    /** 候補が空になった駒。上限到達の場合は null。 */
    readonly pieceId: string | null = null,
  ) {
    super(
      anomalyCause === 'empty_candidates'
        ? `[quantum:anomaly] C-901 candidate set became empty (pieceId=${pieceId})`
        : '[quantum:anomaly] candidate_update did not stabilize within the iteration limit',
    );
    this.name = 'QuantumAnomalyError';
  }
}

/**
 * 候補集合が空になっている駒を探す (§Q8.8 C-901)。盤上 → 先手持ち駒 → 後手持ち駒の順。
 * candidates が undefined の駒 (本将棋モード) は対象外。
 */
export function findEmptyCandidatePiece(pos: Position): PieceInstance | null {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.candidates !== undefined && cell.candidates.size === 0) return cell;
    }
  }
  for (const p of pos.hands.player1) {
    if (p.candidates !== undefined && p.candidates.size === 0) return p;
  }
  for (const p of pos.hands.player2) {
    if (p.candidates !== undefined && p.candidates.size === 0) return p;
  }
  return null;
}

/**
 * 空集合があれば QuantumAnomalyError を投げる。無ければ何もしない。
 * candidate_update の反復の各所から呼ぶ。
 */
export function assertNoEmptyCandidates(pos: Position): void {
  const empty = findEmptyCandidatePiece(pos);
  if (empty) throw new QuantumAnomalyError('empty_candidates', pos, empty.pieceId);
}
