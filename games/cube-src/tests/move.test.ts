import { describe, expect, it } from 'vitest';
import { applyMove, createSolved, snapshot } from '../src/core/cubeState';
import {
  cancels, inverse, isEquivalent, isWholeCube, makeMove, quarterTurns, slicesFromDepths,
} from '../src/core/move';
import { SIZES, mulberry32, randomMove } from './helpers';

describe('Move（02 §1）', () => {
  it('makeMove は不変条件を検証する（INV6）', () => {
    expect(() => makeMove(3, 'x', 0, 1)).toThrow(RangeError);
    expect(() => makeMove(3, 'x', 8, 1)).toThrow(RangeError);
    expect(() => makeMove(3, 'x', 1, 0 as never)).toThrow(RangeError);
    expect(() => makeMove(11, 'x', 1, 1)).toThrow(RangeError);
    expect(makeMove(10, 'z', 1023, 2).slices).toBe(1023);
  });

  it('inverse・isEquivalent・cancels・quarterTurns・isWholeCube', () => {
    const r = makeMove(3, 'x', 4, -1);
    expect(inverse(r).turns).toBe(1);
    expect(cancels(r, inverse(r))).toBe(true);
    expect(isEquivalent(makeMove(3, 'x', 4, 2), makeMove(3, 'x', 4, -2))).toBe(true);
    expect(cancels(makeMove(3, 'x', 4, 2), makeMove(3, 'x', 4, 2))).toBe(true);
    expect(quarterTurns(r)).toBe(3);
    expect(isWholeCube(makeMove(3, 'y', 7, 1))).toBe(true);
    expect(isWholeCube(makeMove(3, 'y', 3, 1))).toBe(false);
  });

  it('slicesFromDepths', () => {
    expect(slicesFromDepths('R', 1, 1, 5)).toBe(0b10000);
    expect(slicesFromDepths('R', 1, 2, 5)).toBe(0b11000);
    expect(slicesFromDepths('L', 3, 3, 5)).toBe(0b00100);
    expect(() => slicesFromDepths('R', 0, 1, 5)).toThrow(RangeError);
    expect(() => slicesFromDepths('R', 1, 6, 5)).toThrow(RangeError);
  });

  it('P1 / P2: 任意の状態で m・inverse(m) は恒等、m を 4 回でも恒等（N=1..10 × 200）', () => {
    const rng = mulberry32(3);
    for (const n of SIZES) {
      const st = createSolved(n);
      for (let i = 0; i < 200; i++) {
        applyMove(st, randomMove(n, rng));
        const before = snapshot(st);
        const m = randomMove(n, rng);
        applyMove(st, m);
        applyMove(st, inverse(m));
        expect(snapshot(st)).toEqual(before);
        for (let k = 0; k < 4; k++) applyMove(st, m);
        expect(snapshot(st)).toEqual(before);
      }
    }
  });
});
