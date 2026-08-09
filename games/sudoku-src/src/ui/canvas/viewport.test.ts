/**
 * ビューポート（第3分冊 5章）
 *
 * 4.5 の参考表（fit時のセル実寸とLOD）を、**表の数字そのままで**裏取りする。
 * 表が実装と食い違っていた版があったため（v1.02 の訂正）、ここで固定する。
 */

import { describe, expect, it } from 'vitest';
import { BOARD_SIZES, type BoardSize } from '../../data/types';
import { create as createLayout } from './layout';
import { decide } from './lod';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  cellPx,
  fit,
  fitOf,
  initial,
  isZoomable,
  pan,
  resize,
  stepFactor,
  toLogical,
  toScreen,
  zoomAt,
  zoomTo,
} from './viewport';

const W = 800;
const H = 800;

describe('初期状態（5.2 / C-48）', () => {
  it('初期倍率は盤面全体が入る倍率である（C-48 / C-167）', () => {
    for (const n of BOARD_SIZES) {
      const layout = createLayout(n);
      const vp = initial(layout, W, H);
      // 段階7 までは「セル64px」で頭打ちにしていたが、上下限を外したので素直に全体が入る
      expect(vp.zoom).toBe(fitOf(layout, W, H));
      expect(vp.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(vp.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    }
  });

  /**
   * fit時のセル実寸と、そのときの表示LOD。
   * **小サイズは頭打ちが無くなったので、盤面領域いっぱいまで大きくなる**（C-167）。
   *
   * **どのサイズも、盤面全体を出した時点では数字が読める**（C-181 で塗りつぶしの境目を
   * 18px から 8px へ下げた）。49×49 も 16px なので数字のまま出る。
   */
  const TABLE: Array<{ n: BoardSize; px: number; lod: string }> = [
    { n: 1, px: 768, lod: 'FULL' },
    { n: 4, px: 192, lod: 'FULL' },
    { n: 9, px: 85, lod: 'FULL' },
    { n: 16, px: 48, lod: 'FULL' },
    { n: 25, px: 31, lod: 'COMPACT' },
    { n: 36, px: 21, lod: 'COMPACT' },
    { n: 49, px: 16, lod: 'COMPACT' },
  ];

  it.each(TABLE)('N=$n の fit時セル実寸 $px px と表示LOD $lod が表と一致する', ({ n, px, lod }) => {
    const layout = createLayout(n);
    const vp = initial(layout, W, H);
    expect(Math.round(cellPx(vp, layout))).toBe(px);
    expect(decide(cellPx(vp, layout), null)).toBe(lod);
  });

  it('どのサイズでも拡大縮小できる。頭打ちは無くなった（C-167）', () => {
    for (const n of BOARD_SIZES) {
      const layout = createLayout(n);
      expect(isZoomable(layout, W, H)).toBe(true);
      // 盤面全体の倍率より小さくも大きくもできる
      const vp = initial(layout, W, H);
      expect(zoomAt(vp, layout, 0.25, 0, 0).zoom).toBeLessThan(vp.zoom);
      expect(zoomAt(vp, layout, 4, 0, 0).zoom).toBeGreaterThan(vp.zoom);
    }
  });

  it('盤面が描画領域より小さい軸は中央へ寄る（5.2）', () => {
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    const boardPx = layout.boardSize * vp.zoom;
    expect(vp.offsetX).toBeCloseTo((W - boardPx) / 2, 10);
    expect(vp.offsetY).toBeCloseTo((H - boardPx) / 2, 10);
  });
});

describe('ズーム（5.2 / 5.5）', () => {
  it('不動点の論理座標が保たれる', () => {
    const layout = createLayout(49);
    const vp = initial(layout, W, H);
    const before = toLogical(vp, 300, 500);
    const zoomed = zoomAt(vp, layout, 1.25, 300, 500);
    const after = toScreen(zoomed, before.x, before.y);
    expect(after.x).toBeCloseTo(300, 6);
    expect(after.y).toBeCloseTo(500, 6);
  });

  it('どこまでも動かしても、上下限は越えない（C-167）', () => {
    const layout = createLayout(49);
    let vp = initial(layout, W, H);
    for (let i = 0; i < 80; i++) vp = zoomAt(vp, layout, 1.25, W / 2, H / 2);
    expect(vp.zoom).toBeCloseTo(MAX_ZOOM, 10);
    for (let i = 0; i < 200; i++) vp = zoomAt(vp, layout, 1 / 1.25, W / 2, H / 2);
    expect(vp.zoom).toBeCloseTo(MIN_ZOOM, 10);
  });

  it('上下限に張り付いたら、それ以上は動かない（C-167）', () => {
    const layout = createLayout(1);
    const vp = initial(layout, W, H);
    const top = zoomAt(vp, layout, 1e6, 0, 0);
    expect(top.zoom).toBe(MAX_ZOOM);
    expect(zoomAt(top, layout, 2, 0, 0)).toBe(top);

    const bottom = zoomAt(vp, layout, 1e-6, 0, 0);
    expect(bottom.zoom).toBe(MIN_ZOOM);
    expect(zoomAt(bottom, layout, 0.5, 0, 0)).toBe(bottom);
  });

  it('ホイール1目盛りで、見えるマスの数がちょうど1つ増減する（C-167）', () => {
    const layout = createLayout(25);
    const vp = initial(layout, W, H);
    const span = Math.min(vp.width, vp.height);
    const before = span / cellPx(vp, layout);

    const zoomedIn = zoomAt(vp, layout, stepFactor(vp, layout, 1), 0, 0);
    expect(span / cellPx(zoomedIn, layout)).toBeCloseTo(before - 1, 6);

    const zoomedOut = zoomAt(vp, layout, stepFactor(vp, layout, -1), 0, 0);
    expect(span / cellPx(zoomedOut, layout)).toBeCloseTo(before + 1, 6);
  });

  it('倍率の直接指定は描画領域の中心を不動点とする', () => {
    const layout = createLayout(25);
    const vp = initial(layout, W, H);
    const zoomed = zoomTo(vp, layout, 1.0);
    expect(zoomed.zoom).toBeCloseTo(1.0, 10);
    // 中心の論理座標が変わらない
    expect(toLogical(zoomed, W / 2, H / 2).x).toBeCloseTo(toLogical(vp, W / 2, H / 2).x, 6);
  });

  it('「全体」で fit倍率・中央へ戻る（5.5）', () => {
    const layout = createLayout(25);
    const vp = pan(zoomAt(initial(layout, W, H), layout, 1.5, 0, 0), layout, -100, -100);
    expect(fit(vp, layout)).toEqual(initial(layout, W, H));
  });
});

describe('パンに制限を設けない（5.4 / C-203）', () => {
  it('盤面より外へも、いくらでも動かせる', () => {
    const layout = createLayout(49);
    let vp = zoomAt(initial(layout, W, H), layout, 2, W / 2, H / 2);
    const boardPx = layout.boardSize * vp.zoom;
    expect(boardPx).toBeGreaterThan(W);

    // 段階7 までは 0 で止めていた。**止めない**のが C-203 である
    vp = pan(vp, layout, 10000, 10000);
    expect(vp.offsetX).toBe(10000 + (W - boardPx) / 2);
    expect(vp.offsetY).toBe(10000 + (H - boardPx) / 2);
  });

  it('端のマスを画面の中央まで持ってこられる（利用者の指示）', () => {
    // これが制限を外した理由そのもの。**いちばん端の行が真ん中に来る**ことを見る
    const layout = createLayout(49);
    const vp = zoomAt(initial(layout, W, H), layout, 4, W / 2, H / 2);
    const boardPx = layout.boardSize * vp.zoom;

    // 盤面の下端を画面の中央へ置く量だけ引く
    const moved = pan(vp, layout, 0, H / 2 - (boardPx + vp.offsetY));
    expect(boardPx + moved.offsetY).toBeCloseTo(H / 2, 6);
  });

  it('盤面が収まっているときも、同じく制限しない', () => {
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    const moved = pan(vp, layout, -1000, 0);
    expect(moved.offsetX).toBeCloseTo(vp.offsetX - 1000, 6);
  });

  it('「全体」表示は中央に置かれる（受入条件⑥）', () => {
    // 位置に制限が無いので、**中央寄せは明示しないと成り立たない**
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    const boardPx = layout.boardSize * vp.zoom;
    expect(vp.offsetX).toBeCloseTo((W - boardPx) / 2, 6);
    expect(vp.offsetY).toBeCloseTo((H - boardPx) / 2, 6);
  });

  it('どこまで動かしても「全体」で中央へ戻れる（見失ったときの逃げ道・C-203）', () => {
    // **制限を外す代わりの安全網**。これが効かなくなると盤面が行方不明になる
    const layout = createLayout(49);
    const lost = pan(
      zoomAt(initial(layout, W, H), layout, 8, W / 2, H / 2),
      layout,
      -999999,
      888888,
    );
    expect(fit(lost, layout)).toEqual(initial(layout, W, H));
  });
});

describe('描画領域の寸法変更（3.6 / 5.3）', () => {
  it('窓が広がっても倍率はそのまま持ち越す（C-167）', () => {
    // 段階7 までは fit倍率まで引き上げていたが、どこまでも縮小できる以上その理由が無い
    const layout = createLayout(49);
    const small = initial(layout, 400, 400);
    const grown = resize(small, layout, 1600, 1600);
    expect(grown.zoom).toBe(small.zoom);
  });

  it('見えている中心の論理座標を保つ', () => {
    const layout = createLayout(49);
    const vp = pan(zoomAt(initial(layout, W, H), layout, 2, W / 2, H / 2), layout, -50, -50);
    const before = toLogical(vp, W / 2, H / 2);
    const resized = resize(vp, layout, 600, 900);
    const after = toLogical(resized, 300, 450);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});

/**
 * ルーペの自動有効化は廃止した（C-189）
 *
 * **自分で開く道具**になったため、「小さくなったら出る／出ない」という検査そのものが無くなった。
 * 置き場所と逃げ方は `ui/components/zoom.test.tsx` で確かめている。
 */
