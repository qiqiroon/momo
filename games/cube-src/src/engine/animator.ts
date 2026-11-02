// 層の回転アニメーションの時間と角度（設計 02 §3.4・§3.5）
import { isWholeCube } from '../core/move';
import type { Axis, Move, MoveOrigin } from '../core/types';
import { easeInOutQuad } from '../util/easing';

export interface AnimationSettings {
  /** 90° あたりの基準時間（ms）。設定で 60〜400 */
  baseQuarterMs: number;
  solverPlaybackScale: number;
}

/** 90° あたりの既定。回っているのがかろうじて見える速さ（2026-11-01 利用者の指示。設計の 180 から変更） */
export const DEFAULT_QUARTER_MS = 70;

export const DEFAULT_ANIMATION: AnimationSettings = {
  baseQuarterMs: DEFAULT_QUARTER_MS,
  solverPlaybackScale: 1,
};

export interface ActiveAnimation {
  readonly move: Move;
  readonly axis: Axis;
  readonly slices: number;
  /** ラジアン。−θ_target → 0 へ進む。描画は R_world(axis, phi) · M_base（符号を反転しない） */
  readonly phi: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
}

export function durationFor(move: Move, origin: MoveOrigin, s: AnimationSettings): number {
  return s.baseQuarterMs
    * (Math.abs(move.turns) === 2 ? 1.45 : 1)
    * (isWholeCube(move) ? 1.2 : 1)
    * (origin === 'shuffle' ? 0.33 : 1)
    * (origin === 'solver' ? s.solverPlaybackScale : 1);
}

/** φ(t) = (ease(t/duration) − 1) × θ_target。t=0 で 1 手前の姿勢、t=duration で確定姿勢 */
export function phiAt(move: Move, elapsedMs: number, durationMs: number): number {
  const t = durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 1;
  return (easeInOutQuad(t) - 1) * move.turns * (Math.PI / 2);
}
