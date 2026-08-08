/**
 * 判定と誤り検出（第2分冊 4章 / 11.5）
 *
 * 判定は**変換後 `solution` との単純照合**による。行・列・ブロックの重複検査は行わない（4.2）。
 * 一意解であるため、`solution` と一致する配置はどの制約にも違反せず、
 * 制約を満たしていても `solution` と異なる値は誤りだからである。
 *
 * **アプリは数独を解かない**（1.3）。ここに探索は無い。
 */

import type { BoardState } from './board';

export interface BoardSummary {
  errorCount: number;
  emptyCount: number;
  completed: boolean;
  /** 値ごとの未配置数。長さ N。添字 v-1 が値 v に対応 */
  remainingByValue: number[];
}

/** そのセルに置かれている値（固定値または記入値）。0 = 空 */
function effectiveValue(state: BoardState, index: number): number {
  return state.given[index] !== 0 ? state.given[index] : state.entered[index];
}

/** 単一セルの正誤を返す。空セルは偽 */
export function isCorrect(state: BoardState, index: number): boolean {
  const value = effectiveValue(state, index);
  return value !== 0 && value === state.solution[index];
}

/**
 * 完成しているか（4.5）。
 * すべてのセルについて、固定値または記入値が `solution` と一致すること。
 * 誤りセルが1つでもあれば照合が一致しないため、自動的に未完成となる。
 */
export function isComplete(state: BoardState): boolean {
  for (let index = 0; index < state.solution.length; index++) {
    if (effectiveValue(state, index) !== state.solution[index]) return false;
  }
  return true;
}

/**
 * 記入値から誤りマークを組み直す（3.7 手順[3]）。
 * **誤りマークは中断保存に含めず、復元時に作り直す**ため、保存項目が1つ減る。
 */
export function rebuildErrorFlags(state: BoardState): void {
  for (let index = 0; index < state.entered.length; index++) {
    const entered = state.entered[index];
    state.errorFlags[index] = entered !== 0 && entered !== state.solution[index] ? 1 : 0;
  }
}

/**
 * 4.6 の判定情報をまとめて返す。**上位にセル走査をさせない。**
 *
 * 「値ごとの残数」は `solution` ではなく現在の盤面から数える。
 * **数えるのは固定値と、正しく置かれた記入値のみ**（C-115）。
 * 誤りを数に含めると、まだ入れる場所が残っているのにパレットが非活性になり、入力できなくなる。
 */
export function summary(state: BoardState): BoardSummary {
  const { n } = state;
  const placed = new Array<number>(n).fill(0);
  let errorCount = 0;
  let emptyCount = 0;

  for (let index = 0; index < n * n; index++) {
    const given = state.given[index];
    const entered = state.entered[index];

    if (given !== 0) {
      placed[given - 1]++;
      continue;
    }
    if (entered === 0) {
      emptyCount++;
      continue;
    }
    if (entered === state.solution[index]) placed[entered - 1]++;
    else errorCount++;
  }

  // 各値は完成解にちょうど N 個現れる
  const remainingByValue = placed.map((count) => n - count);

  // 完成の定義は 4.5 の1箇所に持たせる（ここで数え直さない）
  return { errorCount, emptyCount, completed: isComplete(state), remainingByValue };
}

/** 第2分冊 11.5 `ValidateService` */
export const validateService = { isCorrect, isComplete, rebuildErrorFlags, summary };
