/**
 * 履歴（第2分冊 7章 / 11.8）
 *
 * 盤面操作の取り消し・やり直しを提供する。上限100手のリングバッファであり（C-14）、
 * **中断保存の対象外**である（7.6）。再開時は履歴・Redo ともに空で始まる。
 *
 * 型が実行部より先に置かれているのは、盤面（`game/board.ts`）が操作のたびに
 * 履歴エントリを組み立てて返すためである。`board.ts` からの参照は型のみで、
 * 実行時の依存は本ファイル → `board.ts` の一方向である。
 */

import { peers, recomputeNotesAround, type BoardState } from '../game/board';
import { UNDO_LIMIT_DEFAULT } from '../game/config';
import * as notes from '../game/notes';

export type HistoryOpKind = 'PLACE' | 'ERASE' | 'NOTE_EDIT';

/**
 * 候補メモの変更差分（7.3）。**変更前**のワード列を持つ。
 * 盤面全体の複製は保持しない。1エントリで影響を受けるセルは最大でも概ね 3N である。
 */
export interface NoteDelta {
  index: number;
  /** 変更前の候補集合（当該セル分のワード列の複製） */
  prevWords: number[];
}

/**
 * 履歴エントリ（C-23）。「確定値の入力 ＋ それに伴う自動消込」で1エントリとする。
 *
 * `NOTE_EDIT` では `prevValue` / `nextValue` / `prevError` が意味を持たないが、
 * **省略可能にはしない**（v1.01 の明記）。取り消し処理が種別ごとに分岐せず、
 * 常に同じ手順で盤面へ書き戻せるようにするためである。
 */
export interface HistoryEntry {
  kind: HistoryOpKind;
  /** 操作対象セル */
  index: number;
  /** 変更前の記入値 */
  prevValue: number;
  /** 変更後の記入値 */
  nextValue: number;
  /** 変更前の誤りマーク */
  prevError: boolean;
  /** 候補の変更差分。関連セル分を含む */
  noteDelta: NoteDelta[];
}

export interface UndoState {
  limit: number;
  /** 末尾が最新 */
  entries: HistoryEntry[];
  redoEntries: HistoryEntry[];
}

export interface UndoOutcome {
  applied: boolean;
  /** 変化したセル。UI層の再描画範囲決定に用いる */
  changedIndices: number[];
}

export function create(limit: number = UNDO_LIMIT_DEFAULT): UndoState {
  const bounded = Number.isInteger(limit) && limit > 0 ? limit : UNDO_LIMIT_DEFAULT;
  return { limit: bounded, entries: [], redoEntries: [] };
}

/**
 * 操作エントリを積む。**Redo スタックは破棄される**（7.5・分岐なし履歴）。
 * 上限に達していたら最も古いものから捨てる（C-14）。
 */
export function push(undo: UndoState, entry: HistoryEntry): void {
  undo.entries.push(entry);
  if (undo.entries.length > undo.limit) undo.entries.splice(0, undo.entries.length - undo.limit);
  undo.redoEntries.length = 0;
}

export function canUndo(undo: UndoState): boolean {
  return undo.entries.length > 0;
}

export function canRedo(undo: UndoState): boolean {
  return undo.redoEntries.length > 0;
}

/**
 * 取り消して盤面へ反映する（7.5 Undo）。
 *
 * **ミス回数は減らさない。`failed` も偽に戻らない**（5.3 / 5.4）。誤入力という事実は取り消されない。
 * **ヒント表示・使用回数も変化しない**（6.7）。よって本モジュールはミス管理・ヒントに触れない。
 * 完成判定も行わない（Undo で完成することはない）。
 */
export function undo(undo: UndoState, board: BoardState): UndoOutcome {
  const entry = undo.entries.pop();
  if (entry === undefined) return { applied: false, changedIndices: [] };
  const result = applyEntry(board, entry);
  undo.redoEntries.push(result.inverse);
  return { applied: true, changedIndices: result.changedIndices };
}

/**
 * やり直して盤面へ反映する（7.5 Redo）。
 *
 * **再適用によるミス計数は行わない**（同一の誤入力を二重に計上しないため）。
 * 誤りマークの再付与は行う（盤面状態の復元であるため）。
 * **Redo で完成に到達する経路は存在しない**ため、完成判定は行わない（C-116）。
 */
export function redo(undo: UndoState, board: BoardState): UndoOutcome {
  const entry = undo.redoEntries.pop();
  if (entry === undefined) return { applied: false, changedIndices: [] };
  const result = applyEntry(board, entry);
  undo.entries.push(result.inverse);
  if (undo.entries.length > undo.limit) undo.entries.splice(0, undo.entries.length - undo.limit);
  return { applied: true, changedIndices: result.changedIndices };
}

export function clear(undo: UndoState): void {
  undo.entries.length = 0;
  undo.redoEntries.length = 0;
}

// ---------------------------------------------------------------- 内部

/**
 * エントリの「変更前の姿」を盤面へ書き戻し、**書き戻す直前の姿を逆向きのエントリとして返す。**
 *
 * Undo と Redo はこの1手順を共有する。Redo スタックへ積まれるのは
 * 「操作の直後の姿」を `prev*` に持つエントリであり、それを同じ手順で書き戻せば
 * 操作をやり直したことになる。**種別（PLACE / ERASE / NOTE_EDIT）による分岐は無い。**
 * 候補メモの編集で `prevValue` / `prevError` を省略しない理由がここにある（7.3）。
 *
 * 手順は 3.6.1 の2段構成に従う。①記録された候補差分の復元 → ②Easy のみ自動算出。
 * **Easy では②が①を上書きするが結果は一致する。分岐を持たないために①も常に実行する**（3.6.5）。
 */
function applyEntry(
  board: BoardState,
  entry: HistoryEntry,
): { inverse: HistoryEntry; changedIndices: number[] } {
  const { index } = entry;

  // 書き戻す前の姿を採る。採る範囲はエントリが触る範囲と同一にする（往復で差が出ないため）
  const inverse: HistoryEntry = {
    kind: entry.kind,
    index,
    prevValue: board.entered[index],
    nextValue: entry.prevValue,
    prevError: board.errorFlags[index] !== 0,
    noteDelta: notes.captureCells(
      board.notes,
      entry.noteDelta.map((d) => d.index),
    ),
  };

  board.entered[index] = entry.prevValue;
  board.errorFlags[index] = entry.prevError ? 1 : 0;

  // ① 候補差分の復元。**逆順に適用する**（7.5 手順[3]）
  notes.restoreCells(board.notes, [...entry.noteDelta].reverse());
  // ② Easy のみ自動算出。Easy 以外では何も起きない
  recomputeNotesAround(board, index);

  const changed = new Set<number>([index]);
  for (const delta of entry.noteDelta) changed.add(delta.index);
  if (board.difficulty === 'Easy') {
    for (const peer of peers(board, index)) changed.add(peer);
  }

  return { inverse, changedIndices: [...changed] };
}

/** 第2分冊 11.8 `UndoStack` */
export const undoStack = { create, push, canUndo, canRedo, undo, redo, clear };
