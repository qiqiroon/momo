import { describe, expect, it } from 'vitest';
import {
  AXIS_MATRIX, AXIS_TURN, BODY_FACE_OF, COMPOSE, INVERSE, ROT_MATRICES, WORLD_FACE_OF,
  det, mulMat, mulVec, oriOf, rotateIndex, sliceOf, turnsForFace,
} from '../src/core/rotations';
import { AXES, FACES, type GridPos } from '../src/core/types';
import { SIZES } from './helpers';

const allPositions = (n: number): GridPos[] => {
  const out: GridPos[] = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) for (let z = 0; z < n; z++) out.push([x, y, z]);
  return out;
};

describe('軸回転の添字置換（01 §2）', () => {
  it('T1: 各軸の rot90 を 4 回で恒等（N=1..10）', () => {
    for (const n of SIZES) {
      for (const axis of AXES) {
        for (const p of allPositions(n)) {
          let q = p;
          for (let i = 0; i < 4; i++) q = rotateIndex(q, axis, n);
          expect(q).toEqual(p);
        }
      }
    }
  });

  it('U-V1: 添字の式が中心化座標での +90° 行列と一致する', () => {
    for (const n of SIZES) {
      for (const axis of AXES) {
        for (const p of allPositions(n)) {
          const c = p.map((i) => 2 * i - (n - 1)) as unknown as GridPos;
          const r = mulVec(AXIS_MATRIX[axis], c).map((v) => (v + (n - 1)) / 2);
          expect(rotateIndex(p, axis, n)).toEqual(r);
        }
      }
    }
  });

  it('U-V1: rotY90(i) = [i.z, i.y, n-1-i.x]', () => {
    expect(rotateIndex([0, 1, 2], 'y', 3)).toEqual([2, 1, 2]);
    expect(rotateIndex([2, 0, 1], 'y', 5)).toEqual([1, 0, 2]);
  });

  it('sliceOf：正の面は n-depth、負の面は depth-1', () => {
    expect(sliceOf('R', 1, 5)).toBe(4);
    expect(sliceOf('L', 1, 5)).toBe(0);
    expect(sliceOf('U', 3, 5)).toBe(2);
    expect(sliceOf('B', 2, 5)).toBe(1);
  });

  it('turnsForFace：時計回り＝外向き法線まわり −90°（01 §2.1 の表）', () => {
    const cw = Object.fromEntries(FACES.map((f) => [f, turnsForFace(f, 'cw')]));
    expect(cw).toEqual({ U: -1, D: 1, R: -1, L: 1, F: -1, B: 1 });
    for (const f of FACES) {
      expect(turnsForFace(f, 'ccw')).toBe(-turnsForFace(f, 'cw'));
      expect(turnsForFace(f, 'double')).toBe(2 * turnsForFace(f, 'cw'));
    }
  });
});

describe('24 元回転群（01 §3）', () => {
  it('T2: 24 個・行列式 +1・成分 0/±1・恒等が先頭', () => {
    expect(ROT_MATRICES.length).toBe(24);
    expect(ROT_MATRICES[0]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    for (const m of ROT_MATRICES) {
      expect(det(m)).toBe(1);
      expect(m.every((v) => v === 0 || v === 1 || v === -1)).toBe(true);
    }
    expect(new Set(ROT_MATRICES.map((m) => m.join(','))).size).toBe(24);
  });

  it('T2: COMPOSE が行列積と一致し、結合律・逆元・単位元を満たす', () => {
    for (let a = 0; a < 24; a++) {
      expect(COMPOSE[a * 24]).toBe(a);
      expect(COMPOSE[a]).toBe(a);
      expect(COMPOSE[a * 24 + INVERSE[a]]).toBe(0);
      expect(COMPOSE[INVERSE[a] * 24 + a]).toBe(0);
      for (let b = 0; b < 24; b++) {
        expect(COMPOSE[a * 24 + b]).toBe(oriOf(mulMat(ROT_MATRICES[a], ROT_MATRICES[b])));
        for (let c = 0; c < 24; c++) {
          const abC = COMPOSE[COMPOSE[a * 24 + b] * 24 + c];
          const aBc = COMPOSE[a * 24 + COMPOSE[b * 24 + c]];
          expect(abC).toBe(aBc);
        }
      }
    }
  });

  it('AXIS_TURN は軸の +90° を左から合成し、4 回で戻る', () => {
    for (const axis of AXES) {
      const r = oriOf(AXIS_MATRIX[axis]);
      for (let o = 0; o < 24; o++) {
        expect(AXIS_TURN[axis][o]).toBe(COMPOSE[r * 24 + o]);
        let q = o;
        for (let i = 0; i < 4; i++) q = AXIS_TURN[axis][q];
        expect(q).toBe(o);
      }
    }
  });

  it('BODY_FACE_OF と WORLD_FACE_OF は互いの逆写像', () => {
    for (let o = 0; o < 24; o++) {
      for (let f = 0; f < 6; f++) {
        expect(WORLD_FACE_OF[o * 6 + BODY_FACE_OF[o * 6 + f]]).toBe(f);
      }
    }
  });

  it('Y 軸 +90° の姿勢では、体の F 面が世界の R 面へ向く', () => {
    const o = oriOf(AXIS_MATRIX.y);
    expect(FACES[WORLD_FACE_OF[o * 6 + FACES.indexOf('F')]]).toBe('R');
  });
});
