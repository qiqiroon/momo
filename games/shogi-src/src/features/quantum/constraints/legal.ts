/**
 * 量子モード合法手制約群 C-101 〜 C-105 (Phase 5-6・§Q8.4)。
 *
 * これらは per-piece に候補集合を狭める本命の制約群。「今の局面と各候補駒種の
 * 組合せで、現実的な指し手が説明できるか」を判定し、説明不能な候補を除外する。
 *
 * ## 制約一覧
 *
 * - **C-101 行動可能性**: 候補駒種 K として、この駒の現在位置から少なくとも 1 つ
 *   合法手が生成できるか。無ければ K は「立ち往生している = ここに居られない駒種」
 *   として除外。
 * - **C-102 移動経路**: 飛び駒 (香・角・飛・馬・龍) の直近移動経路が塞がっていない
 *   ことを確認。※現状は C-101 の hasAnyMovesAs で generatePieceMoves 経由の path
 *   チェックが働くので、5-6 初版はここに追加ロジックを置かず C-101 に委ねる。
 *   将来「直近着手の path 妥当性を history から検証」する版に拡張予定。
 * - **C-103 二歩**: 同じ筋 (col) に自初期陣営の既確定な歩 (fu, 不成) がいれば、
 *   この駒の候補から fu を除外。torus ON 時は無効化。
 * - **C-104 行き所のない駒**: 端段の桂/香/歩など、その位置で K として不成のままでは
 *   合法手ゼロになる駒種を除外 (dead_zone)。torus ON 時は無効化。
 * - **C-105 強制成り**: 移動先で kind K が must_promote 圏内 (敵陣最奥から N 段以内) に
 *   居るのに piece.promoted=false なら、K は「既に成っていなければおかしい」ので除外。
 *
 * 現状 C-101 と C-104/C-105 は結果的にかなり重なる (どれも「そこで動けない候補を落と
 * す」)。§Q8.4 の分類に忠実に別関数として提供し、テストで各観点を明示できるようにする。
 */

import type { Mgf } from '../../../core/engine/mgf/types';
import type { PieceInstance, Position } from '../../../core/engine/position/types';
import { generatePieceMoves } from '../../../core/engine/moves/generator';
import type {
  QuantumConstraint,
  QuantumPieceLocation,
} from '../candidate-update';

/**
 * 「piece が kind K の駒だったとして、盤上の現在位置から合法手 (擬合法) が
 * 1 つでも生成できるか」を判定するヘルパー。piece.candidates を一時的に {K} に
 * 差し替えた fake position を作り、既存の generatePieceMoves を借用する。
 *
 * 手番と関係なく確認したいので sideToMove も piece.owner に一時セットする。
 */
function hasAnyMovesAsKind(
  kind: string,
  piece: PieceInstance,
  square: { row: number; col: number },
  pos: Position,
  mgf: Mgf,
): boolean {
  const fakePiece: PieceInstance = { ...piece, candidates: new Set([kind]) };
  const fakeBoard = pos.board.map((row, r) =>
    row.map((cell, c) => (r === square.row && c === square.col ? fakePiece : cell)),
  );
  const fakePos: Position = { ...pos, board: fakeBoard, sideToMove: piece.owner };
  const moves = generatePieceMoves(mgf, fakePos, square);
  return moves.length > 0;
}

/** C-101 行動可能性: 候補駒種 K として現在位置から動ける手があるか。 */
export const c101ActionPossibility: QuantumConstraint = (
  piece,
  location,
  pos,
  mgf,
  _context,
) => {
  if (piece.candidates === undefined) return new Set();
  // 持ち駒は「動く」概念が無いので狭めない (打つ時の合法性は別途 legal.ts で扱う)。
  if (location.kind !== 'board') return new Set(piece.candidates);
  const survivors = new Set<string>();
  for (const k of piece.candidates) {
    if (hasAnyMovesAsKind(k, piece, location.square, pos, mgf)) survivors.add(k);
  }
  return survivors;
};

/**
 * C-102 移動経路: 飛び駒の経路成立。5-6 初版は C-101 の hasAnyMovesAs で
 * generatePieceMoves が path 遮断を考慮するため、追加ロジックは不要。
 * ここは「同じ動きで path check する no-op」として現状 C-101 と等価な結果を返す。
 * §Q7 の履歴依存版 (直近着手の path を history から再現) は 5-15 以降で拡張予定。
 */
export const c102MovePathIntegrity: QuantumConstraint = c101ActionPossibility;

/** C-103 二歩: 同筋に自初期陣営の確定 fu (不成) が居るなら候補から fu 除外。 */
export const c103Nifu: QuantumConstraint = (piece, location, pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (!piece.candidates.has('fu')) return new Set(piece.candidates);
  if (mgf.constraints?.nifu !== true) return new Set(piece.candidates);
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  // 盤上の駒しか筋を持たない (持ち駒は打つ時に isDropAllowed でチェック)
  if (location.kind !== 'board') return new Set(piece.candidates);

  const col = location.square.col;
  const myInitial = piece.initialOwner;
  const myId = piece.pieceId;
  for (let r = 0; r < pos.height; r++) {
    const cell = pos.board[r][col];
    if (!cell || cell.pieceId === myId) continue;
    if (cell.initialOwner !== myInitial) continue;
    // 本将棋モード: kind でチェック
    if (cell.candidates === undefined) {
      if (cell.kind === 'fu' && !cell.promoted) {
        const narrowed = new Set(piece.candidates);
        narrowed.delete('fu');
        return narrowed;
      }
      continue;
    }
    // 量子モード: 確定 & fu 単独のみを「筋を塞ぐ」判断に採用 (保守的)
    if (cell.confirmed && cell.candidates.size === 1 && cell.candidates.has('fu') && !cell.promoted) {
      const narrowed = new Set(piece.candidates);
      narrowed.delete('fu');
      return narrowed;
    }
  }
  return new Set(piece.candidates);
};

/**
 * C-104 行き所のない駒: 敵陣最奥から def.must_promote_at 段以内で不成の候補は除外。
 * 例: player1 の歩 (must_promote_at=1) は敵陣最奥 (rank 1) では成らずに居られないので
 *   候補から fu を落とす。桂 (must_promote_at=2) は rank 1/2 で不成不可。
 * 既に promoted=true の駒は成りバリアントで居るので該当外。
 * torus ON 時は端段が繋がって「行き所」が生まれるので無効化。
 */
export const c104DeadZone: QuantumConstraint = (piece, location, _pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  if (mgf.constraints?.dead_zone !== 'auto' && mgf.constraints?.dead_zone !== true) {
    return new Set(piece.candidates);
  }
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);

  const survivors = new Set<string>();
  const rank = location.square.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);

  for (const k of piece.candidates) {
    const def = mgf.pieces.find((p) => p.id === k);
    if (!def) continue;
    if (!def.must_promote_at || def.must_promote_at === 0) {
      survivors.add(k);
      continue;
    }
    // 敵陣最奥からの距離が must_promote_at 未満 → K で不成のまま居られない
    if (distanceFromEnemyBack < def.must_promote_at) continue;
    survivors.add(k);
  }
  return survivors;
};

/**
 * C-105 強制成り: piece が must_promote 圏内に居るのに promoted=false なら、
 * 当該駒種 K は成らずには行き着けないので候補から除外。C-104 と重なる部分が
 * あるが、こちらは「成るべきだったのに成っていない」ロジック視点で分離。
 * torus ON 時は最奥段が繋がるので基本無効化 (must_promote_at のロジック自体は
 * ボードトポロジー依存)。
 */
export const c105ForcedPromotion: QuantumConstraint = (piece, location, _pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);

  const survivors = new Set<string>();
  const rank = location.square.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);

  for (const k of piece.candidates) {
    const def = mgf.pieces.find((p) => p.id === k);
    if (!def) continue;
    if (!def.can_promote) {
      survivors.add(k);
      continue;
    }
    if (!def.must_promote_at || def.must_promote_at === 0) {
      survivors.add(k);
      continue;
    }
    // 敵陣最奥から must_promote_at 段以内で不成なら、K は必ず成っているはず
    if (distanceFromEnemyBack < def.must_promote_at) continue;
    survivors.add(k);
  }
  return survivors;
};

/**
 * `register('quantum:constraints', [...basicConstraints, ...legalConstraints])` として
 * `index.ts` から結合登録される順序付き配列。
 */
export const legalConstraints: QuantumConstraint[] = [
  c101ActionPossibility,
  c102MovePathIntegrity,
  c103Nifu,
  c104DeadZone,
  c105ForcedPromotion,
];

/** テスト用の型別名エクスポート (basic.ts と同型)。 */
export type LegalConstraintLocation = QuantumPieceLocation;
