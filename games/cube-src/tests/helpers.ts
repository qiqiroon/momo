// テスト用の乱数（シード固定で再現できる）と、ランダムな合法手
import { makeMove } from '../src/core/move';
import { AXES, type Move } from '../src/core/types';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TURNS: Move['turns'][] = [-2, -1, 1, 2];

/** 任意のスライス組（ワイド・飛び飛び・全体を含む）のランダムな合法手 */
export function randomMove(n: number, rng: () => number): Move {
  const axis = AXES[Math.floor(rng() * 3)];
  const slices = 1 + Math.floor(rng() * ((1 << n) - 1));
  return makeMove(n, axis, slices, TURNS[Math.floor(rng() * 4)]);
}

export const SIZES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
