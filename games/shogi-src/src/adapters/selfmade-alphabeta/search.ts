/**
 * 自作の読み筋 (Phase 3・親 §7.3.1 第1段階 = アルファベータ枝刈り + 駒得評価)。
 *
 * 外部依存ゼロ。合法手を出すところ・手を進めるところは既存のエンジン (core/engine) を
 * そのまま借りるので、**トーラスでも量子でもカスタムルールでも同じ読み筋が動く**
 * (強さは落ちる=親 §7.3 但し書き)。
 *
 * 進め方は反復深化。深さ 1 から始めて 1 手ずつ深く読み直し、持ち時間が尽きたところで
 * 打ち切って**最後に読み切った深さの結論**を採用する。途中で切れた深さの結論は捨てる
 * (全部の手を見ていないので、たまたま最初に見た手が残るだけになるため)。
 *
 * 打ち切りは「時間」だけでなく「深さ」でも掛けられる (親 §7.4 の go(limits))。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Move, Position } from '../../core/engine/position/types';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import { MATE_VALUE, buildValueBook, evaluate, pieceValue } from './evaluate';
import type { ValueBook } from './evaluate';

export interface SearchOptions {
  /** 考える時間の上限 (ms)。深さ 1 だけは必ず読み切る。 */
  movetimeMs: number;
  /** 読む深さの上限 (手数)。 */
  maxDepth: number;
  /**
   * 同点崩しの幅 (点・歩 1 枚 = 100)。**最善からこの幅までしか損しないことを保証した上で**
   * 候補から 1 つ選ぶ。0 なら常に最善を指す。**対局では強さの段から決まる** (levels.ts)。
   * ここの既定 20 は段を渡さずに直接呼んだとき (検査など) の値。
   *
   * v1.39 以前は「上限しか分かっていない手」もこの幅の中に混ぜていたため、実際には
   * 飛車を丸損する手が同点として選ばれていた (親 §7.3.3)。いまは正確な点数が出た手だけを
   * 候補にするので、幅は文字どおり「保証された損の上限」を意味する。
   */
  jitter?: number;
  /** 深さを 1 つ読み切るたびに呼ばれる。長考中に「動いている」ことを出すため。 */
  onProgress?: (p: { depth: number; nodes: number; elapsedMs: number; score: number }) => void;
  /** 外から打ち切る (画面を離れた・投了した等)。 */
  shouldStop?: () => boolean;
  /** テスト用の差し替え。 */
  now?: () => number;
  random?: () => number;
}

export interface SearchResult {
  /** 指す手。1 手も無ければ null (詰み・手詰まり)。 */
  move: Move | null;
  /** 手番側から見た点数。 */
  score: number;
  /** 読み切った深さ。 */
  depth: number;
  nodes: number;
  elapsedMs: number;
  /** 上限の深さまで読み切れたか (時間切れで途中なら false)。 */
  completed: boolean;
}

/** 静かになるまで駒の取り合いだけを読み続ける深さの上限。 */
const QUIESCENCE_DEPTH = 3;

interface Ctx {
  mgf: Mgf;
  /**
   * 候補 1 個ぶんの値打ちの早見表 (v1.49)。量子モードの値打ちは候補から引くので要る。
   * **局面によらない**ので探索の入口で 1 度だけ作って読みの間じゅう使い回す。
   */
  book: ValueBook;
  nodes: number;
  deadline: number;
  now: () => number;
  shouldStop?: () => boolean;
  aborted: boolean;
  /**
   * 時間の確認は毎回やると重いので、この数ごとに見る。
   *
   * ただし**量子モードでは 1 マス分の手を出すだけで数十 ms かかる**ことがあるので、
   * 間隔が粗いと打ち切りが効くまでに予定を大きく超える (実測で 2 秒の予定が 5 秒)。
   * 節目を細かくして、超過を抑える。
   */
  checkMask: number;
}

function timeUp(ctx: Ctx): boolean {
  if (ctx.aborted) return true;
  if ((ctx.nodes & ctx.checkMask) !== 0) return false;
  if (ctx.shouldStop?.()) {
    ctx.aborted = true;
    return true;
  }
  if (ctx.now() >= ctx.deadline) {
    ctx.aborted = true;
    return true;
  }
  return false;
}

/**
 * 合法手を出す。量子モードでは候補の絞り込みが行き詰まって例外になることがあるので、
 * その枝は「読めなかった」として静かに捨てる (対局そのものを止めるのは対局画面側の仕事)。
 */
function safeLegalMoves(mgf: Mgf, position: Position): Move[] {
  try {
    return generateLegalMoves(mgf, position);
  } catch {
    return [];
  }
}

function safeApply(mgf: Mgf, position: Position, move: Move): Position | null {
  try {
    return applyMove(mgf, position, move);
  } catch {
    return null;
  }
}

function capturedValue(ctx: Ctx, position: Position, move: Move): number {
  if (move.type !== 'move') return 0;
  const target = position.board[move.to.row][move.to.col];
  return target ? pieceValue(target, ctx.book) : 0;
}

/**
 * 良さそうな手から先に見る。アルファベータは「先に良い手を見るほど枝が刈れる」ので、
 * 並べ替えるだけで読める深さが変わる。
 */
function orderKey(ctx: Ctx, position: Position, m: Move): number {
  let s = capturedValue(ctx, position, m) * 10;
  if (m.type === 'move' && m.promote) s += 500;
  return s;
}

function orderMoves(ctx: Ctx, position: Position, moves: Move[]): Move[] {
  const scored = moves.map((m) => ({ m, s: orderKey(ctx, position, m) }));
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

/**
 * 点数の大きい順に並べつつ、**同じ点数どうしの並び順だけをばらす**。
 *
 * 枝刈りの都合で、**本当に同点の手のうち正確な点数が付くのは最初に読んだ 1 つだけ**で、
 * 残りは「これ以上は良くない」という上限しか出ない (親 §7.3.3)。そのため同点の中から
 * どれが選ばれるかは**読む順番で決まる**。ここで順番をばらすことで、毎回同じ将棋に
 * ならないようにする (以前は同点崩しの幅がその役をしていたが、上限を確定値と取り違えて
 * いたため大損する手まで選んでいた)。
 *
 * `random` が常に 0 を返すとき (検査) は元の並びのまま＝結果が毎回同じになる。
 */
function orderByScoreWithTieShuffle<T>(
  items: { move: T; score: number }[],
  random: () => number,
): T[] {
  return items
    .map((x, i) => ({ move: x.move, score: x.score, r: random(), i }))
    .sort((a, b) => b.score - a.score || a.r - b.r || a.i - b.i)
    .map((x) => x.move);
}

/** 駒の取り合いだけを読み進めて、取り返しの途中で評価を打ち切らないようにする。 */
function quiescence(ctx: Ctx, position: Position, alpha: number, beta: number, depth: number): number {
  ctx.nodes++;
  const stand = evaluate(ctx.mgf, position, ctx.book);
  if (depth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (timeUp(ctx)) return stand;

  const captures = safeLegalMoves(ctx.mgf, position).filter((m) => capturedValue(ctx, position, m) > 0);
  if (captures.length === 0) return alpha;

  for (const m of orderMoves(ctx, position, captures)) {
    const next = safeApply(ctx.mgf, position, m);
    if (!next) continue;
    const score = -quiescence(ctx, next, -beta, -alpha, depth - 1);
    if (ctx.aborted) return alpha;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx: Ctx, position: Position, depth: number, alpha: number, beta: number, ply: number): number {
  if (depth <= 0) return quiescence(ctx, position, alpha, beta, QUIESCENCE_DEPTH);
  ctx.nodes++;
  if (timeUp(ctx)) return evaluate(ctx.mgf, position, ctx.book);

  const moves = safeLegalMoves(ctx.mgf, position);
  // 指す手が無い = 負け。浅いところで詰まされるほど悪いので ply を足して差を付ける
  // (同じ詰みなら遠い方がまし・詰ませるなら早い方が良い、と読めるようにするため)。
  if (moves.length === 0) return -MATE_VALUE + ply;

  let best = -Infinity;
  for (const m of orderMoves(ctx, position, moves)) {
    const next = safeApply(ctx.mgf, position, m);
    if (!next) continue;
    const score = -negamax(ctx, next, depth - 1, -beta, -alpha, ply + 1);
    if (ctx.aborted) return best === -Infinity ? evaluate(ctx.mgf, position, ctx.book) : best;
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  if (best === -Infinity) return -MATE_VALUE + ply;
  return best;
}

export function searchBestMove(mgf: Mgf, position: Position, options: SearchOptions): SearchResult {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const jitter = options.jitter ?? 20;
  const start = now();

  const ctx: Ctx = {
    mgf,
    book: buildValueBook(mgf, position),
    nodes: 0,
    deadline: start + Math.max(1, options.movetimeMs),
    now,
    shouldStop: options.shouldStop,
    aborted: false,
    checkMask: 15,
  };

  const rootMoves = safeLegalMoves(mgf, position);
  if (rootMoves.length === 0) {
    return { move: null, score: -MATE_VALUE, depth: 0, nodes: 0, elapsedMs: now() - start, completed: true };
  }

  // 最初の並びも、見込みが同じ手どうしは順番をばらす (下の並べ替えと同じ理由)。
  let ordered = orderByScoreWithTieShuffle(
    rootMoves.map((m) => ({ move: m, score: orderKey(ctx, position, m) })),
    random,
  );
  let bestMove: Move = ordered[0];
  let bestScore = 0;
  let reachedDepth = 0;

  const maxDepth = Math.max(1, options.maxDepth);
  for (let depth = 1; depth <= maxDepth; depth++) {
    let alpha = -Infinity;
    /** 並べ替え用。上限しか分かっていない手も含む。 */
    const all: { move: Move; score: number }[] = [];
    /**
     * 選ぶ用。**正確な点数が出た手だけ**を入れる (親 §7.3.3)。
     *
     * 枝刈りの窓を (−∞, −alpha) で開いているので、返る値が alpha より大きい手だけが
     * 確定値で、それ以外は「これ以上は良くない」という上限にすぎない。上限は最善手の
     * 点数とぴったり同じ値になることが多く、これを確定値として同点扱いすると
     * **飛車を丸損する手が候補に混ざる** (v1.38 までの不具合)。
     */
    const exact: { move: Move; score: number }[] = [];
    let aborted = false;

    for (const m of ordered) {
      // 1 手も評価しないうちは打ち切らない (指す手が決まらなくなるため)。
      // 2 手目からは、根の手と手の間でも時間を見る (量子のように 1 手が重い場面で効く)。
      if (all.length > 0 && now() >= ctx.deadline) {
        ctx.aborted = true;
        aborted = true;
        break;
      }
      const next = safeApply(mgf, position, m);
      if (!next) continue;
      const prevAlpha = alpha;
      const score = -negamax(ctx, next, depth - 1, -Infinity, -alpha, 1);
      if (ctx.aborted) {
        // 深さ 1 だけは読み切る (1 手も評価しないまま返さないため)。
        // 最初の 1 手は窓が (−∞, +∞) なので確定値。
        if (depth === 1 && all.length === 0) {
          all.push({ move: m, score });
          exact.push({ move: m, score });
        }
        aborted = true;
        break;
      }
      all.push({ move: m, score });
      if (score > prevAlpha) exact.push({ move: m, score });
      if (score > alpha) alpha = score;
    }

    if (aborted && depth > 1) break; // 途中で切れた深さの結論は捨てる
    if (exact.length === 0) break;

    // 確定値の並びは必ず増えていく (alpha を更新した手だけが入るため) ので、末尾が最善。
    exact.sort((a, b) => b.score - a.score);
    bestScore = exact[0].score;
    // 同点崩し: 最善から jitter 以内**であることが確かめられた手**から 1 つ選ぶ。
    // 本当に同点の手どうしのばらけは、上の読む順番のランダム化が受け持つ。
    const tied = exact.filter((s) => s.score >= bestScore - jitter);
    bestMove = tied[Math.floor(random() * tied.length)]?.move ?? exact[0].move;
    reachedDepth = depth;
    options.onProgress?.({ depth, nodes: ctx.nodes, elapsedMs: now() - start, score: bestScore });

    // 次の深さは今回より確実に重いので、残り時間が今回ぶんに満たなければ切り上げる
    const elapsed = now() - start;
    if (elapsed * 2 > options.movetimeMs) break;
    if (Math.abs(bestScore) > MATE_VALUE - 1000) break; // 詰みが見えたらそれ以上読まない

    // 次の深さは今回の良かった順に見る (枝がよく刈れる)。
    // **ここでは並びをばらさない**。ばらすのは読み始める前の 1 回だけで足りるうえ、
    // 深さごとにばらすと前の深さで分かった良い並びが崩れて枝が刈れなくなる
    // (実測で中盤の読める深さが 1 つ落ちた)。並べ替えは安定なので、同点の手どうしは
    // 最初にばらした順番のまま保たれる。
    all.sort((a, b) => b.score - a.score);
    ordered = all.map((x) => x.move);
    if (aborted) break;
  }

  return {
    move: bestMove,
    score: bestScore,
    depth: reachedDepth,
    nodes: ctx.nodes,
    elapsedMs: now() - start,
    completed: !ctx.aborted && reachedDepth >= maxDepth,
  };
}
