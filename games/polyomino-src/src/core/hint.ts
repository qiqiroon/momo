// ヒントの下ごしらえ（仕様書 §8）。今の盤面から、計算に渡す問題を作る。DOM を触らない

import { type Game, refKey } from './game';
import { type Cell } from './geometry';
import { fromKnownSolution, type HintProblem, pickHint } from './hintSolver';
import { boardCells, type Placement } from './levels';

/** 今の盤面（確定した駒だけ）から、残りの空きマスと残りの駒を作る */
export function buildProblem(game: Game): HintProblem {
  const filled = new Set<string>();
  for (const pl of game.placements.values()) for (const [x, y] of game.occupied(pl)) filled.add(x + ',' + y);
  const empty = boardCells(game.level).filter(([x, y]) => !filled.has(x + ',' + y));
  const units = game.refs()
    .filter((r) => !game.placements.has(refKey(r)))
    .map((r) => ({ piece: r.piece, copy: r.copy, cells: game.pieces[r.piece].cells as Cell[] }));
  return { empty, units, n: game.level.n };
}

export type HintStart =
  /** 計算せずに出せた */
  | { kind: 'ready'; placement: Placement }
  /** 重なり・はみ出しがあるので出せない */
  | { kind: 'conflict' }
  /** もう全部置いてある */
  | { kind: 'full' }
  /** 計算が要る（Worker へ） */
  | { kind: 'compute'; problem: HintProblem };

/** ヒントを押したときの最初の判断 */
export function startHint(game: Game): HintStart {
  if (game.conflictCells().size) return { kind: 'conflict' };
  const problem = buildProblem(game);
  if (!problem.units.length) return { kind: 'full' };
  const base = (p: number) => game.pieces[p].cells;
  const known = fromKnownSolution(game.level.solution, [...game.placements.values()], base);
  if (known) {
    const pl = pickHint(known, problem.empty, base);
    if (pl) return { kind: 'ready', placement: pl };
  }
  return { kind: 'compute', problem };
}

/** 計算の答え（残りの置き方）から、出す駒を1つ選ぶ */
export function chooseHint(game: Game, rest: readonly Placement[]): Placement | null {
  return pickHint(rest, buildProblem(game).empty, (p) => game.pieces[p].cells);
}
