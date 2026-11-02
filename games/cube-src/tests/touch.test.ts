// 指とマウスの操作の手直し（2026-11-02 作者の修正指示 `docs/order/修正261102.txt`）
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createSolved } from '../src/core/cubeState';
import { makeMove } from '../src/core/move';
import { FACES, FACE_AXIS, FACE_NORMAL, FACE_SIGN, AXIS_INDEX, type Vec3 } from '../src/core/types';
import { stickerOnRay } from '../src/input/dragToMove';
import { ViewController } from '../src/input/viewController';
import { GROUP_QUATERNIONS } from '../src/input/viewFrame';
import { CUBE_WORLD_SIZE, CubeView } from '../src/render/cubeView';
import { framingSpheres } from '../src/render/mirrorRoom';
import { mulberry32 } from './helpers';

const H = CUBE_WORLD_SIZE / 2;

/** 面 f の上の点（u, v は面の中の 2 軸の座標、−H..H） */
const pointOnFace = (f: (typeof FACES)[number], u: number, v: number): Vec3 => {
  const i = AXIS_INDEX[FACE_AXIS[f]];
  const p = [0, 0, 0];
  p[i] = FACE_SIGN[f] * H;
  const others = [0, 1, 2].filter((k) => k !== i);
  p[others[0]] = u;
  p[others[1]] = v;
  return p as unknown as Vec3;
};

describe('面をつまむ当たり判定（色の境目・隙間・鏡）', () => {
  it('面の上のどこを狙っても（色の境目・小キューブの隙間・角の近くも）、その面のその位置の小キューブを掴む', () => {
    const rng = mulberry32(7);
    for (let n = 1; n <= 10; n++) {
      const state = createSolved(n);
      const unit = CUBE_WORLD_SIZE / n;
      for (const f of FACES) {
        const nv = FACE_NORMAL[f];
        for (let k = 0; k < 60; k++) {
          // 半分は色の境目（小キューブの継ぎ目）の上ちょうど、残りは面の上のどこか
          const onSeam = k % 2 === 0;
          const pick = () => (onSeam ? -H + Math.floor(rng() * (n + 1)) * unit : (rng() * 2 - 1) * H);
          const u = Math.min(H - 1e-9, Math.max(-H + 1e-9, pick()));
          const v = Math.min(H - 1e-9, Math.max(-H + 1e-9, (rng() * 2 - 1) * H));
          const p = pointOnFace(f, u, v);
          // 面の外側の、斜めの向きから狙う
          const out = new Vector3(...nv).multiplyScalar(1 + rng())
            .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.8));
          if (out.dot(new Vector3(...nv)) <= 0.2) continue;
          const o = new Vector3(...p).addScaledVector(out, 20);
          const r = new Vector3(...p).sub(o).normalize();
          const hit = stickerOnRay(state, CUBE_WORLD_SIZE, o.toArray(), r.toArray());
          expect(hit, `N=${n} ${f}`).not.toBeNull();
          // 角のすぐ近くでは、隣の面に先に当たることがある（見た目どおり）。どちらでも、当たった面の上の小キューブ
          const c = state.cubies[hit!.cubie];
          const i = AXIS_INDEX[FACE_AXIS[hit!.face]];
          expect(c.pos[i]).toBe(FACE_SIGN[hit!.face] > 0 ? n - 1 : 0);
          if (hit!.face === f) {
            const others = [0, 1, 2].filter((j) => j !== i);
            // 掴んだ小キューブのマスに、狙った点が入っている（継ぎ目ちょうどなら両隣のどちらでもよい）
            const inCell = (pos: number, x: number) => x >= pos * unit - H - 1e-6 && x <= (pos + 1) * unit - H + 1e-6;
            expect(inCell(c.pos[others[0]], u)).toBe(true);
            expect(inCell(c.pos[others[1]], v)).toBe(true);
          }
        }
      }
    }
  });

  it('真正面から狙えば必ずその面。外れたら null（背景・鏡と同じ扱い）', () => {
    const state = createSolved(3);
    for (const f of FACES) {
      const nv = new Vector3(...FACE_NORMAL[f]);
      const hit = stickerOnRay(state, CUBE_WORLD_SIZE, nv.clone().multiplyScalar(30).toArray(), nv.clone().negate().toArray());
      expect(hit!.face).toBe(f);
    }
    expect(stickerOnRay(state, CUBE_WORLD_SIZE, [10, 10, 30], [0, 0, -1])).toBeNull();
    // キューブから遠ざかる視線
    expect(stickerOnRay(state, CUBE_WORLD_SIZE, [0, 0, 30], [0, 0, 1])).toBeNull();
  });
});

describe('全体の回転は横回しか縦回し', () => {
  const makeView = (grid: 0 | 90 = 0) => {
    const camera = new PerspectiveCamera();
    const view = new ViewController(camera, { viewGrid: grid });
    view.setViewport(800, 600);
    return { view, camera };
  };
  /** 世界の軸 e がカメラから見てどちらを向いているか（カメラ座標） */
  const inCamera = (camera: PerspectiveCamera, e: Vector3) => e.clone().applyQuaternion(camera.quaternion.clone().invert());

  it('横に引けば、画面の縦にいちばん近いキューブの軸のまわりだけで回る（少し斜めに引いても）', () => {
    const { view, camera } = makeView();
    const before = inCamera(camera, new Vector3(0, 1, 0));
    // キューブの、いちばん手前の点（キューブに付いた点）
    const front = new Vector3(0, 0, 1).applyQuaternion(camera.quaternion).multiplyScalar(H);
    const x0 = front.clone().project(camera).x;
    view.beginDrag();
    view.dragRotate(40, 25);
    for (let i = 0; i < 5; i++) view.dragRotate(13, -9);
    expect(inCamera(camera, new Vector3(0, 1, 0)).distanceTo(before)).toBeLessThan(1e-9);
    // 右へ引いたので、手前の点は右へ動いた
    expect(front.clone().project(camera).x).toBeGreaterThan(x0);
  });

  /** カメラから見て、世界の面 n がいちばん上を向いているか（カメラ座標の y） */
  const upness = (camera: PerspectiveCamera, n: Vector3) => inCamera(camera, n).y;

  it('キューブの左側を上へ引けば、左に見えている面（前）が上へ。右の面の向きは変わらない', () => {
    const { view, camera } = makeView();
    const right = inCamera(camera, new Vector3(1, 0, 0));
    const before = upness(camera, new Vector3(0, 0, 1));
    view.beginDrag(-80);
    view.dragRotate(5, -20);
    for (let i = 0; i < 5; i++) view.dragRotate(3, -10);
    expect(inCamera(camera, new Vector3(1, 0, 0)).distanceTo(right)).toBeLessThan(1e-9);
    expect(upness(camera, new Vector3(0, 0, 1))).toBeGreaterThan(before);
  });

  it('キューブの右側を上へ引けば、右に見えている面（右）が上へ。前の面の向きは変わらない', () => {
    const { view, camera } = makeView();
    const front = inCamera(camera, new Vector3(0, 0, 1));
    const before = upness(camera, new Vector3(1, 0, 0));
    view.beginDrag(80);
    view.dragRotate(-5, -20);
    for (let i = 0; i < 5; i++) view.dragRotate(-3, -10);
    expect(inCamera(camera, new Vector3(0, 0, 1)).distanceTo(front)).toBeLessThan(1e-9);
    expect(upness(camera, new Vector3(1, 0, 0))).toBeGreaterThan(before);
  });

  it('右側を下へ引けば、右の面が下へ', () => {
    const { view, camera } = makeView();
    const before = upness(camera, new Vector3(1, 0, 0));
    view.beginDrag(80);
    for (let i = 0; i < 5; i++) view.dragRotate(0, 12);
    expect(upness(camera, new Vector3(1, 0, 0))).toBeLessThan(before);
  });

  it('何度回しても、離して寄せれば 24 通りの向きにぴったり戻る（斜めの中途半端な向きにならない）', () => {
    const { view } = makeView(90);
    const rng = mulberry32(5);
    for (let k = 0; k < 30; k++) {
      view.beginDrag((rng() - 0.5) * 300);
      for (let i = 0; i < 10; i++) view.dragRotate((rng() - 0.5) * 60, (rng() - 0.5) * 60);
      view.release();
      for (let i = 0; i < 100 && view.isActive; i++) view.update(16);
      const d = view.delta;
      const nearest = Math.max(...GROUP_QUATERNIONS.map((g) => Math.abs(g.dot(d))));
      expect(nearest).toBeGreaterThan(1 - 1e-9);
    }
  });
});

describe('携帯の画面とピンチ', () => {
  const fitOf = (framing: { center: Vector3; radius: number }[], w: number, h: number) => {
    const view = new ViewController(new PerspectiveCamera(), { viewGrid: 0 }, framing);
    view.setViewport(w, h);
    return view;
  };

  it('狭い画面では鏡の像の奥側を欠けさせて、キューブを大きく（近く）写す', () => {
    const full = fitOf(framingSpheres(), 375, 520);
    const compact = fitOf(framingSpheres(true), 375, 520);
    expect(compact.distance).toBeLessThan(full.distance * 0.85);
  });

  it('ピンチでは、鏡の像が画面から消えてキューブが画面いっぱいになるまで寄れ、そのときキューブは真ん中', () => {
    const view = fitOf(framingSpheres(true), 375, 520);
    const cubeOnly = fitOf([{ center: new Vector3(), radius: (CUBE_WORLD_SIZE * Math.sqrt(3)) / 2 }], 375, 520);
    view.zoom(1e-6);
    expect(view.distance).toBeLessThan(cubeOnly.distance);
    expect(Math.abs(view.cubeScreenOffset.x)).toBeLessThan(1e-9);
    expect(Math.abs(view.cubeScreenOffset.y)).toBeLessThan(1e-9);
  });
});

describe('層の回転は最後の角度まで描く', () => {
  it('回し終えたフレームでも「書き換えた」と返す（描き直さないと数度手前で止まって見える）', () => {
    const state = createSolved(3);
    const view = new CubeView(new Scene(), state);
    const move = makeMove(3, 'x', 0b100, 1);
    expect(view.applyAnimation({ move, axis: 'x', slices: move.slices, phi: -0.2, elapsedMs: 60, durationMs: 70 })).toBe(true);
    expect(view.applyAnimation(null)).toBe(true);
    expect(view.applyAnimation(null)).toBe(false);
  });
});
