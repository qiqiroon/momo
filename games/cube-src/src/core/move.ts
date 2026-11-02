// Move の純粋ヘルパ（設計 02 §1、08 §2）
import { sliceOf } from './rotations';
import { MAX_SIZE, MIN_SIZE, type Axis, type Face, type Move } from './types';

const TURNS = new Set([-2, -1, 1, 2]);

/** Move の唯一の生成口。不変条件 INV6 を検証する */
export function makeMove(n: number, axis: Axis, slices: number, turns: Move['turns']): Move {
  if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
    throw new RangeError(`n out of range: ${n}`);
  }
  if (!Number.isInteger(slices) || slices <= 0 || slices >= 1 << n) {
    throw new RangeError(`slices out of range: ${slices} (n=${n})`);
  }
  if (!TURNS.has(turns)) throw new RangeError(`invalid turns: ${turns}`);
  if (axis !== 'x' && axis !== 'y' && axis !== 'z') throw new RangeError(`invalid axis: ${axis}`);
  return { n, axis, slices, turns };
}

const mod4 = (t: number): number => ((t % 4) + 4) % 4;

export function inverse(m: Move): Move {
  return { ...m, turns: -m.turns as Move['turns'] };
}

export function isEquivalent(a: Move, b: Move): boolean {
  return a.n === b.n && a.axis === b.axis && a.slices === b.slices
    && mod4(a.turns) === mod4(b.turns);
}

/** 続けて適用すると恒等になるか */
export function cancels(a: Move, b: Move): boolean {
  return a.n === b.n && a.axis === b.axis && a.slices === b.slices
    && mod4(a.turns + b.turns) === 0;
}

export function isWholeCube(m: Move): boolean {
  return m.slices === (1 << m.n) - 1;
}

/** 論理適用用に mod 4 で正規化 */
export function quarterTurns(m: Move): 0 | 1 | 2 | 3 {
  return mod4(m.turns) as 0 | 1 | 2 | 3;
}

/** その面から数えて深さ from〜to をビットマスクにする（R=(R,1,1)、Rw=(R,1,2)、3R=(R,3,3)） */
export function slicesFromDepths(face: Face, from: number, to: number, n: number): number {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > n) {
    throw new RangeError(`depth out of range: ${from}..${to} (n=${n})`);
  }
  let mask = 0;
  for (let d = from; d <= to; d++) mask |= 1 << sliceOf(face, d, n);
  return mask;
}
