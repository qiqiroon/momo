/**
 * 量子モード合法手制約群 C-101 〜 C-105 (Phase 5-6・§Q8.4 / Phase 5-6.5 で PieceID 化)。
 *
 * これらは per-piece に候補集合を狭める本命の制約群。「今の局面と各候補 PieceID (=初期駒)
 * の組合せで、現実的な指し手が説明できるか」を判定し、説明不能な候補を除外する。
 *
 * ## 制約一覧
 *
 * - **C-101 行動可能性**: 動いた駒の候補 PieceID X について、X の initialKind K の
 *   direction × range に (from, to) が乗るか判定。乗らなければ X を除外。
 * - **C-102 移動経路**: 5-6 初版は C-101 と同一。将来経路の history 妥当性検証に拡張予定。
 * - **C-103 二歩**: 同筋に自初期陣営の確定 fu-initial-PieceID が居るなら、
 *   この駒の候補から fu-initial-@同筋の PieceID を除外。torus ON で無効化。
 * - **C-104 行き所のない駒**: 敵陣最奥から N 段以内に居るのに不成のままでは合法手ゼロ
 *   になる初期駒種を候補から除外 (dead_zone)。torus ON で無効化。
 * - **C-105 強制成り**: must_promote 圏内なのに piece.promoted=false なら、
 *   「成っていなければおかしい」候補 PieceID (K として must_promote 対象) を除外。
 *
 * すべての制約は候補 PieceID を context.infoMap で「初期 kind / 初期位置 / 初期陣営」に
 * resolve してから既存の kind ベースロジックを適用する。
 */

import type { Mgf, Player } from '../../../core/engine/mgf/types';
import type { PieceId, Square } from '../../../core/engine/position/types';
import { directionOffsets } from '../../../core/engine/moves/directions';
import type {
  QuantumConstraint,
  QuantumPieceLocation,
} from '../candidate-update';
import type { CandidateInfo } from '../piece-lookup';

/**
 * 「盤上を kind K の駒だったとみなして、(from, to) の移動を説明できるか」を判定する。
 * §Q5/§Q7 の C-101 は「今の局面で説明可能な候補だけを残す」もので、実測ベースの
 * narrowing 判定 (静的な "動けるか" 一般論ではない)。よって:
 *   - direction × range の組合せに (dr, dc) が乗るか (方向マッチ)
 *   - slide/step/jump のいずれかの型で許される移動長か
 * だけをチェックする。実際にその move が成立したという事実により、途中の
 * 経路が空いていた/居ても道が繋がっていたことは確定しているので、盤面走査は不要。
 */
function canKindExplainMove(
  kind: string,
  from: Square,
  to: Square,
  owner: Player,
  mgf: Mgf,
): boolean {
  const def = mgf.pieces.find((p) => p.id === kind);
  if (!def || !def.move_logic) return false;

  const dr = to.row - from.row;
  const dc = to.col - from.col;

  for (const ability of def.move_logic.abilities) {
    const offsets = directionOffsets(ability.direction, owner);
    const maxRange =
      ability.range === -1 ? Math.max(mgf.board.width, mgf.board.height) : ability.range;
    for (const { drow, dcol } of offsets) {
      for (let s = 1; s <= maxRange; s++) {
        if (drow * s === dr && dcol * s === dc) return true;
        if (ability.type === 'step' || ability.type === 'jump') break;
      }
    }
  }
  return false;
}

/**
 * candidate PieceID → initialKind を context.infoMap から取り出す。
 * 見つからない場合は undefined (テスト等の orphan 候補で発生し得る)。
 */
function resolveInitialKind(context: { infoMap: Map<string, CandidateInfo> }, pid: PieceId): string | undefined {
  return context.infoMap.get(pid)?.initialKind;
}

/**
 * C-101 行動可能性 (§Q7 の正しい意味論): 直近の指し手が候補 PieceID X の initialKind K
 * として説明できるか。
 *
 * candidate_update は applyMove の直後に呼ばれるので、pos.history の末尾は「今回動いた
 * piece の move」。その move の (from, to) 差分をとり、K の direction × range に
 * 一致するかを機械的にチェック。説明不能な X は候補から除外する。
 *
 * 動いていない駒 (piece.pieceId !== lastMove.pieceId) や持ち駒はこの制約で狭まらない。
 */
export const c101ActionPossibility: QuantumConstraint = (piece, location, pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (location.kind !== 'board') return new Set(piece.candidates);
  const lastMove = pos.history[pos.history.length - 1];
  if (!lastMove || lastMove.type !== 'move') return new Set(piece.candidates);
  if (lastMove.pieceId !== piece.pieceId) return new Set(piece.candidates);

  const survivors = new Set<PieceId>();
  for (const pid of piece.candidates) {
    const initialKind = resolveInitialKind(context, pid);
    if (initialKind === undefined) continue;
    // 現在 promoted なら promoted_id の abilities で判定する。C-105 は piece.promoted=false
    // かつ dead_zone 圏内の case を別に処理するので、ここは piece.promoted=true の場合
    // 「その pid の promoted 版」で説明可能かをチェック。
    const testKind = piece.promoted
      ? (mgf.pieces.find((p) => p.id === initialKind)?.promoted_id ?? initialKind)
      : initialKind;
    if (canKindExplainMove(testKind, lastMove.from, lastMove.to, piece.owner, mgf)) {
      survivors.add(pid);
    }
  }
  return survivors;
};

/**
 * C-102 移動経路: 飛び駒の経路成立。5-6 初版は C-101 と等価。
 */
export const c102MovePathIntegrity: QuantumConstraint = c101ActionPossibility;

/** C-103 二歩: 同筋に自初期陣営の確定 fu (initialKind='fu') が居るなら、
 *  この駒の候補から「自初期陣営の fu-initial かつ initialSquare.col == 同筋」の PieceID を除外。
 *  厳密には initialKind='fu' の初期駒はどれでも「歩として盤上に居られる」ので、
 *  fu を候補に持てる余地を残すのは「別の fu-initial-@col C が該当筋に確定していない」ときのみ。
 *  簡易に: 現在 col に既に fu 確定駒が居るなら、この駒の候補から「fu 系候補」を全部除外する。
 */
export const c103Nifu: QuantumConstraint = (piece, location, pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (mgf.constraints?.nifu !== true) return new Set(piece.candidates);
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  if (location.kind !== 'board') return new Set(piece.candidates);

  const col = location.square.col;
  const myInitial = piece.initialOwner;
  const myId = piece.pieceId;

  // その筋に「自初期陣営の confirmed fu」が居るか探す。
  let filesHasConfirmedFu = false;
  for (let r = 0; r < pos.height; r++) {
    const cell = pos.board[r][col];
    if (!cell || cell.pieceId === myId) continue;
    if (cell.initialOwner !== myInitial) continue;
    if (cell.promoted) continue;
    // 本将棋モード (candidates 無) では kind で判定
    if (cell.candidates === undefined) {
      if (cell.kind === 'fu') { filesHasConfirmedFu = true; break; }
      continue;
    }
    // 量子モード: 確定 & 単一 & その候補 PieceID の initialKind == 'fu' なら fu 確定
    if (cell.confirmed && cell.candidates.size === 1) {
      const only = Array.from(cell.candidates)[0];
      const info = context.infoMap.get(only);
      if (info?.initialKind === 'fu') { filesHasConfirmedFu = true; break; }
    }
  }
  if (!filesHasConfirmedFu) return new Set(piece.candidates);

  // fu-initial の候補 PieceID を全部除外
  const narrowed = new Set<PieceId>();
  for (const pid of piece.candidates) {
    const info = context.infoMap.get(pid);
    if (info?.initialKind === 'fu') continue;
    narrowed.add(pid);
  }
  return narrowed;
};

/**
 * C-104 行き所のない駒: 敵陣最奥から def.must_promote_at 段以内で不成の候補は除外。
 * PieceID 候補 X について、X の initialKind K が must_promote_at ≥ (現在の距離+1) なら
 * 「K で不成のまま居られない」ので X を除外。
 */
export const c104DeadZone: QuantumConstraint = (piece, location, _pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  if (mgf.constraints?.dead_zone !== 'auto' && mgf.constraints?.dead_zone !== true) {
    return new Set(piece.candidates);
  }
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);

  const survivors = new Set<PieceId>();
  const rank = location.square.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);

  for (const pid of piece.candidates) {
    const info = context.infoMap.get(pid);
    if (!info) { survivors.add(pid); continue; }
    const def = mgf.pieces.find((p) => p.id === info.initialKind);
    if (!def) { survivors.add(pid); continue; }
    if (!def.must_promote_at || def.must_promote_at === 0) { survivors.add(pid); continue; }
    if (distanceFromEnemyBack < def.must_promote_at) continue;
    survivors.add(pid);
  }
  return survivors;
};

/**
 * C-105 強制成り: piece が must_promote 圏内に居るのに promoted=false なら、
 * 当該候補 PieceID X の initialKind K は成らずには行き着けないので除外。
 */
export const c105ForcedPromotion: QuantumConstraint = (piece, location, _pos, mgf, context) => {
  if (piece.candidates === undefined) return new Set();
  if (context.torusMode !== 'none') return new Set(piece.candidates);
  if (location.kind !== 'board') return new Set(piece.candidates);
  if (piece.promoted) return new Set(piece.candidates);

  const survivors = new Set<PieceId>();
  const rank = location.square.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);

  for (const pid of piece.candidates) {
    const info = context.infoMap.get(pid);
    if (!info) { survivors.add(pid); continue; }
    const def = mgf.pieces.find((p) => p.id === info.initialKind);
    if (!def) { survivors.add(pid); continue; }
    if (!def.can_promote) { survivors.add(pid); continue; }
    if (!def.must_promote_at || def.must_promote_at === 0) { survivors.add(pid); continue; }
    if (distanceFromEnemyBack < def.must_promote_at) continue;
    survivors.add(pid);
  }
  return survivors;
};

/**
 * `register('quantum:constraints', [...basicConstraints, ...legalConstraints, ...propagationConstraints])`
 * として `index.ts` から結合登録される順序付き配列。
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
