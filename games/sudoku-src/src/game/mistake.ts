/**
 * ミス管理（第2分冊 5章 / 11.6）
 *
 * 誤入力の計数と、上限到達による失敗判定を行う。
 *
 * **失敗は状態ではなく属性である**（C-17）。失敗してもプレイは続く。
 * 入力受理・誤り検出・ミス計数・ヒント・Undo・完成判定のいずれも止めない。
 * 影響するのは統計への計上規則だけである（10章）。
 */

import type { Difficulty } from '../data/types';
import { MISTAKE_LIMIT } from './config';

export interface MistakeState {
  /** 誤入力操作の累計回数 */
  count: number;
  /** 上限。null は無制限 */
  limit: number | null;
  /** 上限に達したか */
  failed: boolean;
}

export interface MistakeRecordOutcome {
  count: number;
  failed: boolean;
  /** この計上で初めて失敗に到達したか（UI通知の契機） */
  justFailed: boolean;
}

export function create(difficulty: Difficulty): MistakeState {
  return { count: 0, limit: MISTAKE_LIMIT[difficulty], failed: false };
}

/**
 * 誤入力を1件計上する（C-07）。
 *
 * **同一セルへ同じ誤った値を繰り返し入れても、そのつど計上する。**
 * 候補メモの操作とヒントの使用は計数対象外であり、ここへは来ない。
 * Undo による取り消しでも減算しない（7.5）ため、減らす口は用意しない。
 */
export function record(state: MistakeState): MistakeRecordOutcome {
  const wasFailed = state.failed;
  state.count += 1;
  // Easy は limit が null。**難易度による分岐は設けず、常に上限との比較を行う**（5.5）
  state.failed = reachedLimit(state.count, state.limit);
  return { count: state.count, failed: state.failed, justFailed: !wasFailed && state.failed };
}

/** 中断復元用。保存された回数と失敗の有無をそのまま戻す */
export function restore(difficulty: Difficulty, count: number, failed: boolean): MistakeState {
  return { count, limit: MISTAKE_LIMIT[difficulty], failed };
}

/**
 * 上限に達したか。
 * `limit` が `null`（無制限）のときは常に偽である。
 * JavaScript では `count >= null` が `count >= 0` と解釈されて真になってしまうため、
 * `null` はここで明示的に除く。
 */
function reachedLimit(count: number, limit: number | null): boolean {
  return limit !== null && count >= limit;
}

/** 第2分冊 11.6 `MistakeService` */
export const mistakeService = { create, record, restore };
