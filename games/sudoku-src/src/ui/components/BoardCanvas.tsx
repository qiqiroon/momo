/**
 * 盤面の Canvas（第3分冊 3.2 / 15.6）
 *
 * React は要素の生成・破棄と寸法変更のみを担う。描画内容は props で渡さず、
 * **描画モデルを作って `Renderer` に引き渡す**（3.2）。
 *
 * ポインタ操作は**生の座標を React へ渡さず**、`hitTest` で意味のある操作へ変換してから
 * 通知する（3.2）。判別の規則は 8.2（移動量 8px・押下時間 500ms）に従い、
 * **長押しには何も割り当てない**（C-53 でメモは切替に一本化しており、誤爆しやすいため）。
 *
 * ズーム・パンの操作（5.5）もここで受ける。**次のビューポートは純粋関数で作って渡す**
 * だけで、状態は上位が持つ（15.5）。指1本のドラッグはパン、2本はピンチ、
 * ホイールはポインタ位置を不動点とするズームである。
 */

import { useEffect, useRef, useState } from 'react';
import { cellRect, type BoardLayout } from '../canvas/layout';
import { loupeRect, test as hitTest, toCellIndex } from '../canvas/hitTest';
import { create as createRenderer, type RenderModel, type Renderer } from '../canvas/renderer';
import {
  pan as panViewport,
  stepFactor,
  toScreen,
  zoomAt,
  type ViewportState,
} from '../canvas/viewport';
import { TAP_MOVE_PX, TAP_TIME_MS } from '../config';
import type { LoupeCorner } from '../../data/types';
import { diagnostics } from '../../data/diagnostics';
import { BoardScrollbars } from './BoardScrollbars';
import { LoupeLayer, type LoupeLayerProps } from './LoupeLayer';

export interface BoardCanvasProps {
  model: RenderModel;
  layout: BoardLayout;
  /** 描画領域の寸法が変わったときに知らせる。ビューポートの再計算は上位が行う（3.6） */
  onResize(width: number, height: number): void;
  /**
   * 選択の変化。**盤面外のタップは `null`**（8.3 の「解除は盤面外のタップまたは Esc」）。
   * 15.6 は `number` だけを挙げていたが、それでは解除を伝える手段が無い。
   */
  onSelectCell(index: number | null): void;
  /** ヒントの × が押された（10.4）。セル選択より優先して判定される */
  onDismissHint(index: number): void;
  /**
   * マウスが乗っているマス（C-185）。盤面の外へ出たら `null`。
   * **マウスのときだけ呼ぶ**ので、これが来ない環境＝マウスの無い端末である。
   */
  onHoverCell(index: number | null): void;
  /** 盤面領域の画面上の位置（C-198）。数字ボタンとの重なりを測るために上位が使う */
  onFrameRect(rect: { left: number; top: number; width: number; height: number }): void;
  /**
   * ルーペの操作部（C-189）。盤面の枠の中へ重ねる。
   * **箱の位置はここが出す**（C-195）。Canvas と同じ寸法から求めないと、
   * 描いてある箱と ＋ / − の位置がずれる
   */
  loupe: Omit<LoupeLayerProps, 'box'> & { corner: LoupeCorner | null };
  /** ズーム・パンの結果（15.6） */
  onViewportChange(next: ViewportState): void;
  /**
   * いま選んでいるマス（C-167）。
   * **拡大縮小の不動点**に使う。選んでいるマスがあれば、そこを中心に拡大縮小する。
   */
  selected: number | null;
}

/** 押下中のポインタ。ピンチの判定に2本目まで持つ */
interface Pointer {
  x: number;
  y: number;
}

export function BoardCanvas({
  model,
  layout,
  onResize,
  onSelectCell,
  onDismissHint,
  onHoverCell,
  onFrameRect,
  loupe,
  onViewportChange,
  selected,
}: BoardCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;

  // 判定に使う値は毎回の描画で変わるため、参照で最新を見る（購読を張り替えないため）
  const modelRef = useRef(model);
  modelRef.current = model;
  const onSelectRef = useRef(onSelectCell);
  onSelectRef.current = onSelectCell;
  const onHoverRef = useRef(onHoverCell);
  onHoverRef.current = onHoverCell;
  const onDismissRef = useRef(onDismissHint);
  onDismissRef.current = onDismissHint;
  const onViewportRef = useRef(onViewportChange);
  onViewportRef.current = onViewportChange;

  /** 押下の始点。解放時に「タップだったか」を判じるために持つ（8.2） */
  const pressRef = useRef<{ x: number; y: number; at: number; id: number } | null>(null);
  /** 押下中のポインタ（ピンチ用）。順序を保つため Map で持つ */
  const pointersRef = useRef(new Map<number, Pointer>());
  /** ピンチ直前の2点間距離。倍率の比を作るために持つ */
  const pinchRef = useRef<number | null>(null);
  /** 8px を越えてドラッグに転じたか。転じたあとはタップとして扱わない（8.2） */
  const draggingRef = useRef(false);

  /**
   * 描画領域の実寸（C-195）
   *
   * **ルーペの箱はここから出す。** 上位が持つビューポートの寸法から出すと、
   * 測る前の仮置き（1×1）を掴んだまま直らないことがある。
   * Canvas に描く箱と同じ出どころにしておけば、ずれようがない。
   */
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  /** 画面上の位置。数字ボタンとの重なりを測るために上位へ渡す（C-198） */
  const onFrameRectRef = useRef(onFrameRect);
  onFrameRectRef.current = onFrameRect;

  // 生成はマウント時、破棄はアンマウント時（15.4）
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

    const renderer = createRenderer({ canvas, layout });
    rendererRef.current = renderer;

    const applySize = () => {
      const rect = host.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.resize(rect.width, rect.height);
      setFrameSize({ width: rect.width, height: rect.height });
      onFrameRectRef.current({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      onResizeRef.current(rect.width, rect.height);
    };
    applySize();

    const observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(applySize) : null;
    observer?.observe(host);

    return () => {
      observer?.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [layout]);

  /**
   * ルーペの置き場所を記録に残す（C-196）
   *
   * **覆いを避けて逃げたかどうかは、実機でしか確かめられない。**
   * 表示枠が隠れている環境では盤面の寸法そのものが測られず、こちらでは何も試せなかった。
   * そこで**角が変わったときだけ**、そのときの寸法と箱の位置を控える。
   * 毎回書くと記録が溢れるので、変わった瞬間だけにする。
   */
  const lastCornerRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${loupe.corner ?? '閉'}/${Math.round(frameSize.width)}x${Math.round(frameSize.height)}`;
    if (key === lastCornerRef.current) return;
    lastCornerRef.current = key;
    if (loupe.corner === null || frameSize.height <= 0) {
      diagnostics.recordEvent('ルーペ', `閉じている 盤面領域${Math.round(frameSize.width)}x${Math.round(frameSize.height)}`);
      return;
    }
    const box = loupeRect({ corner: loupe.corner }, frameSize.width, frameSize.height);
    diagnostics.recordEvent(
      'ルーペの置き場所',
      `設定=${loupe.homeCorner} 実際=${loupe.corner}` +
        ` 盤面領域${Math.round(frameSize.width)}x${Math.round(frameSize.height)}` +
        ` 箱(${Math.round(box.x)},${Math.round(box.y)})`,
    );
  }, [loupe.corner, loupe.homeCorner, frameSize]);

  // 盤面の中身が変わったら描き直す
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setModel(model);
    renderer.invalidate('ALL');
  }, [model]);

  /**
   * ホイールは**受け身でない購読**にする。React の `onWheel` では既定動作
   * （ページのスクロール・ブラウザのズーム）を止められず、盤面と画面が同時に動いてしまう。
   *
   * **拡大縮小になるのは Ctrl を押しているときだけ**である（C-167）。
   * Ctrl 無しのホイールには何もせず、既定動作に任せる。盤面の外（ヘッダーや操作パネル）は
   * そもそも購読していないので、そちらの Ctrl＋ホイールはブラウザ自身の拡大縮小になる。
   * 画面をつまむ操作（トラックパッドのピンチ）もブラウザが Ctrl 付きとして送ってくるため、
   * 同じ道で盤面の拡大縮小になる。
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const viewport = modelRef.current.viewport;
      const direction = event.deltaY < 0 ? 1 : -1;
      const origin = zoomOrigin(event.clientX, event.clientY);
      onViewportRef.current(
        zoomAt(viewport, layout, stepFactor(viewport, layout, direction), origin.x, origin.y),
      );
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
    // 不動点の求め方は参照ごしに最新を見るので、購読を張り替える必要は無い
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  /**
   * 拡大縮小の不動点（C-167）
   *
   * **選んでいるマスがあればその中心、無ければポインタの位置**。
   * 選んでいるマスは「いま見ていたい場所」なので、拡大しても視界から逃げない。
   */
  const zoomOrigin = (clientX: number, clientY: number): { x: number; y: number } => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const fallback = {
      x: clientX - (rect?.left ?? 0),
      y: clientY - (rect?.top ?? 0),
    };

    const index = selectedRef.current;
    if (index === null) return fallback;
    const cell = cellRect(layout, index);
    return toScreen(modelRef.current.viewport, cell.x + cell.w / 2, cell.y + cell.h / 2);
  };

  /** 画面座標を Canvas の左上基準へ直す */
  const localPoint = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPoint(event);
    pointersRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    // 2本目が触れた時点でピンチへ移る。1本目のタップ判定は捨てる
    if (pointersRef.current.size >= 2) {
      pressRef.current = null;
      draggingRef.current = true;
      pinchRef.current = pinchDistance();
      return;
    }
    pressRef.current = { ...point, at: Date.now(), id: event.pointerId };
    draggingRef.current = false;
  };

  /** 押下中の2点間距離。ピンチの倍率はこの比で作る（5.5） */
  const pinchDistance = (): number | null => {
    const points = [...pointersRef.current.values()];
    if (points.length < 2) return null;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  };

  /** 押下中の2点の中点。ピンチの不動点である（5.5） */
  const pinchCenter = (): { x: number; y: number } => {
    const points = [...pointersRef.current.values()];
    return { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const pointers = pointersRef.current;

    /**
     * マウスが乗っているマスを上へ知らせる（C-185・ルーペ用）。
     * **マウスのときだけ知らせる。** 指やペンでは押している最中しか動かず、
     * 押した先＝選択そのものなので、ルーペの追従に使う意味が無い。
     * よって「マウスがあるか」を別に調べる必要も無い。
     */
    if (event.pointerType === 'mouse') {
      const at = localPoint(event);
      const viewport = modelRef.current.viewport;
      const logicalX = (at.x - viewport.offsetX) / viewport.zoom;
      const logicalY = (at.y - viewport.offsetY) / viewport.zoom;
      onHoverRef.current?.(toCellIndex(logicalX, logicalY, layout));
    }

    const previous = pointers.get(event.pointerId);
    if (previous === undefined) return;

    const point = localPoint(event);
    pointers.set(event.pointerId, point);
    const viewport = modelRef.current.viewport;

    // [1] 2本 → ピンチ。中点を不動点として倍率だけを変える
    if (pointers.size >= 2) {
      const before = pinchRef.current;
      const after = pinchDistance();
      if (before !== null && after !== null && before > 0) {
        const center = pinchCenter();
        onViewportRef.current(zoomAt(viewport, layout, after / before, center.x, center.y));
      }
      pinchRef.current = after;
      return;
    }

    // [2] 1本 → パン。8px を越えるまではタップの可能性が残るので動かさない（8.2）
    const press = pressRef.current;
    if (press === null) return;
    if (!draggingRef.current) {
      if (Math.hypot(point.x - press.x, point.y - press.y) < TAP_MOVE_PX) return;
      draggingRef.current = true;
    }
    onViewportRef.current(panViewport(viewport, layout, point.x - previous.x, point.y - previous.y));
  };

  /**
   * 解放時に判別する。ドラッグ（パン・ピンチ）に転じていたか、押下が 500ms 以上なら
   * **何も起こさない**。タップだけがヒント × とセル選択を起こす（8.2）。
   */
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const pointers = pointersRef.current;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchRef.current = null;

    const press = pressRef.current;
    const wasDragging = draggingRef.current;
    if (pointers.size === 0) {
      pressRef.current = null;
      draggingRef.current = false;
    }
    if (press === null || press.id !== event.pointerId) return;
    if (wasDragging) return;

    const point = localPoint(event);
    const moved = Math.hypot(point.x - press.x, point.y - press.y);
    if (moved >= TAP_MOVE_PX) return;
    if (Date.now() - press.at >= TAP_TIME_MS) return;

    const m = modelRef.current;
    const hit = hitTest(point.x, point.y, layout, m.viewport, m.hints, m.loupe);
    if (hit.kind === 'HINT_CLOSE') onDismissRef.current(hit.index);
    else if (hit.kind === 'CELL') onSelectRef.current(hit.index);
    // 盤面外（NONE）は選択解除。吹き出し本体の押下もここへ来るが、
    // `hitTest` が透過させない設計なので、下のセルは選ばれない（10.3）
    else onSelectRef.current(null);
  };

  const onPointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      pressRef.current = null;
      draggingRef.current = false;
    }
  };

  return (
    // 外枠は「盤面＋2本の帯」を並べる器で、寸法を測るのは中の枠（`board-frame`）である。
    // 帯のぶんを差し引いた実寸を測らないと、盤面が帯の下へ潜り込む（C-165）
    <div className="board-host">
      <div className="board-frame" ref={hostRef}>
        <canvas
          className="board"
          ref={canvasRef}
          data-testid="board"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerLeave={(event) => {
            // 盤面から出たらルーペは最後に選んだマスへ戻る（C-185）
            if (event.pointerType === 'mouse') onHoverRef.current?.(null);
          }}
        />
        <LoupeLayer
          {...loupe}
          box={
            loupe.corner === null || frameSize.height <= 0
              ? null
              : loupeRect({ corner: loupe.corner }, frameSize.width, frameSize.height)
          }
        />
      </div>
      <BoardScrollbars
        viewport={model.viewport}
        layout={layout}
        onViewportChange={onViewportChange}
      />
    </div>
  );
}
