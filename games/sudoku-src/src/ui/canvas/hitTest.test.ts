/**
 * ヒットテスト（第3分冊 8.2 / 10.4）
 *
 * **受入条件 5-2「座標→セル変換が全サイズ・全倍率で正しい」**をここで確かめる。
 */

import { describe, expect, it } from 'vitest';
import { BOARD_SIZES, type BoardSize } from '../../data/types';
import type { HintDisplay } from '../../game/hint';
import { MIN_TOUCH_PX } from '../config';
import { bubbleGeometries, rectContains, test as hitTest, toCellIndex } from './hitTest';
import { cellRect, create as createLayout } from './layout';
import { MAX_ZOOM, initial, minZoom, pan, toScreen, zoomTo, type ViewportState } from './viewport';

const W = 800;
const H = 600;

/** そのサイズで意味のある倍率を並べる（fit・中間・最大） */
function zoomLadder(n: BoardSize): number[] {
  const layout = createLayout(n);
  const lo = minZoom(layout, W, H);
  if (lo >= MAX_ZOOM) return [lo];
  return [lo, Math.sqrt(lo * MAX_ZOOM), MAX_ZOOM];
}

/** 盤面の隅・中央・境目を含む索引を選ぶ */
function sampleIndices(n: number): number[] {
  const picks = new Set<number>();
  const rows = [0, 1, Math.floor(n / 2), n - 2, n - 1].filter((r) => r >= 0 && r < n);
  const cols = rows;
  for (const r of rows) for (const c of cols) picks.add(r * n + c);
  return [...picks];
}

describe('座標 → セル索引（受入条件 5-2）', () => {
  it.each(BOARD_SIZES)('N=%i の全倍率でセル中央が正しい索引を返す', (n) => {
    const layout = createLayout(n);
    for (const zoom of zoomLadder(n)) {
      const vp = zoomTo(initial(layout, W, H), layout, zoom);
      for (const index of sampleIndices(n)) {
        const rect = cellRect(layout, index);
        const center = toScreen(vp, rect.x + rect.w / 2, rect.y + rect.h / 2);
        expect(hitTest(center.x, center.y, layout, vp, [])).toEqual({ kind: 'CELL', index });
      }
    }
  });

  it.each(BOARD_SIZES)('N=%i でセルの境目が隣へこぼれない', (n) => {
    const layout = createLayout(n);
    const vp = initial(layout, W, H);
    for (const index of sampleIndices(n)) {
      const rect = cellRect(layout, index);
      // 左上の角は自分のセル
      const topLeft = toScreen(vp, rect.x + 0.001, rect.y + 0.001);
      expect(hitTest(topLeft.x, topLeft.y, layout, vp, [])).toEqual({ kind: 'CELL', index });
      // 右下の角の直前も自分のセル
      const bottomRight = toScreen(vp, rect.x + rect.w - 0.001, rect.y + rect.h - 0.001);
      expect(hitTest(bottomRight.x, bottomRight.y, layout, vp, [])).toEqual({ kind: 'CELL', index });
    }
  });

  it('盤面の外は NONE を返す', () => {
    const layout = createLayout(9);
    expect(toCellIndex(-0.001, 0, layout)).toBeNull();
    expect(toCellIndex(0, -0.001, layout)).toBeNull();
    expect(toCellIndex(layout.boardSize, 0, layout)).toBeNull();
    expect(toCellIndex(0, layout.boardSize, layout)).toBeNull();

    const vp = initial(layout, W, H);
    // 中央寄せの余白部分（盤面の外）
    expect(hitTest(2, 2, layout, vp, [])).toEqual({ kind: 'NONE' });
  });

  it('パンしても対応がずれない', () => {
    const layout = createLayout(49);
    const vp = pan(zoomTo(initial(layout, W, H), layout, 1.0), layout, -137, -211);
    for (const index of sampleIndices(49)) {
      const rect = cellRect(layout, index);
      const center = toScreen(vp, rect.x + rect.w / 2, rect.y + rect.h / 2);
      expect(hitTest(center.x, center.y, layout, vp, [])).toEqual({ kind: 'CELL', index });
    }
  });
});

// ---------------------------------------------------------------- ヒント吹き出し

function hint(index: number, value: number, issuedAt: number): HintDisplay {
  return { index, value, issuedAt };
}

/** 画面のほぼ中央に来るセルを選ぶ（吹き出しが確実に描かれる位置） */
function centerCell(n: BoardSize): { layout: ReturnType<typeof createLayout>; vp: ViewportState; index: number } {
  const layout = createLayout(n);
  const vp = initial(layout, W, H);
  const mid = Math.floor(n / 2);
  return { layout, vp, index: mid * n + mid };
}

describe('ヒント吹き出しの判定（10.2 / 10.3 / 10.4）', () => {
  it('× はセル選択より優先される', () => {
    const { layout, vp, index } = centerCell(9);
    const hints = [hint(index, 7, 100)];
    const [geom] = bubbleGeometries(layout, vp, hints);
    const cx = geom.closeHit.x + geom.closeHit.w / 2;
    const cy = geom.closeHit.y + geom.closeHit.h / 2;
    expect(hitTest(cx, cy, layout, vp, hints)).toEqual({ kind: 'HINT_CLOSE', index });
  });

  it('× の判定領域は 44×44 を下回らない', () => {
    const { layout, vp, index } = centerCell(9);
    const [geom] = bubbleGeometries(layout, vp, [hint(index, 7, 100)]);
    expect(geom.closeHit.w).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
    expect(geom.closeHit.h).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  });

  it('吹き出し本体を押しても何も起こらず、下のセルへ透過しない', () => {
    const { layout, vp, index } = centerCell(9);
    const hints = [hint(index, 7, 100)];
    const [geom] = bubbleGeometries(layout, vp, hints);
    const x = geom.box.x + 3;
    const y = geom.box.y + geom.box.h / 2;
    // 吹き出しが無ければセルに当たる位置であること（透過しないことの裏取り）
    expect(hitTest(x, y, layout, vp, []).kind).toBe('CELL');
    expect(hitTest(x, y, layout, vp, hints)).toEqual({ kind: 'NONE' });
  });

  it('重なったときは新しい吹き出しが勝つ（表示順の逆順に判定・10.4）', () => {
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    const older = hint(40, 5, 100);
    const newer = hint(41, 6, 200);
    const hints = [older, newer];
    const geoms = bubbleGeometries(layout, vp, hints);
    // 描画順は issuedAt の昇順
    expect(geoms.map((g) => g.hint.issuedAt)).toEqual([100, 200]);

    const newGeom = geoms[1];
    const cx = newGeom.closeHit.x + newGeom.closeHit.w / 2;
    const cy = newGeom.closeHit.y + newGeom.closeHit.h / 2;
    expect(hitTest(cx, cy, layout, vp, hints)).toEqual({ kind: 'HINT_CLOSE', index: 41 });
  });

  it('提示値が2桁だと吹き出しが広くなる（内容に応じて可変・10.2）', () => {
    const { layout, vp, index } = centerCell(25);
    const [single] = bubbleGeometries(layout, vp, [hint(index, 7, 1)]);
    const [double] = bubbleGeometries(layout, vp, [hint(index, 25, 1)]);
    expect(double.box.w).toBeGreaterThan(single.box.w);
    // 高さは画面座標で固定
    expect(double.box.h).toBe(single.box.h);
  });

  it('上端をはみ出すときだけ下辺へ反転する（10.2）', () => {
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    // 最上行のセルは上に余地が無い
    const [top] = bubbleGeometries(layout, vp, [hint(0, 1, 1)]);
    expect(top.flipped).toBe(true);
    // 中ほどのセルは上に出る
    const [middle] = bubbleGeometries(layout, vp, [hint(40, 1, 1)]);
    expect(middle.flipped).toBe(false);
  });

  it('左右にはみ出さない位置までずらす（10.2）', () => {
    const layout = createLayout(9);
    const vp = initial(layout, W, H);
    for (const index of [0, 8, 72, 80]) {
      const [geom] = bubbleGeometries(layout, vp, [hint(index, 49, 1)]);
      expect(geom.box.x).toBeGreaterThanOrEqual(0);
      expect(geom.box.x + geom.box.w).toBeLessThanOrEqual(W);
    }
  });

  it('対象セルが画面外なら吹き出しを描かない（表示状態は保持する・10.2）', () => {
    const layout = createLayout(49);
    // 盤面の左上隅を画面の左上へ合わせると、右下のセルは画面外になる。
    // **位置に制限が無くなったので（C-203）、寄せ先は自分で指定する。**
    // 大きく引くと盤面ごと画面の外へ出てしまい、左上も盤面でなくなる
    const zoomed = zoomTo(initial(layout, W, H), layout, MAX_ZOOM);
    const vp = pan(zoomed, layout, -zoomed.offsetX, -zoomed.offsetY);
    const hints = [hint(49 * 49 - 1, 49, 1)];
    expect(bubbleGeometries(layout, vp, hints)).toHaveLength(0);
    // 判定にも現れない
    expect(hitTest(10, 10, layout, vp, hints).kind).toBe('CELL');
  });
});

/**
 * 吹き出しが密集したときの取り違え（C-160 / V-18 / 受入条件 7-4）
 *
 * × の判定領域は見た目（20px）より広い（44px）。**この広げたぶんが隣の吹き出しの上まで届く。**
 * 広げた領域を先に見る規則では、見えている × を押したのに隣が閉じる場合があり、
 * **総当たりで 60 件の取り違えが見つかった**（16×16 / 25×25 / 36×36 / 49×49）。
 *
 * そこで「その点で手前に描かれている吹き出しを1つだけ選ぶ」を先に置いた。
 * 本検査は、その規則で取り違えが1件も起きないことを守る。
 */
describe('× の取り違え（10.4 / 7-4 / C-160）', () => {
  it('見えている × を押したら、必ずその吹き出しが閉じる', () => {
    const misses: string[] = [];

    for (const n of [9, 16, 25, 36, 49] as BoardSize[]) {
      const layout = createLayout(n);
      // 盤面いっぱい＝吹き出しがいちばん密集する条件（スマートフォン縦画面の幅）
      const vp = initial(layout, 343, 343);
      const base = Math.floor(n / 2) * n + Math.floor(n / 2);

      for (let dr = -4; dr <= 4; dr++) {
        for (let dc = -4; dc <= 4; dc++) {
          if (dr === 0 && dc === 0) continue;
          const other = base + dr * n + dc;
          if (other < 0 || other >= n * n) continue;

          const hints = [hint(base, 7, 1000), hint(other, 7, 1001)];
          const geoms = bubbleGeometries(layout, vp, hints);

          geoms.forEach((geometry, index) => {
            for (const px of [0.1, 0.3, 0.5, 0.7, 0.9]) {
              for (const py of [0.1, 0.5, 0.9]) {
                const x = geometry.close.x + geometry.close.w * px;
                const y = geometry.close.y + geometry.close.h * py;
                // あとから描いたものに覆われている × は押せなくて正しい（10.3）
                const covered = geoms
                  .slice(index + 1)
                  .some((later) => rectContains(later.box, x, y));
                if (covered) continue;

                const got = hitTest(x, y, layout, vp, hints);
                if (got.kind !== 'HINT_CLOSE' || got.index !== geometry.hint.index) {
                  misses.push(`${n}×${n} d=(${dr},${dc}) 押した=${geometry.hint.index}`);
                }
              }
            }
          });
        }
      }
    }

    expect(misses.slice(0, 5)).toEqual([]);
  });
});
