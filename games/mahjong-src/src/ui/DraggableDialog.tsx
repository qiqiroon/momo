// 結果の枠など、マウスや指でつかんで動かせる枠（2026-10-08 利用者指示）。
// - 枠のどこでもつかめる（ボタンの上から動かしてもよい。少し動かしてから離したときはボタンを押したことにしない）
// - 動かせる範囲：枠の一部（KEEP_PX 四方）が画面に残っていれば、それ以外は画面の外に出してよい
// - つかんだあとの動きは画面全体で拾う（勢いよく動かして指が枠の外へ先に出ても置いていかれない）
// 位置は枠ごとに持つ＝枠が閉じて次に開いたら真ん中に戻る。

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/** 画面に残す最小の幅・高さ（ここをつかめば戻せる） */
const KEEP_PX = 48;
/** これより小さい動きはつかんだことにしない（ボタンを押しただけのとき） */
const DRAG_START_PX = 5;

interface Props {
  className: string;
  children: ReactNode;
}

export function DraggableDialog({ className, children }: Props) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  /** つかんでいる間だけ付ける画面全体の見張りを外す関数 */
  const release = useRef<(() => void) | null>(null);

  useEffect(() => () => release.current?.(), []);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    release.current?.();
    suppressClick.current = false;
    const id = e.pointerId;
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = offset.x;
    const oy = offset.y;
    const rect = e.currentTarget.getBoundingClientRect();
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      let dx = ev.clientX - sx;
      let dy = ev.clientY - sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_START_PX) return;
        moved = true;
        setDragging(true);
      }
      // 枠の一部が画面に残る範囲に収める
      dx = Math.min(Math.max(dx, KEEP_PX - rect.right), window.innerWidth - KEEP_PX - rect.left);
      dy = Math.min(Math.max(dy, KEEP_PX - rect.bottom), window.innerHeight - KEEP_PX - rect.top);
      setOffset({ x: ox + dx, y: oy + dy });
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      if (moved) suppressClick.current = true;
      setDragging(false);
      release.current?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    release.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      release.current = null;
    };
  };

  // 動かしたあとの「離した」でボタンが押されないようにする
  const onClickCapture = (e: MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const style = { '--dx': `${offset.x}px`, '--dy': `${offset.y}px` } as CSSProperties;
  return (
    <div
      className={`${className} draggable${dragging ? ' dragging' : ''}`}
      role="dialog"
      style={style}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
    >
      {children}
    </div>
  );
}
