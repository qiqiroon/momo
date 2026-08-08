/**
 * 盤面状態（第2分冊 3章 / 11.4）
 *
 * 出題盤面を保持し、入力・消去・候補操作を受理する。
 * **判定（4章）・ミス管理（5章）・履歴（7章）とは分離**し、ここは状態の保持と一次的な整合維持のみを担う。
 * ミス計数と履歴への積み込みは、返した `Outcome` を受け取った側（セッション）が行う。
 *
 * **層の向き**: データ層と `transform/` のみに依存する。React・Canvas・DOM は参照しない（1.2）。
 */

import {
  ok,
  type BoardSize,
  type Difficulty,
  type Grid,
  type Puzzle,
  type PuzzleId,
  type Result,
} from '../data/types';
import type { HistoryEntry, NoteDelta } from '../history/undoStack';
import { apply as applyTransform } from '../transform/transformer';
import type { TransformParams } from '../transform/params';
import * as notes from './notes';
import type { NoteSet } from './notes';
import { isComplete } from './validate';

export interface BoardState {
  n: BoardSize;
  b: number;
  difficulty: Difficulty;

  /** 元問題ID。既出管理・中断保存に用いる */
  sourceId: PuzzleId;
  /** 適用済み変換パラメータ */
  transformParams: TransformParams;

  /** 変換後の初期盤面。0 = 空、1..N = 固定値。以後不変 */
  given: Grid;
  /** 変換後の完成解。以後不変 */
  solution: Grid;

  /** ユーザー入力値。固定セルの位置は常に 0 */
  entered: Grid;
  /** 誤りマーク。記入セルのうち solution と不一致のものが真 */
  errorFlags: Uint8Array;

  /** 候補メモ */
  notes: NoteSet;
}

export type CellKind = 'GIVEN' | 'EMPTY' | 'FILLED_CORRECT' | 'FILLED_WRONG';

export interface CellView {
  index: number;
  kind: CellKind;
  /** 表示すべき確定値。0 = なし */
  value: number;
  /** 候補の値配列。確定値があるときは空 */
  notes: number[];
}

export interface PlaceOutcome {
  /** 無効操作だったか（固定セルなど） */
  ignored: boolean;
  /** 誤入力だったか。ミス計数の入力となる */
  wasMistake: boolean;
  /** この操作で完成したか */
  completed: boolean;
  /** 履歴へ積むエントリ。ignored のときは null */
  entry: HistoryEntry | null;
}

export interface EraseOutcome {
  ignored: boolean;
  entry: HistoryEntry | null;
}

export interface NoteOutcome {
  /** Easy では常に true（手動編集不可） */
  ignored: boolean;
  entry: HistoryEntry | null;
}

export interface BoardCreateInput {
  puzzle: Puzzle;
  params: TransformParams;
  difficulty: Difficulty;
}

// ---------------------------------------------------------------- 生成

/** 出題盤面を初期化する。Easy の場合は初期候補を全面算出する */
export function create(input: BoardCreateInput): Result<BoardState> {
  const transformed = applyTransform(input.puzzle, input.params);
  if (!transformed.ok) return transformed;
  const { n, b, given, solution } = transformed.value;

  const state: BoardState = {
    n,
    b,
    difficulty: input.difficulty,
    sourceId: input.puzzle.id,
    transformParams: input.params,
    given,
    solution,
    entered: new Array<number>(n * n).fill(0),
    errorFlags: new Uint8Array(n * n),
    notes: notes.create(n),
  };

  // Easy は候補が導出値なので、開始時に全面算出する（3.6.3）
  recomputeAllNotes(state);
  return ok(state);
}

// ---------------------------------------------------------------- 盤面操作（3.4）

export function place(state: BoardState, index: number, value: number): PlaceOutcome {
  if (!isCellIndex(state, index) || !isValue(state, value)) return ignoredPlace();
  // [1] 固定セルへの入力は拒否する
  if (state.given[index] !== 0) return ignoredPlace();

  // [2] 変更前の状態を履歴用に採取する。**候補は ① が触る範囲（当該セル＋関連セル）を採る**
  const prevValue = state.entered[index];
  const prevError = state.errorFlags[index] !== 0;
  const touched = [index, ...peers(state, index)];
  const noteDelta = notes.captureCells(state.notes, touched);

  // [3][4] 記入値と誤りマーク
  state.entered[index] = value;
  state.errorFlags[index] = value === state.solution[index] ? 0 : 1;

  // [5] 値が入ったセルに候補は不要
  notes.clearCell(state.notes, index);
  // [6] 関連セルからの消込。**正誤を問わず行う**（3.6.2）
  for (let i = 1; i < touched.length; i++) notes.remove(state.notes, touched[i], value);
  // [7] Easy のみ差分自動算出（②）
  recomputeNotesAround(state, index);

  return {
    ignored: false,
    wasMistake: value !== state.solution[index],
    completed: isComplete(state),
    entry: {
      kind: 'PLACE',
      index,
      prevValue,
      nextValue: value,
      prevError,
      noteDelta,
    },
  };
}

export function erase(state: BoardState, index: number): EraseOutcome {
  if (!isCellIndex(state, index)) return { ignored: true, entry: null };
  // [1] 固定セル・空セルへの適用は無効操作（履歴にも積まない）
  if (state.given[index] !== 0 || state.entered[index] === 0) {
    return { ignored: true, entry: null };
  }

  const prevValue = state.entered[index];
  const prevError = state.errorFlags[index] !== 0;

  // [3] 記入値と誤りマークを落とす
  state.entered[index] = 0;
  state.errorFlags[index] = 0;
  // [4] **候補の復元は行わない**（C-22）。よって ① の差分は空である
  // [5] Easy のみ差分自動算出（②）。結果として周辺の候補は盤面と整合する
  recomputeNotesAround(state, index);

  return {
    ignored: false,
    entry: { kind: 'ERASE', index, prevValue, nextValue: 0, prevError, noteDelta: [] },
  };
}

// ---------------------------------------------------------------- 候補メモの手動編集（7.2）

export function addNote(state: BoardState, index: number, value: number): NoteOutcome {
  return editNote(state, index, () => notes.add(state.notes, index, value), value);
}

export function removeNote(state: BoardState, index: number, value: number): NoteOutcome {
  return editNote(state, index, () => notes.remove(state.notes, index, value), value);
}

export function toggleNote(state: BoardState, index: number, value: number): NoteOutcome {
  return editNote(state, index, () => notes.toggle(state.notes, index, value), value);
}

export function clearNotes(state: BoardState, index: number): NoteOutcome {
  return editNote(state, index, () => notes.clearCell(state.notes, index), null);
}

/**
 * 候補メモの手動編集に共通の手順。
 *
 * - **Easy では候補が導出値なので手動編集を受け付けない**（C-03）。難易度による分岐はここだけである。
 * - 確定値が入っているセルの候補は常に空とするため（3.6.3）、そのようなセルの編集も受け付けない。
 * - 影響は当該セルのみで、関連セルへ波及しない。よって `noteDelta` の要素数は常に1である（7.3）。
 */
function editNote(
  state: BoardState,
  index: number,
  mutate: () => void,
  value: number | null,
): NoteOutcome {
  if (state.difficulty === 'Easy') return { ignored: true, entry: null };
  if (!isCellIndex(state, index)) return { ignored: true, entry: null };
  if (value !== null && !isValue(state, value)) return { ignored: true, entry: null };
  if (state.given[index] !== 0 || state.entered[index] !== 0) {
    return { ignored: true, entry: null };
  }

  const noteDelta: NoteDelta[] = notes.captureCells(state.notes, [index]);
  mutate();

  // `prevValue` / `nextValue` / `prevError` は候補編集では意味を持たないが、省略可能にはしない（7.3）
  const currentValue = state.entered[index];
  return {
    ignored: false,
    entry: {
      kind: 'NOTE_EDIT',
      index,
      prevValue: currentValue,
      nextValue: currentValue,
      prevError: state.errorFlags[index] !== 0,
      noteDelta,
    },
  };
}

// ---------------------------------------------------------------- 問い合わせ

/** セル区分と表示値・候補集合を返す。**区分の決定はドメイン層が行う**（3.3） */
export function cellState(state: BoardState, index: number): CellView {
  const given = state.given[index] ?? 0;
  const entered = state.entered[index] ?? 0;
  const value = given !== 0 ? given : entered;

  let kind: CellKind;
  if (given !== 0) kind = 'GIVEN';
  else if (entered === 0) kind = 'EMPTY';
  else kind = entered === state.solution[index] ? 'FILLED_CORRECT' : 'FILLED_WRONG';

  return {
    index,
    kind,
    value,
    notes: value !== 0 ? [] : notes.values(state.notes, index),
  };
}

/** 関連セル（同じ行・列・ブロック。自身は除く）の位置を返す */
export function peers(state: BoardState, index: number): number[] {
  const { n, b } = state;
  if (!isCellIndex(state, index)) return [];
  const row = Math.floor(index / n);
  const col = index % n;
  const blockRow = Math.floor(row / b) * b;
  const blockCol = Math.floor(col / b) * b;

  const out: number[] = [];
  for (let c = 0; c < n; c++) {
    if (c !== col) out.push(row * n + c);
  }
  for (let r = 0; r < n; r++) {
    if (r !== row) out.push(r * n + col);
  }
  for (let r = blockRow; r < blockRow + b; r++) {
    for (let c = blockCol; c < blockCol + b; c++) {
      // 行と列で既に拾ったセルを重ねない
      if (r !== row && c !== col) out.push(r * n + c);
    }
  }
  return out;
}

// ---------------------------------------------------------------- Easy の自動算出（3.6.3）

/**
 * 変化したセルが属する行・列・ブロックのみを再算出する（差分更新・C-16）。
 *
 * **Easy 以外では何もしない。** 呼び出し側に難易度の分岐を持たせないため、判定はここに置く。
 * 対象セル数は重複を除いて概ね 3N 未満であり、49×49 で約145セルである。
 */
export function recomputeNotesAround(state: BoardState, index: number): void {
  if (state.difficulty !== 'Easy') return;
  if (!isCellIndex(state, index)) return;
  recomputeCell(state, index);
  for (const peer of peers(state, index)) recomputeCell(state, peer);
}

/**
 * 盤面全体の再算出。**初期化時のみ行う**（3.6.3）。
 *
 * 中断からの再開で候補の復元に失敗したときにも、Easy はここで作り直す（12.4）。
 * 再開も初期化の一種であり、入力のたびに走らせるものではない。
 */
export function recomputeAllNotes(state: BoardState): void {
  if (state.difficulty !== 'Easy') return;
  for (let index = 0; index < state.n * state.n; index++) recomputeCell(state, index);
}

/**
 * 1セルの候補を算出し直す。
 * 空セルの候補 = `{1..N}` から関連セルに現れる値を除いた集合。
 * **現れる値には固定値・記入値の双方を含み、記入値は正誤を問わない**（3.6.3）。
 */
function recomputeCell(state: BoardState, index: number): void {
  if (state.given[index] !== 0 || state.entered[index] !== 0) {
    notes.clearCell(state.notes, index);
    return;
  }
  const used = new Set<number>();
  for (const peer of peers(state, index)) {
    const value = state.given[peer] !== 0 ? state.given[peer] : state.entered[peer];
    if (value !== 0) used.add(value);
  }
  const candidates: number[] = [];
  for (let value = 1; value <= state.n; value++) {
    if (!used.has(value)) candidates.push(value);
  }
  notes.setValues(state.notes, index, candidates);
}

// ---------------------------------------------------------------- 内部

function isCellIndex(state: BoardState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.n * state.n;
}

function isValue(state: BoardState, value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= state.n;
}

function ignoredPlace(): PlaceOutcome {
  return { ignored: true, wasMistake: false, completed: false, entry: null };
}

/** 第2分冊 11.4 `BoardService` */
export const boardService = {
  create,
  place,
  erase,
  addNote,
  removeNote,
  toggleNote,
  clearNotes,
  cellState,
  peers,
  recomputeNotesAround,
};
