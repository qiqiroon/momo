/**
 * 盤面のスクロールバー（C-165）
 *
 * 盤面はキャンバスに描いているため、ブラウザのスクロールバーは現れない。
 * 拡大したときに「いま盤全体のどこを見ているか」が分からないので、
 * **盤面領域の右側と下側に、位置と見えている割合を表す帯**を自前で置く。
 *
 * 帯はつまみを掴んで動かせる。パンと同じ窓口（`onViewportChange`）へ流すため、
 * 指でのドラッグ・ホイール・ピンチと一切食い違わない。
 */

import { useEffect, useRef } from 'react';
import type { BoardLayout } from '../canvas/layout';
import { pan, type ViewportState } from '../canvas/viewport';

export interface BoardScrollbarsProps {
  viewport: ViewportState;
  layout: BoardLayout;
  onViewportChange(next: ViewportState): void;
}

/** 1軸ぶんの寸法。`thumbStart` と `thumbLength` は帯の中の位置と長さ（CSS px） */
interface AxisMetrics {
  /** 帯の長さ＝描画領域のその軸の寸法 */
  track: number;
  thumbStart: number;
  thumbLength: number;
  /** 動かせる余地。0 なら盤面が収まりきっている */
  scrollable: number;
}

/** 盤面の実寸と描画領域から、つまみの位置と長さを出す */
export function axisMetrics(boardPx: number, viewPx: number, offset: number): AxisMetrics {
  if (viewPx <= 0) return { track: 0, thumbStart: 0, thumbLength: 0, scrollable: 0 };

  const scrollable = Math.max(0, boardPx - viewPx);
  // 収まっているときはつまみが帯いっぱいになる（ブラウザの流儀と同じ）
  const ratio = boardPx <= 0 ? 1 : Math.min(1, viewPx / boardPx);
  const thumbLength = Math.max(MIN_THUMB_PX, viewPx * ratio);
  const room = Math.max(0, viewPx - thumbLength);
  const progress = scrollable === 0 ? 0 : Math.min(1, Math.max(0, -offset / scrollable));
  return { track: viewPx, thumbStart: room * progress, thumbLength, scrollable };
}

/** つまみが細くなりすぎると掴めないため下限を設ける */
const MIN_THUMB_PX = 24;

export function BoardScrollbars({
  viewport,
  layout,
  onViewportChange,
}: BoardScrollbarsProps): React.ReactElement {
  const boardPx = layout.boardSize * viewport.zoom;
  const horizontal = axisMetrics(boardPx, viewport.width, viewport.offsetX);
  const vertical = axisMetrics(boardPx, viewport.height, viewport.offsetY);

  // ドラッグ中に古い値を掴まないよう、最新を参照で持つ
  const stateRef = useRef({ viewport, layout, onViewportChange });
  stateRef.current = { viewport, layout, onViewportChange };
  const dragRef = useRef<{ axis: 'X' | 'Y'; from: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();

      const { viewport: vp, layout: lo, onViewportChange: emit } = stateRef.current;
      const px = lo.boardSize * vp.zoom;
      const axis =
        drag.axis === 'X'
          ? axisMetrics(px, vp.width, vp.offsetX)
          : axisMetrics(px, vp.height, vp.offsetY);
      if (axis.scrollable === 0) return;

      const room = Math.max(1, axis.track - axis.thumbLength);
      const here = drag.axis === 'X' ? event.clientX : event.clientY;
      // つまみを1px 動かすと、盤面は「余地の比」だけ逆向きに動く
      const delta = ((here - drag.from) * axis.scrollable) / room;
      drag.from = here;
      emit(drag.axis === 'X' ? pan(vp, lo, -delta, 0) : pan(vp, lo, 0, -delta));
    };

    const onUp = (): void => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const begin = (axis: 'X' | 'Y') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { axis, from: axis === 'X' ? event.clientX : event.clientY };
  };

  return (
    <>
      <div className="board-scroll board-scroll-v" data-testid="board-scroll-v">
        <div
          className="board-scroll-thumb"
          data-testid="board-scroll-thumb-v"
          data-scrollable={vertical.scrollable > 0}
          style={{ top: `${vertical.thumbStart}px`, height: `${vertical.thumbLength}px` }}
          onPointerDown={begin('Y')}
        />
      </div>
      <div className="board-scroll board-scroll-h" data-testid="board-scroll-h">
        <div
          className="board-scroll-thumb"
          data-testid="board-scroll-thumb-h"
          data-scrollable={horizontal.scrollable > 0}
          style={{ left: `${horizontal.thumbStart}px`, width: `${horizontal.thumbLength}px` }}
          onPointerDown={begin('X')}
        />
      </div>
      <div className="board-scroll-corner" aria-hidden="true" />
    </>
  );
}
