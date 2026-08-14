/**
 * 汎用モンテカルロ木探索 (Phase 3-3・親 §7.3)。
 *
 * 読み方が自作探索 (αβ) とまったく違う。αβ は「駒得がいちばん良くなる手」を計算で
 * 求めるが、こちらは**手当たり次第に最後まで指してみて、勝った割合が高い手**を選ぶ。
 * ルールの中身をほとんど知らなくてよいので、**変則ルールにそのまま乗る**のが取り柄
 * (合法手を出す・手を進める、だけをエンジンから借りる)。
 *
 * **★将棋はランダムに指し継いでもほとんど終局しない** (玉を詰ますまで手がほぼ無限に
 * 続く)。そのため「勝敗が決まるまで試す」という素朴な形では動かない。親 v1.30 §7.3 の
 * 規定どおり、**規定手数で打ち切り、そこの駒得で勝ち・負け・引き分けに割り当てる**。
 *
 * 強さは §7.3 の但し書きどおり自作探索より劣る想定で、目標は
 * 「破綻なく相手ができること」。量子での順位は実際に対局させて決める (付録 D-5 §6.3)。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Move, Position } from '../../core/engine/position/types';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import { evaluate } from '../selfmade-alphabeta/evaluate';

export interface MctsOptions {
  /** 何回試すか。段 (Easy/Hard/Apocalypse) から決まる。 */
  playouts: number;
  /** 考える時間の上限 (ms)。回数より先にこちらが来たら打ち切る。 */
  movetimeMs: number;
  /** 1 回の試し打ちで何手まで進めるか。ここまで来たら駒得で勝敗に割り当てる。 */
  playoutDepth?: number;
  /** 引き分けとみなす駒得の差 (点・歩 1 枚 = 100)。 */
  drawMargin?: number;
  onProgress?: (p: { depth: number; nodes: number; elapsedMs: number }) => void;
  shouldStop?: () => boolean;
  now?: () => number;
  random?: () => number;
}

export interface MctsResult {
  move: Move | null;
  /** 選んだ手の勝率 (0〜1)。 */
  winRate: number;
  /** 実際に試した回数。 */
  playouts: number;
  elapsedMs: number;
}

/** 試し打ちの既定の長さ。長くするほど本当らしくなるが、その分 1 回が重くなる。 */
const DEFAULT_PLAYOUT_DEPTH = 24;
/** この差より小さければ引き分け扱い (歩 1 枚半)。 */
const DEFAULT_DRAW_MARGIN = 150;

/** UCB1 の探索係数。大きいほど「まだ試していない手」を選びやすい。 */
const EXPLORATION = 1.4;

interface Child {
  move: Move;
  position: Position;
  visits: number;
  /** 根の手番から見た勝ち点の合計 (勝ち 1・引き分け 0.5・負け 0)。 */
  wins: number;
}

function legalMoves(mgf: Mgf, position: Position): Move[] {
  try {
    return generateLegalMoves(mgf, position);
  } catch {
    // 量子で候補の絞り込みが行き詰まった枝は「読めなかった」として捨てる (自作探索と同じ扱い)。
    return [];
  }
}

function apply(mgf: Mgf, position: Position, move: Move): Position | null {
  try {
    return applyMove(mgf, position, move);
  } catch {
    return null;
  }
}

/**
 * 1 回の試し打ち。**根の手番から見た点**を返す (勝ち 1・引き分け 0.5・負け 0)。
 *
 * 打ち切りまで進めたら駒得で決める。途中で指す手が無くなったら、そこで勝敗が決まった
 * ものとして扱う (打ち切りより優先・親 §7.3 v1.30)。
 */
function playout(
  mgf: Mgf,
  start: Position,
  rootSide: string,
  depth: number,
  drawMargin: number,
  random: () => number,
  outOfTime: () => boolean,
): number {
  let position = start;

  for (let i = 0; i < depth; i++) {
    // **1 手を出すだけで数十 ms かかる場面がある** (量子)。試し打ちの途中でも時間を見ないと、
    // 1 回の試し打ちだけで予定を大きく超える (実測で 2 秒の予定が 5 秒＝自作探索で起きた形)。
    if (outOfTime()) return 0.5;

    const moves = legalMoves(mgf, position);
    if (moves.length === 0) {
      // 手が無い側の負け。その側が根の手番なら 0、相手なら 1。
      return position.sideToMove === rootSide ? 0 : 1;
    }
    const next = apply(mgf, position, moves[Math.floor(random() * moves.length)]);
    if (!next) return 0.5; // 進められない枝は引き分け扱いにして捨てる
    position = next;
  }

  // 打ち切り。evaluate は「その局面の手番側から見た点」なので、根の手番の側へ揃える。
  const score = position.sideToMove === rootSide ? evaluate(mgf, position) : -evaluate(mgf, position);
  if (score > drawMargin) return 1;
  if (score < -drawMargin) return 0;
  return 0.5;
}

/**
 * いちばん良さそうな手を返す。
 *
 * 木は根の 1 段だけ持つ (どの手を試すかを UCB1 で選び、その先はランダムに指し継ぐ)。
 * 段を深くするより回数を稼ぐほうが、この規模では効きが素直なため。
 */
export function searchBestMoveMcts(mgf: Mgf, position: Position, options: MctsOptions): MctsResult {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const start = now();
  const deadline = start + Math.max(1, options.movetimeMs);
  const depth = options.playoutDepth ?? DEFAULT_PLAYOUT_DEPTH;
  const drawMargin = options.drawMargin ?? DEFAULT_DRAW_MARGIN;

  const rootSide = position.sideToMove;
  const rootMoves = legalMoves(mgf, position);
  if (rootMoves.length === 0) {
    return { move: null, winRate: 0, playouts: 0, elapsedMs: now() - start };
  }

  const children: Child[] = [];
  for (const move of rootMoves) {
    const next = apply(mgf, position, move);
    if (next) children.push({ move, position: next, visits: 0, wins: 0 });
  }
  if (children.length === 0) {
    return { move: rootMoves[0], winRate: 0, playouts: 0, elapsedMs: now() - start };
  }

  const outOfTime = () => now() >= deadline || options.shouldStop?.() === true;

  let total = 0;
  for (let i = 0; i < options.playouts; i++) {
    // **毎回見る**。1 回の試し打ちが重い場面 (量子) では、間隔を空けると打ち切りが効く前に
    // 予定を大きく超えるため。時計を読む手間は試し打ち 1 回に比べれば無視できる。
    if (outOfTime()) break;

    // UCB1: まだ試していない手を先に 1 回ずつ、そのあとは「勝率＋伸びしろ」で選ぶ。
    let picked = children[0];
    let bestUcb = -Infinity;
    for (const child of children) {
      if (child.visits === 0) { picked = child; break; }
      const ucb = child.wins / child.visits + EXPLORATION * Math.sqrt(Math.log(total + 1) / child.visits);
      if (ucb > bestUcb) { bestUcb = ucb; picked = child; }
    }

    picked.wins += playout(mgf, picked.position, rootSide, depth, drawMargin, random, outOfTime);
    picked.visits++;
    total++;

    if ((i & 63) === 0) {
      options.onProgress?.({ depth: 1, nodes: total, elapsedMs: now() - start });
    }
  }

  // 選ぶのは**いちばん多く試した手**。勝率だけで選ぶと、1 回試して勝っただけの手が
  // 上に来てしまう (試した回数が少ない値ほど当てにならない)。
  let best = children[0];
  for (const child of children) {
    if (child.visits > best.visits) best = child;
  }

  return {
    move: best.move,
    winRate: best.visits > 0 ? best.wins / best.visits : 0,
    playouts: total,
    elapsedMs: now() - start,
  };
}
