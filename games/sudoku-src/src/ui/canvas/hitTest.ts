/**
 * ヒットテストとヒント吹き出しの画面幾何（第3分冊 8.2 / 10.2 / 10.4 / 15.3）
 *
 * 画面座標を「意味のある操作」へ変換する。生の座標を React へ渡さない（3.2）。
 *
 * **吹き出しの画面幾何を本モジュールが持つ。** 描画（`renderer.ts`）とヒット領域は
 * 同じ矩形を指していなければならず、2箇所に置くと必ずずれる。
 * `renderer.ts` は Canvas コンテキストを抱えるため、共有の向きは
 * 「純粋な `hitTest` → `renderer` が参照する」とする（逆向きは層を汚す）。
 */

import type { HintDisplay } from '../../game/hint';
import { LOUPE_CORNERS, type LoupeCorner } from '../../data/types';
import {
  HINT_BUBBLE_H,
  HINT_BUBBLE_PAD_X,
  HINT_CLOSE_SIZE,
  HINT_DIGIT_W,
  HINT_TAIL_H,
  LOUPE_BOX_PX,
  LOUPE_MARGIN_PX,
  MIN_TOUCH_PX,
} from '../config';
import { digits } from '../symbols';
import { cellRect, type BoardLayout, type Rect } from './layout';
import { toScreen, type ViewportState } from './viewport';

export type HitResult =
  | { kind: 'CELL'; index: number }
  | { kind: 'HINT_CLOSE'; index: number }
  | { kind: 'NONE' };

/** 吹き出し1件の画面幾何。すべて CSS px の画面座標である（ズーム倍率に依存しない） */
export interface HintBubbleGeometry {
  hint: HintDisplay;
  /** 吹き出し本体 */
  box: Rect;
  /** × の見た目の矩形 */
  close: Rect;
  /** × の判定領域。最小 44×44 を保証する（10.4） */
  closeHit: Rect;
  /** 指示部が指す点（対象セルの上辺中央 / 反転時は下辺中央） */
  tipX: number;
  tipY: number;
  /** 対象セルの下側へ反転したか（10.2） */
  flipped: boolean;
}

/**
 * 論理座標 → セル索引。盤面外は null
 */
export function toCellIndex(x: number, y: number, layout: BoardLayout): number | null {
  if (x < 0 || y < 0 || x >= layout.boardSize || y >= layout.boardSize) return null;
  const col = Math.floor(x / layout.cellSize);
  const row = Math.floor(y / layout.cellSize);
  return row * layout.n + col;
}

/**
 * 表示中のヒントの吹き出し幾何を、**描画順（`issuedAt` の昇順）**で返す（10.3）。
 * 対象セルが画面外にあるものは含まない（10.2）。表示状態そのものは保持される。
 */
export function bubbleGeometries(
  layout: BoardLayout,
  viewport: ViewportState,
  hints: readonly HintDisplay[],
): HintBubbleGeometry[] {
  const ordered = [...hints].sort((a, b) => a.issuedAt - b.issuedAt);
  const result: HintBubbleGeometry[] = [];

  for (const hint of ordered) {
    const cell = cellRect(layout, hint.index);
    const topLeft = toScreen(viewport, cell.x, cell.y);
    const bottomRight = toScreen(viewport, cell.x + cell.w, cell.y + cell.h);

    // 対象セルが描画領域と重ならないときは描かない
    const offscreen =
      bottomRight.x <= 0 ||
      bottomRight.y <= 0 ||
      topLeft.x >= viewport.width ||
      topLeft.y >= viewport.height;
    if (offscreen) continue;

    const w = bubbleWidth(hint.value);
    const anchorX = (topLeft.x + bottomRight.x) / 2;

    // 上辺へ吸着し、上端をはみ出す場合だけ下辺へ反転する
    let y = topLeft.y - HINT_TAIL_H - HINT_BUBBLE_H;
    const flipped = y < 0;
    if (flipped) y = bottomRight.y + HINT_TAIL_H;

    // 左右をはみ出す場合は、はみ出さない位置まで水平にずらす（指示部は対象を指したまま）
    const x = Math.max(0, Math.min(anchorX - w / 2, viewport.width - w));

    const box: Rect = { x, y, w, h: HINT_BUBBLE_H };
    const close: Rect = {
      x: x + w - HINT_BUBBLE_PAD_X - HINT_CLOSE_SIZE,
      y: y + (HINT_BUBBLE_H - HINT_CLOSE_SIZE) / 2,
      w: HINT_CLOSE_SIZE,
      h: HINT_CLOSE_SIZE,
    };

    result.push({
      hint,
      box,
      close,
      closeHit: expandTo(close, MIN_TOUCH_PX),
      tipX: anchorX,
      tipY: flipped ? bottomRight.y : topLeft.y,
      flipped,
    });
  }

  return result;
}

/**
 * ルーペの画面矩形（7.2）
 *
 * 吹き出しと同じ理由で、**描画とヒット領域が同じ矩形を指すよう1箇所に置く。**
 * 寸法は画面座標で固定であり、ズーム倍率に依存しない。
 */
export function loupeRect(
  loupe: { corner: LoupeCorner },
  width: number,
  height: number,
): Rect {
  // **箱の大きさは盤面サイズによらず一定**（C-186）。中を何マスに割るかだけが変わる
  const size = LOUPE_BOX_PX;
  const left = loupe.corner === 'TOP_LEFT' || loupe.corner === 'BOTTOM_LEFT';
  const top = loupe.corner === 'TOP_LEFT' || loupe.corner === 'TOP_RIGHT';
  return {
    x: left ? LOUPE_MARGIN_PX : width - size - LOUPE_MARGIN_PX,
    y: top ? LOUPE_MARGIN_PX : height - size - LOUPE_MARGIN_PX,
    w: size,
    h: size,
  };
}


/**
 * ルーペの箱を置く角を決める（C-191）
 *
 * **ふだんは設定した角。** 数字ボタンに覆われるときだけ、**覆われ方がいちばん少ない角**へ逃げる。
 * あわせて**映しているマス自身は隠さない**——隠したら何を拡大しているのか見えなくなる。
 *
 * 逃げても足りない場合は覆われたままとし、**数字ボタンを上に出す**（利用者の指示）。
 * 数字ボタンは DOM、ルーペの中身は Canvas なので、**放っておいても数字ボタンが上に来る**。
 */
export function chooseLoupeCorner(
  home: LoupeCorner,
  width: number,
  height: number,
  /** 数字ボタンが覆っている帯（画面座標）。無ければ null */
  cover: Rect | null,
  /** 映しているマスの画面上の位置。無ければ null */
  target: Rect | null,
): LoupeCorner {
  const score = (corner: LoupeCorner): number => {
    const box = loupeRect({ corner }, width, height);
    // 覆われている面積。小さいほどよい
    let value = cover === null ? 0 : overlapArea(box, cover);
    // **映しているマスを隠すのは論外**なので、面積とは桁の違う重みを付ける
    if (target !== null && overlapArea(box, target) > 0) value += width * height;
    return value;
  };

  const best = score(home);
  if (best === 0) return home;

  let chosen = home;
  let chosenScore = best;
  for (const corner of LOUPE_CORNERS) {
    const value = score(corner);
    // 同点なら動かさない。**動く理由が無いのに動くと、探す手間だけが増える**
    if (value < chosenScore) {
      chosen = corner;
      chosenScore = value;
    }
  }
  return chosen;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 吹き出しの幅。内容（提示値）に応じて可変とする（10.2） */
export function bubbleWidth(value: number): number {
  return HINT_BUBBLE_PAD_X * 3 + HINT_DIGIT_W * digits(value) + HINT_CLOSE_SIZE;
}

/**
 * 画面座標を判定する。
 *
 * ヒントの × を**セル選択より優先**し、**表示順の逆順**（手前から奥へ）に判定して
 * 最初に当たった1件のみを処理する（10.4）。
 * 吹き出し本体の押下は何も起こさない。**下のセルへは透過させない**（10.3）。
 *
 * **ルーペの領域も同じく透過させない**（7.2「ルーペ領域はポインタ操作を受け付けない」）。
 * 透過させると、拡大表示を狙って触ったつもりが、その裏にある小さなセルを選んでしまう。
 *
 * ---
 *
 * **重なったときの順序（C-160 / V-18）**
 *
 * × の判定領域は見た目より広い（20px の × を 44px まで広げる・10.4）。
 * 吹き出しが密集すると、**この広げたぶんが隣の吹き出しの上まで届く。**
 * 広げた領域を先に見ると、見えている × を押したのに隣が閉じる。
 *
 * そこで2段階で判じる。
 *
 * 1. **その点にいちばん手前で描かれている吹き出しを1つだけ選ぶ。**
 *    その × の上なら閉じ、本体の上なら何も起こさない（透過しない）。
 * 2. どの吹き出しの上でもない場合にだけ、**広げた判定領域**を手前から見る。
 *
 * こうすると「見えている × を押せば必ずそれが閉じる」ことが保証され、
 * 押しやすさのための余白は、取り違えの起きない場所だけで効く。
 */
export function test(
  x: number,
  y: number,
  layout: BoardLayout,
  viewport: ViewportState,
  hints: readonly HintDisplay[],
  loupe: { corner: LoupeCorner } | null = null,
): HitResult {
  if (loupe !== null && contains(loupeRect(loupe, viewport.width, viewport.height), x, y)) {
    return { kind: 'NONE' };
  }

  const geoms = bubbleGeometries(layout, viewport, hints);

  // [1] 見えているものが勝つ。手前の吹き出しに載っている点は、その1件だけで決める
  for (let i = geoms.length - 1; i >= 0; i--) {
    const g = geoms[i];
    if (!contains(g.box, x, y)) continue;
    return contains(g.close, x, y) ? { kind: 'HINT_CLOSE', index: g.hint.index } : { kind: 'NONE' };
  }

  // [2] どの吹き出しの上でもない＝取り違えの起きない場所。ここでだけ判定を広げる（10.4）
  for (let i = geoms.length - 1; i >= 0; i--) {
    const g = geoms[i];
    if (contains(g.closeHit, x, y)) return { kind: 'HINT_CLOSE', index: g.hint.index };
  }

  const logicalX = (x - viewport.offsetX) / viewport.zoom;
  const logicalY = (y - viewport.offsetY) / viewport.zoom;
  const index = toCellIndex(logicalX, logicalY, layout);
  return index === null ? { kind: 'NONE' } : { kind: 'CELL', index };
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/** 矩形の中心を保ったまま、最小寸法まで広げる */
function expandTo(rect: Rect, min: number): Rect {
  const w = Math.max(rect.w, min);
  const h = Math.max(rect.h, min);
  return { x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, w, h };
}

/** 矩形が点を含むか。ヒット判定の唯一の規則である */
export function rectContains(rect: Rect, x: number, y: number): boolean {
  return contains(rect, x, y);
}

export const hitTestModule = { test, toCellIndex, bubbleGeometries, bubbleWidth, loupeRect, chooseLoupeCorner };
