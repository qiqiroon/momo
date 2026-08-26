/**
 * 手を**伝言に載せる形**と、届いた伝言から**どの手かを見分ける**やり方
 * (v1.90・第 9 段 9-4c・親 v1.65 §3.7.1)。
 *
 * ★なぜ 1 か所に集めるか
 * 手を伝言へ写している場所は**送る側 2 つ・受け取る側 4 つ**ある（自分の着手を送る／
 * 観戦者へ丸ごと配る／相手の着手を受ける／観戦で並べ直す／感想戦で並べ直す／AI の着手）。
 * **運ぶ項目を足すたびに、写しのどれかだけが古いまま残る**——準備画面がルール一式を
 * 自前で並べ直していて段B② で 1 か所へ寄せたのと、まったく同じ形。**数え上げる形は
 * 必ず漏れる**ので、写す仕事と見分ける仕事をここへ寄せる。
 *
 * ★なぜ「続けて起きる動きの並び」まで載せるのか (9-4c)
 * 受け取った側は、届いた項目に合う合法手を**自分で作り直して**盤に載せている。ところが
 * **同じ「どの駒が・どこから・どこへ」で中身の違う手が 2 通りある**ことがある——
 * 量子モードでは、王のマスの駒が**王かもしれないしクイーンかもしれない**ので、
 * 「キャスリングして 2 マス動く」と「クイーンとして 2 マス滑る」が**まったく同じ項目**に
 * なる。並びを載せずに突き合わせると、**送った側と違う盤が並ぶ**。
 * 仕様書 §3.7.1 が「**何が起きたかを手そのものに書く**」と定めているのはこのため。
 */

import type {
  BoardMove,
  DropMove,
  Move,
  MoveStep,
  Square,
} from '../engine/position/types';

/** 伝言に載せる「どの手か」を決める項目。時計や局面の印はここには含めない。 */
export interface WireMove {
  kind: 'move' | 'drop';
  pieceId: string;
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
  /** 【v1.65 §3.6.2】入れ替わる昇格の昇格先 (from/to からは決まらない)。 */
  promoteTo?: string;
  /** 【v1.65 §3.7.1】続けて起きる動きの並び (キャスリング・アンパッサン・獅子の 2 回行動)。 */
  extra_steps?: MoveStep[];
}

/** 指した手を、伝言に載せる形へ写す。**省略できる項目は持っているときだけ載せる**。 */
export function wireMoveOf(move: BoardMove | DropMove): WireMove {
  if (move.type === 'drop') {
    return { kind: 'drop', pieceId: move.pieceId, to: { row: move.to.row, col: move.to.col } };
  }
  return {
    kind: 'move',
    pieceId: move.pieceId,
    from: { row: move.from.row, col: move.from.col },
    to: { row: move.to.row, col: move.to.col },
    promote: move.promote,
    ...(move.promoteTo !== undefined ? { promoteTo: move.promoteTo } : {}),
    ...(move.extra_steps !== undefined ? { extra_steps: move.extra_steps } : {}),
  };
}

/**
 * 伝言に載せる項目だけを取り出す（時計や局面の印のような**外側の事情**を落とす）。
 *
 * **項目を数え上げているのはこの 1 か所だけ**にする＝ここに足せば、送る側も受け取る側も
 * 一度に付いてくる。
 */
export function wireFieldsOf(m: WireMove): WireMove {
  return {
    kind: m.kind,
    pieceId: m.pieceId,
    ...(m.from !== undefined ? { from: m.from } : {}),
    to: m.to,
    ...(m.promote !== undefined ? { promote: m.promote } : {}),
    ...(m.promoteTo !== undefined ? { promoteTo: m.promoteTo } : {}),
    ...(m.extra_steps !== undefined ? { extra_steps: m.extra_steps } : {}),
  };
}

/**
 * その合法手は、届いた伝言が指している手か。
 *
 * ★**並びも突き合わせる**＝載っていない伝言は「並びを持たない手」を指しているとみなす。
 * **書き忘れたときは「見つからない」側に転ぶ**（黙って別の手を指すより、同期ずれとして
 * 表に出るほうが軽い）。
 */
export function isSameWireMove(candidate: Move, wire: WireMove): boolean {
  if (wire.kind === 'drop') {
    return (
      candidate.type === 'drop' &&
      candidate.pieceId === wire.pieceId &&
      sameSquare(candidate.to, wire.to)
    );
  }
  if (candidate.type !== 'move') return false;
  if (!wire.from) return false;
  return (
    candidate.pieceId === wire.pieceId &&
    sameSquare(candidate.from, wire.from) &&
    sameSquare(candidate.to, wire.to) &&
    candidate.promote === (wire.promote ?? false) &&
    candidate.promoteTo === wire.promoteTo &&
    sameSteps(candidate.extra_steps, wire.extra_steps)
  );
}

function sameSquare(a: Square, b: { row: number; col: number }): boolean {
  return a.row === b.row && a.col === b.col;
}

/** 並びどうしの突き合わせ。どちらも持っていなければ一致 (将棋・はさみの手はここを通る)。 */
function sameSteps(a: MoveStep[] | undefined, b: MoveStep[] | undefined): boolean {
  if (a === undefined || a.length === 0) return b === undefined || b.length === 0;
  if (b === undefined || a.length !== b.length) return false;
  return a.every((step, i) => sameStep(step, b[i]));
}

function sameStep(a: MoveStep, b: MoveStep): boolean {
  if (a.pieceId !== b.pieceId) return false;
  if ((a.from === undefined) !== (b.from === undefined)) return false;
  if (a.from && b.from && !sameSquare(a.from, b.from)) return false;
  if (a.promote !== b.promote) return false;
  if (a.dest.kind !== b.dest.kind) return false;
  if (a.dest.kind === 'square' && b.dest.kind === 'square') {
    return sameSquare(a.dest.square, b.dest.square);
  }
  if (a.dest.kind === 'hand' && b.dest.kind === 'hand') {
    return a.dest.owner === b.dest.owner;
  }
  return true; // 取り除く (discard) は行き先を持たない
}
