/**
 * N別レイアウト（第3分冊 4章）
 *
 * **受入条件 5-1 の土台**である。罫線階層・文字寸法・候補メモ配置が
 * 全サイズで同じ規則から出ることを、ここで確かめる。
 */

import { describe, expect, it } from 'vitest';
import { BOARD_SIZES, type BoardSize } from '../../data/types';
import { BASE_CELL, FIT_MARGIN_RATIO } from '../config';
import { cellRect, create, fitZoom, noteRect, subCellRect } from './layout';

describe('レイアウト算出（4.1 / 4.2 / 4.3）', () => {
  it('全7サイズで b² = N が成り立ち、盤面寸法は N × 基準セル寸法である', () => {
    for (const n of BOARD_SIZES) {
      const layout = create(n);
      expect(layout.b * layout.b).toBe(n);
      expect(layout.cellSize).toBe(BASE_CELL);
      expect(layout.boardSize).toBe(n * BASE_CELL);
    }
  });

  it('基準セル寸法は N によって変わらない（N 依存の分岐を持たない・4.1）', () => {
    const sizes = new Set(BOARD_SIZES.map((n) => create(n).cellSize));
    expect(sizes.size).toBe(1);
  });

  it('罫線は3階層で、セル < ブロック < 外枠 の順に太い（4.2）', () => {
    for (const n of BOARD_SIZES) {
      const { lineWidth } = create(n);
      expect(lineWidth.cell).toBeLessThan(lineWidth.block);
      expect(lineWidth.block).toBeLessThan(lineWidth.outer);
    }
  });

  it('文字寸法は 1桁 > 2桁 で、候補メモは区画に収まる（4.3）', () => {
    for (const n of BOARD_SIZES) {
      const layout = create(n);
      expect(layout.fontSize.single).toBeGreaterThan(layout.fontSize.double);
      // 候補メモの文字は区画（セル ÷ b）より小さい
      expect(layout.fontSize.note).toBeLessThan(layout.cellSize / layout.b);
    }
  });
});

describe('セルの矩形（4.1）', () => {
  it('索引が行優先で、隙間なく敷き詰められる', () => {
    for (const n of BOARD_SIZES) {
      const layout = create(n);
      const last = cellRect(layout, n * n - 1);
      expect(last.x + last.w).toBe(layout.boardSize);
      expect(last.y + last.h).toBe(layout.boardSize);

      const first = cellRect(layout, 0);
      expect(first).toEqual({ x: 0, y: 0, w: BASE_CELL, h: BASE_CELL });

      // 索引 n は2行目の先頭
      const secondRowHead = cellRect(layout, n);
      expect(secondRowHead.x).toBe(0);
      expect(secondRowHead.y).toBe(BASE_CELL);
    }
  });
});

describe('候補メモの配置（4.4）', () => {
  it('全7サイズで 1..N が b×b の区画をちょうど1つずつ占める', () => {
    for (const n of BOARD_SIZES) {
      const layout = create(n);
      const seen = new Set<string>();
      const cell = cellRect(layout, 0);

      for (let v = 1; v <= n; v++) {
        const rect = noteRect(layout, 0, v);
        // 区画はセルの内側にある
        expect(rect.x).toBeGreaterThanOrEqual(cell.x);
        expect(rect.y).toBeGreaterThanOrEqual(cell.y);
        expect(rect.x + rect.w).toBeLessThanOrEqual(cell.x + cell.w + 1e-9);
        expect(rect.y + rect.h).toBeLessThanOrEqual(cell.y + cell.h + 1e-9);
        seen.add(`${rect.x},${rect.y}`);
      }
      // 重複が無い＝N 個の区画を1つずつ埋めた
      expect(seen.size).toBe(n);
      // b×b の区画をすべて使い切る
      expect(seen.size).toBe(layout.b * layout.b);
    }
  });

  it('N=1 では候補の区画がセルそのものになる（4.4 / 4.6・分岐なしの帰結）', () => {
    const layout = create(1);
    expect(noteRect(layout, 0, 1)).toEqual(cellRect(layout, 0));
  });

  it('区画規則は任意の矩形へ同じ形で適用できる（ルーペが同じ配置を使う・7.2）', () => {
    const scaled = subCellRect({ x: 100, y: 200, w: 90, h: 90 }, 3, 5);
    // 値5 は区画行1・区画列1（中央）
    expect(scaled).toEqual({ x: 130, y: 230, w: 30, h: 30 });
  });
});

describe('fit倍率（5.2）と 4.5 の参考表', () => {
  it('余白係数を掛けた値になる', () => {
    const layout = create(9);
    expect(fitZoom(layout, 800, 800)).toBeCloseTo((800 / 360) * FIT_MARGIN_RATIO, 10);
  });

  it('短い辺で決まる', () => {
    const layout = create(9);
    expect(fitZoom(layout, 800, 400)).toBeCloseTo(fitZoom(layout, 400, 400), 10);
  });

  /** 仕様書 4.5 の表（幅800・係数適用後）。**表そのものが実装と一致するか**を見る */
  const TABLE: Array<{ n: BoardSize; fit: number }> = [
    { n: 1, fit: 19.2 },
    { n: 4, fit: 4.8 },
    { n: 9, fit: 2.13 },
    { n: 16, fit: 1.2 },
    { n: 25, fit: 0.77 },
    { n: 36, fit: 0.53 },
    { n: 49, fit: 0.39 },
  ];

  it.each(TABLE)('N=$n の fit倍率が表と一致する', ({ n, fit }) => {
    expect(fitZoom(create(n), 800, 800)).toBeCloseTo(fit, 2);
  });

  it('描画領域が未確定（0）のときは 0 を返す', () => {
    expect(fitZoom(create(9), 0, 0)).toBe(0);
  });
});
