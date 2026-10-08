// 卓の並べ方（正方形の卓／横4列）を決める（2026-10-08 利用者指示：出せるときは切り替えられる）。
// - 横4列はどの画面でも出せる。正方形の卓は、卓の1辺が SQUARE_MIN_SIDE 以上取れるときだけ出せる
// - 何も選んでいなければ、今までどおり画面の幅で決める（760px 以下は横4列）
// - 選んだ並べ方はこの端末に覚える（覚えられない環境でも動く）。出せない並べ方を選んでいたら、出せる方で出す

import { useCallback, useEffect, useState } from 'react';

export type Layout = 'square' | 'lanes';

/** 今までどおりの自動の境目（これ以下の幅は横4列） */
const AUTO_LANES_MAX_WIDTH = 760;
/** 正方形の卓を出せる、卓の1辺の最小（px）。これより小さいと牌が読めない */
export const SQUARE_MIN_SIDE = 440;
const STORE_KEY = 'momo-mahjong-layout';

/** 正方形の卓の1辺（styles.css の .square の --side と同じ決め方） */
const squareSide = () => Math.min(window.innerWidth - 48, window.innerHeight - 100, 980);

function readChoice(): Layout | null {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return v === 'square' || v === 'lanes' ? v : null;
  } catch {
    return null;
  }
}

function writeChoice(v: Layout) {
  try {
    window.localStorage.setItem(STORE_KEY, v);
  } catch {
    /* 覚えられなくても、いまの画面では切り替わる */
  }
}

function measure() {
  if (typeof window === 'undefined') return { canSquare: true, auto: 'square' as Layout };
  const canSquare = squareSide() >= SQUARE_MIN_SIDE;
  const auto: Layout = window.innerWidth <= AUTO_LANES_MAX_WIDTH || !canSquare ? 'lanes' : 'square';
  return { canSquare, auto };
}

export function useLayout() {
  const [choice, setChoice] = useState<Layout | null>(readChoice);
  const [m, setM] = useState(measure);

  useEffect(() => {
    const on = () => setM(measure());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const layout: Layout = choice === 'square' ? (m.canSquare ? 'square' : 'lanes') : choice === 'lanes' ? 'lanes' : m.auto;

  const toggle = useCallback(() => {
    const next: Layout = layout === 'square' ? 'lanes' : 'square';
    if (next === 'square' && !m.canSquare) return;
    setChoice(next);
    writeChoice(next);
  }, [layout, m.canSquare]);

  return { layout, canSwitch: m.canSquare, toggle };
}
