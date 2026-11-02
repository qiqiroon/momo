import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyMove, colorAt, createSolved, faceColors } from '../src/core/cubeState';
import { isEquivalent } from '../src/core/move';
import { parseMove } from '../src/core/notation';
import { AXES, FACES, FACE_AXIS, FACE_INDEX, FACE_NORMAL, type Face, type Vec3 } from '../src/core/types';
import { WORLD_FACE_OF } from '../src/core/rotations';
import {
  chooseDirection, inPlaneDirections, pushAxis, pushToMove, sliceIndexOf,
} from '../src/input/dragToMove';
import { ViewController } from '../src/input/viewController';
import { SIZES, mulberry32 } from './helpers';

describe('押した向き → 回転（04 §3.3）', () => {
  it('I1: 設計の検証例 4 件（N=3 の外側の層）', () => {
    // 正面を上へ押す → R 相当（正面が上へ）
    expect(isEquivalent(pushToMove(3, 'F', 'U', 2), parseMove('R', 3))).toBe(true);
    // 上面を右へ払う → F 相当
    expect(isEquivalent(pushToMove(3, 'U', 'R', 2), parseMove('F', 3))).toBe(true);
    // 右面を上へ押す → F' 相当
    expect(isEquivalent(pushToMove(3, 'R', 'U', 2), parseMove("F'", 3))).toBe(true);
    // 正面を右へ払う → U' 相当
    expect(isEquivalent(pushToMove(3, 'F', 'R', 2), parseMove("U'", 3))).toBe(true);
  });

  it('I2: 6 面 × 面の中の 4 向き＝24 通りで、n × d は立方体の軸になる', () => {
    let count = 0;
    for (const n of FACES) {
      for (const d of inPlaneDirections(n)) {
        const { axis } = pushAxis(n, d);
        expect(axis).not.toBe(FACE_AXIS[n]);
        expect(axis).not.toBe(FACE_AXIS[d]);
        count++;
      }
    }
    expect(count).toBe(24);
  });

  it('I3: 掴んだ小キューブの層が、そのまま回る層になる（N=2..10、ランダム 500 件）', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const n = 2 + Math.floor(rng() * 9);
      const st = createSolved(n);
      const c = st.cubies[Math.floor(rng() * st.cubies.length)];
      const faces = FACES.filter((f) => colorAt(c, f) !== null);
      const face = faces[Math.floor(rng() * faces.length)];
      const dirs = inPlaneDirections(face);
      const dir = dirs[Math.floor(rng() * 4)];
      const { axis } = pushAxis(face, dir);
      const m = pushToMove(n, face, dir, sliceIndexOf(c.pos, axis));
      expect(m.slices).toBe(1 << c.pos[AXES.indexOf(axis)]);
    }
  });

  it('U-V1（ドラッグ）：掴んだステッカーは、押した向きの面へ移る（全 N・全ステッカー・全向き）', () => {
    for (const n of SIZES.slice(1)) {
      const base = createSolved(n);
      base.cubies.forEach((c0, ci) => {
        for (const face of FACES) {
          if (colorAt(c0, face) === null) continue;
          for (const dir of inPlaneDirections(face)) {
            const st = createSolved(n);
            const c = st.cubies[ci];
            // 掴んだ体の面（世界の面 face に出ている体の面）
            const bodyFace = FACES.findIndex((_, b) => WORLD_FACE_OF[c.ori * 6 + b] === FACE_INDEX[face]);
            const { axis } = pushAxis(face, dir);
            applyMove(st, pushToMove(n, face, dir, sliceIndexOf(c.pos, axis)));
            // 90° 回したあと、そのステッカーは押した向きの面を向いている
            expect(FACES[WORLD_FACE_OF[c.ori * 6 + bodyFace]]).toBe(dir);
          }
        }
      });
    }
  });

  it('色で確かめる：N=3 で正面の右上のステッカーを上へ押すと、上面の右の列が緑になる（R と同じ）', () => {
    const st = createSolved(3);
    applyMove(st, pushToMove(3, 'F', 'U', 2));
    const u = faceColors(st, 'U');
    expect([u[2], u[5], u[8]].join('')).toBe('GGG');
  });

  it('まとめて（Alt）：外側から掴んだ層までを回す（最低 2 枚）', () => {
    // N=5 で右から 1 枚目を掴む → Rw（右から 2 枚）
    expect(isEquivalent(pushToMove(5, 'F', 'U', 4, 'wide'), parseMove('Rw', 5))).toBe(true);
    // 右から 3 枚目（真ん中）を掴む → 3Rw
    expect(isEquivalent(pushToMove(5, 'F', 'U', 2, 'wide'), parseMove('3Rw', 5))).toBe(true);
    // 左から 2 枚目 → 左から 2 枚（L 側の Lw と同じ層。向きは押した向き）
    const m = pushToMove(5, 'F', 'U', 1, 'wide');
    expect(m.slices).toBe(0b00011);
  });
});

describe('画面上の押した向き → 面の中の向き（04 §3.2）', () => {
  // ホームの向きのカメラで、実物の点を画面へ写す
  const camera = new PerspectiveCamera();
  const view = new ViewController(camera, { viewGrid: 0 });
  view.setViewport(800, 600);
  camera.updateMatrixWorld();
  const toScreen = (p: Vec3) => {
    const v = new Vector3(...p).project(camera);
    return { x: ((v.x + 1) / 2) * 800, y: ((1 - v.y) / 2) * 600 };
  };
  const unit = 4 / 3;
  const center = (f: Face): Vec3 => FACE_NORMAL[f].map((c) => c * 2) as unknown as Vec3;

  it('正面の中央を画面の上へ押すと「上」、右へ払うと「右」', () => {
    expect(chooseDirection('F', center('F'), unit, { x: 0, y: -30 }, toScreen)).toBe('U');
    expect(chooseDirection('F', center('F'), unit, { x: 30, y: 0 }, toScreen)).toBe('R');
    expect(chooseDirection('F', center('F'), unit, { x: 0, y: 30 }, toScreen)).toBe('D');
  });

  it('上面を画面の右上へ払うと、上面の中の「奥」か「右」になる（斜めの面でも画面の向きで選ぶ）', () => {
    const d = chooseDirection('U', center('U'), unit, { x: 30, y: -10 }, toScreen);
    expect(['R', 'B']).toContain(d);
  });

  it('動かしていなければ選ばない', () => {
    expect(chooseDirection('F', center('F'), unit, { x: 0, y: 0 }, toScreen)).toBeNull();
  });
});
