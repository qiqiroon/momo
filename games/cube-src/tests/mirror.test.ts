import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AXES, FACES, FACE_NORMAL, type Face } from '../src/core/types';
import { ViewController, homeQuaternion } from '../src/input/viewController';
import { GROUP_QUATERNIONS } from '../src/input/viewFrame';
import {
  CUBE_RADIUS, MIRROR_DISTANCE, MIRROR_NORMAL, framingSpheres, mirrorFaceOf, mirrorImage,
} from '../src/render/mirrorRoom';
import { mulberry32 } from './helpers';

/** ホームのときのカメラの向き（原点からカメラへ） */
const homeDir = () => new Vector3(0, 0, 1).applyQuaternion(homeQuaternion());

/** その向き Δ のとき、本体のカメラから見えている面 */
const visibleFaces = (delta: Quaternion): Face[] => {
  const dir = homeDir().applyQuaternion(delta.clone().invert());
  return FACES.filter((f) => new Vector3(...FACE_NORMAL[f]).dot(dir) > 1e-9);
};

describe('鏡の置き場所（03 §4.2）', () => {
  it('鏡はキューブの左・下・奥にあり、回しても角が当たらない距離', () => {
    expect(MIRROR_DISTANCE).toBeGreaterThan(CUBE_RADIUS);
    // 鏡の面の上の点 = −D·n。カメラ（ホーム）は 3 枚とも表側（キューブの側）にある
    for (const a of AXES) expect(homeDir().dot(MIRROR_NORMAL[a])).toBeGreaterThan(0);
  });

  it('像は鏡の面で折り返した位置にできる（面からの距離が等しく、面に垂直な線の上）', () => {
    const rng = mulberry32(1);
    for (const a of AXES) {
      const n = MIRROR_NORMAL[a];
      for (let i = 0; i < 20; i++) {
        const p = new Vector3(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2);
        const q = mirrorImage(p, a);
        // 符号付き距離が反転：p は面の表側 +h、像は裏側 −h
        expect(q.dot(n) + MIRROR_DISTANCE).toBeCloseTo(-(p.dot(n) + MIRROR_DISTANCE), 12);
        // p と像を結ぶ線は面に垂直
        expect(q.clone().sub(p).cross(n).length()).toBeLessThan(1e-12);
      }
    }
  });

  it('反射の法則：目 → 鏡の点 → 物 の道のりは、目から像までの直線と同じ長さ（入射角＝反射角）', () => {
    const eye = homeDir().multiplyScalar(30);
    const rng = mulberry32(2);
    for (const a of AXES) {
      const n = MIRROR_NORMAL[a];
      for (let i = 0; i < 20; i++) {
        const p = new Vector3(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2);
        const img = mirrorImage(p, a);
        // 目から像への線が鏡の面を通る点
        const t = (-MIRROR_DISTANCE - eye.dot(n)) / img.clone().sub(eye).dot(n);
        const hit = eye.clone().lerp(img, t);
        expect(eye.distanceTo(hit) + hit.distanceTo(p)).toBeCloseTo(eye.distanceTo(img), 9);
      }
    }
  });

  it('ホームでは、左の鏡に左面（橙）、床の鏡に下面（黄）、奥の鏡に奥面（青）が正面から映る', () => {
    const home = new Quaternion();
    expect(mirrorFaceOf(home, 'x')).toBe('L');
    expect(mirrorFaceOf(home, 'y')).toBe('D');
    expect(mirrorFaceOf(home, 'z')).toBe('B');
    // 像のうち目の方を向いている面：左の鏡の像では、実物の左面の像が目の方を向く
    const eye = homeDir();
    const faceImageNormal = (f: Face, a: 'x' | 'y' | 'z') => {
      const nf = new Vector3(...FACE_NORMAL[f]);
      return nf.addScaledVector(MIRROR_NORMAL[a], -2 * nf.dot(MIRROR_NORMAL[a]));
    };
    expect(faceImageNormal('L', 'x').dot(eye)).toBeGreaterThan(0);
    expect(faceImageNormal('D', 'y').dot(eye)).toBeGreaterThan(0);
    expect(faceImageNormal('B', 'z').dot(eye)).toBeGreaterThan(0);
  });

  it('キューブを 24 通りのどの向きに回しても、本体と鏡 3 枚で 6 面すべてが見える', () => {
    for (const g of GROUP_QUATERNIONS) {
      const mirrored = AXES.map((a) => mirrorFaceOf(g, a));
      expect(new Set([...visibleFaces(g), ...mirrored]).size).toBe(6);
      expect(new Set(mirrored).size).toBe(3);
    }
  });

  it('鏡は画面（部屋）に固定：キューブを縦の軸まわりに +90° 回すと、左の鏡には奥の面が来る', () => {
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    expect(mirrorFaceOf(delta, 'x')).toBe('B');
    expect(mirrorFaceOf(delta, 'z')).toBe('R');
    expect(mirrorFaceOf(delta, 'y')).toBe('D');
  });
});

describe('画面に収める（03 §4.6）', () => {
  it('キューブと鏡の像 3 つが、どの画面の形でも画面の中に収まる', () => {
    for (const [w, h] of [[1280, 720], [683, 690], [375, 700], [1920, 1080]]) {
      const cam = new PerspectiveCamera();
      const view = new ViewController(cam, { viewGrid: 0 }, framingSpheres());
      view.setViewport(w, h);
      cam.updateMatrixWorld();
      const toWorld = new Quaternion(); // ホームでは部屋の座標＝世界
      for (const s of framingSpheres()) {
        const c = s.center.clone().applyQuaternion(toWorld);
        // 球の中心の両端（カメラの右・上の向きへ半径ぶん）が NDC の [-1, 1] に入る
        const right = new Vector3(1, 0, 0).applyQuaternion(cam.quaternion).multiplyScalar(s.radius);
        const up = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion).multiplyScalar(s.radius);
        for (const p of [c.clone().add(right), c.clone().sub(right), c.clone().add(up), c.clone().sub(up)]) {
          const ndc = p.project(cam);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
        }
      }
      // キューブの重心は画面のどこかに写り、ドラッグの中心はそこに合う
      const o = view.cubeScreenOffset;
      const ndc = new Vector3().project(cam);
      expect(o.x).toBeCloseTo((ndc.x * w) / 2, 6);
      expect(o.y).toBeCloseTo((-ndc.y * h) / 2, 6);
    }
  });
});
