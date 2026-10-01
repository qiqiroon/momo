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
import { isInCheck } from '../../core/engine/moves/check';
import { positionHash } from '../../core/engine/position/hash';
import { hiddenRightsFingerprint } from '../../core/engine/victory/repetition';
import { PLAIN_RULES, advancePosition, type AdvanceRules } from '../../core/engine/position/advance';
import { MATE_VALUE, buildValueBook, evaluate, pieceValue } from './evaluate';
import type { ValueBook } from './evaluate';

export interface SearchOptions {
  /** 考える時間の上限 (ms)。深さ 1 だけは必ず読み切る。 */
  movetimeMs: number;
  /** 読む深さの上限 (手数)。 */
  maxDepth: number;
  /**
   * 読む局面の数の上限 (★v1.93・強さ比べ用)。**時間と違って機械の混み具合で変わらない**ので、
   * 同じ条件で何度走らせても同じ手を指す＝改良の前後を公平に比べられる。
   * 対局では使わない (省略＝上限なし・時間だけで打ち切る)。
   */
  maxNodes?: number;
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
  /**
   * ★v1.93: 1 手進めたあとの後処理の決まり (量子・盤の端のつなぎ方・反復上限)。
   * 読みの中で盤を進めるたびに対局画面と同じ後処理を通す。省略時は後処理なし。
   */
  rules?: AdvanceRules;
  /**
   * ★v1.93: 読み方の改良の入り・切り。**省略した項目は切り**＝v1.92 までと同じ読み方。
   * 強さ比べ (src/selfplay) で 1 つずつ入れて効き目を測り、効いたものだけを対局で入れる。
   */
  features?: Partial<SearchFeatures>;
  /** 深さを 1 つ読み切るたびに呼ばれる。長考中に「動いている」ことを出すため。 */
  onProgress?: (p: { depth: number; nodes: number; elapsedMs: number; score: number }) => void;
  /** 外から打ち切る (画面を離れた・投了した等)。 */
  shouldStop?: () => boolean;
  /** テスト用の差し替え。 */
  now?: () => number;
  random?: () => number;
}

/**
 * ★v1.93: 読み方の改良。どれも点数の付け方 (evaluate.ts) は変えない＝効くのは
 * 「同じ量で、どれだけ深く・取りこぼし無く読めるか」。
 */
export interface SearchFeatures {
  /**
   * 同じ局面を覚えておく表 (置換表)。手順が違っても同じ局面に行き着くことは多いので、
   * 前に読んだ結果を使い回す。前の深さで一番良かった手を先に試すのにも使う。
   */
  tt: boolean;
  /**
   * 手を読む順番の工夫。駒を取らない手のうち、**別の枝で相手を黙らせた手** (キラー手) と、
   * **これまでよく相手を黙らせてきた手** (履歴) を先に試す。
   */
  killers: boolean;
  /** 王手をかけられている局面は 1 手深く読む (そこで打ち切ると判断を誤りやすいため)。 */
  checkExtension: boolean;
  /**
   * 読み始める前に、**王手だけで詰ませられるか**を短く調べる (詰みを専門に読む部分)。
   * 見つかればその手を指す。持ち時間・局面数の一部 (MATE_SHARE) だけを使う。
   */
  mateSearch: boolean;
  /**
   * ★v1.94 案 (強さ比べ中): 量子の駒の値打ちを候補の平均 (期待値) で数える (evaluate.ts)。
   * 省略＝今までどおり「いちばん強い候補」。
   */
  quantumMeanValue?: boolean;
  /**
   * ★v1.94 案 B (強さ比べ中): 量子で、まだ王でありうる自分の駒が少ないほど減点する
   * (evaluate.ts KING_CANDIDATE_PENALTY)。省略＝今までどおり数えない。
   */
  quantumKingSafety?: boolean;
}

const NO_FEATURES: SearchFeatures = { tt: false, killers: false, checkExtension: false, mateSearch: false };

/** 詰み探索に回す持ち時間・局面数の割合。 */
const MATE_SHARE = 0.2;
/** 詰み探索で調べる手数 (攻め方の手と受け方の手を合わせた数・奇数)。 */
const MATE_PLIES = [1, 3, 5];
/** 置換表に入れる局面数の上限。超えたら捨てて作り直す (読みの間に膨らみすぎないため)。 */
const TT_LIMIT = 200_000;

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
  /** 1 手進めたあとの後処理の決まり (★v1.93)。 */
  rules: AdvanceRules;
  /**
   * 候補 1 個ぶんの値打ちの早見表 (v1.49)。量子モードの値打ちは候補から引くので要る。
   * **局面によらない**ので探索の入口で 1 度だけ作って読みの間じゅう使い回す。
   */
  book: ValueBook;
  nodes: number;
  /** 読む局面の数の上限。無ければ Infinity。 */
  maxNodes: number;
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
  /** ★v1.93: 読み方の改良の入り・切り。 */
  f: SearchFeatures;
  /** 置換表 (f.tt のときだけ)。 */
  tt: Map<string, TtEntry> | null;
  /** 手数ごとのキラー手 2 つ (f.killers のときだけ)。 */
  killers: Array<[string | null, string | null]>;
  /** 手ごとの履歴の点 (f.killers のときだけ)。 */
  history: Map<string, number> | null;
  /** 王手の延長をしてよい手数の上限 (延長が続いて止まらなくならないため)。 */
  maxPly: number;
}

/** 置換表の 1 件。点数は**その局面から見た**詰みまでの手数に直して入れる (toTt)。 */
interface TtEntry {
  depth: number;
  score: number;
  /** 0 = 正確・1 = これ以上 (下限)・2 = これ以下 (上限)。 */
  flag: 0 | 1 | 2;
  move: string | null;
}

const TT_EXACT = 0;
const TT_LOWER = 1;
const TT_UPPER = 2;
/** これより大きい点は詰み (または王取り) を意味する。 */
const MATE_BOUND = MATE_VALUE - 1000;

/**
 * 詰みの点は「根から何手目で詰むか」で付いている (浅いほど大きい)。置換表は別の手数から
 * 同じ局面に来たときにも使うので、**その局面から何手で詰むか**に直して入れ、取り出すときに
 * 戻す。直さないと、遠い詰みを近い詰みと取り違える。検査から確かめるので export する。
 */
export function toTt(score: number, ply: number): number {
  if (score > MATE_BOUND) return score + ply;
  if (score < -MATE_BOUND) return score - ply;
  return score;
}

export function fromTt(score: number, ply: number): number {
  if (score > MATE_BOUND) return score - ply;
  if (score < -MATE_BOUND) return score + ply;
  return score;
}

/** 局面の鍵。盤に現れない権利 (キャスリング等) も含める＝将棋では空。 */
function ttKey(ctx: Ctx, position: Position): string {
  const hidden = hiddenRightsFingerprint(ctx.mgf, position);
  return hidden ? `${positionHash(position)}#${hidden}` : positionHash(position);
}

/** 手の鍵 (キラー手・履歴・置換表の手)。打つ手は駒の身元ではなく駒種で見る (別の枝でも同じ手として拾う)。 */
function moveKey(position: Position, m: Move): string {
  if (m.type === 'move') {
    return `m${m.from.row},${m.from.col}-${m.to.row},${m.to.col}${m.promote ? '+' : ''}${m.promoteTo ?? ''}`;
  }
  if (m.type === 'drop') {
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === m.pieceId);
    return `d${piece?.kind ?? m.pieceId}@${m.to.row},${m.to.col}`;
  }
  return `f${m.pieceId}`;
}

function timeUp(ctx: Ctx): boolean {
  if (ctx.aborted) return true;
  // 局面数の上限は毎回見る (安い比較なので間引かない＝打ち切る位置が毎回同じになる)。
  if (ctx.nodes >= ctx.maxNodes) {
    ctx.aborted = true;
    return true;
  }
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

interface Advanced {
  position: Position;
  /** 王と確定した駒を取った＝指した側の勝ち (§Q8.5 C-202)。 */
  royalCaptured: boolean;
}

/**
 * 1 手進める。**★v1.93: 対局画面と同じ後処理まで通す** (core/engine/position/advance.ts)。
 * v1.92 までは駒を動かすだけだったので、量子では候補が絞れないまま読み進め、
 * 王と確定した駒を取っても勝ちにならない別のゲームを読んでいた。
 *
 * 進められない手と、**候補更新が異常を出す手**は「読めなかった枝」として捨てる。
 * 異常が出ると対局は投票で止まり、その先がどうなるかは読みでは決められないため。
 */
function safeApply(ctx: Ctx, position: Position, move: Move): Advanced | null {
  try {
    const r = advancePosition(ctx.mgf, position, move, ctx.rules);
    if (r.anomaly) return null;
    return { position: r.position, royalCaptured: r.royalCaptured };
  } catch {
    return null;
  }
}

/** 王と確定した駒を取る手の並べ替え用の見込み (どの駒を取るより先に見る)。 */
const ROYAL_ORDER_VALUE = 20000;

function capturedValue(ctx: Ctx, position: Position, move: Move): number {
  if (move.type !== 'move') return 0;
  const target = position.board[move.to.row][move.to.col];
  if (!target) return 0;
  const v = pieceValue(target, ctx.book);
  // 量子で値打ち 0＝候補が王だけ＝王と確定した駒。材料には数えない (evaluate.ts) が、
  // 取れば勝ちなので並べ替えではいちばん先に見る。本当に勝ちかどうかは進めた結果
  // (royalCaptured) が決める＝ここは見る順番の見込みにすぎない。
  if (v === 0 && target.candidates !== undefined) return ROYAL_ORDER_VALUE;
  return v;
}

/** 駒を取る手か。静かになるまで読む部分が、取る手だけを追うのに使う。 */
function isCapture(position: Position, move: Move): boolean {
  return move.type === 'move' && position.board[move.to.row][move.to.col] != null;
}

/** 指した側から見た「王を取って勝った」点数。浅いほど良い (詰みと同じ付け方)。 */
function royalWinScore(plyAfterMove: number): number {
  return MATE_VALUE - plyAfterMove;
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

/** 置換表の手は何より先に見る。 */
const TT_MOVE_ORDER = 1e9;
/** キラー手は駒を取る手 (歩を取って 1000) のすぐ後ろ。 */
const KILLER1_ORDER = 900;
const KILLER2_ORDER = 800;
/** 履歴の点はキラー手より下に収める。 */
const HISTORY_ORDER_CAP = 700;

/**
 * 読む順番。`ply` と `ttMove` は改良 (★v1.93) のときだけ効く＝切っているときは
 * v1.92 までの並べ方 (取る駒の大きさ・成り) とまったく同じ。
 */
function orderMoves(ctx: Ctx, position: Position, moves: Move[], ply = 0, ttMove: string | null = null): Move[] {
  const useKeys = ttMove !== null || ctx.f.killers;
  const killers = ctx.f.killers ? ctx.killers[ply] : undefined;
  const scored = moves.map((m) => {
    let s = orderKey(ctx, position, m);
    if (useKeys) {
      const k = moveKey(position, m);
      if (k === ttMove) s += TT_MOVE_ORDER;
      else if (ctx.f.killers && !isCapture(position, m)) {
        // 駒を取らない手だけ (取る手は取る駒の大きさで十分に前へ来る)。
        if (killers && k === killers[0]) s += KILLER1_ORDER;
        else if (killers && k === killers[1]) s += KILLER2_ORDER;
        else s += Math.min(HISTORY_ORDER_CAP, ctx.history?.get(k) ?? 0);
      }
    }
    return { m, s };
  });
  scored.sort((a, b) => b.s - a.s);
  return scored.map((x) => x.m);
}

/** 相手を黙らせた (枝が刈れた) 駒を取らない手を覚える。 */
function rememberCutoff(ctx: Ctx, position: Position, m: Move, ply: number, depth: number): void {
  if (!ctx.f.killers || isCapture(position, m)) return;
  const k = moveKey(position, m);
  const slot = (ctx.killers[ply] ??= [null, null]);
  if (slot[0] !== k) {
    slot[1] = slot[0];
    slot[0] = k;
  }
  ctx.history!.set(k, (ctx.history!.get(k) ?? 0) + depth * depth);
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
function quiescence(ctx: Ctx, position: Position, alpha: number, beta: number, depth: number, ply: number): number {
  ctx.nodes++;
  const stand = evaluate(ctx.mgf, position, ctx.book);
  if (depth <= 0) return stand;
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (timeUp(ctx)) return stand;

  // ★v1.93: 「値打ちが 0 より大きい駒を取る手」ではなく「取る手」を全部追う。
  // 王と確定した駒は材料として 0 点なので、前の書き方では取れば勝ちの手を落としていた。
  const captures = safeLegalMoves(ctx.mgf, position).filter((m) => isCapture(position, m));
  if (captures.length === 0) return alpha;

  for (const m of orderMoves(ctx, position, captures)) {
    const next = safeApply(ctx, position, m);
    if (!next) continue;
    const score = next.royalCaptured
      ? royalWinScore(ply + 1)
      : -quiescence(ctx, next.position, -beta, -alpha, depth - 1, ply + 1);
    if (ctx.aborted) return alpha;
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(ctx: Ctx, position: Position, depth: number, alpha: number, beta: number, ply: number): number {
  // ★v1.93 王手の延長: 王手をかけられている局面で読みを打ち切らない。
  if (ctx.f.checkExtension && ply < ctx.maxPly && isInCheck(ctx.mgf, position, position.sideToMove)) depth += 1;
  if (depth <= 0) return quiescence(ctx, position, alpha, beta, QUIESCENCE_DEPTH, ply);
  ctx.nodes++;
  if (timeUp(ctx)) return evaluate(ctx.mgf, position, ctx.book);

  // ★v1.93 置換表: 同じ局面を同じ深さ以上で読んだことがあれば、その結論を使う。
  // **窓を狭めることには使わない** (結論が窓の外だと分かったときだけ返す)。根は
  // 「窓の中に収まった点だけが正確」という前提で同点崩しの候補を選ぶため (親 §7.3.3)。
  let key: string | null = null;
  let ttMove: string | null = null;
  if (ctx.tt) {
    key = ttKey(ctx, position);
    const e = ctx.tt.get(key);
    if (e) {
      ttMove = e.move;
      if (e.depth >= depth) {
        const s = fromTt(e.score, ply);
        if (e.flag === TT_EXACT) return s;
        if (e.flag === TT_LOWER && s >= beta) return s;
        if (e.flag === TT_UPPER && s <= alpha) return s;
      }
    }
  }
  const alphaOrig = alpha;

  const moves = safeLegalMoves(ctx.mgf, position);
  // 指す手が無い = 負け。浅いところで詰まされるほど悪いので ply を足して差を付ける
  // (同じ詰みなら遠い方がまし・詰ませるなら早い方が良い、と読めるようにするため)。
  if (moves.length === 0) return -MATE_VALUE + ply;

  let best = -Infinity;
  let bestMove: Move | null = null;
  for (const m of orderMoves(ctx, position, moves, ply, ttMove)) {
    const next = safeApply(ctx, position, m);
    if (!next) continue;
    const score = next.royalCaptured
      ? royalWinScore(ply + 1)
      : -negamax(ctx, next.position, depth - 1, -beta, -alpha, ply + 1);
    if (ctx.aborted) return best === -Infinity ? evaluate(ctx.mgf, position, ctx.book) : best;
    if (score > best) {
      best = score;
      bestMove = m;
    }
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      rememberCutoff(ctx, position, m, ply, depth);
      break;
    }
  }
  if (best === -Infinity) return -MATE_VALUE + ply;
  if (ctx.tt && key !== null) {
    if (ctx.tt.size >= TT_LIMIT) ctx.tt.clear();
    ctx.tt.set(key, {
      depth,
      score: toTt(best, ply),
      flag: best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT,
      move: bestMove ? moveKey(position, bestMove) : null,
    });
  }
  return best;
}

/**
 * ★v1.93 詰み探索: 手番の側が、**王手 (または王取り) だけを続けて** `plies` 手以内に
 * 詰ませられるか。詰ませる初手を返す (無ければ null)。
 *
 * 攻め方は王手になる手だけ、受け方はすべての手を調べる。受け方に指す手が無くなれば詰み。
 * 量子では王が確定するまで王手が成立しない (§Q13.1) ので、確定した王を取る手も攻めに数える。
 * 局面数・時間の上限に達したら「分からない」で打ち切る (詰みが無いとは言わない)。
 */
function findMate(ctx: Ctx, position: Position, plies: number, limit: { nodes: number; deadline: number }): Move | null {
  const over = () => ctx.nodes >= limit.nodes || ctx.now() >= limit.deadline || !!ctx.shouldStop?.();

  /** 攻め方の手番。詰ませる初手を返す。 */
  const attack = (pos: Position, left: number): Move | null => {
    const defender = pos.sideToMove === 'player1' ? 'player2' : 'player1';
    for (const m of orderMoves(ctx, pos, safeLegalMoves(ctx.mgf, pos))) {
      if (over()) return null;
      ctx.nodes++;
      const next = safeApply(ctx, pos, m);
      if (!next) continue;
      if (next.royalCaptured) return m;
      if (!isInCheck(ctx.mgf, next.position, defender)) continue;
      if (defend(next.position, left - 1)) return m;
    }
    return null;
  };
  /** 受け方の手番。どう受けても詰むなら true。 */
  const defend = (pos: Position, left: number): boolean => {
    const moves = safeLegalMoves(ctx.mgf, pos);
    if (moves.length === 0) return true;
    if (left <= 0) return false;
    for (const m of moves) {
      if (over()) return false;
      ctx.nodes++;
      const next = safeApply(ctx, pos, m);
      if (!next) return false; // 読めない受けがある＝詰むとは言い切れない
      if (next.royalCaptured) return false;
      if (!attack(next.position, left - 1)) return false;
    }
    return true;
  };
  return attack(position, plies);
}

export function searchBestMove(mgf: Mgf, position: Position, options: SearchOptions): SearchResult {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const jitter = options.jitter ?? 20;
  const start = now();

  const ctx: Ctx = {
    mgf,
    rules: options.rules ?? PLAIN_RULES,
    book: buildValueBook(mgf, position, {
      mean: options.features?.quantumMeanValue === true,
      kingSafety: options.features?.quantumKingSafety === true,
    }),
    nodes: 0,
    maxNodes: options.maxNodes ?? Infinity,
    deadline: start + Math.max(1, options.movetimeMs),
    now,
    shouldStop: options.shouldStop,
    aborted: false,
    checkMask: 15,
    f: { ...NO_FEATURES, ...options.features },
    tt: options.features?.tt ? new Map() : null,
    killers: [],
    history: options.features?.killers ? new Map() : null,
    maxPly: 2 * Math.max(1, options.maxDepth) + 4,
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

  // ★v1.93 詰み探索: 王手だけで詰ませられるなら、普通の読みをするまでもなく指す。
  if (ctx.f.mateSearch) {
    const limit = {
      nodes: ctx.maxNodes === Infinity ? Infinity : ctx.maxNodes * MATE_SHARE,
      deadline: start + options.movetimeMs * MATE_SHARE,
    };
    for (const plies of MATE_PLIES) {
      const mate = findMate(ctx, position, plies, limit);
      if (mate) {
        return {
          move: mate,
          score: MATE_VALUE - plies,
          depth: plies,
          nodes: ctx.nodes,
          elapsedMs: now() - start,
          completed: true,
        };
      }
      if (ctx.nodes >= limit.nodes || now() >= limit.deadline) break;
    }
  }

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
      if (all.length > 0 && (now() >= ctx.deadline || ctx.nodes >= ctx.maxNodes)) {
        ctx.aborted = true;
        aborted = true;
        break;
      }
      const next = safeApply(ctx, position, m);
      if (!next) continue;
      const prevAlpha = alpha;
      const score = next.royalCaptured
        ? royalWinScore(1)
        : -negamax(ctx, next.position, depth - 1, -Infinity, -alpha, 1);
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
    if (ctx.nodes * 2 > ctx.maxNodes) break; // 局面数の上限でも同じ見切り方をする
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
