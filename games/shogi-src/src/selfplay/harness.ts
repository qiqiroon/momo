/**
 * 強さ比べの物差し (★v1.93・開発用・アプリには載らない)。
 *
 * 思考ルーチンの改良が本当に効いたかを、**同じ条件で自己対戦させた勝ち負け**で測る。
 * 前は「60 手で駒得の差」で比べていたが、駒得は勝ち負けではない (駒を損しても詰ませれば勝ち)。
 *
 * ## 公平に比べるための決まり
 *
 * - **読む量は局面の数で揃える** (`maxNodes`)。時間で揃えると、機械の混み具合で読める量が
 *   変わり、同じ対局をもう一度走らせても同じ結果にならない。
 * - **出だしは決まった手順から始める**。初期局面から毎回同じ将棋にならないよう、乱数の種から
 *   決まる数手を指してから比べ始める。種が同じなら出だしも同じ。
 * - **同じ出だしを先後入れ替えて 2 局**指す。出だしの有利不利が片方にだけ乗らないため。
 * - 手の選び方に混ぜる乱数も、対局ごとの種で決まる。**同じ条件なら結果は毎回同じ**。
 *
 * ## 終局の決め方 (本番の対局画面より簡単にしてある)
 *
 * - 指す手が無い＝その側の負け (詰み・手詰まり)
 * - 量子で王と確定した駒を取った＝取った側の勝ち
 * - 同じ局面が 4 回＝引き分け (連続王手の千日手は区別しない)
 * - 手数の上限＝引き分け
 * - 入玉宣言・持将棋は扱わない (上限まで指して引き分けになる)
 */

import type { Mgf, Player } from '../core/engine/mgf/types';
import type { Move, Position } from '../core/engine/position/types';
import { generateLegalMoves } from '../core/engine/moves/legal';
import { positionHash } from '../core/engine/position/hash';
import { advancePosition, type AdvanceRules } from '../core/engine/position/advance';
import { searchBestMove, type SearchOptions } from '../adapters/selfmade-alphabeta/search';

/** 1 手を決める係。局面と乱数を受け取って手を返す (無ければ null)。 */
export type Player_ = (position: Position, random: () => number) => { move: Move | null; depth: number; nodes: number };

export type GameEnd = 'no_moves' | 'royal_captured' | 'repetition' | 'move_limit' | 'anomaly';

export interface GameResult {
  /** 先手 (player1) から見た点。勝ち 1・引き分け 0.5・負け 0。 */
  scoreP1: number;
  end: GameEnd;
  plies: number;
  /** 各係の 1 手あたりの平均の深さ・局面数・時間 (ms)。 */
  stats: Record<Player, { moves: number; depth: number; nodes: number; ms: number }>;
}

/** 種から決まる乱数 (線形合同法)。**最初の数個は偏る**ので捨ててから使う。 */
export function seededRandom(seed: number): () => number {
  let s = (seed * 2654435761) % 2147483648;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 8; i++) next();
  return next;
}

export interface GameOptions {
  mgf: Mgf;
  rules: AdvanceRules;
  start: Position;
  p1: Player_;
  p2: Player_;
  seed: number;
  maxPlies: number;
}

export function playGame(opts: GameOptions): GameResult {
  const { mgf, rules, p1, p2, maxPlies } = opts;
  const random = seededRandom(opts.seed);
  const stats: GameResult['stats'] = {
    player1: { moves: 0, depth: 0, nodes: 0, ms: 0 },
    player2: { moves: 0, depth: 0, nodes: 0, ms: 0 },
  };
  const seen = new Map<string, number>();
  let pos = opts.start;
  const finish = (scoreP1: number, end: GameEnd, plies: number): GameResult => {
    for (const side of ['player1', 'player2'] as Player[]) {
      const s = stats[side];
      if (s.moves > 0) {
        s.depth /= s.moves;
        s.nodes /= s.moves;
        s.ms /= s.moves;
      }
    }
    return { scoreP1, end, plies, stats };
  };
  const lossFor = (side: Player) => (side === 'player1' ? 0 : 1);

  for (let ply = 0; ply < maxPlies; ply++) {
    const side = pos.sideToMove;
    let legal: Move[];
    try {
      legal = generateLegalMoves(mgf, pos);
    } catch {
      return finish(0.5, 'anomaly', ply);
    }
    if (legal.length === 0) return finish(lossFor(side), 'no_moves', ply);

    const t0 = performance.now();
    const picked = (side === 'player1' ? p1 : p2)(pos, random);
    const s = stats[side];
    s.moves++;
    s.ms += performance.now() - t0;
    s.depth += picked.depth;
    s.nodes += picked.nodes;
    if (!picked.move) return finish(lossFor(side), 'no_moves', ply);

    const r = advancePosition(mgf, pos, picked.move, rules);
    if (r.royalCaptured) return finish(side === 'player1' ? 1 : 0, 'royal_captured', ply + 1);
    if (r.anomaly) return finish(0.5, 'anomaly', ply + 1);
    pos = r.position;
    const h = positionHash(pos);
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    if (n >= 4) return finish(0.5, 'repetition', ply + 1);
  }
  return finish(0.5, 'move_limit', maxPlies);
}

/**
 * 出だし。初期局面から、種で決まる手を `plies` 手指した局面を返す (手は無作為)。
 * 無作為なので出だしで駒得・駒損が生じることもあるが、先後を入れ替えて 2 局指すので
 * 有利不利は打ち消し合う。
 */
export function openingFrom(mgf: Mgf, rules: AdvanceRules, initial: Position, plies: number, seed: number): Position {
  const random = seededRandom(seed * 31 + 7);
  let pos = initial;
  for (let i = 0; i < plies; i++) {
    const legal = generateLegalMoves(mgf, pos);
    if (legal.length === 0) break;
    const r = advancePosition(mgf, pos, legal[Math.floor(random() * legal.length)], rules);
    if (r.royalCaptured || r.anomaly) break;
    pos = r.position;
  }
  return pos;
}

/** 1 局の記録 (A から見た形)。手分けした子から親へ JSON で運ぶ。 */
export interface GameRecord {
  opening: number;
  aIsP1: boolean;
  /** A の点。勝ち 1・引き分け 0.5・負け 0。 */
  aScore: number;
  end: GameEnd;
  plies: number;
  a: { moves: number; depth: number; nodes: number; ms: number };
  b: { moves: number; depth: number; nodes: number; ms: number };
}

export interface PairOptions {
  mgf: Mgf;
  rules: AdvanceRules;
  initial: Position;
  a: Player_;
  b: Player_;
  opening: number;
  openingPlies: number;
  maxPlies: number;
}

/** 1 つの出だしを先後入れ替えて 2 局指す。 */
export function playPair(opts: PairOptions): GameRecord[] {
  const start = openingFrom(opts.mgf, opts.rules, opts.initial, opts.openingPlies, opts.opening);
  const out: GameRecord[] = [];
  for (const aIsP1 of [true, false]) {
    // 出だしの局面で手番の側が p1 とは限らない (奇数手指した後) ので、席は手番ではなく
    // player1 / player2 で割り当てる。
    const r = playGame({
      mgf: opts.mgf,
      rules: opts.rules,
      start,
      p1: aIsP1 ? opts.a : opts.b,
      p2: aIsP1 ? opts.b : opts.a,
      seed: opts.opening * 2 + (aIsP1 ? 0 : 1),
      maxPlies: opts.maxPlies,
    });
    out.push({
      opening: opts.opening,
      aIsP1,
      aScore: aIsP1 ? r.scoreP1 : 1 - r.scoreP1,
      end: r.end,
      plies: r.plies,
      a: r.stats[aIsP1 ? 'player1' : 'player2'],
      b: r.stats[aIsP1 ? 'player2' : 'player1'],
    });
  }
  return out;
}

export interface MatchSummary {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** A の得点率 (0〜1)。 */
  score: number;
  /** 得点率のおおよその誤差 (±2 標準誤差)。 */
  margin: number;
  ends: Partial<Record<GameEnd, number>>;
  avgPlies: number;
  a: { depth: number; nodes: number; ms: number };
  b: { depth: number; nodes: number; ms: number };
}

export function summarize(records: GameRecord[]): MatchSummary {
  const n = records.length;
  const mean = records.reduce((x, r) => x + r.aScore, 0) / Math.max(1, n);
  const variance = records.reduce((x, r) => x + (r.aScore - mean) ** 2, 0) / Math.max(1, n - 1);
  const ends: Partial<Record<GameEnd, number>> = {};
  for (const r of records) ends[r.end] = (ends[r.end] ?? 0) + 1;
  /** 1 手あたりの平均は、手数で重みを付けて出す (長い対局ほど多く数える)。 */
  const avg = (k: 'a' | 'b') => {
    const moves = records.reduce((x, r) => x + r[k].moves, 0);
    const w = (f: 'depth' | 'nodes' | 'ms') => (moves ? records.reduce((x, r) => x + r[k][f] * r[k].moves, 0) / moves : 0);
    return { depth: w('depth'), nodes: w('nodes'), ms: w('ms') };
  };
  return {
    games: n,
    wins: records.filter((r) => r.aScore === 1).length,
    draws: records.filter((r) => r.aScore === 0.5).length,
    losses: records.filter((r) => r.aScore === 0).length,
    score: mean,
    margin: 2 * Math.sqrt(variance / Math.max(1, n)),
    ends,
    avgPlies: records.reduce((x, r) => x + r.plies, 0) / Math.max(1, n),
    a: avg('a'),
    b: avg('b'),
  };
}

/**
 * 自作探索の係。読む量は局面の数 (`maxNodes`) で決める＝時間は十分大きく取って効かせない。
 * `tweak` で探索の設定を差し替える (改良の入り・切りを比べるため)。
 */
export function alphaBetaPlayer(
  mgf: Mgf,
  rules: AdvanceRules,
  maxNodes: number,
  tweak: Partial<SearchOptions> = {},
): Player_ {
  return (position, random) => {
    const r = searchBestMove(mgf, position, {
      movetimeMs: 10 * 60 * 1000,
      maxDepth: 64,
      jitter: 0,
      maxNodes,
      rules,
      random,
      ...tweak,
    });
    return { move: r.move, depth: r.depth, nodes: r.nodes };
  };
}
