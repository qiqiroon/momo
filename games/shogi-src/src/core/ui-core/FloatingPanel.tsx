import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';

/**
 * 半透明・ドラッグ可能なフローティングパネル（段階 v0.32 共通化）。
 * 対局終了パネル / 投了確認パネル / 相手退室パネル などに再利用。
 *
 * - background は変わらないため CSS の .floating-result 系を継承（`className` プロパティで
 *   .floating-result / .floating-confirm など揃える）
 * - パネル全体は fixed 配置、中央からのオフセットを transform で表現
 * - status が変わっても位置は保持（呼び出し側で reset したい場合は key で再マウント）
 *
 * **v1.21 (ユーザー報告 2026-08-12)**: つかめる場所をパネル全体に広げた。
 * それまではタイトル帯だけがつまみで、動かせること自体に気づけなかった
 * （つまみは v0.32 から正しく動いていた＝壊れていたのではなく、見つからなかった）。
 * ボタンなどの操作部品の上から始めたドラッグは無視するので、押す操作は今までどおり。
 */

/** ドラッグの起点として扱わない部品（押す・選ぶ・入力する物の上では動かさない）。 */
const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"]';
export function FloatingPanel({
  className,
  title,
  children,
}: {
  className: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const onDragStart = (e: ReactMouseEvent | ReactTouchEvent) => {
    // ボタンや入力欄の上から始まったものは、押す操作なのでドラッグにしない。
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(INTERACTIVE)) return;
    const point = 'touches' in e ? e.touches[0] : (e as ReactMouseEvent);
    dragState.current = {
      startX: point.clientX,
      startY: point.clientY,
      origX: drag.x,
      origY: drag.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent | globalThis.TouchEvent) => {
      if (!dragState.current) return;
      const point = 'touches' in e ? e.touches[0] : (e as globalThis.MouseEvent);
      setDrag({
        x: dragState.current.origX + point.clientX - dragState.current.startX,
        y: dragState.current.origY + point.clientY - dragState.current.startY,
      });
    };
    const onEnd = () => {
      dragState.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, []);

  return (
    <div
      className={className}
      role="dialog"
      aria-modal="false"
      style={{ transform: `translate(calc(-50% + ${drag.x}px), calc(-50% + ${drag.y}px))` }}
      onMouseDown={onDragStart}
      onTouchStart={onDragStart}
    >
      <div className="floating-result-header">
        <span className="drag-hint" aria-hidden="true">⣿</span>
        <span className="title">{title}</span>
        <span className="drag-hint" aria-hidden="true">⣿</span>
      </div>
      {children}
    </div>
  );
}
