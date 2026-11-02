// 操作パネルの中身（DOM を持たない部分。設計 04 §6）。どのボタンを並べ、押したらどの手になるか
import type { Face, Move } from '../core/types';
import { faceMove, middleMove, wholeCommand, WHOLE_FACE, type MiddleSlice, type Variant } from '../input/screenMoves';
import type { ViewCommand } from '../input/viewController';
import type { ViewFrame } from '../input/viewFrame';

export const PANEL_FACES: readonly Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];
export const VARIANTS: readonly Variant[] = ['cw', 'ccw', 'double'];

/** 画面で見たときの、回る部分の動き。ボタンの絵と読み上げに使う */
export type Motion = 'up' | 'down' | 'left' | 'right' | 'cw' | 'ccw';

/**
 * 画面基準の面を時計回り（その面から見て）に回したとき、手前に見えている部分がどちらへ動くか。
 * 右の面は手前が上へ、上の面は手前が左へ、奥の面は前から見ると反時計回り
 */
const CW_MOTION: Record<Face, Motion> = { R: 'up', L: 'down', U: 'left', D: 'right', F: 'cw', B: 'ccw' };
const REVERSE: Record<Motion, Motion> = { up: 'down', down: 'up', left: 'right', right: 'left', cw: 'ccw', ccw: 'cw' };

export const MOTION_ICON: Record<Motion, string> = { up: '↑', down: '↓', left: '←', right: '→', cw: '↻', ccw: '↺' };

/** 半回転は向きを問わないので null */
export function motionOf(face: Face, variant: Variant): Motion | null {
  if (variant === 'double') return null;
  const m = CW_MOTION[face];
  return variant === 'cw' ? m : REVERSE[m];
}

/** 層の選択肢：N ≥ 4 で 1..ceil(N/2)。反対側の層は向かいの面のボタンで選べるので半分で足りる */
export function depthChoices(n: number): number[] {
  if (n < 4) return [];
  return Array.from({ length: Math.ceil(n / 2) }, (_, i) => i + 1);
}

/** 真ん中の層の行は 3×3×3 だけ（N=5 以上は層の選択で真ん中も選べる） */
export function showMiddle(n: number): boolean {
  return n === 3;
}

export interface LayerChoice {
  depth: number;
  wide: boolean;
}

/** 大きさが変わったら、選べない層を選べる範囲へ寄せる */
export function clampLayer(n: number, c: LayerChoice): LayerChoice {
  const max = Math.max(1, depthChoices(n).length);
  const depth = Math.min(Math.max(1, c.depth), max);
  return { depth, wide: c.wide && depth > 1 };
}

/** 面ボタンの手。まとめて回すときは外側から depth 枚目まで */
export function panelFaceMove(n: number, frame: ViewFrame, face: Face, variant: Variant, c: LayerChoice): Move | null {
  const { depth, wide } = clampLayer(n, c);
  return faceMove(n, frame, face, variant, wide ? 1 : depth, depth);
}

export function panelMiddleMove(n: number, frame: ViewFrame, slice: MiddleSlice, variant: Variant): Move | null {
  return middleMove(n, frame, slice, variant);
}

export function panelWholeCommand(frame: ViewFrame, axis: 'x' | 'y' | 'z', variant: Variant): ViewCommand {
  return wholeCommand(frame, WHOLE_FACE[axis], variant);
}
