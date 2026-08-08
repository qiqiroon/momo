/**
 * 候補メモ（第2分冊 3.5 / 11.3）の検査。
 *
 * **32 をまたぐ値**（36×36 / 49×49 では1セルが2ワードになる）を必ず通す。
 * ここを落とすと、大きい盤面でだけ候補が消える種類の不具合になる。
 */

import { describe, expect, it } from 'vitest';

import type { BoardSize } from '../data/types';
import * as notes from './notes';

const ALL_SIZES: readonly BoardSize[] = [1, 4, 9, 16, 25, 36, 49];

describe('候補メモの内部表現（3.5.1）', () => {
  it.each([
    [1, 1, 1, 4],
    [4, 1, 16, 64],
    [9, 1, 81, 324],
    [16, 1, 256, 1024],
    [25, 1, 625, 2500],
    [36, 2, 2592, 10368],
    [49, 2, 4802, 19208],
  ])('%i×%i: 1セル %i ワード・総 %i ワード（仕様書の表と一致する）', (n, perCell, total, bytes) => {
    const set = notes.create(n as BoardSize);
    expect(set.wordsPerCell).toBe(perCell);
    expect(set.words.length).toBe(total);
    expect(set.words.byteLength).toBe(bytes);
  });
});

describe('候補の出し入れ', () => {
  it.each(ALL_SIZES)('%i×%i: 追加・有無・除去・反転・全消去が効く', (n) => {
    const set = notes.create(n);
    const index = n * n - 1;

    expect(notes.has(set, index, 1)).toBe(false);
    notes.add(set, index, 1);
    expect(notes.has(set, index, 1)).toBe(true);

    notes.add(set, index, n);
    expect(notes.values(set, index)).toEqual(n === 1 ? [1] : [1, n]);
    expect(notes.count(set, index)).toBe(n === 1 ? 1 : 2);

    notes.remove(set, index, 1);
    expect(notes.has(set, index, 1)).toBe(false);

    notes.toggle(set, index, 1);
    expect(notes.has(set, index, 1)).toBe(true);
    notes.toggle(set, index, 1);
    expect(notes.has(set, index, 1)).toBe(false);

    notes.clearCell(set, index);
    expect(notes.count(set, index)).toBe(0);
  });

  it('32 をまたぐ値を取り違えない（49×49 は1セル2ワード）', () => {
    const set = notes.create(49);
    const index = 100;
    for (const value of [31, 32, 33, 48, 49]) notes.add(set, index, value);
    expect(notes.values(set, index)).toEqual([31, 32, 33, 48, 49]);
    expect(notes.count(set, index)).toBe(5);

    notes.remove(set, index, 32);
    expect(notes.values(set, index)).toEqual([31, 33, 48, 49]);

    // 隣のセルへ漏れていないこと
    expect(notes.count(set, index + 1)).toBe(0);
    expect(notes.count(set, index - 1)).toBe(0);
  });

  it('範囲外の値と索引は黙って無視する', () => {
    const set = notes.create(9);
    notes.add(set, 0, 0);
    notes.add(set, 0, 10);
    notes.add(set, 0, -1);
    notes.add(set, 999, 1);
    notes.add(set, -1, 1);
    expect(notes.count(set, 0)).toBe(0);
    expect(notes.values(set, 999)).toEqual([]);
  });

  it('値を返すときは必ず昇順である', () => {
    const set = notes.create(25);
    for (const value of [25, 3, 17, 1, 9]) notes.add(set, 5, value);
    expect(notes.values(set, 5)).toEqual([1, 3, 9, 17, 25]);
  });

  it('一括設定は既存の候補を置き換える', () => {
    const set = notes.create(9);
    notes.setValues(set, 0, [1, 2, 3]);
    notes.setValues(set, 0, [7, 8]);
    expect(notes.values(set, 0)).toEqual([7, 8]);
  });

  it('複製は元と切り離される', () => {
    const set = notes.create(9);
    notes.add(set, 0, 5);
    const copy = notes.clone(set);
    notes.remove(set, 0, 5);
    expect(notes.has(copy, 0, 5)).toBe(true);
    expect(notes.has(set, 0, 5)).toBe(false);
  });
});

describe('保存形式との相互変換（3.5.3）', () => {
  it.each(ALL_SIZES)('%i×%i: 値配列へ書き出して読み戻すと一致する', (n) => {
    const set = notes.create(n);
    notes.add(set, 0, 1);
    notes.add(set, n * n - 1, n);
    const arrays = notes.toArrays(set);
    expect(arrays.length).toBe(n * n);

    const restored = notes.fromArrays(arrays, n);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(Array.from(restored.value.words)).toEqual(Array.from(set.words));
  });

  it('候補が空のセルは空配列になる', () => {
    const set = notes.create(4);
    notes.add(set, 2, 3);
    const arrays = notes.toArrays(set);
    expect(arrays[0]).toEqual([]);
    expect(arrays[2]).toEqual([3]);
  });

  it('壊れた保存は、その値だけを捨てて読み込む', () => {
    const arrays: number[][] = Array.from({ length: 81 }, () => []);
    arrays[0] = [1, 1, 0, 10, -3, 9]; // 重複・範囲外を混ぜる
    const restored = notes.fromArrays(arrays, 9);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(notes.values(restored.value, 0)).toEqual([1, 9]);
  });

  it('長さが N×N でない保存は受け付けない', () => {
    expect(notes.fromArrays([[1]], 9).ok).toBe(false);
  });
});

describe('履歴差分（7.3）', () => {
  it('採取した差分を書き戻すと、採取した時点の姿に戻る', () => {
    const set = notes.create(49);
    notes.setValues(set, 10, [1, 40]);
    notes.setValues(set, 11, [2]);

    const delta = notes.captureCells(set, [10, 11]);
    notes.clearCell(set, 10);
    notes.add(set, 11, 49);
    expect(notes.values(set, 10)).toEqual([]);

    notes.restoreCells(set, delta);
    expect(notes.values(set, 10)).toEqual([1, 40]);
    expect(notes.values(set, 11)).toEqual([2]);
  });

  it('採取した差分は、その後の変更に引きずられない（複製である）', () => {
    const set = notes.create(9);
    notes.setValues(set, 0, [1, 2]);
    const delta = notes.captureCells(set, [0]);
    notes.setValues(set, 0, [8]);
    notes.restoreCells(set, delta);
    expect(notes.values(set, 0)).toEqual([1, 2]);
  });
});
