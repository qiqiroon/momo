import type { Mgf } from '../../core/engine/mgf/types';
import type { BoardTopology, Move, PieceInstance, Position } from '../../core/engine/position/types';
import { PLANE_TOPOLOGY, topologyOf } from '../../core/engine/position/coordinates';
import { buildInitialKindMap, confirmedKindOf } from '../../core/engine/candidate-kinds';

/**
 * トーラスモディファイア (親 §3.4)。
 *
 * - **なし**: 通常の盤。端は端。
 * - **円筒**: 左右だけをつなぐ (wrap_x)。上下には端があるので、成り・入玉・詰みは
 *   通常将棋のまま素直に成立する。
 * - **完全トーラス**: 上下もつなぐ (wrap_x && wrap_y)。**意図的なネタモード**で、
 *   追加の制限は「王で敵王を取れない」の 1 点だけ (親 §3.4.2 の最小介入)。
 *   飛・角・金などが盤を回り込んで王手をかけるのは**仕様として残す**
 *   (「意外なことができると知ることがエンタメ」= 親 §3.4.2 の設計思想)。
 */
export type TorusMode = 'none' | 'cylinder' | 'full';

/** 対局設定のトーラスモードを、盤の端のつなぎ方へ翻訳する。 */
export function topologyFor(mode: TorusMode): BoardTopology {
  switch (mode) {
    case 'cylinder':
      return { wrapX: true, wrapY: false };
    case 'full':
      return { wrapX: true, wrapY: true };
    default:
      return PLANE_TOPOLOGY;
  }
}

/**
 * 完全トーラス専用の追加制限 `no_royal_capture_royal` (親 §3.4.2・§3.9)。
 * false を返した手は指せない。
 *
 * 上下がつながると、両者の玉が盤の上端と下端をまたいで背中合わせに隣り合う。
 * そのままでは先に動いたほうが相手の玉をただ取りして対局が成立しないので、
 * **玉で玉を取ることだけ**を禁じる。それ以外の周回利きは塞がない。
 *
 * 量子モードでは「玉と確定している駒どうし」のときだけ禁じる。まだ正体が決まって
 * いない駒は玉と言い切れないので、ここでは止めない (候補の和集合で手を出す考え方と同じ)。
 */
export function noRoyalCaptureRoyal(mgf: Mgf, position: Position, move: Move): boolean {
  if (move.type !== 'move') return true;
  if (!topologyOf(position).wrapY) return true;
  const target = position.board[move.to.row][move.to.col];
  if (!target) return true;
  const mover = position.board[move.from.row][move.from.col];
  if (!mover) return true;
  const kindMap = buildInitialKindMap(position);
  return !(isConfirmedRoyal(mgf, mover, kindMap) && isConfirmedRoyal(mgf, target, kindMap));
}

function isConfirmedRoyal(
  mgf: Mgf,
  piece: PieceInstance,
  kindMap: Map<string, string>,
): boolean {
  const kind = confirmedKindOf(mgf, piece, kindMap);
  if (kind === undefined) return false;
  return mgf.pieces.find((p) => p.id === kind)?.is_royal === true;
}
