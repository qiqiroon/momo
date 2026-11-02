// キューブの描画：InstancedMesh 2 本（本体・ステッカー）（設計 03 §1・§2・§5）
import {
  BoxGeometry, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4,
  PlaneGeometry, Quaternion, Vector3, type Scene,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { sliceCubies, type CubeState } from '../core/cubeState';
import type { ActiveAnimation } from '../engine/animator';
import { ROT_MATRICES } from '../core/rotations';
import { COLOR_HEX, FACES, FACE_NORMAL } from '../core/types';
import { createBodyMaterial, createStickerMaterial } from './materials';

/** キューブ全体の一辺。N によらず一定（決定 D7） */
export const CUBE_WORLD_SIZE = 4.0;
const BODY_SCALE = 0.94;
const STICKER_SIZE = 0.82;
const STICKER_LIFT = 0.5015;
/** これより大きい N では角丸の本体を使わない（画面上で見分けられないため） */
const ROUNDED_MAX_N = 5;

/** 24 元回転群の各要素を Matrix4 にしたもの */
const ORI_MATRIX4: readonly Matrix4[] = ROT_MATRICES.map((m) =>
  new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1));

/** 体座標の各面に貼るステッカーの単位オフセット（UNIT=1 のとき） */
const FACE_LOCAL: readonly Matrix4[] = FACES.map((f) => {
  const n = new Vector3(...FACE_NORMAL[f]);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
  return new Matrix4().compose(n.multiplyScalar(STICKER_LIFT), q, new Vector3(STICKER_SIZE, STICKER_SIZE, 1));
});

export class CubeView {
  private readonly scene: Scene;
  private readonly bodyMaterial = createBodyMaterial();
  private readonly stickerMaterial = createStickerMaterial();
  private readonly stickerGeometry = new PlaneGeometry(1, 1);
  private bodyGeometry: BufferGeometry | null = null;
  private bodies: InstancedMesh | null = null;
  private stickers: InstancedMesh | null = null;
  private state: CubeState;
  /** ステッカー添字 → cubies の添字・体座標の面 */
  private stickerOwner = new Int32Array(0);
  private stickerFace = new Uint8Array(0);
  /** 小キューブ添字 → 自分のステッカー添字（最大 3） */
  private cubieStickers: number[][] = [];
  /** 確定した姿勢の行列（列優先 16 個ずつ） */
  private bodyBase = new Float32Array(0);
  private stickerBase = new Float32Array(0);
  /** 前のフレームで回転させた小キューブ */
  private animated: number[] = [];
  private readonly tmp = new Matrix4();

  constructor(scene: Scene, state: CubeState) {
    this.scene = scene;
    this.state = state;
    this.rebuild(state);
  }

  /** N が変わったとき。メッシュを作り直す */
  rebuild(state: CubeState): void {
    this.disposeMeshes();
    this.state = state;
    const { n, cubies } = state;

    this.bodyGeometry = n <= ROUNDED_MAX_N
      ? new RoundedBoxGeometry(1, 1, 1, 2, 0.12)
      : new BoxGeometry(1, 1, 1);
    this.bodies = new InstancedMesh(this.bodyGeometry, this.bodyMaterial, cubies.length);

    const owners: number[] = [];
    const faces: number[] = [];
    cubies.forEach((c, i) => c.base.forEach((col, f) => {
      if (col !== null) {
        owners.push(i);
        faces.push(f);
      }
    }));
    this.stickerOwner = Int32Array.from(owners);
    this.stickerFace = Uint8Array.from(faces);
    this.cubieStickers = cubies.map(() => []);
    owners.forEach((ci, j) => this.cubieStickers[ci].push(j));
    this.bodyBase = new Float32Array(cubies.length * 16);
    this.stickerBase = new Float32Array(owners.length * 16);
    this.animated = [];
    this.stickers = new InstancedMesh(this.stickerGeometry, this.stickerMaterial, owners.length);

    // 色はここで一度だけ書く。以後書き換えない（設計 03 §3.4・INV7）
    const colors = new Float32Array(owners.length * 3);
    const tmp = new Color();
    owners.forEach((ci, j) => {
      tmp.setHex(COLOR_HEX[cubies[ci].base[faces[j]]!]);
      tmp.toArray(colors, j * 3);
    });
    this.stickers.instanceColor = new InstancedBufferAttribute(colors, 3);

    for (const mesh of [this.bodies, this.stickers]) {
      mesh.frustumCulled = false;
      this.scene.add(mesh);
    }
    this.rebuildBaseMatrices();
  }

  /** 論理状態が変わったとき。全インスタンスの基準行列（確定した姿勢）を作り直す */
  rebuildBaseMatrices(): void {
    const { bodies, stickers, state } = this;
    if (!bodies || !stickers) return;
    const { n, cubies } = state;
    const unit = CUBE_WORLD_SIZE / n;
    const half = (n - 1) / 2;
    const base = new Matrix4();
    const m = new Matrix4();
    const scale = new Matrix4();

    const cubieBase = cubies.map((c) => {
      const b = new Matrix4().copy(ORI_MATRIX4[c.ori]);
      b.setPosition((c.pos[0] - half) * unit, (c.pos[1] - half) * unit, (c.pos[2] - half) * unit);
      return b;
    });

    scale.makeScale(unit * BODY_SCALE, unit * BODY_SCALE, unit * BODY_SCALE);
    cubieBase.forEach((b, i) => m.multiplyMatrices(b, scale).toArray(this.bodyBase, i * 16));

    scale.makeScale(unit, unit, unit);
    for (let j = 0; j < this.stickerOwner.length; j++) {
      base.multiplyMatrices(cubieBase[this.stickerOwner[j]], scale);
      m.multiplyMatrices(base, FACE_LOCAL[this.stickerFace[j]]).toArray(this.stickerBase, j * 16);
    }
    bodies.instanceMatrix.array.set(this.bodyBase);
    stickers.instanceMatrix.array.set(this.stickerBase);
    bodies.instanceMatrix.needsUpdate = true;
    stickers.instanceMatrix.needsUpdate = true;
    this.animated = [];
  }

  /**
   * 毎フレーム。回転中のスライスの小キューブとそのステッカーだけを
   * R_world(axis, phi) · M_base に書き換える（設計 03 §5.2）。phi=0 で基準行列と一致する。
   * 行列を書き換えたら true（回し終えて基準へ戻したフレームも含む。描き直さないと途中の角度のまま残る）
   */
  applyAnimation(anim: ActiveAnimation | null): boolean {
    const { bodies, stickers } = this;
    if (!bodies || !stickers) return false;
    const bodyArr = bodies.instanceMatrix.array as Float32Array;
    const stickerArr = stickers.instanceMatrix.array as Float32Array;
    if (!anim && this.animated.length === 0) return false;

    const next = anim ? sliceCubies(this.state, anim.axis, anim.slices).map((c) => c.id) : [];
    // 前のフレームで動かしたものを基準に戻す（今回も動かすものは下で上書き）
    for (const i of this.animated) this.copyBase(i, bodyArr, stickerArr, null);
    if (anim) {
      const rot = new Matrix4();
      if (anim.axis === 'x') rot.makeRotationX(anim.phi);
      else if (anim.axis === 'y') rot.makeRotationY(anim.phi);
      else rot.makeRotationZ(anim.phi);
      for (const i of next) this.copyBase(i, bodyArr, stickerArr, rot);
    }
    this.animated = next;
    bodies.instanceMatrix.needsUpdate = true;
    stickers.instanceMatrix.needsUpdate = true;
    return true;
  }

  /** 小キューブ i とそのステッカーの行列を、基準（rot があれば rot · 基準）にする */
  private copyBase(i: number, bodyArr: Float32Array, stickerArr: Float32Array, rot: Matrix4 | null): void {
    const m = this.tmp;
    const write = (src: Float32Array, dst: Float32Array, k: number) => {
      if (rot) m.fromArray(src, k * 16).premultiply(rot).toArray(dst, k * 16);
      else dst.set(src.subarray(k * 16, k * 16 + 16), k * 16);
    };
    write(this.bodyBase, bodyArr, i);
    for (const j of this.cubieStickers[i]) write(this.stickerBase, stickerArr, j);
  }

  private disposeMeshes(): void {
    for (const mesh of [this.bodies, this.stickers]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.dispose();
    }
    this.bodyGeometry?.dispose();
    this.bodies = this.stickers = null;
    this.bodyGeometry = null;
  }

  dispose(): void {
    this.disposeMeshes();
    this.bodyMaterial.dispose();
    this.stickerMaterial.dispose();
    this.stickerGeometry.dispose();
  }
}
