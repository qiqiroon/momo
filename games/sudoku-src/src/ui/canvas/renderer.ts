/**
 * Canvas 描画エンジン（第3分冊 3章 / 15.4）
 *
 * **React に依存しない命令的モジュール**である（3.1 / 3.2）。React は Canvas 要素の
 * 生成・破棄と寸法変更だけを担い、描画内容は描画モデル（3.4）として引き渡される。
 *
 * 本ファイルだけが `CanvasRenderingContext2D` を保持する。`layout` / `lod` / `hitTest` は
 * 純粋関数のままに保つ（3.1）。
 *
 * **サイズ別の特例を書かない。** 罫線階層・文字寸法・候補メモ配置はすべて 4章の一般規則で決まる。
 */

import type { BoardSize, Grid, LoupeCorner } from '../../data/types';
import type { NoteSet } from '../../game/notes';
import * as notes from '../../game/notes';
import type { HintDisplay } from '../../game/hint';
import {
  BOARD_COLORS,
  BOARD_FONT_FAMILY,
  FONT_DOUBLE_MAX_WIDTH_RATIO,
  FONT_RATIO_DOUBLE,
  FONT_RATIO_NOTE,
  FONT_RATIO_SINGLE,
  HINT_BUBBLE_PAD_X,
  HINT_TAIL_H,
  HINT_TAIL_W,
  NOTE_FILL_RATIO,
} from '../config';
import { toDisplay, digits } from '../symbols';
import { cellRect, subCellRect, type BoardLayout, type Rect } from './layout';
import type { LodLevel } from './lod';
import { bubbleGeometries, loupeRect } from './hitTest';
import type { ViewportState } from './viewport';

/**
 * ルーペの表示状態（7.2 / C-185・C-189）
 *
 * 中心セルは**マウスがあればマウスの下のマス、無ければ最後に選んだマス**である。
 * **開くかどうかは利用者が決める**（虫眼鏡アイコン）。倍率も自分で決める。
 */
export interface LoupeState {
  /** 中心セル。**その中央が箱の中央に来る** */
  centerIndex: number;
  /** 映す幅（セル数）。3 なら 3×3、0.33 なら1マスの3分の1。**小さいほど拡大** */
  span: number;
  /** 画面上の置き場所。ふだんは設定した角、覆われたときだけ動く */
  corner: LoupeCorner;
}

/** 描画モデル（3.4）。読み取り専用として扱う。renderer は内容を変更しない */
export interface RenderModel {
  n: BoardSize;
  b: number;
  /** 固定値。0 は非固定 */
  givens: Readonly<Grid>;
  /** 入力値。0 は空 */
  entered: Readonly<Grid>;
  /** 誤りフラグ。セルごと */
  errorFlags: Readonly<Uint8Array>;
  /** 候補メモ。ビットマスク（第2分冊 3.5） */
  notes: Readonly<NoteSet>;
  /** 選択中セル。未選択は null */
  selected: number | null;
  /**
   * 確定前のキーボード入力（8.5.1）。**淡色の仮表示として描く**。
   *
   * 3.4 の描画モデルに項目が無く、8.5.1 が求める仮表示を渡す先が無かったため足した
   * （2026-08-06・ユーザー承認済み。C-156）。`text` は打たれた文字そのものであり、
   * 値ではない（`1` は 1 とも 12 とも確定していない）。パレット押下は即時確定するため
   * ここを通らず、**キーボードのある環境でしか現れない**。
   */
  pendingInput: { index: number; text: string } | null;
  /** 表示中のヒント（第2分冊 6.4） */
  hints: readonly HintDisplay[];
  /** ビューポート状態 */
  viewport: ViewportState;
  /** 表示LOD */
  lod: LodLevel;
  /** ルーペの有効状態 */
  loupe: LoupeState | null;
}

/** 再描画要求のダーティ種別（3.5） */
export type DirtyKind = 'ALL' | 'VIEWPORT' | 'CELLS' | 'SELECTION' | 'HINTS' | 'LOUPE';

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  layout: BoardLayout;
  /**
   * 画面外セルの間引きを行うか。既定は true。
   * **false は計測専用**である（V-12 が問う「盤面全体 約12万要素」を実際に描かせるため）。
   */
  cullOffscreen?: boolean;
  /** 1フレーム描き終えるたびに呼ばれる。計測（V-12 / V-13）と検査のための観測口 */
  onFrame?: (info: { ms: number; kinds: readonly DirtyKind[] }) => void;
}

export interface Renderer {
  /** 描画モデルを差し替える。描画は行わない */
  setModel(model: RenderModel): void;
  /** 再描画を要求する。同一フレーム内の重複要求は集約される（3.5） */
  invalidate(kind: DirtyKind): void;
  /** 描画領域の寸法変更を通知する（CSS px） */
  resize(width: number, height: number): void;
  /**
   * 同期的に1回描き、所要ミリ秒を返す。
   * 計測（V-12 / V-13）と検査のために設ける（C-144）。通常の描画経路は `invalidate` である。
   * `clip` を与えると、その矩形（画面座標）へ切り抜いて描く＝部分再描画（3.5）。
   */
  drawNow(clip?: Rect): number;
  /** コンテキストを解放する */
  dispose(): void;
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export function create(options: RendererOptions): Renderer {
  const { canvas, layout } = options;
  const cull = options.cullOffscreen !== false;

  const context2d = canvas.getContext('2d');
  if (!context2d) throw new Error('2D コンテキストを取得できない');
  const ctx: CanvasRenderingContext2D = context2d;

  let model: RenderModel | null = null;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let disposed = false;
  let frame: number | null = null;
  let pending: DirtyKind[] = [];

  /** 2桁の縮小率は文字寸法ごとに1回だけ測る（4.3） */
  const doubleScaleCache = new Map<number, number>();
  /** 字面を上下中央へ置くための補正。書体指定ごとに1回だけ測る */
  const baselineCache = new Map<string, number>();
  /** いま設定してある書体と、その補正量 */
  let currentFont = '';
  let currentOffset = 0;

  function schedule(): void {
    if (frame !== null || disposed) return;
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => setTimeout(() => cb(now()), 16) as unknown as number;
    frame = raf(() => {
      frame = null;
      const kinds = pending;
      pending = [];
      if (disposed) return;
      const ms = paint();
      options.onFrame?.({ ms, kinds });
    });
  }

  function paint(clip?: Rect): number {
    const m = model;
    if (!m || width <= 0 || height <= 0) return 0;
    const started = now();

    doubleScaleCache.clear();
    forgetFont();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.save();

    if (clip) {
      ctx.beginPath();
      ctx.rect(clip.x, clip.y, clip.w, clip.h);
      ctx.clip();
    }

    // レイヤ1: 背景
    ctx.fillStyle = BOARD_COLORS.background;
    ctx.fillRect(0, 0, width, height);

    // レイヤ2〜7 は論理座標へ変換して描く（3.3）
    ctx.save();
    ctx.translate(m.viewport.offsetX, m.viewport.offsetY);
    ctx.scale(m.viewport.zoom, m.viewport.zoom);

    const range = visibleRange(m);
    // **セル塗りを先に、ハイライトを後に置く**（新4）。逆にすると固定セルの灰色が
    // ハイライトを覆ってしまい、「最初から埋まっているセルだけ塗られない」状態になる。
    // ハイライトは半透明なので、上に重ねても固定セルであることは色味で残る
    drawCellFills(m, range);
    drawHighlights(m, range);
    drawGrid(m);
    drawCellContents(m, range);
    drawPendingInput(m);
    drawSelection(m);

    ctx.restore();
    forgetFont();

    // レイヤ8・9 は画面座標で描く。可読性を倍率に依存させないため（3.3）
    drawHints(m);
    drawLoupe(m);

    ctx.restore();
    forgetFont();
    return now() - started;
  }

  // -------------------------------------------------------------- 可視範囲

  interface CellRange {
    rowFrom: number;
    rowTo: number;
    colFrom: number;
    colTo: number;
  }

  function visibleRange(m: RenderModel): CellRange {
    const all: CellRange = { rowFrom: 0, rowTo: m.n - 1, colFrom: 0, colTo: m.n - 1 };
    if (!cull) return all;

    const unit = layout.cellSize * m.viewport.zoom;
    if (unit <= 0) return all;
    const colFrom = Math.floor(-m.viewport.offsetX / unit);
    const rowFrom = Math.floor(-m.viewport.offsetY / unit);
    const colTo = Math.ceil((width - m.viewport.offsetX) / unit);
    const rowTo = Math.ceil((height - m.viewport.offsetY) / unit);
    return {
      rowFrom: Math.max(0, rowFrom),
      rowTo: Math.min(m.n - 1, rowTo),
      colFrom: Math.max(0, colFrom),
      colTo: Math.min(m.n - 1, colTo),
    };
  }

  function eachVisible(m: RenderModel, range: CellRange, fn: (index: number) => void): void {
    for (let row = range.rowFrom; row <= range.rowTo; row++) {
      for (let col = range.colFrom; col <= range.colTo; col++) {
        fn(row * m.n + col);
      }
    }
  }

  // -------------------------------------------------------------- レイヤ2: ハイライト

  /**
   * 選択セルを基準に行・列・同値を強調する（7.3 / 新4）。
   * 重なるセルは強い表現を優先する（同値 > 行・列）。
   * 塗りを重ねずに、セルごとの最終段階を決めてから1回だけ塗る。
   *
   * **ブロックは塗らない**（ユーザー指示）。縦横だけを塗るほうが、いま効いている筋が読みやすい。
   */
  function drawHighlights(m: RenderModel, range: CellRange): void {
    if (m.selected === null) return;
    const marks = new Map<number, 1 | 2>();
    const put = (index: number, level: 1 | 2): void => {
      const current = marks.get(index);
      if (current === undefined || current < level) marks.set(index, level);
    };

    const n = m.n;
    const row = Math.floor(m.selected / n);
    const col = m.selected % n;
    for (let i = 0; i < n; i++) {
      put(row * n + i, 1);
      put(i * n + col, 1);
    }

    // 同値ハイライトは選択セルに確定値があるときのみ。MINIMAL では省略する（6.2 / 7.3）
    const value = valueAt(m, m.selected);
    if (value !== 0 && m.lod !== 'MINIMAL') {
      for (let i = 0; i < n * n; i++) {
        if (valueAt(m, i) === value) put(i, 2);
      }
    }

    const colors = [BOARD_COLORS.highlightLine, BOARD_COLORS.highlightSame];
    eachVisible(m, range, (index) => {
      const level = marks.get(index);
      if (level === undefined) return;
      const rect = cellRect(layout, index);
      ctx.fillStyle = colors[level - 1];
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    });
  }

  // -------------------------------------------------------------- レイヤ3: セル塗り

  function drawCellFills(m: RenderModel, range: CellRange): void {
    if (m.lod === 'MINIMAL') {
      // 値が入っているセルを塗りで示す。固定値と入力値は濃さで区別する（6.2）
      eachVisible(m, range, (index) => {
        const given = m.givens[index] !== 0;
        const filled = given || m.entered[index] !== 0;
        if (!filled) return;
        const rect = cellRect(layout, index);
        ctx.fillStyle = given ? BOARD_COLORS.minimalGiven : BOARD_COLORS.minimalEntered;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      });
      return;
    }

    eachVisible(m, range, (index) => {
      if (m.givens[index] === 0) return;
      const rect = cellRect(layout, index);
      ctx.fillStyle = BOARD_COLORS.givenFill;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    });
  }

  // -------------------------------------------------------------- レイヤ4: 罫線

  /**
   * 罫線は3階層（4.2）。**N=1 では `col % 1 === 0` が常に真となり、外枠だけが残る。**
   * 分岐は書かない。
   */
  function drawGrid(m: RenderModel): void {
    const size = layout.boardSize;
    const unit = layout.cellSize;

    if (m.lod !== 'MINIMAL') {
      ctx.strokeStyle = BOARD_COLORS.lineCell;
      ctx.lineWidth = strokeWidth(m, layout.lineWidth.cell);
      ctx.beginPath();
      for (let i = 1; i < m.n; i++) {
        if (i % m.b === 0) continue;
        const at = i * unit;
        ctx.moveTo(at, 0);
        ctx.lineTo(at, size);
        ctx.moveTo(0, at);
        ctx.lineTo(size, at);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = BOARD_COLORS.lineBlock;
    ctx.lineWidth = strokeWidth(m, layout.lineWidth.block);
    ctx.beginPath();
    for (let i = 1; i < m.n; i++) {
      if (i % m.b !== 0) continue;
      const at = i * unit;
      ctx.moveTo(at, 0);
      ctx.lineTo(at, size);
      ctx.moveTo(0, at);
      ctx.lineTo(size, at);
    }
    ctx.stroke();

    // 外枠はブロック境界と重なる位置を上書きする（4.2）
    ctx.strokeStyle = BOARD_COLORS.lineOuter;
    ctx.lineWidth = strokeWidth(m, layout.lineWidth.outer);
    ctx.strokeRect(0, 0, size, size);
  }

  /** 論理線幅を用いるが、**最小1物理ピクセル**を保証する（4.2） */
  function strokeWidth(m: RenderModel, logical: number): number {
    const scale = m.viewport.zoom * dpr;
    return scale > 0 ? Math.max(logical, 1 / scale) : logical;
  }

  // -------------------------------------------------------------- レイヤ5・6: 候補メモと確定値

  function drawCellContents(m: RenderModel, range: CellRange): void {
    if (m.lod === 'MINIMAL') return; // 文字を描かない（6.2）
    ctx.textAlign = 'center';
    eachVisible(m, range, (index) => paintCell(m, index, cellRect(layout, index)));
  }

  /**
   * 1セルぶんの候補メモと確定値を、与えられた矩形へ描く。
   * **盤面とルーペで同じ手順を使う**（ルーペは FULL 相当で拡大するだけである・7.2）。
   */
  function paintCell(m: RenderModel, index: number, rect: Rect, lod: LodLevel = m.lod): void {
    const unit = rect.w;
    const value = valueAt(m, index);

    if (value === 0) {
      if (lod === 'MINIMAL') return;
      const list = notes.values(m.notes as NoteSet, index);
      if (list.length === 0) return;
      if (lod === 'FULL') {
        ctx.fillStyle = BOARD_COLORS.noteText;
        useFont((unit / m.b) * FONT_RATIO_NOTE);
        for (const v of list) {
          const sub = subCellRect(rect, m.b, v);
          centerText(toDisplay(v), sub.x + sub.w / 2, sub.y + sub.h / 2);
        }
        return;
      }
      // COMPACT: 区画そのものを塗る（6.3 / C-182）。**点では数を読み取れない**
      ctx.fillStyle = BOARD_COLORS.noteDot;
      for (const v of list) {
        const sub = subCellRect(rect, m.b, v);
        const w = sub.w * NOTE_FILL_RATIO;
        const h = sub.h * NOTE_FILL_RATIO;
        ctx.fillRect(sub.x + (sub.w - w) / 2, sub.y + (sub.h - h) / 2, w, h);
      }
      return;
    }

    // 誤りは**文字色のみ**で表す（C-43）
    ctx.fillStyle =
      m.givens[index] !== 0
        ? BOARD_COLORS.givenText
        : m.errorFlags[index]
          ? BOARD_COLORS.errorText
          : BOARD_COLORS.enteredText;
    useFont(valueFontSize(unit, value));
    centerText(toDisplay(value), rect.x + rect.w / 2, rect.y + rect.h / 2);
  }

  /**
   * 文字寸法を切り替え、字面を上下中央へ置くための補正量を求める。
   *
   * Canvas の `textBaseline = 'middle'` は**字面ではなく em 枠の中央**にそろえるため、
   * 数字が上へ寄って見える（実機で最大 6.5px のずれを実測した）。字面の上端・下端を
   * 測って基準線をずらす。
   *
   * **測る前に基準線を合わせる。** 字面の上端・下端は「そのときの基準線からの距離」として
   * 返るため、`middle` のまま測ると別の値になる（実機で 7.5 → 1.6 と食い違った）。
   *
   * **寸法が変わったときだけ測り直す。** `ctx.font` は読むたびに指定文字列を組み立てるので、
   * 1字ごとに読むと 49×49 の候補メモで3倍以上遅くなる（実機で 96ms → 30ms の差）。
   */
  function useFont(px: number): void {
    const font = `${px}px ${BOARD_FONT_FAMILY}`;
    if (font === currentFont) return;
    currentFont = font;
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';

    let offset = baselineCache.get(font);
    if (offset === undefined) {
      const metrics = ctx.measureText('8');
      const ascent = metrics.actualBoundingBoxAscent;
      const descent = metrics.actualBoundingBoxDescent;
      // 字面の寸法を返さない環境では em 枠の中央そろえに落とす
      offset =
        typeof ascent === 'number' && typeof descent === 'number' ? (ascent - descent) / 2 : NaN;
      baselineCache.set(font, offset);
    }
    if (Number.isNaN(offset)) ctx.textBaseline = 'middle';
    currentOffset = Number.isNaN(offset) ? 0 : offset;
  }

  /** 文字を矩形の中央へ描く。`useFont` で寸法を選んでから呼ぶ */
  function centerText(text: string, cx: number, cy: number): void {
    ctx.fillText(text, cx, cy + currentOffset);
  }

  /**
   * `ctx.save()` / `restore()` は書体も巻き戻すため、追跡していた値を捨てる。
   * これを怠ると「設定済みのつもり」で古い寸法のまま描いてしまう。
   */
  function forgetFont(): void {
    currentFont = '';
    currentOffset = 0;
  }

  /** 1桁と2桁で寸法が変わる。2桁はセル幅の 0.80 に収まるよう縮小する（4.3） */
  function valueFontSize(unit: number, value: number): number {
    if (digits(value) === 1) return unit * FONT_RATIO_SINGLE;
    const base = unit * FONT_RATIO_DOUBLE;
    let scale = doubleScaleCache.get(unit);
    if (scale === undefined) {
      useFont(base);
      const measured = ctx.measureText('88').width;
      scale = measured > 0 ? Math.min(1, (unit * FONT_DOUBLE_MAX_WIDTH_RATIO) / measured) : 1;
      doubleScaleCache.set(unit, scale);
    }
    return base * scale;
  }

  // -------------------------------------------------------------- レイヤ6.5: 確定前の入力

  /**
   * 確定前のキーボード入力を、対象セルへ淡色で描く（8.5.1）。
   *
   * **確定値と同じ位置・同じ寸法**で描き、色だけを変える。確定した瞬間に濃い確定値へ
   * 置き換わるので、位置が動かない。`MINIMAL` では文字を描かない規則に従って描かない（6.2）。
   */
  function drawPendingInput(m: RenderModel): void {
    if (m.pendingInput === null || m.lod === 'MINIMAL') return;
    const { index, text } = m.pendingInput;
    if (text === '' || index < 0 || index >= m.n * m.n) return;

    const rect = cellRect(layout, index);
    ctx.textAlign = 'center';
    ctx.fillStyle = BOARD_COLORS.pendingText;
    // 桁数に応じた寸法は確定値と同じ規則で選ぶ（4.3）。`text` は 1〜2 桁である
    useFont(valueFontSize(rect.w, text.length === 1 ? 1 : 10));
    centerText(text, rect.x + rect.w / 2, rect.y + rect.h / 2);
    forgetFont();
  }

  // -------------------------------------------------------------- レイヤ7: 選択枠

  function drawSelection(m: RenderModel): void {
    if (m.selected === null) return;
    const rect = cellRect(layout, m.selected);
    ctx.strokeStyle = BOARD_COLORS.selection;
    ctx.lineWidth = strokeWidth(m, layout.lineWidth.block);
    const inset = ctx.lineWidth / 2;
    ctx.strokeRect(rect.x + inset, rect.y + inset, rect.w - ctx.lineWidth, rect.h - ctx.lineWidth);
  }

  // -------------------------------------------------------------- レイヤ8: ヒント吹き出し

  /** `issuedAt` の昇順に描き、新しいものが手前に来る（10.3）。幾何は `hitTest` と共有する */
  function drawHints(m: RenderModel): void {
    const geoms = bubbleGeometries(layout, m.viewport, m.hints);
    ctx.textAlign = 'center';

    for (const g of geoms) {
      ctx.fillStyle = BOARD_COLORS.hintFill;
      ctx.fillRect(g.box.x, g.box.y, g.box.w, g.box.h);

      // 指示部。対象セルを指したまま維持する（10.2）
      const baseY = g.flipped ? g.box.y : g.box.y + g.box.h;
      const tipX = Math.max(g.box.x + HINT_TAIL_W, Math.min(g.tipX, g.box.x + g.box.w - HINT_TAIL_W));
      ctx.beginPath();
      ctx.moveTo(tipX - HINT_TAIL_W / 2, baseY);
      ctx.lineTo(tipX + HINT_TAIL_W / 2, baseY);
      ctx.lineTo(tipX, g.flipped ? baseY - HINT_TAIL_H : baseY + HINT_TAIL_H);
      ctx.closePath();
      ctx.fill();

      // 提示値のみを大きく表示する。位置情報は示さない（10.2）
      ctx.fillStyle = BOARD_COLORS.hintText;
      useFont(g.box.h * 0.5);
      centerText(
        toDisplay(g.hint.value),
        g.box.x + HINT_BUBBLE_PAD_X + (g.box.w - g.close.w - HINT_BUBBLE_PAD_X * 3) / 2 + HINT_BUBBLE_PAD_X / 2,
        g.box.y + g.box.h / 2,
      );

      ctx.strokeStyle = BOARD_COLORS.hintClose;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(g.close.x + 4, g.close.y + 4);
      ctx.lineTo(g.close.x + g.close.w - 4, g.close.y + g.close.h - 4);
      ctx.moveTo(g.close.x + g.close.w - 4, g.close.y + 4);
      ctx.lineTo(g.close.x + 4, g.close.y + g.close.h - 4);
      ctx.stroke();
    }
  }

  // -------------------------------------------------------------- レイヤ9: ルーペ

  /**
   * 中心セルとその周囲を FULL 相当で拡大描画する（7.2）。
   * 盤面外にはみ出す部分は背景色で埋め、**中心はずらさない**。
   * 吹き出し自体は描かない（二重表示になるため）。
   */
  /**
   * ルーペ（7.2 / C-189）
   *
   * **盤面のどこか一点を、箱の中に別の倍率で描き直す。**
   * 段階7 までは「中心セルの周囲 r セル」を1マスずつ並べていたが、
   * **映す幅が 1マス未満にもなる**（いちばん拡大すると1マスの33%）ため、
   * 「その一点を中心に、盤面を別の倍率で描く」という素直な形へ改めた。
   *
   * **中心はいつも対象セルの中央**である（C-189）。
   * **中は必ず文字で描く**（`FULL` 相当）。つぶれて読めなくてもよく、
   * 塗りつぶしへ切り替えることはしない（C-189。切り替えたら拡大する意味が無い）。
   */
  function drawLoupe(m: RenderModel): void {
    const loupe = m.loupe;
    if (!loupe) return;

    const box = loupeRect(loupe, width, height);
    const unit = layout.cellSize;
    // 箱の一辺に「映す幅」ぶんのセルを収める倍率
    const scale = box.w / (loupe.span * unit);

    // 対象セルの中央（論理座標）
    const cell = cellRect(layout, loupe.centerIndex);
    const cx = cell.x + cell.w / 2;
    const cy = cell.y + cell.h / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();

    ctx.fillStyle = BOARD_COLORS.loupeFill;
    ctx.fillRect(box.x, box.y, box.w, box.h);

    // 箱の中央へ対象セルの中央が来るように置く
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);

    // 見えている範囲のセルだけを描く
    const half = (loupe.span * unit) / 2;
    const from = (v: number) => Math.max(0, Math.floor((v - half) / unit));
    const to = (v: number) => Math.min(m.n - 1, Math.floor((v + half) / unit));
    const colFrom = from(cx), colTo = to(cx);
    const rowFrom = from(cy), rowTo = to(cy);

    ctx.textAlign = 'center';
    forgetFont();
    for (let row = rowFrom; row <= rowTo; row++) {
      for (let col = colFrom; col <= colTo; col++) {
        const index = row * m.n + col;
        const rect = cellRect(layout, index);

        if (m.givens[index] !== 0) {
          ctx.fillStyle = BOARD_COLORS.givenFill;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        if (index === m.selected) {
          ctx.fillStyle = BOARD_COLORS.highlightSame;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        ctx.strokeStyle = BOARD_COLORS.lineCell;
        ctx.lineWidth = 1 / scale;
        ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

        // **必ず文字で描く。** 塗りつぶしの表現へは落とさない（C-189）
        paintCell(m, index, rect, 'FULL');
      }
    }

    ctx.restore();
    forgetFont();

    ctx.strokeStyle = BOARD_COLORS.loupeBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }

  // -------------------------------------------------------------- 共通

  function valueAt(m: RenderModel, index: number): number {
    const given = m.givens[index];
    return given !== 0 ? given : m.entered[index];
  }

  // -------------------------------------------------------------- 公開

  return {
    setModel(next: RenderModel): void {
      model = next;
    },

    invalidate(kind: DirtyKind): void {
      if (disposed) return;
      pending.push(kind);
      schedule();
    },

    resize(nextWidth: number, nextHeight: number): void {
      if (disposed) return;
      width = nextWidth;
      height = nextHeight;
      dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      // バッキングストアは CSS寸法 × devicePixelRatio（3.6）
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    },

    drawNow(clip?: Rect): number {
      if (disposed) return 0;
      return paint(clip);
    },

    dispose(): void {
      disposed = true;
      model = null;
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      frame = null;
      pending = [];
    },
  };
}

export const rendererModule = { create };
