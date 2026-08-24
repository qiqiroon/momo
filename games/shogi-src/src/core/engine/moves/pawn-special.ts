/**
 * ポーンの特殊な手を**生む側** (親 v1.65 §5.5.3・第 9 段 9-4b)。
 *
 * ここが受け持つのは 2 つ。どちらも「動きの定義 (abilities) だけでは書けない手」であり、
 * **適用する側 (position/apply の extra_steps・discard) は 9-2 で既に出来ている**ので、
 * 本モジュールは**それを生む**だけを担う。
 *
 * - **初手 2 マス**…一度も動いていないポーンは前へ 2 マス進める (間も着地も空)。
 * - **アンパッサン**…直前の手で相手のポーンが 2 マス進み自分のポーンの横を通り過ぎたとき、
 *   通り過ぎたマスへ斜めに進んで、そのポーンを取る (取られる駒は着地マスにいないので
 *   §3.7.1 の並びで**取り除く**)。取れるのは**直後の 1 手だけ**。
 *
 * ★「ポーン」を名札で決め打ちしない (§3.6・9-1 と同じ方針)
 * ポーンとは「前へ 1 マスだけ進めて、その動きでは取れない駒」である。この動き
 * (`step`/`forward`/`range:1`/`can_capture:false`) を持つ駒種をポーンとみなす。
 * こうすれば chess.json の駒 id が "pawn" でなくても、他の自由ルールで同じ動きの駒を
 * 作っても正しく効く。
 *
 * ★この一式は `constraints.pawn_double_step` が立っているルールでだけ動く。
 * 将棋・はさみ将棋・トーラス将棋・量子将棋はこの指定を持たないので**素通り**する
 * (縮退互換)。呼ぶ側 (generator) が指定の有無で入り口を閉じる。
 */

import type { Mgf, MgfPieceDef, Player } from '../mgf/types';
import type { BoardMove, Position, Square } from '../position/types';
import { topologyOf, wrapSquare } from '../position/coordinates';
import { directionOffsets } from './directions';

/** その駒種は「前へ 1 マス・取れない」動き (＝ポーンの前進) を持つか。 */
function hasPawnPush(def: MgfPieceDef): boolean {
  return !!def.move_logic?.abilities.some(
    (a) => a.type === 'step' && a.direction === 'forward' && a.range === 1 && a.can_capture === false,
  );
}

/** 盤上の駒がポーン (§5.5.3 の意味で) か。量子で正体が未確定な駒はここでは扱わない。 */
function isPawnAt(mgf: Mgf, position: Position, sq: Square): boolean {
  const cell = position.board[sq.row][sq.col];
  if (!cell || cell.candidates !== undefined) return false;
  const def = mgf.pieces.find((p) => p.id === cell.kind);
  return !!def && hasPawnPush(def);
}

/**
 * `from` にいる自分の駒についての、ポーンの特殊な手 (初手 2 マス・アンパッサン)。
 *
 * 呼ぶ側は `constraints.pawn_double_step` が立っているときだけ呼ぶ。手番の駒であることは
 * generator 側で確かめ済みなので、ここでは持ち主の向き (前) だけを使う。
 */
export function pawnSpecialMoves(mgf: Mgf, position: Position, from: Square): BoardMove[] {
  const piece = position.board[from.row][from.col];
  if (!piece || piece.candidates !== undefined) return [];
  const def = mgf.pieces.find((p) => p.id === piece.kind);
  if (!def || !hasPawnPush(def)) return [];

  const moves: BoardMove[] = [];
  const doubleStep = pawnDoubleStep(position, from, piece.owner, piece.pieceId, piece.initialSquare);
  if (doubleStep) moves.push(doubleStep);
  moves.push(...enPassantMoves(mgf, position, from, piece.owner, piece.pieceId));
  return moves;
}

/**
 * 初手 2 マス。**一度も動いていない** (＝いま初期マスにいる) ポーンが、前へ 2 マス進める。
 * **間のマスも着地マスも空いている**こと。着地は空なので取りは起きない (通常の前進と同じ)。
 *
 * ※初期マス (2 段目/7 段目) から 2 マスでは最奥段に届かないので昇格は起きない
 * (上下がつながった盤でも初期マスは端に接しないため回り込まない)。素の前進手を返す。
 */
function pawnDoubleStep(
  position: Position,
  from: Square,
  owner: Player,
  pieceId: string,
  initialSquare: Square,
): BoardMove | null {
  // 「一度も動いていない」= いま初期マスにいる (ポーンは後退できないので同義)。
  if (from.row !== initialSquare.row || from.col !== initialSquare.col) return null;

  const { width, height } = position;
  const topology = topologyOf(position);
  const fwd = directionOffsets('forward', owner)[0];

  const one = wrapSquare({ row: from.row + fwd.drow, col: from.col + fwd.dcol }, width, height, topology);
  if (!one || position.board[one.row][one.col] !== null) return null; // 間がふさがっている
  const two = wrapSquare({ row: one.row + fwd.drow, col: one.col + fwd.dcol }, width, height, topology);
  if (!two || position.board[two.row][two.col] !== null) return null; // 着地がふさがっている

  return { type: 'move', pieceId, from, to: two, promote: false };
}

/**
 * アンパッサン。直前の手が**相手のポーンの 2 マス進み**で、その通り過ぎたマスへ
 * 自分のポーンが斜め前に進めるなら、そのマスへ進んで相手のポーンを**取り除く**。
 *
 * **正本は手の並び 1 本** (§4.2.1)＝権利を局面に持たせず、直前の手 1 つを見て決める。
 * 取れるのは通り過ぎた直後の 1 手だけなので、それより前を遡る必要は無い。
 */
function enPassantMoves(
  mgf: Mgf,
  position: Position,
  from: Square,
  owner: Player,
  pieceId: string,
): BoardMove[] {
  const last = position.history[position.history.length - 1];
  if (!last || last.type !== 'move') return [];

  // 直前に動いた駒は、いま着地マスにいる。それが相手のポーンで、初期マスから 2 マス
  // まっすぐ進んだ手 (＝初手 2 マス) だったか。
  const landed = position.board[last.to.row][last.to.col];
  if (!landed || landed.pieceId !== last.pieceId) return [];
  if (landed.owner === owner) return [];
  if (!isPawnAt(mgf, position, last.to)) return [];
  // その相手ポーンにとっての「初手 2 マス」だったか (初期マスから前へ 2 マス)。
  if (last.from.row !== landed.initialSquare.row || last.from.col !== landed.initialSquare.col) return [];

  const { width, height } = position;
  const topology = topologyOf(position);
  const oppFwd = directionOffsets('forward', landed.owner)[0];
  // 通り過ぎたマス = 相手ポーンの初期マスから前へ 1 マス。そこからさらに 1 マス前が着地
  // マスと一致していなければ 2 マス進みではない (念のための整合確認)。
  const passed = wrapSquare(
    { row: last.from.row + oppFwd.drow, col: last.from.col + oppFwd.dcol },
    width,
    height,
    topology,
  );
  if (!passed) return [];
  const after = wrapSquare(
    { row: passed.row + oppFwd.drow, col: passed.col + oppFwd.dcol },
    width,
    height,
    topology,
  );
  if (!after || after.row !== last.to.row || after.col !== last.to.col) return [];
  if (position.board[passed.row][passed.col] !== null) return []; // 通り過ぎたマスは空のはず

  // 自分のポーンが `from` から斜め前へ進んで、その通り過ぎたマスへ行けるか。
  const moves: BoardMove[] = [];
  for (const d of directionOffsets('forward_diagonal', owner)) {
    const dest = wrapSquare({ row: from.row + d.drow, col: from.col + d.dcol }, width, height, topology);
    if (dest && dest.row === passed.row && dest.col === passed.col) {
      // 着地マス (passed) は空なので本体の手では何も取らない。取られる相手ポーンは
      // 着地マスにいない (§3.7.1)＝並びで**取り除く**へ。
      moves.push({
        type: 'move',
        pieceId,
        from,
        to: passed,
        promote: false,
        extra_steps: [{ pieceId: landed.pieceId, from: last.to, dest: { kind: 'discard' } }],
      });
      break; // 同じ通り過ぎマスへ行ける斜めは 1 方向だけ
    }
  }
  return moves;
}
