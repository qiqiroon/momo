/**
 * 量子モード候補集合の AC-3 アーク整合ループ (Phase 5-4 / Phase 5-6.5 移行後)。
 *
 * §Q7.4 candidate_update(board_state): 各駒の候補集合に対して制約群を反復適用し、
 * 安定状態 (どの候補集合も変化しない状態) に到達するまで繰り返す。
 *
 * ## Phase 5-6.5 変更点
 *
 * candidates の中身は「駒種名の集合」→「初期 PieceID の集合」に変わった (§Q4.1)。
 * QuantumContext に infoMap: Map<PieceId, CandidateInfo> を追加、反復開始時に
 * buildInitialInfoMap で 1 回作って全制約に渡す。制約側は候補 PieceID を
 * context.infoMap.get(pid) で「初期 kind / 初期位置 / 初期陣営」に resolve する。
 *
 * ## 反復上限 (§Q7.9.1)
 *
 * 目安は pieces × pieceIds。本将棋なら 40 駒 × 40 PieceID = 1600 だが、
 * 実際は各反復で複数駒が同時に狭まるため 512 で足りる想定。パラメータ化は 5-15 で対応。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceInstance, Position, Square } from '../../core/engine/position/types';
import { get as pluginGet } from '../../core/plugin/registry';
import { checkC001InitialOwnerPreserved, checkC002CandidatesMonotone } from './constraints/basic';
import { buildInitialInfoMap, type CandidateInfo } from './piece-lookup';

/** 制約が判定する駒がどこに居るかの情報 (盤上か持ち駒か)。 */
export type QuantumPieceLocation =
  | { kind: 'board'; square: Square }
  | { kind: 'hand'; owner: 'player1' | 'player2'; index: number };

/**
 * candidate_update 呼び出し時の副次情報。Phase 4 のトーラスモード等、Position や Mgf
 * だけでは表現しにくい runtime 状態をここに集約する。
 *
 * ## infoMap (Phase 5-6.5)
 * 候補 PieceID を「初期 kind / 初期位置 / 初期陣営」に resolve する map。
 * candidate_update の反復開始時に 1 回作って全制約で共有する。制約側は
 * context.infoMap.get(pid) で参照する (buildInitialInfoMap は毎反復ごとに
 * 呼ぶ必要はない — 対局中 pieceId と初期属性は不変)。
 */
export interface QuantumContext {
  torusMode: 'none' | 'cylinder' | 'full';
  infoMap: Map<string, CandidateInfo>;
}

/** context を省略した時の既定値 (torus 非適用・空 infoMap)。テスト向けフォールバック。 */
export const DEFAULT_QUANTUM_CONTEXT: QuantumContext = {
  torusMode: 'none',
  infoMap: new Map(),
};

/**
 * 呼び出し側で torusMode だけ渡したい時のヘルパ。infoMap は position から自動生成。
 * 通常は candidate_update 内部で自前で作るのでこのヘルパは外部呼び出し向け。
 */
export function makeQuantumContext(
  pos: Position,
  torusMode: 'none' | 'cylinder' | 'full' = 'none',
): QuantumContext {
  return { torusMode, infoMap: buildInitialInfoMap(pos) };
}

/**
 * 単一の制約。piece の現在の候補集合を狭める判断を返す。
 * 返り値 = その駒に「現時点で許される候補 PieceID 集合」。current candidates と交わって適用される。
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
  contextInput?: QuantumContext,
): Position {
  const constraints = pluginGet<QuantumConstraint[]>('quantum:constraints') ?? [];
  if (constraints.length === 0) return pos;

  // context.infoMap は「対局中不変な初期属性の map」なので反復途中で作り直す必要はない。
  // 呼び出し側で明示的に渡された context がある場合はそのまま尊重し (テスト向け)、
  // 無ければ pos から生成する。
  const context: QuantumContext = contextInput ?? {
    torusMode: 'none',
    infoMap: buildInitialInfoMap(pos),
  };

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
  // §Q7.5: 候補集合が 1 個に収縮したら確定 (C-301)。5-8 で正式実装するが
  // ここでは confirmed=true への遷移だけは行う (安全な副作用)。
  const confirmed = next.size === 1;
  return { ...piece, candidates: next, confirmed };
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
