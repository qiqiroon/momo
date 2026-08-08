/**
 * N別レイアウト（第3分冊 4章 / 15.1）
 *
 * 盤面は**基準セル寸法を単位とする論理座標系**で定義する。
 * ズーム・パンは描画時の変換行列で適用し、レイアウト算出には影響させない（4.1）。
 *
 * **N 依存の分岐を設けない**（1×1 を含む・4.6）。罫線階層も候補メモ配置も、
 * 一般の規則がそのまま各サイズの帰結になる。
 *
 * 本モジュールは状態を持たない。すべて純粋関数である（15.1）。
 */

import type { BoardSize } from '../../data/types';
import {
  BASE_CELL,
  FIT_MARGIN_RATIO,
  FONT_RATIO_DOUBLE,
  FONT_RATIO_NOTE,
  FONT_RATIO_SINGLE,
  LINE_WIDTH_BLOCK,
  LINE_WIDTH_CELL,
  LINE_WIDTH_OUTER,
} from '../config';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardLayout {
  /** 盤面サイズ */
  n: BoardSize;
  /** ブロック1辺 */
  b: number;
  /** 基準セル寸法（論理単位） */
  cellSize: number;
  /** 盤面の論理寸法（外枠を含まない） */
  boardSize: number;
  /** 罫線の論理線幅 */
  lineWidth: { cell: number; block: number; outer: number };
  /** 文字の論理寸法 */
  fontSize: { single: number; double: number; note: number };
}

/** N からレイアウトを算出する。純粋関数 */
export function create(n: BoardSize): BoardLayout {
  const b = Math.round(Math.sqrt(n));
  const cellSize = BASE_CELL;
  return {
    n,
    b,
    cellSize,
    boardSize: n * cellSize,
    lineWidth: { cell: LINE_WIDTH_CELL, block: LINE_WIDTH_BLOCK, outer: LINE_WIDTH_OUTER },
    fontSize: {
      single: cellSize * FONT_RATIO_SINGLE,
      double: cellSize * FONT_RATIO_DOUBLE,
      // 候補メモは b×b の区画に入る。区画寸法に対する比である（4.3 / 4.4）
      note: (cellSize / b) * FONT_RATIO_NOTE,
    },
  };
}

/** 論理座標におけるセルの矩形を返す */
export function cellRect(layout: BoardLayout, index: number): Rect {
  const row = Math.floor(index / layout.n);
  const col = index % layout.n;
  return {
    x: col * layout.cellSize,
    y: row * layout.cellSize,
    w: layout.cellSize,
    h: layout.cellSize,
  };
}

/**
 * 候補値 v の、セル内における論理矩形を返す（4.4）
 *
 * セル内部を b×b に分割し、`区画行 = ⌊(v−1)/b⌋`・`区画列 = (v−1) mod b` に置く。
 * `N = b²` であるため 1..N がちょうど収まる。**N=1 では 1区画に値1のみ**となる。
 */
export function noteRect(layout: BoardLayout, index: number, value: number): Rect {
  return subCellRect(cellRect(layout, index), layout.b, value);
}

/**
 * 4.4 の区画規則を、**任意の矩形**に対して適用する。
 *
 * 盤面（論理座標）とルーペ（画面座標で拡大描画・7.2）の双方が同じ配置を使う。
 * 規則を2箇所に書くとずれるため、ここ1箇所に置く。
 */
export function subCellRect(rect: Rect, b: number, value: number): Rect {
  const sub = rect.w / b;
  return {
    x: rect.x + ((value - 1) % b) * sub,
    y: rect.y + Math.floor((value - 1) / b) * sub,
    w: sub,
    h: sub,
  };
}

/**
 * 描画領域に対する fit倍率を算出する（5.2）
 *
 * 盤面全体が収まる最大倍率に余白係数を掛ける。**上限で頭打ちにはしない**
 * （頭打ちはビューポート側の `minZoom` / `maxZoom` の役目である）。
 */
export function fitZoom(layout: BoardLayout, width: number, height: number): number {
  if (width <= 0 || height <= 0) return 0;
  return Math.min(width / layout.boardSize, height / layout.boardSize) * FIT_MARGIN_RATIO;
}

export const layoutModule = { create, cellRect, noteRect, fitZoom };
