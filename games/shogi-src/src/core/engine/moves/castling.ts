/**
 * キャスリングを**生む側** (親 v1.65 §5.5.4・第 9 段 9-4c)。
 *
 * ここが受け持つのは「その局面でキャスリングを指せるか」と「指すとしたらどういう手か」
 * の 2 つだけ。**運ぶ側 (position/apply の並び) は 9-2 で既に出来ている**ので、本モジュールは
 * それを生むだけを担う (ポーンの特殊な手＝moves/pawn-special と同じ受け持ち方)。
 *
 * ★手の形 (§5.5.4「運び方」)
 * **王の 1 手として運び、ルークの動きは §3.7.1 の並びに書く**。手の種類は増やさない。
 * 「王が 2 マス動いたらキャスリング」とは決めない＝**自由ルールで王が滑る定義を作った
 * 瞬間に見分けがつかなくなる**ため、何が起きたかを手そのものに書く (§3.7.1)。
 *
 * ★相方の駒は**ルール定義が名指しする** (`constraints.castling.partner`・ユーザー判断
 * 2026-08-26)。ポーンのときのように動きの形で見分けないのは、**量子モードで効かなくなる**
 * ため——正体が未確定な駒は「段を走れる可能性」しか言えず、**ルークとクイーン (将棋なら
 * 飛車・龍) を区別できない**。それでは §Q23.3 の「キャスリングは王とルークの確定である」
 * に届かない (指した後に何に確定させるかを言えない)。**名指しなら「その駒の可能性を
 * 持っているか」がそのまま判定になり、確定させる先も決まる**。
 *
 * ★王の側は名指ししない＝**ルール定義が既に持っている「王である」印**をそのまま使う。
 *
 * ★量子モード (§Q23.3)
 * - **「一度も動いていない」は正体が未確定でも言える**＝駒は 1 枚ずつ追える。
 * - **王手にまつわる条件は、王が確定するまで自動的に真**＝この判定は legal.ts 側にあり、
 *   「確定した王がいるか」で分かれる。本モジュールは**攻撃されているかを一切見ない**
 *   (見ると利きの走査と互いに呼び合う輪ができる)。
 *
 * ★この一式は `constraints.castling` を持つルールでだけ動く。将棋・はさみ将棋・
 * トーラス将棋・量子将棋はこの指定を持たないので**素通り**する (縮退互換)。
 */

import type { Mgf } from '../mgf/types';
import type { BoardMove, Move, PieceId, PieceInstance, Position, Square } from '../position/types';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { buildInitialKindMap, resolveCandidateKinds } from '../candidate-kinds';

/**
 * 王が横へ動くマス数 (§5.5.4「王が横へ 2 マス動き、ルークが王を飛び越して隣へ」)。
 * ルークは**王が通ったマス** (＝王の出発点の隣) に着く。
 */
const KING_TRAVEL = 2;

/**
 * `from` にいる自分の駒についてのキャスリング (王側・女王側)。
 *
 * 呼ぶ側は `constraints.castling` があるときだけ呼ぶ。手番の駒であることは generator 側で
 * 確かめ済みなので、ここでは持ち主と正体の可能性だけを見る。
 */
export function castlingMoves(mgf: Mgf, position: Position, from: Square): BoardMove[] {
  const rule = mgf.constraints?.castling;
  if (!rule) return [];

  const king = position.board[from.row][from.col];
  if (!king) return [];
  // 王である可能性が残っていない駒はキャスリングできない (§Q23.3)。
  if (!couldBeRoyal(mgf, position, king)) return [];
  // 「一度も動いていない」= いま初期マスに居て、手の並びにも出てこない。
  if (from.row !== king.initialSquare.row || from.col !== king.initialSquare.col) return [];

  const moved = movedPieceIds(position);
  if (moved.has(king.pieceId)) return [];

  const moves: BoardMove[] = [];
  // **左右の両方を見る**。左右がつながった盤では、同じルークへ回り込んで届くこともある
  // (§5.5.7「両回りを許す」)＝回り込みを特別扱いしないという §3.4 の方針に揃える。
  for (const dcol of [1, -1]) {
    const move = castlingOneWay(mgf, position, from, dcol, king, rule.partner, moved);
    if (move) moves.push(move);
  }
  return moves;
}

/** 片側ぶん。`from` から `dcol` の向きへ進んで最初にぶつかった駒が相方なら 1 手になる。 */
function castlingOneWay(
  mgf: Mgf,
  position: Position,
  from: Square,
  dcol: number,
  king: PieceInstance,
  partnerKind: string,
  moved: Set<PieceId>,
): BoardMove | null {
  const { width, height } = position;
  const topology = topologyOf(position);

  let cur = wrapSquare({ row: from.row, col: from.col + dcol }, width, height, topology);
  let distance = 1;
  while (cur) {
    // 盤を一周して出発マスへ戻った＝この向きに相方は居ない。
    if (cur.row === from.row && cur.col === from.col) return null;
    const cell = position.board[cur.row][cur.col];
    if (cell) {
      // 最初にぶつかった駒が相方でなければ、この向きは成り立たない (間が空いていない)。
      if (cell.owner !== king.owner) return null;
      if (moved.has(cell.pieceId)) return null;
      if (cell.initialSquare.row !== cur.row || cell.initialSquare.col !== cur.col) return null;
      if (!couldBeKind(mgf, position, cell, partnerKind)) return null;
      // 王が動くぶんだけ離れていないと、王が相方のマスに乗ってしまう。
      if (distance <= KING_TRAVEL) return null;

      const to = wrapSquare(
        { row: from.row, col: from.col + dcol * KING_TRAVEL },
        width,
        height,
        topology,
      );
      const partnerTo = wrapSquare({ row: from.row, col: from.col + dcol }, width, height, topology);
      if (!to || !partnerTo) return null;

      // ★着地マスも通過マスも空である (上のループで空だと確かめて通ってきた)。
      // ★狙われていないかは legal.ts 側で見る (§Q23.3・利きの走査と呼び合わないため)。
      return {
        type: 'move',
        pieceId: king.pieceId,
        from,
        to,
        promote: false,
        extra_steps: [
          { pieceId: cell.pieceId, from: { ...cur }, dest: { kind: 'square', square: partnerTo } },
        ],
      };
    }
    cur = wrapSquare({ row: cur.row, col: cur.col + dcol }, width, height, topology);
    distance++;
  }
  return null;
}

/**
 * その手がキャスリングなら、**王が通り抜けるマス**を返す (キャスリングでなければ null)。
 *
 * ★**並びに書かれた相方の着地マスが、そのまま王の通過マス**である (§5.5.4 の「ルークが
 * 王を飛び越して隣へ」＝ルークは王が通ったマスに着く)。**向きを推し量る必要がない**ので、
 * 左右がつながった盤で回り込んだ手でも正しく出る。
 *
 * 着地マスは含めない＝**盤を 1 手進めて王手か見る**ほうで既に見ているため (legal.ts)。
 */
export function castlingPassThroughSquares(
  mgf: Mgf,
  position: Position,
  move: Move,
): Square[] | null {
  if (!mgf.constraints?.castling) return null;
  if (move.type !== 'move' || !move.extra_steps || move.extra_steps.length !== 1) return null;
  const mover = position.board[move.from.row][move.from.col];
  if (!mover || !couldBeRoyal(mgf, position, mover)) return null;
  const step = move.extra_steps[0];
  if (step.dest.kind !== 'square') return null;
  return [step.dest.square];
}

/**
 * その手が王側 (`O-O`) か女王側 (`O-O-O`) か (§5.5.6 の棋譜表記)。キャスリングでなければ null。
 *
 * ★**王の出発点から盤の端までが近いほうが「王側」**。チェスの王は e 列に立つので、
 * h 側 (3 マス) が王側・a 側 (4 マス) が女王側になり、先手・後手のどちらでも同じに出る。
 * **相方までの距離で決めない**＝左右がつながった盤では同じルークへ両回りで届き、
 * **距離が並ぶことがある**ため。真ん中に立っていて端までが並ぶときは、列の大きいほうを
 * 王側とする (どちらとも言えないので、決め方だけ固定しておく)。
 */
export function castlingSideOf(
  mgf: Mgf,
  position: Position,
  move: Move,
): 'king' | 'queen' | null {
  const passing = castlingPassThroughSquares(mgf, position, move);
  if (!passing || move.type !== 'move') return null;

  // 王の進む向き＝出発点から見た通過マスの側。回り込みも数に入れる。
  const width = position.width;
  const forward = (((passing[0].col - move.from.col) % width) + width) % width;
  const dcol = forward === 1 ? 1 : -1;

  const toRightEdge = width - 1 - move.from.col;
  const toLeftEdge = move.from.col;
  const kingSideIsRight = toRightEdge === toLeftEdge ? true : toRightEdge < toLeftEdge;
  return (dcol > 0) === kingSideIsRight ? 'king' : 'queen';
}

/**
 * **直前の手がキャスリングだったか** (§Q23.3 の絞り込み用)。動いた 2 枚の番号を返す。
 *
 * ★**指した後の盤から見る**ので、`castlingPassThroughSquares` (指す前を見る) とは別に要る。
 * ★**正体を見ずに、手に書かれた並びの形だけで見分ける**＝量子の絞り込みの途中で呼ばれる
 * ので、候補の絞り具合で答えが変わってはいけない。並びを持つ 3 つは形で分かれる——
 * **キャスリング**＝別の駒がマスへ／**アンパッサン**＝取り除きへ／**獅子の 2 回行動**＝
 * 同じ駒がもう一度。
 */
export function castlingStepOfLastMove(
  mgf: Mgf,
  position: Position,
): { moverId: PieceId; partnerId: PieceId } | null {
  if (!mgf.constraints?.castling) return null;
  const last = position.history[position.history.length - 1];
  if (!last || last.type !== 'move') return null;
  if (!last.extra_steps || last.extra_steps.length !== 1) return null;
  const step = last.extra_steps[0];
  if (step.dest.kind !== 'square') return null;
  if (step.pieceId === last.pieceId) return null;
  return { moverId: last.pieceId, partnerId: step.pieceId };
}

/** その駒に「王である」可能性が残っているか (本将棋モードは駒種そのもの)。 */
function couldBeRoyal(mgf: Mgf, position: Position, piece: PieceInstance): boolean {
  return kindsOf(mgf, position, piece).some(
    (kind) => mgf.pieces.find((p) => p.id === kind)?.is_royal === true,
  );
}

/** その駒に「駒種 `kind` である」可能性が残っているか。 */
function couldBeKind(mgf: Mgf, position: Position, piece: PieceInstance, kind: string): boolean {
  return kindsOf(mgf, position, piece).includes(kind);
}

/** その駒がいま名乗りうる駒種 (量子モードは候補ぶん・本将棋モードは 1 つ)。 */
function kindsOf(mgf: Mgf, position: Position, piece: PieceInstance): string[] {
  if (piece.candidates === undefined) return [piece.kind];
  return resolveCandidateKinds(mgf, piece.candidates, piece.promoted, buildInitialKindMap(position));
}

/**
 * これまでに 1 度でも動いた駒の番号 (§5.5.4「一度も動いていない」・§4.2.1)。
 *
 * ★**権利を局面に持たせない**＝正本は手の並び 1 本。**王が動いて元の場所に戻った局面と、
 * 一度も動いていない局面は盤を見ても区別が付かない**ので、手を遡って数える。
 * **並びで動いた駒も数える**＝キャスリングでルークが動いたことを取りこぼさない。
 */
function movedPieceIds(position: Position): Set<PieceId> {
  const ids = new Set<PieceId>();
  for (const m of position.history) {
    ids.add(m.pieceId);
    if (m.type === 'move' && m.extra_steps) {
      for (const step of m.extra_steps) ids.add(step.pieceId);
    }
  }
  return ids;
}
