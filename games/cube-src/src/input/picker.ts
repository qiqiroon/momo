// 画面の点 → 掴んだステッカー（設計 04 §3.1）
// 描いた形ではなくキューブ全体の箱に視線を当てる（stickerOnRay）。色の境目・小キューブの隙間・角丸の縁も、
// 見えている面のその位置として掴める。
// 鏡に映った面は掴まない（2026-11-02 作者：鏡はクリックやドラッグに反応しない）。鏡の上は背景と同じ扱い
import { Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { CubeState } from '../core/cubeState';
import { FACES, FACE_NORMAL, type Face, type Move, type Vec3 } from '../core/types';
import { CUBE_WORLD_SIZE } from '../render/cubeView';
import {
  chooseDirection, pushAxis, pushToMove, sliceIndexOf, stickerOnRay, type PushWidth, type Vec2,
} from './dragToMove';

export interface StickerHit {
  /** cubies の添字 */
  readonly cubie: number;
  /** 掴んだ面（世界の面）。論理状態から求める（描画の途中の角度に左右されない） */
  readonly face: Face;
}

export class Picker {
  private readonly raycaster = new Raycaster();
  private readonly camera: PerspectiveCamera;
  private readonly getState: () => CubeState;
  private readonly canvas: HTMLElement;

  constructor(canvas: HTMLElement, camera: PerspectiveCamera, getState: () => CubeState) {
    this.canvas = canvas;
    this.camera = camera;
    this.getState = getState;
  }

  /** 画面の点（clientX/Y）で掴めるステッカー。無ければ null（背景・鏡） */
  pick(clientX: number, clientY: number): StickerHit | null {
    const { o, r } = this.ray(clientX, clientY);
    return stickerOnRay(this.getState(), CUBE_WORLD_SIZE, o, r);
  }

  /** 画面の点を通る視線（矢印の当たり判定用。10 §6.3）。鏡に映った矢印は押せない */
  rays(clientX: number, clientY: number): { o: Vec3; r: Vec3 }[] {
    return [this.ray(clientX, clientY)];
  }

  private ray(clientX: number, clientY: number): { o: Vec3; r: Vec3 } {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const { origin, direction } = this.raycaster.ray;
    return { o: origin.toArray(), r: direction.toArray() };
  }

  /**
   * 掴んだステッカーを、画面上で (dx, dy) px 押したときの回転。押した向きが面の中のどの向きとも
   * 合わない（面に垂直に押し込んだ）ときは null
   */
  pushFor(hit: StickerHit, dx: number, dy: number, width: PushWidth): { move: Move; about: Face } | null {
    const state = this.getState();
    const n = state.n;
    const c = state.cubies[hit.cubie];
    const unit = CUBE_WORLD_SIZE / n;
    const half = (n - 1) / 2;
    const nv = FACE_NORMAL[hit.face];
    // 掴んだステッカーの中心（論理の位置から求める）
    const point: Vec3 = [
      (c.pos[0] - half) * unit + (nv[0] * unit) / 2,
      (c.pos[1] - half) * unit + (nv[1] * unit) / 2,
      (c.pos[2] - half) * unit + (nv[2] * unit) / 2,
    ];
    const dir = chooseDirection(hit.face, point, unit, { x: dx, y: dy }, (p) => this.toScreen(p));
    if (!dir) return null;
    const { axis, sign } = pushAxis(hit.face, dir);
    const move = pushToMove(n, hit.face, dir, sliceIndexOf(c.pos, axis), width);
    // 全体を回すとき（Ctrl）の向き：回転軸 a の向きの面のまわりに +90°
    const about = FACES.find((f) => FACE_NORMAL[f][['x', 'y', 'z'].indexOf(axis)] === sign)!;
    return { move, about };
  }

  /** 3D の点 → 画面の px（canvas の左上が原点、下向きが正） */
  private toScreen(p: Vec3): Vec2 {
    const v = new Vector3(...p).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height };
  }
}
