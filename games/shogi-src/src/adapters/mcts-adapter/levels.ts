/**
 * 強さの段を、汎用MCTS の具体値へ写す (親 §7.5.3・§7.5.4)。
 *
 * αβ は「深さ」で強弱を作るが、MCTS は**試し打ちの回数**で作る。同じ段でも
 * 中身がまるで違うので、写像はそれぞれの思考ルーチンが自分で持つ。
 *
 * 表の正本は親 §7.5.4。
 */

import { DEFAULT_AI_LEVEL, type AiLevel, type ThinkLimits } from '../../core/ai/types';

interface MctsLevelRow {
  /** 何回試すか。 */
  playouts: number;
  /** 段が求める考慮時間 (ms)。持ち時間の予算とは小さい方を採る。 */
  movetimeMs: number;
  /** スマホでの考慮時間 (親 §7.4)。 */
  mobileMovetimeMs: number;
}

export const MCTS_LEVEL_TABLE: Record<AiLevel, MctsLevelRow> = {
  Easy: { playouts: 200, movetimeMs: 300, mobileMovetimeMs: 300 },
  Hard: { playouts: 800, movetimeMs: 2000, mobileMovetimeMs: 1200 },
  Apocalypse: { playouts: 3000, movetimeMs: 5000, mobileMovetimeMs: 2500 },
};

export interface ResolvedMctsLevel {
  playouts: number;
  movetimeMs: number;
}

export function resolveMctsLevel(limits: ThinkLimits): ResolvedMctsLevel {
  const row = MCTS_LEVEL_TABLE[limits.level ?? DEFAULT_AI_LEVEL];
  const wanted = limits.mobile ? row.mobileMovetimeMs : row.movetimeMs;
  const budget = limits.movetimeMs;
  return {
    playouts: row.playouts,
    movetimeMs: typeof budget === 'number' ? Math.min(wanted, budget) : wanted,
  };
}
