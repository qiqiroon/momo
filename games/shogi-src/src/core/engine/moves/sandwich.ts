import type { Mgf, MgfPostMoveTopology, Player } from '../mgf/types';
import type { Position, Square } from '../position/types';
import { topologyOf, wrapSquare } from '../position/coordinates';

/**
 * 挟んで取る決まり (親 §3.8 `post_move_topology`・§5.3 はさみ将棋)。
 *
 * **着手の直後に 1 回だけ**判定する。動かした駒を起点に、縦横 (定義次第で他の向きも) を
 * 見て、相手の駒が 1 枚以上続いたあとに自分の駒があれば、その続いたぶんをまとめて取る。
 * 取った結果として新たに成立した挟みは解決しない (連鎖しない = 次の着手で改めて見る)。
 *
 * **盤の端がつながっている方向 (円筒・完全トーラス) では、走査も回り込む**。
 * つながった方向には端が無いので、`own_piece_or_board_edge` の端条件も隅の囲み取りも
 * その方向については成立しない (親 §3.8 の合成規則)。
 */

/** 縦横 4 方向。斜めを足したくなったら axis に合わせてここへ足す。 */
const AXIS_OFFSETS: Record<string, { drow: number; dcol: number }[]> = {
  horizontal: [
    { drow: 0, dcol: 1 },
    { drow: 0, dcol: -1 },
  ],
  vertical: [
    { drow: 1, dcol: 0 },
    { drow: -1, dcol: 0 },
  ],
};

function offsetsFor(rule: MgfPostMoveTopology): { drow: number; dcol: number }[] {
  const axes = rule.axis ?? ['horizontal', 'vertical'];
  return axes.flatMap((a) => AXIS_OFFSETS[a] ?? []);
}

/**
 * そのマスが「盤の隅」か。
 *
 * **つながっている方向には端が無い**ので、円筒 (左右がつながる) では隅は存在しない。
 * 完全トーラスでも同様。平面のときだけ四隅が隅になる。
 */
function isCornerSquare(position: Position, sq: Square): boolean {
  const topology = topologyOf(position);
  if (topology.wrapX || topology.wrapY) return false;
  const atColEdge = sq.col === 0 || sq.col === position.width - 1;
  const atRowEdge = sq.row === 0 || sq.row === position.height - 1;
  return atColEdge && atRowEdge;
}

/**
 * 着手で取られる駒 (盤から消える駒) の PieceID を返す。
 * 挟みの決まりを持たないルールでは常に空。
 */
export function sandwichCaptures(mgf: Mgf, position: Position, to: Square): string[] {
  const rule = mgf.capture_rules?.post_move_topology;
  if (!rule || rule.condition !== 'sandwich') return [];
  const mover = position.board[to.row][to.col];
  if (!mover) return [];

  // 既定は「動かした駒を起点にだけ」。mover_only=false のルールでは着手した側の
  // すべての駒を起点に見る (取られるのはどちらの場合も相手の駒だけ)。
  const origins: Square[] = rule.mover_only === false ? ownPieceSquares(position, mover.owner) : [to];

  const captured = new Set<string>();
  for (const origin of origins) {
    for (const id of runCaptures(rule, position, origin, mover.owner)) captured.add(id);
    if (rule.corner_enclosure) {
      for (const id of cornerCaptures(rule, position, origin, mover.owner)) captured.add(id);
    }
  }
  return [...captured];
}

/** その陣営の駒があるマスを集める (mover_only=false のとき起点にする)。 */
function ownPieceSquares(position: Position, owner: Player): Square[] {
  const squares: Square[] = [];
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      if (position.board[row][col]?.owner === owner) squares.push({ row, col });
    }
  }
  return squares;
}

/** 起点の駒から 1 方向ずつ見て、挟んだ相手の駒をまとめて取る。 */
function runCaptures(
  rule: MgfPostMoveTopology,
  position: Position,
  from: Square,
  mover: Player,
): string[] {
  const topology = topologyOf(position);
  const { width, height } = position;
  const captured: string[] = [];

  for (const { drow, dcol } of offsetsFor(rule)) {
    const run: string[] = [];
    let closed = false;
    let cur = wrapSquare({ row: from.row + drow, col: from.col + dcol }, width, height, topology);
    // 一周して出発マスへ戻ったら打ち切る (つながった盤で回り続けないように)
    while (cur && !(cur.row === from.row && cur.col === from.col)) {
      const cell = position.board[cur.row][cur.col];
      if (!cell) break; // 空マスがあれば挟めていない
      if (cell.owner === mover) {
        // 自分の駒で閉じた = 間に挟んだぶんを取る (相手の駒が 1 枚も無ければ何も起きない)
        closed = true;
        break;
      }
      run.push(cell.pieceId);
      cur = wrapSquare({ row: cur.row + drow, col: cur.col + dcol }, width, height, topology);
    }
    // 盤の端に出た (cur === null) だけは、端も挟む役をする定義なら閉じたとみなす。
    // 一周して戻った場合は「相手の駒しか無い」ので閉じていない。
    if (!cur && rule.bound_by === 'own_piece_or_board_edge') closed = true;
    if (closed) captured.push(...run);
  }
  return captured;
}

/**
 * 隅の囲み取り (角取り)。
 *
 * 隅は 1 方向にしか逃げ場が無く挟みが成立しないので、**直交する 2 マスが相手の駒で
 * 塞がれた時点で取られる**。着手で塞がったマスに**隣接する隅**だけを見る。
 */
function cornerCaptures(
  rule: MgfPostMoveTopology,
  position: Position,
  from: Square,
  mover: Player,
): string[] {
  const topology = topologyOf(position);
  const { width, height } = position;
  const captured: string[] = [];

  for (const { drow, dcol } of offsetsFor(rule)) {
    const corner = wrapSquare({ row: from.row + drow, col: from.col + dcol }, width, height, topology);
    if (!corner || !isCornerSquare(position, corner)) continue;
    const cell = position.board[corner.row][corner.col];
    if (!cell || cell.owner === mover) continue;
    // 隅から盤の内側へ向かう 2 マス (縦 1・横 1) がどちらも自分の駒なら取れる
    const inward: Square[] = [
      { row: corner.row, col: corner.col === 0 ? 1 : width - 2 },
      { row: corner.row === 0 ? 1 : height - 2, col: corner.col },
    ];
    const surrounded = inward.every((sq) => {
      const c = position.board[sq.row]?.[sq.col];
      return c !== null && c !== undefined && c.owner === mover;
    });
    if (surrounded) captured.push(cell.pieceId);
  }
  return captured;
}

/** その陣営の盤上の駒数。全滅 (annihilation) の判定用。 */
export function countBoardPieces(position: Position, player: Player): number {
  let count = 0;
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      if (position.board[row][col]?.owner === player) count++;
    }
  }
  return count;
}

/**
 * 全滅 (annihilation) で負けている陣営を返す。決着していなければ null。
 *
 * 「相手の盤上の駒が `remaining_threshold` 枚以下」で勝ち (親 §3.10)。
 */
export function annihilationLoser(mgf: Mgf, position: Position): Player | null {
  if (mgf.victory?.type !== 'annihilation') return null;
  const threshold = mgf.victory.remaining_threshold ?? 0;
  for (const side of ['player1', 'player2'] as Player[]) {
    if (countBoardPieces(position, side) <= threshold) return side;
  }
  return null;
}
