import { describe, expect, it } from 'vitest';
import {
  applyMove, assertInvariants, createSolved, cubieAt, faceColors, isSolved, restore, snapshot,
  type CubeState,
} from '../src/core/cubeState';
import { inverse, makeMove } from '../src/core/move';
import { parseMove, parseSequence } from '../src/core/notation';
import { AXES, FACES, type Face, type Move } from '../src/core/types';
import { SIZES, mulberry32, randomMove } from './helpers';

const COUNT: Record<number, number> = { 1: 1, 2: 8, 3: 26, 4: 56, 5: 98, 7: 218, 10: 488 };

const sameState = (a: CubeState, b: CubeState): boolean =>
  a.cubies.every((c, i) => c.ori === b.cubies[i].ori && c.pos.join() === b.cubies[i].pos.join());

const applyAll = (s: CubeState, moves: Move[]): void => moves.forEach((m) => applyMove(s, m));

/** 面の色を行ごとの文字列にする（正面から見て左上から右、上から下） */
const rows = (s: CubeState, f: Face): string[] => {
  const c = faceColors(s, f);
  const out: string[] = [];
  for (let r = 0; r < s.n; r++) out.push(c.slice(r * s.n, (r + 1) * s.n).join(''));
  return out;
};
const col = (s: CubeState, f: Face, j: number): string => rows(s, f).map((r) => r[j]).join('');

describe('CubeState（01 §5）', () => {
  it('T3: 完成状態・小キューブ数・ステッカー数', () => {
    for (const n of SIZES) {
      const s = createSolved(n);
      expect(isSolved(s)).toBe(true);
      expect(s.cubies.length).toBe(n === 1 ? 1 : n ** 3 - (n - 2) ** 3);
      if (COUNT[n]) expect(s.cubies.length).toBe(COUNT[n]);
      const stickers = s.cubies.reduce((a, c) => a + c.base.filter((x) => x).length, 0);
      expect(stickers).toBe(6 * n * n);
      assertInvariants(s);
    }
  });

  it('createSolved は範囲外で RangeError', () => {
    expect(() => createSolved(0)).toThrow(RangeError);
    expect(() => createSolved(11)).toThrow(RangeError);
    expect(() => createSolved(2.5)).toThrow(RangeError);
  });

  it('applyMove は n の食い違いを拒む（INV5）', () => {
    expect(() => applyMove(createSolved(3), makeMove(4, 'x', 1, 1))).toThrow(RangeError);
  });

  it('T4: 全軸・全スライス・全 turns で m のあと inverse(m) で戻る（N=1..10）', () => {
    for (const n of SIZES) {
      for (const axis of AXES) {
        for (let s = 0; s < n; s++) {
          for (const t of [-2, -1, 1, 2] as const) {
            const st = createSolved(n);
            const m = makeMove(n, axis, 1 << s, t);
            applyMove(st, m);
            assertInvariants(st);
            applyMove(st, inverse(m));
            expect(sameState(st, createSolved(n))).toBe(true);
          }
        }
      }
    }
  });

  it('T5: 同じ手を 4 回で元に戻る（ori と pos が全小キューブで一致）', () => {
    const rng = mulberry32(5);
    for (const n of SIZES) {
      for (let i = 0; i < 40; i++) {
        const st = createSolved(n);
        applyAll(st, Array.from({ length: 10 }, () => randomMove(n, rng)));
        const before = snapshot(st);
        const m = randomMove(n, rng);
        for (let k = 0; k < 4; k++) applyMove(st, m);
        expect(snapshot(st)).toEqual(before);
      }
    }
  });

  it("T6: N=3 で (R U R' U') を 6 回で完成に戻り、途中は崩れている", () => {
    const st = createSolved(3);
    const seq = parseSequence("R U R' U'", 3);
    for (let i = 1; i <= 6; i++) {
      applyAll(st, seq);
      expect(isSolved(st)).toBe(i === 6);
    }
  });

  it('T7: ランダム 200 手のあとも不変条件が保たれる（N=1..10）', () => {
    const rng = mulberry32(7);
    for (const n of SIZES) {
      const st = createSolved(n);
      for (let i = 0; i < 200; i++) {
        applyMove(st, randomMove(n, rng));
        assertInvariants(st);
      }
    }
  });

  it('T8: N=1 は任意の手のあとも完成', () => {
    const rng = mulberry32(8);
    const st = createSolved(1);
    for (let i = 0; i < 50; i++) {
      applyMove(st, randomMove(1, rng));
      expect(isSolved(st)).toBe(true);
    }
  });

  it('T9 / P6: 完成状態に全体回転だけを何回かけても完成', () => {
    const rng = mulberry32(9);
    for (const n of SIZES) {
      const st = createSolved(n);
      for (let i = 0; i < 30; i++) {
        applyMove(st, makeMove(n, AXES[Math.floor(rng() * 3)], (1 << n) - 1, rng() < 0.5 ? 1 : -1));
        expect(isSolved(st)).toBe(true);
      }
    }
  });

  it('snapshot / restore で同じ状態が戻る', () => {
    const rng = mulberry32(11);
    for (const n of SIZES) {
      const st = createSolved(n);
      applyAll(st, Array.from({ length: 50 }, () => randomMove(n, rng)));
      const back = restore(snapshot(st));
      expect(sameState(back, st)).toBe(true);
      for (const f of FACES) expect(faceColors(back, f)).toEqual(faceColors(st, f));
    }
  });
});

// 回転の向きの確かめ（HANDOVER U-V1）。内部の表現に頼らず、
// 「その手を回したあと、どの面にどの色が見えるか」を実物のキューブの動きと照らす。
// 完成状態の配色：上=白 W、下=黄 Y、正面=緑 G、奥=青 B、右=赤 R、左=橙 O
describe('回転の向き：実物のキューブと同じ動きか（U-V1）', () => {
  const after = (text: string, n = 3): CubeState => {
    const st = createSolved(n);
    applyAll(st, parseSequence(text, n));
    return st;
  };

  it('U：N=3 の前右上の角 (2,2,2) は前左上 (0,2,2) へ移る（01 §2）', () => {
    const st = createSolved(3);
    const id = cubieAt(st, [2, 2, 2])!.id;
    applyMove(st, parseMove('U', 3));
    expect(cubieAt(st, [0, 2, 2])!.id).toBe(id);
  });

  it('U：正面の上の段に右の面の色（赤）が来る', () => {
    const st = after('U');
    expect(rows(st, 'F')[0]).toBe('RRR');
    expect(rows(st, 'L')[0]).toBe('GGG');
    expect(rows(st, 'F')[1]).toBe('GGG');
  });

  it('R：上の面の右の列に正面の色（緑）が来る', () => {
    const st = after('R');
    expect(col(st, 'U', 2)).toBe('GGG');
    expect(col(st, 'F', 2)).toBe('YYY');
  });

  it('F：右の面の左の列に上の面の色（白）が来る', () => {
    const st = after('F');
    expect(col(st, 'R', 0)).toBe('WWW');
    expect(rows(st, 'U')[2]).toBe('OOO');
  });

  it('L：正面の左の列に上の面の色（白）が来る', () => {
    expect(col(after('L'), 'F', 0)).toBe('WWW');
  });

  it('D：右の面の下の段に正面の色（緑）が来る', () => {
    expect(rows(after('D'), 'R')[2]).toBe('GGG');
  });

  it('B：左の面の左の列（奥側）に上の面の色（白）が来る', () => {
    expect(col(after('B'), 'L', 0)).toBe('WWW');
  });

  it('x は R と同じ向き：正面に下の面（黄）、上に正面（緑）', () => {
    const st = after('x');
    expect(rows(st, 'F').join('')).toBe('Y'.repeat(9));
    expect(rows(st, 'U').join('')).toBe('G'.repeat(9));
  });

  it('y は U と同じ向き：正面に右の面（赤）', () => {
    expect(rows(after('y'), 'F').join('')).toBe('R'.repeat(9));
  });

  it('z は F と同じ向き：右の面に上の面（白）', () => {
    expect(rows(after('z'), 'R').join('')).toBe('W'.repeat(9));
  });

  it('M は L と同じ向き：正面の真ん中の列に白', () => {
    expect(col(after('M'), 'F', 1)).toBe('WWW');
  });

  it('E は D と同じ向き：右の面の真ん中の段に緑', () => {
    expect(rows(after('E'), 'R')[1]).toBe('GGG');
  });

  it('S は F と同じ向き：右の面の真ん中の列に白', () => {
    expect(col(after('S'), 'R', 1)).toBe('WWW');
  });

  it('N=5 の 2R（右から2枚目だけ）：上の面の右から2列目だけに緑', () => {
    const st = after('2R', 5);
    expect(col(st, 'U', 3)).toBe('GGGGG');
    expect(col(st, 'U', 4)).toBe('WWWWW');
  });
});
