import type { Mgf, MgfAbility, MgfPieceDef } from '../mgf/types';
import type { BoardMove, PieceId, PieceInstance, Position, Square } from '../position/types';
import { directionOffsets } from './directions';

/**
 * 盤上の指定マスの駒について、擬合法手 (pseudo-legal moves) を生成する。
 * 反則 (nifu, uchifu_tsume, suicide, dead_zone) の除外は段階1-4、
 * 自玉が王手状態になる手の除外は段階1-6 で行う。
 *
 * 量子モード (Phase 5-6.5 移行後): `piece.candidates` が定義されている場合、
 * 各候補 PieceID を position 内でスキャンして initialKind を取り出し、
 * その kind の abilities を union して合法先を返す (§Q5.3)。
 * 現在成っている駒 (`piece.promoted`) は成り駒側の abilities を使う (成った駒は成り駒として動く)。
 * candidates 未定義なら従来通り `piece.kind` 単一で動作する (縮退互換)。
 */
export function generatePieceMoves(mgf: Mgf, position: Position, from: Square): BoardMove[] {
  const piece = position.board[from.row][from.col];
  if (!piece) return [];
  if (piece.owner !== position.sideToMove) return [];

  const candidateKinds = piece.candidates
    ? resolveCandidateKinds(position, mgf, piece.candidates, piece.promoted)
    : [piece.kind];

  const moves: BoardMove[] = [];
  const seen = new Set<string>();

  for (const kind of candidateKinds) {
    const def = mgf.pieces.find((p) => p.id === kind);
    if (!def || !def.move_logic) continue;
    for (const ability of def.move_logic.abilities) {
      const offsets = directionOffsets(ability.direction, piece.owner);
      for (const { drow, dcol } of offsets) {
        const destinations = collectDestinations(position, piece, from, drow, dcol, ability);
        for (const to of destinations) {
          pushMoves(mgf, def, piece, from, to, position, moves, seen);
        }
      }
    }
  }
  return moves;
}

/**
 * 候補 PieceID 集合を「実際に動きを問い合わせる kind の配列」に resolve する。
 * PieceID → position 内スキャンで initialKind 取得 → 成っているならその kind の promoted_id に差し替え。
 * 見つからない PieceID (テスト等での orphan 参照) は無視。
 */
function resolveCandidateKinds(
  position: Position,
  mgf: Mgf,
  candidates: ReadonlySet<PieceId>,
  promoted: boolean,
): string[] {
  const kinds = new Set<string>();
  for (const pid of candidates) {
    const info = findInitialKind(position, pid);
    if (info === undefined) continue;
    if (promoted) {
      // 現在成っている駒 = そのまま成り駒として動く。initialKind の promoted_id を使う。
      const def = mgf.pieces.find((p) => p.id === info);
      if (def?.promoted_id) kinds.add(def.promoted_id);
      // 成れない駒 (kin/ou 等) が候補にあれば実質不整合だが、ここでは静かに落とす。
    } else {
      kinds.add(info);
    }
  }
  return Array.from(kinds);
}

/**
 * position 内 (盤上・両手駒) で pieceId を検索し initialKind を返す。
 * 内部の O(N) スキャン。generatePieceMoves は駒 1 枚あたり |candidates|≦40 回この関数を呼ぶが、
 * 通常局面では O(40×40) = 1600 回程度で十分速い。将来ホットになったら infoMap 化で対応。
 */
function findInitialKind(position: Position, pieceId: PieceId): string | undefined {
  for (const row of position.board) {
    for (const cell of row) {
      if (cell && cell.pieceId === pieceId) return cell.initialKind;
    }
  }
  for (const p of position.hands.player1) if (p.pieceId === pieceId) return p.initialKind;
  for (const p of position.hands.player2) if (p.pieceId === pieceId) return p.initialKind;
  return undefined;
}

/**
 * 全ての盤上駒について擬合法手を集める。
 */
export function generateAllBoardMoves(mgf: Mgf, position: Position): BoardMove[] {
  const moves: BoardMove[] = [];
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (cell && cell.owner === position.sideToMove) {
        moves.push(...generatePieceMoves(mgf, position, { row, col }));
      }
    }
  }
  return moves;
}

function collectDestinations(
  position: Position,
  piece: PieceInstance,
  from: Square,
  drow: number,
  dcol: number,
  ability: MgfAbility,
): Square[] {
  const dests: Square[] = [];
  const maxRange = ability.range === -1 ? Math.max(position.width, position.height) : ability.range;
  let cur = { row: from.row + drow, col: from.col + dcol };
  let step = 1;
  while (step <= maxRange && inBounds(cur, position)) {
    const target = position.board[cur.row][cur.col];
    if (target === null) {
      if (ability.can_move_to_empty !== false) dests.push({ ...cur });
    } else if (target.owner !== piece.owner) {
      if (ability.can_capture !== false) dests.push({ ...cur });
      break;
    } else {
      break;
    }
    if (ability.type === 'step' || ability.type === 'jump') break;
    cur = { row: cur.row + drow, col: cur.col + dcol };
    step++;
  }
  return dests;
}

function inBounds(sq: Square, position: Position): boolean {
  return sq.row >= 0 && sq.row < position.height && sq.col >= 0 && sq.col < position.width;
}

function pushMoves(
  mgf: Mgf,
  def: MgfPieceDef,
  piece: PieceInstance,
  from: Square,
  to: Square,
  position: Position,
  out: BoardMove[],
  seen: Set<string>,
): void {
  const capturedPieceId = position.board[to.row][to.col]?.pieceId;
  const canPromote = canPromoteMove(mgf, def, piece, from, to);
  const mustPromote = mustPromoteMove(mgf, def, piece, to);
  const push = (promote: boolean) => {
    const key = `${to.row},${to.col},${promote ? 1 : 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ type: 'move', pieceId: piece.pieceId, from, to, promote, capturedPieceId });
  };
  if (mustPromote) {
    push(true);
  } else if (canPromote) {
    push(false);
    push(true);
  } else {
    push(false);
  }
}

function canPromoteMove(
  mgf: Mgf,
  def: MgfPieceDef,
  piece: PieceInstance,
  from: Square,
  to: Square,
): boolean {
  if (!def.can_promote || !def.promoted_id) return false;
  if (piece.promoted) return false;
  const zone = mgf.board.promotion_zone?.[piece.owner];
  if (!zone) return false;
  const inZone = (row: number) => {
    const rank = row + 1;
    return rank >= zone.min_rank && rank <= zone.max_rank;
  };
  return inZone(from.row) || inZone(to.row);
}

function mustPromoteMove(mgf: Mgf, def: MgfPieceDef, piece: PieceInstance, to: Square): boolean {
  if (!def.can_promote) return false;
  if (piece.promoted) return false;
  if (!def.must_promote_at || def.must_promote_at === 0) return false;
  const rank = to.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);
  return distanceFromEnemyBack < def.must_promote_at;
}
