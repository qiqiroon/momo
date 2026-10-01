/**
 * 強さの段を、この思考ルーチンの具体値へ写す (親 §7.5.3・§7.5.4)。
 *
 * **段の解釈は思考ルーチンごとに違う**ので、写像は core ではなくここに置く。
 * αβ 探索は「どれだけ長く・どれだけ深く読むか」と「最善からどれだけ外すか」で
 * 強弱を作る (MCTS はプレイアウト数で作る=そちらは別の表を持つ)。
 *
 * 値を変えたくなったら**この表だけ**を書き換える (画面・選び方・他のルーチンには触らない)。
 * 表の正本は親 §7.5.4。
 */

import { DEFAULT_AI_LEVEL, type AiLevel, type ThinkLimits } from '../../core/ai/types';
import type { SearchFeatures } from './search';

interface LevelRow {
  /** 段が求める考慮時間 (ms)。持ち時間の予算とは**小さい方**を採る。 */
  movetimeMs: number;
  /** スマホでの考慮時間。電池と発熱に配慮して短くする (親 §7.4)。 */
  mobileMovetimeMs: number;
  /** 読む深さの上限。実際は時間で先に打ち切られることが多い (暴走止め)。 */
  maxDepth: number;
  /** 同点崩しの幅 (点・歩 1 枚 = 100)。大きいほど最善から外れた手も選ぶ。0 なら常に最善。 */
  jitter: number;
  /** ★v1.93: 読み方の改良 (search.ts の SearchFeatures)。 */
  features: SearchFeatures;
}

/**
 * ★v1.93 (ユーザー判断 2026-10-01): 読み方の改良 4 つを**全段に**入れる。
 *
 * 強さ比べ (src/selfplay・同じ読む量で 160 局) で、4 つ全部入りが今までの読み方に
 * 得点率 66.9% (±7.4)・量子でも 70.0% (±12.3, 40 局)。単独では王手の延長 61.3%・
 * 詰み探索 59.1% がはっきり効き、置換表 52.5%・キラー手 55.3% は単独では差が出なかった。
 *
 * **Easy にも入れる**＝Easy の弱さは「読む深さの上限 2」で作っており (わざとのぶれではない)、
 * そこは変えない。詰み探索が入るので、Easy でも王手だけで詰む短い詰みは見つけるようになる。
 */
const ALL_FEATURES: SearchFeatures = { tt: true, killers: true, checkExtension: true, mateSearch: true };

export const LEVEL_TABLE: Record<AiLevel, LevelRow> = {
  Easy: { movetimeMs: 300, mobileMovetimeMs: 300, maxDepth: 2, jitter: 100, features: ALL_FEATURES },
  Hard: { movetimeMs: 2000, mobileMovetimeMs: 1200, maxDepth: 6, jitter: 20, features: ALL_FEATURES },
  Apocalypse: { movetimeMs: 5000, mobileMovetimeMs: 2500, maxDepth: 12, jitter: 0, features: ALL_FEATURES },
};

export interface ResolvedLevel {
  movetimeMs: number;
  maxDepth: number;
  jitter: number;
  features: SearchFeatures;
}

/**
 * 段と持ち時間の予算から、この 1 手で使う値を決める。
 *
 * **時間は小さい方を採る** (親 §7.5.3)＝段を上げても対局の持ち時間を食い破らない。
 * 深さも指定があれば同じく厳しい側に倒す。
 */
export function resolveLevel(limits: ThinkLimits): ResolvedLevel {
  const row = LEVEL_TABLE[limits.level ?? DEFAULT_AI_LEVEL];
  const wanted = limits.mobile ? row.mobileMovetimeMs : row.movetimeMs;
  const budget = limits.movetimeMs;
  return {
    movetimeMs: typeof budget === 'number' ? Math.min(wanted, budget) : wanted,
    maxDepth: typeof limits.depth === 'number' ? Math.min(row.maxDepth, limits.depth) : row.maxDepth,
    jitter: row.jitter,
    features: row.features,
  };
}
