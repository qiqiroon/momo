/**
 * 候補メモ（第2分冊 3.5 / 11.3）
 *
 * セルごとに N ビットを持つビットマスクで保持する（C-13）。値 v (1..N) はビット位置 v-1 に対応する。
 * 49×49 でも約19KB に収まり、消込はビットクリア1回で済む。
 *
 * **ビット表現は本モジュールに閉じる。** 他モジュールは値（1..N）と索引だけで扱う。
 * 保存形式は値配列（`number[][]`）であり、相互変換もここが提供する（3.5.3）。
 */

import { err, ok, type BoardSize, type Result } from '../data/types';
import type { NoteDelta } from '../history/undoStack';

/** 1ワードあたりのビット数 */
const BITS_PER_WORD = 32;

export interface NoteSet {
  n: BoardSize;
  /** 1セルあたりのワード数。ceil(N / 32) */
  wordsPerCell: number;
  /** 長さ = n * n * wordsPerCell */
  words: Uint32Array;
}

// ---------------------------------------------------------------- 生成と複製

export function create(n: BoardSize): NoteSet {
  const wordsPerCell = Math.ceil(n / BITS_PER_WORD);
  return { n, wordsPerCell, words: new Uint32Array(n * n * wordsPerCell) };
}

export function clone(notes: NoteSet): NoteSet {
  return { n: notes.n, wordsPerCell: notes.wordsPerCell, words: notes.words.slice() };
}

// ---------------------------------------------------------------- 単一の候補の操作

export function has(notes: NoteSet, index: number, value: number): boolean {
  if (!inRange(notes, index, value)) return false;
  const at = wordAt(notes, index, value);
  return (notes.words[at.word] & at.mask) !== 0;
}

export function add(notes: NoteSet, index: number, value: number): void {
  if (!inRange(notes, index, value)) return;
  const at = wordAt(notes, index, value);
  notes.words[at.word] |= at.mask;
}

export function remove(notes: NoteSet, index: number, value: number): void {
  if (!inRange(notes, index, value)) return;
  const at = wordAt(notes, index, value);
  notes.words[at.word] &= ~at.mask;
}

export function toggle(notes: NoteSet, index: number, value: number): void {
  if (!inRange(notes, index, value)) return;
  const at = wordAt(notes, index, value);
  notes.words[at.word] ^= at.mask;
}

export function clearCell(notes: NoteSet, index: number): void {
  if (index < 0 || index >= notes.n * notes.n) return;
  const base = index * notes.wordsPerCell;
  for (let w = 0; w < notes.wordsPerCell; w++) notes.words[base + w] = 0;
}

// ---------------------------------------------------------------- セル単位の取り出し

/** 指定セルの候補を昇順の値配列で返す（UI層への提供用） */
export function values(notes: NoteSet, index: number): number[] {
  const out: number[] = [];
  if (index < 0 || index >= notes.n * notes.n) return out;
  const base = index * notes.wordsPerCell;
  for (let w = 0; w < notes.wordsPerCell; w++) {
    let word = notes.words[base + w];
    while (word !== 0) {
      const bit = word & -word;
      const position = Math.log2(bit >>> 0);
      out.push(w * BITS_PER_WORD + position + 1);
      word &= word - 1;
    }
  }
  return out;
}

/** 指定セルの候補数を返す（UI層の LOD 判定用） */
export function count(notes: NoteSet, index: number): number {
  if (index < 0 || index >= notes.n * notes.n) return 0;
  const base = index * notes.wordsPerCell;
  let total = 0;
  for (let w = 0; w < notes.wordsPerCell; w++) total += popcount(notes.words[base + w]);
  return total;
}

/** 値配列から指定セルの候補を設定する。範囲外の値・重複値は無視する */
export function setValues(notes: NoteSet, index: number, list: number[]): void {
  clearCell(notes, index);
  for (const value of list) add(notes, index, value);
}

// ---------------------------------------------------------------- 永続化との相互変換（3.5.3）

/** 保存形式へ。候補が空のセルは空配列とする */
export function toArrays(notes: NoteSet): number[][] {
  const out: number[][] = new Array<number[]>(notes.n * notes.n);
  for (let index = 0; index < out.length; index++) out[index] = values(notes, index);
  return out;
}

/** 保存形式から。**範囲外の値・重複値は無視する**（壊れた保存で復元全体を落とさない） */
export function fromArrays(arrays: number[][], n: BoardSize): Result<NoteSet> {
  if (!Array.isArray(arrays) || arrays.length !== n * n) {
    return err('DATA_INVALID', `候補メモの長さが N×N ではない: ${String(arrays?.length)}`);
  }
  const notes = create(n);
  for (let index = 0; index < arrays.length; index++) {
    const list = arrays[index];
    if (!Array.isArray(list)) continue;
    for (const value of list) add(notes, index, value);
  }
  return ok(notes);
}

// ---------------------------------------------------------------- 履歴差分（7.3）

/** 指定セル群の候補を**変更前の姿で**採取する */
export function captureCells(notes: NoteSet, indices: number[]): NoteDelta[] {
  const out: NoteDelta[] = [];
  for (const index of indices) {
    if (index < 0 || index >= notes.n * notes.n) continue;
    const base = index * notes.wordsPerCell;
    const prevWords: number[] = new Array<number>(notes.wordsPerCell);
    for (let w = 0; w < notes.wordsPerCell; w++) prevWords[w] = notes.words[base + w];
    out.push({ index, prevWords });
  }
  return out;
}

/** 採取した差分を書き戻す */
export function restoreCells(notes: NoteSet, delta: NoteDelta[]): void {
  for (const entry of delta) {
    if (entry.index < 0 || entry.index >= notes.n * notes.n) continue;
    const base = entry.index * notes.wordsPerCell;
    for (let w = 0; w < notes.wordsPerCell; w++) notes.words[base + w] = entry.prevWords[w] ?? 0;
  }
}

// ---------------------------------------------------------------- 内部

function inRange(notes: NoteSet, index: number, value: number): boolean {
  if (index < 0 || index >= notes.n * notes.n) return false;
  return Number.isInteger(value) && value >= 1 && value <= notes.n;
}

function wordAt(notes: NoteSet, index: number, value: number): { word: number; mask: number } {
  const bit = value - 1;
  return {
    word: index * notes.wordsPerCell + (bit >>> 5),
    mask: 1 << (bit & 31),
  };
}

function popcount(word: number): number {
  let v = word - ((word >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  v = (v + (v >>> 4)) & 0x0f0f0f0f;
  return (v * 0x01010101) >>> 24;
}

/** 第2分冊 11.3 `NotesService` */
export const notesService = {
  create,
  clone,
  has,
  add,
  remove,
  toggle,
  clearCell,
  values,
  count,
  setValues,
  toArrays,
  fromArrays,
  captureCells,
  restoreCells,
};
