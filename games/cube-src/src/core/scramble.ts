// 合法シャッフルの生成（設計 02 §5、08 §6）
// Move[] しか返さない。色や配置を直接いじる経路は持たない（要求仕様 §26）
import { makeMove } from './move';
import { AXES, type Move } from './types';

export const DEFAULT_SCRAMBLE_LENGTH: Record<number, number> = {
  1: 0, 2: 12, 3: 25, 4: 50, 5: 80, 6: 100, 7: 120, 8: 140, 9: 160, 10: 180,
};

/** [0,1) を返す。既定は Math.random */
export type Rng = () => number;

const MAX_RETRY = 32;
const TURN_CHOICES: readonly Move['turns'][] = [-1, 1, 2];

export function scrambleLengthFor(n: number, override?: number): number {
  const len = override ?? DEFAULT_SCRAMBLE_LENGTH[n] ?? 0;
  return Math.max(0, Math.min(999, Math.floor(len)));
}

const pick = <T>(items: readonly T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

export function generateScramble(n: number, length: number, rng: Rng = Math.random): Move[] {
  if (n === 1) return [];
  const out: Move[] = [];
  while (out.length < length) {
    let cand: Move | null = null;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const axis = pick(AXES, rng);
      const slices = 1 << Math.floor(rng() * n);
      cand = makeMove(n, axis, slices, pick(TURN_CHOICES, rng));
      if (!isRejected(out, cand, rng)) break;
    }
    out.push(cand!);
  }
  return out;
}

function isRejected(prev: readonly Move[], m: Move, rng: Rng): boolean {
  const k = prev.length;
  const last = prev[k - 1];
  // 1. 直前と同じ (axis, slices)
  if (last && last.axis === m.axis && last.slices === m.slices) return true;
  // 2. 直前 2 手が同じ軸なら、同じ軸の 3 手目を棄却
  if (k >= 2 && prev[k - 2].axis === m.axis && last.axis === m.axis) return true;
  // 3. 直近 4 手以内に同じ (axis, slices) があれば半々で棄却
  for (let i = Math.max(0, k - 4); i < k; i++) {
    if (prev[i].axis === m.axis && prev[i].slices === m.slices) return rng() < 0.5;
  }
  return false;
}
