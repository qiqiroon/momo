/**
 * ヒント（第2分冊 6章 / 11.7）
 *
 * **ヒントはセルを埋めない。表示のみを行う**（C-24）。
 * したがって本モジュールは `BoardState` を**読むだけ**で、`entered` / `errorFlags` / `notes` を一切変更しない。
 * 完成判定・ミス計数・候補消込のいずれにも影響しない（C-08）。
 *
 * 提示された値をユーザーが自分で入力したときは、通常入力として扱う（6.5）。
 */

import { HINT_LIMIT } from './config';
import { cellState, type BoardState } from './board';
import type { RandomSource } from '../transform/params';

export interface HintDisplay {
  /** 対象セルの位置 */
  index: number;
  /** 提示する値 */
  value: number;
  /** 提示した時刻。表示順の決定に用いる */
  issuedAt: number;
}

export interface HintState {
  /** 表示中のヒント。セルごとに最大1件 */
  displays: HintDisplay[];
  /** セッション内のヒント使用回数（累計） */
  usedCount: number;
}

export interface HintOutcome {
  ignored: boolean;
  display: HintDisplay | null;
  usedCount: number;
}

export function create(): HintState {
  return { displays: [], usedCount: 0 };
}

/**
 * モードA。ユーザーが選んだセルへ提示する。
 *
 * 対象は `EMPTY` と `FILLED_WRONG` のみである（6.3）。
 * **誤って埋めたセルへの提示を許す**ことで、詰まった局面の救済として働く。
 */
export function requestForCell(hint: HintState, board: BoardState, index: number): HintOutcome {
  if (!isTargetCell(board, index)) return ignored(hint);
  // 既に表示中のセルへの再提示は無効操作。表示を維持し、使用回数も増やさない（6.4）
  if (hint.displays.some((d) => d.index === index)) return ignored(hint);
  if (reachedLimit(hint)) return ignored(hint);
  return issue(hint, board, index);
}

/**
 * モードB。対象セルから無作為に1つ選んで提示する。
 *
 * **既に表示中のセルは選ばない。** 選んでも無効操作になるだけで、ユーザーから見ると
 * 「押したのに何も出ない」ためである（6.4 の重複提示の規定の帰結）。
 * 対象が1つも無いとき（完成している、または全対象に提示済み）は無効操作とする。
 */
export function requestRandom(
  hint: HintState,
  board: BoardState,
  random: RandomSource = Math.random,
): HintOutcome {
  if (reachedLimit(hint)) return ignored(hint);

  const targets: number[] = [];
  for (let index = 0; index < board.n * board.n; index++) {
    if (!isTargetCell(board, index)) continue;
    if (hint.displays.some((d) => d.index === index)) continue;
    targets.push(index);
  }
  if (targets.length === 0) return ignored(hint);

  const pick = targets[Math.min(targets.length - 1, Math.floor(random() * targets.length))];
  return issue(hint, board, pick);
}

/** 指定セルの表示を閉じる（× 操作）。**使用回数は減らさない**（6.6） */
export function dismiss(hint: HintState, index: number): void {
  hint.displays = hint.displays.filter((d) => d.index !== index);
}

/**
 * 正解入力に伴う自動解除（6.4）。提示の目的が達成されたため閉じる。
 * **誤った値を入力した場合は呼ばない。** 表示を残すほうが助けになる。
 */
export function dismissOnCorrectInput(hint: HintState, index: number): void {
  dismiss(hint, index);
}

/** すべて閉じる（セッションの完了・破棄時。12.3） */
export function dismissAll(hint: HintState): void {
  hint.displays = [];
}

/** 中断復元用。**表示は空、使用回数のみ復元する**（C-27） */
export function restore(usedCount: number): HintState {
  return { displays: [], usedCount };
}

// ---------------------------------------------------------------- 内部

/** 提示の対象か。固定セルと正解済みのセルは対象外である（6.3） */
function isTargetCell(board: BoardState, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= board.n * board.n) return false;
  const kind = cellState(board, index).kind;
  return kind === 'EMPTY' || kind === 'FILLED_WRONG';
}

/**
 * 提示する。**提示した時点で使用回数を加算する**（6.6）。閉じても減らさない。
 * 提示値は変換後 `solution` の値である（6.3）。変換前の値は用いない。
 */
function issue(hint: HintState, board: BoardState, index: number): HintOutcome {
  const display: HintDisplay = {
    index,
    value: board.solution[index],
    issuedAt: Date.now(),
  };
  // 配列の並びも提示順である。同一ミリ秒で時刻が並んでも順序は失われない
  hint.displays.push(display);
  hint.usedCount += 1;
  return { ignored: false, display, usedCount: hint.usedCount };
}

/** 使用回数の上限（6.8）。現行の `HINT_LIMIT` は `null`＝無制限である */
function reachedLimit(hint: HintState): boolean {
  return HINT_LIMIT !== null && hint.usedCount >= HINT_LIMIT;
}

function ignored(hint: HintState): HintOutcome {
  return { ignored: true, display: null, usedCount: hint.usedCount };
}

/** 第2分冊 11.7 `HintService` */
export const hintService = {
  create,
  requestForCell,
  requestRandom,
  dismiss,
  dismissOnCorrectInput,
  dismissAll,
  restore,
};
