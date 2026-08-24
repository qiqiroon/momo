import type { Mgf, MgfAbility, MgfPieceDef } from '../mgf/types';
import type { BoardMove, BoardTopology, PieceInstance, Position, Square } from '../position/types';
import { directionOffsets } from './directions';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { buildInitialKindMap, resolveCandidateKinds } from '../candidate-kinds';
import { canPromoteKind, forcedPromotionApplies, promotionChoicesOf, promotionTypeOf } from '../piece-rules';

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
    ? resolveCandidateKinds(mgf, piece.candidates, piece.promoted, buildInitialKindMap(position))
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

/**
 * 1 方向ぶんの行き先を集める。
 *
 * Phase 4: 盤の端がつながっている方向 (円筒＝左右／完全トーラス＝上下も) では、
 * 盤の外に出た座標を反対側へ回り込ませる (親 §3.4)。走り駒は**盤を一周して出発マスへ
 * 戻ったところで打ち切る**ので、回り込んでも無限に進み続けることはない。
 */
function collectDestinations(
  position: Position,
  piece: PieceInstance,
  from: Square,
  drow: number,
  dcol: number,
  ability: MgfAbility,
): Square[] {
  const dests: Square[] = [];
  const topology = topologyOf(position);
  const { width, height } = position;
  // 回り込む方向へ進むなら、一周ぶん進めるように上限を取る (斜めは縦横の周期が噛み合う
  // まで出発マスに戻らないことがあるので、マスの総数を上限にする)。
  const wraps = (dcol !== 0 && topology.wrapX) || (drow !== 0 && topology.wrapY);
  const unlimited = wraps ? width * height : Math.max(width, height);
  const maxRange = ability.range === -1 ? unlimited : ability.range;
  let cur = wrapSquare({ row: from.row + drow, col: from.col + dcol }, width, height, topology);
  let step = 1;
  while (step <= maxRange && cur !== null) {
    // 一周して出発マスへ戻った = ここから先は同じ道をなぞるだけなので止める
    if (cur.row === from.row && cur.col === from.col) break;
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
    cur = wrapSquare({ row: cur.row + drow, col: cur.col + dcol }, width, height, topology);
    step++;
  }
  return dests;
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
  const mustPromote = mustPromoteMove(mgf, def, piece, to, topologyOf(position));
  const push = (promote: boolean, promoteTo?: string) => {
    const key = `${to.row},${to.col},${promote ? 1 : 0},${promoteTo ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      type: 'move',
      pieceId: piece.pieceId,
      from,
      to,
      promote,
      ...(promoteTo !== undefined ? { promoteTo } : {}),
      capturedPieceId,
    });
  };
  // 【v1.65 §3.6.2】入れ替わる昇格は**昇格先ごとに別の手**になる (チェスのポーンは
  // クイーン・ルーク・ビショップ・ナイトの 4 通り)。**裏返る成りは従来どおり
  // 成る／成らないの二択**なので、ここは型で分ける。候補が 1 つだけのルールでは
  // 手は 1 つしか生まれない (選択が起きない)。
  const pushPromoted = () => {
    if (promotionTypeOf(def) === 'replace') {
      for (const choice of promotionChoicesOf(def)) push(true, choice);
    } else {
      push(true);
    }
  };
  if (mustPromote) {
    pushPromoted();
  } else if (canPromote) {
    push(false);
    pushPromoted();
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
  // 【v1.65 §3.6.2】「成れるか」は成りの型ごとに条件が違う (裏返る成りは成った姿が要る・
  // 入れ替わる昇格は昇格先の候補が要る)。piece-rules に集めた読み方を使う。
  if (!canPromoteKind(def)) return false;
  if (piece.promoted) return false;
  const zone = mgf.board.promotion_zone?.[piece.owner];
  if (!zone) return false;
  const inZone = (row: number) => {
    const rank = row + 1;
    return rank >= zone.min_rank && rank <= zone.max_rank;
  };
  return inZone(from.row) || inZone(to.row);
}

function mustPromoteMove(
  mgf: Mgf,
  def: MgfPieceDef,
  piece: PieceInstance,
  to: Square,
  topology: BoardTopology,
): boolean {
  if (!canPromoteKind(def)) return false;
  if (piece.promoted) return false;
  // Phase 4 (親 §3.9 v1.11 追記) / 【v1.65 §3.6.3】: 上下がつながっている盤 (完全トーラス)
  // には「行き所のない駒」が存在しないので、**その理由で必ず成る駒だけ**強制が外れる。
  // **ルールとしてそう決まっている駒 (チェスのポーン) は、つながっていても外れない**。
  if (!forcedPromotionApplies(def, topology.wrapY)) return false;
  const rank = to.row + 1;
  const enemyBackRank = piece.owner === 'player1' ? 1 : mgf.board.height;
  const distanceFromEnemyBack = Math.abs(rank - enemyBackRank);
  return distanceFromEnemyBack < (def.must_promote_at ?? 0);
}
