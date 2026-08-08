/**
 * ビューポート操作（第3分冊 5章 / 15.5）
 *
 * 仕様書はこの部品を節として定めながら、置き場所（ファイル名）を挙げていなかった。
 * 段階5 の受入条件 5-2（座標→セル変換が全倍率で正しい）と 5-3（LOD の切替）が
 * 倍率と位置を持つ部品を要するため、**本ファイルへ独立させた**（C-143。ユーザー承認済み）。
 *
 * 変換は `画面座標 = 論理座標 × zoom + offset` の一次変換のみとする。回転・傾斜は行わない（5.1）。
 * 本モジュールは状態を持たない純粋関数である。状態は React 側が保持する（15.5）。
 */

import { BASE_CELL } from '../config';
import { fitZoom, type BoardLayout } from './layout';

export interface ViewportState {
  /** ズーム倍率。論理座標 → 画面座標の倍率 */
  zoom: number;
  /** パン量。画面座標における盤面原点の位置 */
  offsetX: number;
  offsetY: number;
  /** 描画領域の寸法（CSS px） */
  width: number;
  height: number;
}

/**
 * 倍率の上下限（C-167）
 *
 * 段階7 までは「下限＝盤面ぴったり／上限＝セル 64px」で、**それ以上は縮小も拡大もできなかった**。
 * 試遊で「どこまでも拡大縮小できるようにしてほしい」という指示があり、上下限を外した。
 * ただし 0 や無限大を許すと座標計算が壊れるので、**実用上あり得ない値まで広げた形**で残す。
 *
 * `MAX_CELL_PX`（64px）は表示LOD の見立てに使う値として据え置き、倍率の頭打ちには使わない。
 */
export const ZOOM_MIN_CELL_PX = 0.5;
export const ZOOM_MAX_CELL_PX = 1200;

export const MIN_ZOOM = ZOOM_MIN_CELL_PX / BASE_CELL;
export const MAX_ZOOM = ZOOM_MAX_CELL_PX / BASE_CELL;

/** 最小倍率（C-167）。**盤面ぴったりより下へも行ける** */
export function minZoom(_layout: BoardLayout, _width: number, _height: number): number {
  return MIN_ZOOM;
}

/**
 * 盤面全体が収まる倍率（5.2 / C-167）
 *
 * 盤面領域の**上下と左右のうち狭いほう**に合わせる。文字が読めるかどうかは見ない
 * （「全体」ボタンと初期表示がこれである）。
 */
export function fitOf(layout: BoardLayout, width: number, height: number): number {
  return clamp(fitZoom(layout, width, height), MIN_ZOOM, MAX_ZOOM);
}

/** 初期状態（盤面全体・中央寄せ）を作る。初期倍率は常に fit倍率である（C-48 / C-167） */
export function initial(layout: BoardLayout, width: number, height: number): ViewportState {
  const zoom = fitOf(layout, width, height);
  // **中央寄せはここで明示する。** 境界制御は余白の中を自由に動かせるようになったので
  // （新6）、任せておいても中央には来ない
  const boardPx = layout.boardSize * zoom;
  return clampOffsets(
    {
      zoom,
      offsetX: (width - boardPx) / 2,
      offsetY: (height - boardPx) / 2,
      width,
      height,
    },
    layout,
  );
}

/** 不動点を保ったまま倍率を変更し、境界制御を適用する */
export function zoomAt(
  vp: ViewportState,
  layout: BoardLayout,
  factor: number,
  originX: number,
  originY: number,
): ViewportState {
  const next = clamp(vp.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (next === vp.zoom) return vp;

  // 不動点の論理座標を保つ
  const logicalX = (originX - vp.offsetX) / vp.zoom;
  const logicalY = (originY - vp.offsetY) / vp.zoom;
  return clampOffsets(
    {
      ...vp,
      zoom: next,
      offsetX: originX - logicalX * next,
      offsetY: originY - logicalY * next,
    },
    layout,
  );
}

/**
 * 倍率を直接指定する（スライダ・復元用）。
 * 不動点は渡された点。省略したときは描画領域の中心とする（C-167）。
 */
export function zoomTo(
  vp: ViewportState,
  layout: BoardLayout,
  zoom: number,
  origin?: { x: number; y: number },
): ViewportState {
  if (vp.zoom === 0) return vp;
  const point = origin ?? { x: vp.width / 2, y: vp.height / 2 };
  return zoomAt(vp, layout, zoom / vp.zoom, point.x, point.y);
}

/** パンし、境界制御を適用する（5.4） */
export function pan(
  vp: ViewportState,
  layout: BoardLayout,
  dx: number,
  dy: number,
): ViewportState {
  return clampOffsets({ ...vp, offsetX: vp.offsetX + dx, offsetY: vp.offsetY + dy }, layout);
}

/** 盤面全体が入る倍率へ戻し、中央へ寄せる（「全体」ボタン・5.5） */
export function fit(vp: ViewportState, layout: BoardLayout): ViewportState {
  return initial(layout, vp.width, vp.height);
}

/**
 * 描画領域の寸法変更を反映する（3.6 / C-167）
 *
 * **倍率はそのまま持ち越す。** 段階7 までは fit倍率を下回る場合に引き上げていたが、
 * どこまでも縮小できるようになったため、引き上げる理由が無くなった。
 * 見えている中心の論理座標は保つ。
 */
export function resize(
  vp: ViewportState,
  layout: BoardLayout,
  width: number,
  height: number,
): ViewportState {
  const centerX = (vp.width / 2 - vp.offsetX) / vp.zoom;
  const centerY = (vp.height / 2 - vp.offsetY) / vp.zoom;
  const zoom = clamp(vp.zoom, MIN_ZOOM, MAX_ZOOM);
  return clampOffsets(
    {
      zoom,
      offsetX: width / 2 - centerX * zoom,
      offsetY: height / 2 - centerY * zoom,
      width,
      height,
    },
    layout,
  );
}

/** 現在のセル実寸（CSS px）。表示LOD とルーペの唯一の判定基準である（6.1 / 7.1） */
export function cellPx(vp: ViewportState, layout: BoardLayout): number {
  return layout.cellSize * vp.zoom;
}

/**
 * ズーム操作が意味を持つか（5.5 / C-167）
 *
 * 上下限を外したので**どのサイズでも常に意味を持つ**。1×1 でも拡大縮小できる。
 * 引数を残してあるのは、呼び出し側の書き方を変えないためである。
 */
export function isZoomable(_layout: BoardLayout, width: number, height: number): boolean {
  return width > 0 && height > 0;
}

/**
 * ホイール1目盛りぶんの倍率変化（C-167）
 *
 * **1目盛りで、見えるマスの数がちょうど1つ増減する。** 倍率を一定割合で動かすと、
 * 拡大しているときほど大きく飛んで手応えが揃わない。「1セル」という指示に対して、
 * 画面の実寸から素直に出る答えがこれである。
 *
 * `direction` は +1 が拡大（見えるマスが1つ減る）、−1 が縮小。
 */
export function stepFactor(vp: ViewportState, layout: BoardLayout, direction: number): number {
  const span = Math.min(vp.width, vp.height);
  if (span <= 0 || vp.zoom <= 0) return 1;

  const visible = span / (layout.cellSize * vp.zoom);
  // 1マスも見えていないほど拡大しているときは、1目盛りで半分／倍にする
  const next = Math.max(0.5, visible - direction);
  return visible / next;
}

// ---------------------------------------------------------------- 座標変換

/** 論理座標 → 画面座標 */
export function toScreen(vp: ViewportState, x: number, y: number): { x: number; y: number } {
  return { x: x * vp.zoom + vp.offsetX, y: y * vp.zoom + vp.offsetY };
}

/** 画面座標 → 論理座標 */
export function toLogical(vp: ViewportState, x: number, y: number): { x: number; y: number } {
  return { x: (x - vp.offsetX) / vp.zoom, y: (y - vp.offsetY) / vp.zoom };
}

// ---------------------------------------------------------------- 境界制御（5.4）

/**
 * 盤面の外側が描画領域に入らないよう `offset` を制限する。
 * 盤面が描画領域より小さい軸は**中央固定**とし、その軸のパンを無効にする。
 * ゴムバンドは設けない。越える操作はその場で止まる。
 */
function clampOffsets(vp: ViewportState, layout: BoardLayout): ViewportState {
  const boardPx = layout.boardSize * vp.zoom;
  return {
    ...vp,
    offsetX: clampAxis(vp.offsetX, boardPx, vp.width),
    offsetY: clampAxis(vp.offsetY, boardPx, vp.height),
  };
}

/**
 * 1軸ぶんの境界制御（新6）
 *
 * **盤面が描画領域に収まっている軸でも、余白のぶんだけ寄せられる。**
 * 段階7 までは中央固定にしていたが、横画面では盤面領域が横に広く縦に短いため、
 * 拡大しても横だけ余白が残り続け、**横へ引いても何も起きない**という手ざわりになった
 * （820×420 の 16×16 で、縦のつまみは 263/319 に対し横のつまみは帯いっぱい）。
 *
 * 動ける範囲は「端から端まで」で、行き過ぎない点は従来どおり。ゴムバンドは設けない。
 */
function clampAxis(offset: number, boardPx: number, viewPx: number): number {
  if (boardPx <= viewPx) return clamp(offset, 0, viewPx - boardPx);
  return clamp(offset, viewPx - boardPx, 0);
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

export const viewportModule = {
  initial,
  zoomAt,
  zoomTo,
  pan,
  fit,
  fitOf,
  resize,
  cellPx,
  isZoomable,
  stepFactor,
  toScreen,
  toLogical,
};
