/**
 * 量子モード候補集合の AC-3 アーク整合ループ (Phase 5-4)。
 *
 * §Q7.4 candidate_update(board_state): 各駒の候補集合に対して制約群を反復適用し、
 * 安定状態 (どの候補集合も変化しない状態) に到達するまで繰り返す。
 *
 * ## Phase 5-4 (現在の骨組み)
 *
 * このファイルは骨組みだけ。制約 (C-001/C-002/C-003, C-101〜C-105, C-201〜C-203,
 * C-301/C-302, C-901 など) は Phase 5-5 以降で `features/quantum/constraints/*.ts`
 * に実装され、plugin registry の `'quantum:constraints'` として集約登録される。
 *
 * 5-4 段階では registered 制約が 0 個なので、`candidateUpdate` は常に入力の
 * Position をそのまま返す (idempotent no-op)。DoD:
 *   - 空制約で呼んでも位置崩れが起きない
 *   - 反復回数のログを出せる (デバッグ用)
 *
 * ## 反復上限 (§Q7.9.1)
 *
 * 目安は pieces × candidate_kinds。本将棋なら 40 駒 × 8 駒種 = 320。
 * 安全マージンを取って 512 で暫定。パラメータ化は 5-15 で対応予定。
 *
 * ## 制約インターフェース
 *
 * `QuantumConstraint = (piece, location, position, mgf) => ReadonlySet<string>`
 * を返り値として「その駒に許される駒種集合」を返す。
 * candidate_update 側で全制約の結果と現在の candidates を交わし (intersection) て
 * 更新する。返り値が現在の candidates と等しければ変化なし。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceInstance, Position, Square } from '../../core/engine/position/types';
import { get as pluginGet } from '../../core/plugin/registry';
import { checkC001InitialOwnerPreserved, checkC002CandidatesMonotone } from './constraints/basic';

/** 制約が判定する駒がどこに居るかの情報 (盤上か持ち駒か)。 */
export type QuantumPieceLocation =
  | { kind: 'board'; square: Square }
  | { kind: 'hand'; owner: 'player1' | 'player2'; index: number };

/**
 * candidate_update 呼び出し時の副次情報。Phase 4 のトーラスモード等、Position や Mgf
 * だけでは表現しにくい runtime 状態をここに集約する。制約は必要に応じてこの context を
 * 参照して発火/非発火を切り替える (例: torus ON 時は C-103/C-104 を無効化)。
 */
export interface QuantumContext {
  torusMode: 'none' | 'cylinder' | 'full';
}

/** context を省略した時の既定値 (torus 非適用)。 */
export const DEFAULT_QUANTUM_CONTEXT: QuantumContext = { torusMode: 'none' };

/**
 * 単一の制約。piece の現在の候補集合を狭める判断を返す。
 * 返り値 = その駒に「現時点で許される駒種集合」。current candidates と交わって適用される。
 */
export type QuantumConstraint = (
  piece: PieceInstance,
  location: QuantumPieceLocation,
  position: Position,
  mgf: Mgf,
  context: QuantumContext,
) => ReadonlySet<string>;

const MAX_ITERATIONS = 512;

/**
 * §Q7.4 candidate_update の実装。plugin registry から `'quantum:constraints'`
 * を取得し、安定状態まで反復適用する。
 *
 * - 制約が 0 個 (5-4 骨組み) の場合は入力をそのまま返す。
 * - 制約適用で position が全く変わらないなら、参照そのまま返す (React の
 *   memo/useMemo フックが余計に再計算されないようにする配慮)。
 * - MAX_ITERATIONS で強制打ち切り + console.warn ログ (安全弁)。
 */
export function candidateUpdate(
  pos: Position,
  mgf: Mgf,
  context: QuantumContext = DEFAULT_QUANTUM_CONTEXT,
): Position {
  const constraints = pluginGet<QuantumConstraint[]>('quantum:constraints') ?? [];
  if (constraints.length === 0) return pos;

  let current = pos;
  let final: Position | null = null;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const { next, changed } = applyConstraintsOnce(current, mgf, constraints, context);
    if (!changed) {
      final = current;
      break;
    }
    current = next;
  }
  if (final === null) {
    console.warn(
      `[quantum:candidateUpdate] hit MAX_ITERATIONS=${MAX_ITERATIONS} without stabilizing; ` +
      `returning last computed state. Constraints may be non-monotone (C-002 violation).`,
    );
    final = current;
  }
  // §Q8.3 basic invariants (C-001 / C-002) を最後にまとめて検証。
  // 違反時は throw して呼び出し側 (game-store.applyAndCommit 等) に問題を伝える。
  // Phase 5-5: initialOwner 保持 + candidates 単調非増加のフレームワーク不変を強制。
  checkC001InitialOwnerPreserved(pos, final);
  checkC002CandidatesMonotone(pos, final);
  return final;
}

/**
 * 1 パスだけ制約を回して次の Position を作る。
 * どの駒も候補集合が変化しなければ changed=false で入力をそのまま返す。
 */
function applyConstraintsOnce(
  pos: Position,
  mgf: Mgf,
  constraints: QuantumConstraint[],
  context: QuantumContext,
): { next: Position; changed: boolean } {
  let changed = false;

  const nextBoard = pos.board.map((row, r) =>
    row.map((cell, c) => {
      if (!cell) return cell;
      const updated = applyConstraintsToPiece(
        cell,
        { kind: 'board', square: { row: r, col: c } },
        pos,
        mgf,
        constraints,
        context,
      );
      if (updated !== cell) changed = true;
      return updated;
    }),
  );

  const nextHands = {
    player1: pos.hands.player1.map((piece, i) => {
      const updated = applyConstraintsToPiece(
        piece,
        { kind: 'hand', owner: 'player1', index: i },
        pos,
        mgf,
        constraints,
        context,
      );
      if (updated !== piece) changed = true;
      return updated;
    }),
    player2: pos.hands.player2.map((piece, i) => {
      const updated = applyConstraintsToPiece(
        piece,
        { kind: 'hand', owner: 'player2', index: i },
        pos,
        mgf,
        constraints,
        context,
      );
      if (updated !== piece) changed = true;
      return updated;
    }),
  };

  if (!changed) return { next: pos, changed: false };
  return { next: { ...pos, board: nextBoard, hands: nextHands }, changed: true };
}

/**
 * 1 駒に全制約を適用し、候補集合を交わ (intersect) して新しい PieceInstance を返す。
 * 変化がなければ入力の PieceInstance をそのまま返す (identity 保存)。
 * candidates が undefined (本将棋モード) の駒は触らない (縮退互換)。
 */
function applyConstraintsToPiece(
  piece: PieceInstance,
  location: QuantumPieceLocation,
  pos: Position,
  mgf: Mgf,
  constraints: QuantumConstraint[],
  context: QuantumContext,
): PieceInstance {
  if (piece.candidates === undefined) return piece;
  let next: Set<string> | null = null;
  for (const c of constraints) {
    const allowed = c(piece, location, pos, mgf, context);
    const base = next ?? piece.candidates;
    const intersected = intersect(base, allowed);
    if (intersected.size !== base.size) {
      next = intersected;
    } else if (next === null) {
      // No change from this constraint and no prior change; keep going.
    } else {
      next = intersected;
    }
  }
  if (next === null || next.size === piece.candidates.size) return piece;
  // §Q7.5: 候補集合が 1 種に収縮したら確定 (C-301)。5-8 で正式実装するが
  // ここでは confirmed=true への遷移だけは行う (安全な副作用)。
  const confirmed = next.size === 1;
  return { ...piece, candidates: next, confirmed };
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
