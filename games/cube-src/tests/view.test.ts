import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createSolved, snapshot } from '../src/core/cubeState';
import { FACES } from '../src/core/types';
import {
  BALL_RADIUS, ViewController, ballPoint, homeQuaternion, rollAxis, snapDelta,
  type ViewSettings,
} from '../src/input/viewController';
import {
  GROUP_QUATERNIONS, HOME_FRAME, toScreenFace, toWorldFace, viewFrameOf,
} from '../src/input/viewFrame';
import { mulberry32 } from './helpers';

const randomQuaternion = (rng: () => number): Quaternion =>
  new Quaternion(rng() - 0.5, rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();

const makeView = (grid: ViewSettings['viewGrid'] = 0) => {
  const settings: ViewSettings = { viewGrid: grid };
  const view = new ViewController(new PerspectiveCamera(), settings);
  view.setViewport(800, 600);
  return { view, settings };
};

const finish = (view: ViewController) => {
  for (let i = 0; i < 100 && view.isActive; i++) view.update(16);
};

const yAxisAngle = (deg: number) =>
  new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (deg * Math.PI) / 180);

describe('ホームの向き（03 §4.6）', () => {
  it('カメラは U・F・R の側（x・y・z がすべて正）から原点を見る', () => {
    const { view } = makeView();
    const cam = new PerspectiveCamera();
    const v = new ViewController(cam, { viewGrid: 0 });
    v.setViewport(800, 600);
    expect(cam.position.x).toBeGreaterThan(0);
    expect(cam.position.y).toBeGreaterThan(0);
    expect(cam.position.z).toBeGreaterThan(0);
    const forward = new Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    expect(forward.dot(cam.position.clone().normalize())).toBeCloseTo(-1, 9);
    expect(Math.abs(view.delta.w)).toBeCloseTo(1, 12);
  });
});

describe('画面基準の面（04 §5.4）', () => {
  it('I6: ホームでは toWorldFace・toScreenFace が恒等', () => {
    for (const f of FACES) {
      expect(toWorldFace(f, HOME_FRAME)).toBe(f);
      expect(toScreenFace(f, HOME_FRAME)).toBe(f);
    }
  });

  it('toWorldFace と toScreenFace は 24 通りすべてで互いの逆', () => {
    for (let ori = 0; ori < 24; ori++) {
      for (const f of FACES) expect(toScreenFace(toWorldFace(f, { ori }), { ori })).toBe(f);
    }
  });

  it('I7（視点の部分）: ホームから y（上の面の向きへ 90°）のあと、画面の右は世界の奥の面', () => {
    const { view } = makeView();
    view.command({ kind: 'rotate', about: 'U', quarter: -1 });
    expect(toWorldFace('R', view.frame)).toBe('B');
    expect(toWorldFace('U', view.frame)).toBe('U');
    expect(toWorldFace('F', view.frame)).toBe('R');
  });

  it('I10: 45° の前後 ±5° を往復させても、選ばれる向きが入れ替わり続けない', () => {
    let frame = viewFrameOf(yAxisAngle(0), null);
    const start = frame.ori;
    for (let i = 0; i < 20; i++) {
      frame = viewFrameOf(yAxisAngle(i % 2 === 0 ? 50 : 40), frame);
      expect(frame.ori).toBe(start);
    }
    // 十分に越えれば切り替わり、戻るときも同じ幅だけ粘る
    frame = viewFrameOf(yAxisAngle(56), frame);
    const turned = frame.ori;
    expect(turned).not.toBe(start);
    frame = viewFrameOf(yAxisAngle(40), frame);
    expect(frame.ori).toBe(turned);
    frame = viewFrameOf(yAxisAngle(34), frame);
    expect(frame.ori).toBe(start);
  });
});

describe('グリッド（04 §4.3）', () => {
  it('I8: 任意の Δ を 90° で寄せると 24 通りの向きのどれかに一致する', () => {
    const rng = mulberry32(8);
    for (let i = 0; i < 500; i++) {
      const s = snapDelta(randomQuaternion(rng), 90);
      const best = Math.max(...GROUP_QUATERNIONS.map((g) => Math.abs(g.dot(s))));
      expect(best).toBeGreaterThan(0.9999);
    }
  });

  it('15°・45° で寄せた向きは、その刻みの倍数のオイラー角になる', () => {
    const rng = mulberry32(9);
    for (const grid of [15, 45] as const) {
      for (let i = 0; i < 100; i++) {
        const s = snapDelta(randomQuaternion(rng), grid);
        expect(Math.abs(snapDelta(s, grid).dot(s))).toBeGreaterThan(0.999999);
      }
    }
  });

  it('離したとき 90° のグリッドに寄る', () => {
    const { view } = makeView(90);
    view.freeRotate(10, 20, 37, -15);
    view.release();
    finish(view);
    const d = view.delta;
    expect(Math.max(...GROUP_QUATERNIONS.map((g) => Math.abs(g.dot(d))))).toBeGreaterThan(0.999999);
  });

  it('グリッドなしでは離した位置で止まる', () => {
    const { view } = makeView(0);
    view.freeRotate(10, 20, 37, -15);
    const before = view.delta.clone();
    view.release();
    expect(view.isActive).toBe(false);
    expect(Math.abs(view.delta.dot(before))).toBeCloseTo(1, 12);
  });
});

describe('ホームと視点コマンド（04 §4.4・§4.5）', () => {
  it('I9: どう回したあとでも home の完了後に Δ が恒等（誤差 1e-6）', () => {
    const rng = mulberry32(19);
    const { view } = makeView();
    for (let i = 0; i < 50; i++) view.freeRotate((rng() - 0.5) * 800, (rng() - 0.5) * 600, (rng() - 0.5) * 80, (rng() - 0.5) * 80);
    view.command({ kind: 'rotate', about: 'F', quarter: 2 });
    view.command({ kind: 'home' });
    finish(view);
    expect(view.isActive).toBe(false);
    expect(1 - Math.abs(view.delta.w)).toBeLessThan(1e-6);
  });

  it('home は距離（ズーム）を変えない', () => {
    const { view } = makeView();
    view.zoom(1.5);
    const d = view.distance;
    view.freeRotate(0, 0, 50, 0);
    view.command({ kind: 'home' });
    finish(view);
    expect(view.distance).toBeCloseTo(d, 12);
  });

  it('視点アニメーション中の次のコマンドは目標に重ねて合成される', () => {
    const { view } = makeView();
    view.command({ kind: 'rotate', about: 'U', quarter: -1 });
    view.update(30);
    view.command({ kind: 'rotate', about: 'U', quarter: -1 });
    finish(view);
    expect(toWorldFace('F', view.frame)).toBe('B');
  });

  it('ズームは範囲に収まる', () => {
    const { view } = makeView();
    const fit = view.distance;
    view.zoom(100);
    expect(view.distance).toBeCloseTo(fit * 2.2, 9);
    view.zoom(1e-6);
    expect(view.distance).toBeCloseTo(fit * 0.75, 9);
  });

  it('I11: 視点の操作は CubeState を変えない', () => {
    const state = createSolved(4);
    const before = snapshot(state);
    const { view } = makeView(90);
    view.freeRotate(5, 5, 30, 30);
    view.release();
    view.command({ kind: 'rotate', about: 'R', quarter: 1 });
    view.command({ kind: 'home' });
    finish(view);
    expect(snapshot(state)).toEqual(before);
  });
});

describe('自由回転：見えない球を押して転がす（04 §4.2）', () => {
  const rho = BALL_RADIUS;
  const axisOf = (x: number, y: number, dx: number, dy: number) => rollAxis(ballPoint(x, y, rho), dx, dy)!;
  const expectDir = (v: Vector3, x: number, y: number, z: number) => {
    const e = new Vector3(x, y, z).normalize();
    expect(v.x).toBeCloseTo(e.x, 9);
    expect(v.y).toBeCloseTo(e.y, 9);
    expect(v.z).toBeCloseTo(e.z, 9);
  };

  it('I12: 照合表の 5 件', () => {
    const c = 1;
    const z = Math.sqrt(rho * rho - c * c);
    // 重心を通って右へ → 画面の上向きが軸（水平に回る）
    expectDir(axisOf(0, 0, 10, 0), 0, 1, 0);
    // 重心より下を通って右へ → 上向きが手前へ傾く
    expectDir(axisOf(0, -c, 10, 0), 0, z, c);
    // 重心より上を通って右へ → 上向きが奥へ傾く
    expectDir(axisOf(0, c, 10, 0), 0, z, -c);
    // 重心を通って上へ（画面の y は下向きが正なので dy < 0）
    expectDir(axisOf(0, 0, 0, -10), -1, 0, 0);
    // 球の外、右側を上へ → 手前向きが軸（ハンドルの動き）
    expectDir(axisOf(rho * 1.5, 0, 0, -10), 0, 0, 1);
  });

  it('I13: 球の内側から外側へまたいでも、点と軸が飛ばない', () => {
    for (const ang of [0, 0.7, 2.1, 4]) {
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      // 縁では高さが √ で立ち上がるので、十分近くで比べる（1e-10 内側で高さ約 3e-5）
      const inside = ballPoint(ux * (rho - 1e-10), uy * (rho - 1e-10), rho);
      const outside = ballPoint(ux * (rho + 1e-10), uy * (rho + 1e-10), rho);
      expect(inside.distanceTo(outside)).toBeLessThan(1e-3);
      const a = rollAxis(inside, -uy, ux)!;
      const b = rollAxis(outside, -uy, ux)!;
      expect(a.angleTo(b)).toBeLessThan(1e-3);
    }
  });

  it('右へ払うと、正面にあった面が右へ動く（指の向きに回る）', () => {
    const { view } = makeView();
    view.freeRotate(0, 0, 40, 0);
    // カメラは左へ回り込む＝キューブは右へ回る
    const cam = homeQuaternion();
    const homeX = new Vector3(0, 0, 1).applyQuaternion(cam).x;
    const delta = view.delta;
    const front = new Vector3(0, 0, 1).applyQuaternion(delta);
    const viewRight = new Vector3(1, 0, 0).applyQuaternion(cam);
    expect(front.dot(viewRight)).toBeGreaterThan(new Vector3(0, 0, 1).dot(viewRight));
    expect(homeX).toBeGreaterThan(0);
  });
});
