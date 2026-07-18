/**
 * 量子モード基本制約群 C-001 / C-002 / C-003 (Phase 5-5・§Q8.3)。
 *
 * これらは「候補集合を狭める per-piece 制約」というより **フレームワーク不変条件**
 * に近い性質を持つ。実装は 2 種類に分かれる:
 *
 * 1. **不変条件チェック関数** (`checkC001InitialOwnerPreserved`,
 *    `checkC002CandidatesMonotone`) — candidate_update 側で最後にまとめて呼び、
 *    違反があれば throw する。C-001/C-002 の効力はここで発揮される。
 *
 * 2. **`basicConstraints` 配列** — `register('quantum:constraints', ...)` に流し込む
 *    ための入れ物。現時点では 3 つとも「piece.candidates をそのまま返す no-op」
 *    に留めている。将来 (5-6 以降) で per-piece レベルの追加チェックを詰め込む
 *    受け枠として存在する。
 *
 * ## C-001 initialOwner 保持
 * PieceInstance.initialOwner は対局中一切変更されない (捕獲で owner が反転しても
 * initialOwner はそのまま)。§Q8.3 の基本前提であり、C-101 二歩や §Q12 王候補判定
 * が initialOwner を頼っているため、破ると根本が崩れる。
 *
 * ## C-002 候補集合の単調非増加
 * candidate は縮小 (除外) または確定はできるが、追加は禁止。framework の
 * intersect で自然に成立するが、外部から Position を直接いじる不正パスがあれば
 * 検出する。
 *
 * ## C-003 変化検出後の全体再評価
 * ある駒の候補集合が変化したら、その駒に影響される制約は他の駒についても
 * 再評価する必要がある。5-4 の candidate_update が AC-3 スタイルの安定状態
 * 反復ループとして既に実装している (`applyConstraintsOnce` の changed 検知)。
 * ここでは追加コードなし。
 */

import type { PieceInstance, Position } from '../../../core/engine/position/types';
import type { QuantumConstraint } from '../candidate-update';

/** C-001 違反時に throw される Error。テストで型判別する用途。 */
export class C001Violation extends Error {
  constructor(message: string) {
    super(`C-001 (initialOwner preserved): ${message}`);
    this.name = 'C001Violation';
  }
}

/** C-002 違反時に throw される Error。 */
export class C002Violation extends Error {
  constructor(message: string) {
    super(`C-002 (candidates monotone non-increasing): ${message}`);
    this.name = 'C002Violation';
  }
}

/**
 * C-001: candidate_update 呼び出し前後で、全駒の initialOwner が変化していないこと。
 * 変化していたら C001Violation を throw する。
 */
export function checkC001InitialOwnerPreserved(before: Position, after: Position): void {
  // 盤上駒 (pieceId をキーに map)
  const beforeIdMap = new Map<string, PieceInstance>();
  for (const row of before.board) {
    for (const cell of row) if (cell) beforeIdMap.set(cell.pieceId, cell);
  }
  for (const p of before.hands.player1) beforeIdMap.set(p.pieceId, p);
  for (const p of before.hands.player2) beforeIdMap.set(p.pieceId, p);

  const check = (piece: PieceInstance): void => {
    const orig = beforeIdMap.get(piece.pieceId);
    if (!orig) return; // 新規追加された駒は対象外 (捕獲などで持ち駒に移動した場合等)
    if (orig.initialOwner !== piece.initialOwner) {
      throw new C001Violation(
        `pieceId=${piece.pieceId}: initialOwner ${orig.initialOwner} → ${piece.initialOwner}`,
      );
    }
  };

  for (const row of after.board) {
    for (const cell of row) if (cell) check(cell);
  }
  for (const p of after.hands.player1) check(p);
  for (const p of after.hands.player2) check(p);
}

/**
 * C-002: candidate_update 呼び出し前後で、全駒の候補集合が単調非増加であること。
 * つまり `after.candidates ⊆ before.candidates` 。追加が検出されたら C002Violation。
 * candidates=undefined の駒 (本将棋モード) は check 対象外。
 */
export function checkC002CandidatesMonotone(before: Position, after: Position): void {
  const beforeIdMap = new Map<string, PieceInstance>();
  for (const row of before.board) {
    for (const cell of row) if (cell) beforeIdMap.set(cell.pieceId, cell);
  }
  for (const p of before.hands.player1) beforeIdMap.set(p.pieceId, p);
  for (const p of before.hands.player2) beforeIdMap.set(p.pieceId, p);

  const check = (piece: PieceInstance): void => {
    if (piece.candidates === undefined) return;
    const orig = beforeIdMap.get(piece.pieceId);
    if (!orig || orig.candidates === undefined) return; // 元が縮退状態なら比較不能
    for (const kind of piece.candidates) {
      if (!orig.candidates.has(kind)) {
        throw new C002Violation(
          `pieceId=${piece.pieceId}: kind "${kind}" was not in original candidates ` +
          `[${Array.from(orig.candidates).sort().join(',')}]`,
        );
      }
    }
  };

  for (const row of after.board) {
    for (const cell of row) if (cell) check(cell);
  }
  for (const p of after.hands.player1) check(p);
  for (const p of after.hands.player2) check(p);
}

/**
 * §Q8.3 C-001 に対応する per-piece 制約。現時点では狭めない (piece.candidates を
 * そのまま返す)。将来ここで initial 所属由来のチェックを追加する余地あり。
 */
const c001Constraint: QuantumConstraint = (piece, _location, _pos, _mgf, _context) => piece.candidates ?? new Set();

/**
 * §Q8.3 C-002 に対応する per-piece 制約。現時点では狭めない。framework が intersect
 * で自動的に単調非増加を保つが、per-piece レベルで追加チェックを詰めたくなった時の
 * 受け枠として残す。
 */
const c002Constraint: QuantumConstraint = (piece, _location, _pos, _mgf, _context) => piece.candidates ?? new Set();

/**
 * §Q8.3 C-003 に対応する per-piece 制約。framework の反復ループ (AC-3) 自体が
 * C-003 を実装しているので per-piece コードは不要。この Constraint は登録の
 * 一貫性を保つための no-op。
 */
const c003Constraint: QuantumConstraint = (piece, _location, _pos, _mgf, _context) => piece.candidates ?? new Set();

/**
 * `register('quantum:constraints', basicConstraints)` に流し込む配列。
 * 現時点では 3 つとも no-op だが、5-6 以降で per-piece の実際の狭め制約が
 * 別ファイル (`legal.ts` / `capture.ts` 等) に追加され、この配列と結合される。
 */
export const basicConstraints: QuantumConstraint[] = [
  c001Constraint,
  c002Constraint,
  c003Constraint,
];
