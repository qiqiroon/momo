import { describe, expect, it } from 'vitest';
import { applyMove, createSolved, isSolved } from '../src/core/cubeState';
import { inverse } from '../src/core/move';
import { generateScramble, scrambleLengthFor } from '../src/core/scramble';
import { SIZES, mulberry32 } from './helpers';

describe('シャッフル（02 §5）', () => {
  it('S1 / P3: 逆順・逆手で必ず完成に戻る（N=1..10 × 100）', () => {
    const rng = mulberry32(1);
    for (const n of SIZES) {
      for (let i = 0; i < 100; i++) {
        const seq = generateScramble(n, scrambleLengthFor(n), rng);
        const st = createSolved(n);
        seq.forEach((m) => applyMove(st, m));
        [...seq].reverse().forEach((m) => applyMove(st, inverse(m)));
        expect(isSolved(st)).toBe(true);
      }
    }
  });

  it('S2: N≥2 で length ちょうど', () => {
    const rng = mulberry32(2);
    for (const n of SIZES.slice(1)) {
      for (const len of [0, 1, 7, 25, 180]) expect(generateScramble(n, len, rng).length).toBe(len);
    }
  });

  it('S3: N=1 は常に空', () => {
    expect(generateScramble(1, 50)).toEqual([]);
    expect(scrambleLengthFor(1)).toBe(0);
  });

  it('S4: 隣り合う 2 手が同じ (axis, slices) にならない', () => {
    const rng = mulberry32(4);
    for (const n of SIZES.slice(1)) {
      const seq = generateScramble(n, 500, rng);
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i].axis === seq[i - 1].axis && seq[i].slices === seq[i - 1].slices).toBe(false);
      }
    }
  });

  it('S5: 同じシードなら同じ列', () => {
    for (const n of SIZES) {
      expect(generateScramble(n, 60, mulberry32(42))).toEqual(generateScramble(n, 60, mulberry32(42)));
    }
  });

  it('S6: N=3 の 25 手が完成のままになるのは 1000 回で 1 回以下', () => {
    const rng = mulberry32(6);
    let solved = 0;
    for (let i = 0; i < 1000; i++) {
      const st = createSolved(3);
      generateScramble(3, 25, rng).forEach((m) => applyMove(st, m));
      if (isSolved(st)) solved++;
    }
    expect(solved).toBeLessThanOrEqual(1);
  });

  it('scrambleLengthFor：既定値と上書き（0〜999 に収める）', () => {
    expect(scrambleLengthFor(3)).toBe(25);
    expect(scrambleLengthFor(10)).toBe(180);
    expect(scrambleLengthFor(3, 40)).toBe(40);
    expect(scrambleLengthFor(3, 5000)).toBe(999);
    expect(scrambleLengthFor(3, -3)).toBe(0);
  });
});
