/**
 * 出題選択（第1分冊 3.5 / 4.5）
 *
 * 取得済みチャンクの問題集合から、条件に合う元問題を1件選ぶ。**変換は適用しない**。
 * 既出リストは引数で受け取るのみで、自らバッファを読み書きしない（3.5.3）。
 */

import { err, ok, type Difficulty, type Puzzle, type PuzzleId, type Result } from './types';

export interface PickInput {
  puzzles: Puzzle[];
  difficulty: Difficulty | null;
  /** 既出ID。**新しい順**（`recentStore.list` と同じ並び） */
  recentIds: PuzzleId[];
}

export interface PickOutput {
  puzzle: Puzzle;
  /** 難易度フォールバックが発生したか。統計・デバッグ用途に限る */
  fellBack: boolean;
  /** 既出除外が枯渇し、解除して選出したか */
  recentExhausted: boolean;
}

export function pick(input: PickInput): Result<PickOutput> {
  const { puzzles, difficulty, recentIds } = input;
  if (puzzles.length === 0) {
    return err('DATA_INVALID', '選択できる問題が1件も無い');
  }

  // [2] 難易度による絞込。0件なら全難易度へ戻す（通知しない）
  let fellBack = false;
  let candidates = puzzles;
  if (difficulty !== null) {
    const matched = puzzles.filter((p) => p.difficulty === difficulty);
    if (matched.length === 0) fellBack = true;
    else candidates = matched;
  }

  // [3] 既出除外
  const excluded = new Set(recentIds);
  let pool = candidates.filter((p) => !excluded.has(p.id));
  let recentExhausted = false;

  // [4] 枯渇時の解除。**古い側から順に**解除し、1件以上になった時点で確定する
  if (pool.length === 0) {
    recentExhausted = true;
    for (let i = recentIds.length - 1; i >= 0; i--) {
      excluded.delete(recentIds[i]);
      pool = candidates.filter((p) => !excluded.has(p.id));
      if (pool.length > 0) break;
    }
    if (pool.length === 0) pool = candidates;
  }

  // [5] 乱数により1件を選ぶ
  const puzzle = pool[Math.floor(Math.random() * pool.length)];
  return ok({ puzzle, fellBack, recentExhausted });
}

export const pickService = { pick };
