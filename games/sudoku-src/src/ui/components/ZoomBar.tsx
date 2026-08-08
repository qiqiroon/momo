/**
 * ズームバー（第3分冊 5.5 / C-49 / 15.6）
 *
 * 操作パネルの最上段に置く。スライダ・`−`/`＋`・`全体` の3手段を持つ。
 * **状態は持たない。** 次のビューポートを純粋関数で作って上位へ渡すだけである（15.5）。
 *
 * スライダの値域は倍率の下限〜上限を**対数スケール**で割り当てる（5.5）。
 * 倍率は掛け算で変わるため、線形に割り当てると低倍率側だけが極端に細かくなる。
 *
 * **上下限を外したので（C-167）、どのサイズでも3手段すべてが使える。**
 * 段階7 までは 1×1・4×4 で「これ以上動かせない」としてスライダと `−`/`＋` を
 * 非活性にしていたが、いまはどこまでも拡大縮小できる。
 */

import { cellRect, type BoardLayout } from '../canvas/layout';
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fit as fitViewport,
  stepFactor,
  toScreen,
  zoomAt,
  zoomTo,
  type ViewportState,
} from '../canvas/viewport';
import { t } from '../../i18n/locale';

/** スライダの目盛り数。細かさは対数スケールで均一になる */
const SLIDER_STEPS = 100;

export interface ZoomBarProps {
  viewport: ViewportState;
  layout: BoardLayout;
  onZoom(next: ViewportState): void;
  /** いま選んでいるマス（C-167）。あればそこを不動点にする */
  selected: number | null;
}

/** 倍率 → スライダ位置（0〜`SLIDER_STEPS`）。対数スケール */
export function toSlider(zoom: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const ratio = Math.log(zoom / lo) / Math.log(hi / lo);
  return Math.round(Math.min(1, Math.max(0, ratio)) * SLIDER_STEPS);
}

/** スライダ位置 → 倍率。`toSlider` の逆 */
export function fromSlider(position: number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  return lo * Math.pow(hi / lo, position / SLIDER_STEPS);
}

/**
 * 拡大縮小の不動点（C-167）
 *
 * **選んでいるマスがあればその中心、無ければ描画領域の中心。**
 * ホイールと違って手元の位置が無いので、ポインタの代わりが画面の中心になる。
 */
export function zoomOrigin(
  viewport: ViewportState,
  layout: BoardLayout,
  selected: number | null,
): { x: number; y: number } {
  if (selected === null) return { x: viewport.width / 2, y: viewport.height / 2 };
  const cell = cellRect(layout, selected);
  return toScreen(viewport, cell.x + cell.w / 2, cell.y + cell.h / 2);
}

export function ZoomBar({ viewport, layout, onZoom, selected }: ZoomBarProps): React.ReactElement {
  const lo = MIN_ZOOM;
  const hi = MAX_ZOOM;
  // 上下限を外したので、どのサイズでも拡大縮小できる（C-167）
  const zoomable = viewport.width > 0 && viewport.height > 0;

  const origin = zoomOrigin(viewport, layout, selected);
  // `−`/`＋` はホイール1目盛りと同じ「1セルぶん」動かす（C-167）
  const step = (direction: number): void =>
    onZoom(
      zoomAt(viewport, layout, stepFactor(viewport, layout, direction), origin.x, origin.y),
    );

  return (
    <div className="zoom-bar" data-testid="zoom-bar">
      <button
        type="button"
        className="zoom-button"
        disabled={!zoomable}
        aria-label={t('play.zoom.out')}
        onClick={() => step(-1)}
      >
        −
      </button>

      <input
        type="range"
        className="zoom-slider"
        data-testid="zoom-slider"
        min={0}
        max={SLIDER_STEPS}
        step={1}
        value={toSlider(viewport.zoom, lo, hi)}
        disabled={!zoomable}
        aria-label={t('play.zoom.slider')}
        onChange={(event) =>
          onZoom(
            zoomTo(viewport, layout, fromSlider(Number(event.target.value), lo, hi), origin),
          )
        }
      />

      <button
        type="button"
        className="zoom-button"
        disabled={!zoomable}
        aria-label={t('play.zoom.in')}
        onClick={() => step(1)}
      >
        ＋
      </button>

      {/* 盤面が画面より小さいときも意味を持つので、ここだけは常に押せる（5.5） */}
      <button
        type="button"
        className="zoom-fit"
        onClick={() => onZoom(fitViewport(viewport, layout))}
      >
        {t('play.zoom.fit')}
      </button>
    </div>
  );
}
