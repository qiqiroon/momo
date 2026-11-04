// マーキングの描画（2026-11-04 作者の指示）。印を付けたセルを薄い半透明の白で囲み、付けた順の番号を上に出す
// 印は小キューブのステッカーに付いているので、回している途中も一緒に動かす。
// 番号の札は鏡に映さない（映ると字が裏返る）。囲みは映す
import {
  CanvasTexture, DoubleSide, Group, Matrix4, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, Sprite,
  SpriteMaterial, Vector3, type Object3D, type Scene,
} from 'three';
import type { CubeState } from '../core/cubeState';
import { ROT_MATRICES } from '../core/rotations';
import { AXIS_INDEX, FACES, FACE_NORMAL } from '../core/types';
import type { ActiveAnimation } from '../engine/animator';
import type { Mark } from '../ui/marks';
import { CUBE_WORLD_SIZE } from './cubeView';

/** 囲みの内側・外側の半分の幅（セル 1 つ分を 1 として。ステッカーは 0.41） */
const RING_INNER = 0.40;
const RING_OUTER = 0.5;
/** ステッカー（0.5015）より少しだけ浮かせる */
const RING_LIFT = 0.506;
const RING_OPACITY = 0.7;
/**
 * 番号の札をセルの面からどれだけ浮かせるか・大きさ（セル 1 つ分を 1 として）。
 * 斜めから見てもセルの上に重なるよう、ほとんど浮かせない。そのかわり奥行きでは隠さず、
 * セルの面がこちらを向いているときだけ出す（facing）
 */
const LABEL_LIFT = 0.04;
const LABEL_SIZE = 0.8;
/** 大きいキューブでも読める、番号の札の最小の大きさ（キューブの一辺 4 に対して） */
const LABEL_MIN = 0.42;

const ORI_MATRIX4: readonly Matrix4[] = ROT_MATRICES.map((m) =>
  new Matrix4().set(m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, 0, 0, 0, 1));

/** 体座標の各面に置く囲みの行列（セル 1 つ分 = 1） */
const RING_LOCAL: readonly Matrix4[] = FACES.map((f) => {
  const nv = new Vector3(...FACE_NORMAL[f]);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), nv);
  return new Matrix4().compose(nv.multiplyScalar(RING_LIFT), q, new Vector3(1, 1, 1));
});

export class MarkView {
  private readonly group = new Group();
  private readonly labelGroup = new Group();
  private readonly ringGeometry = new RingGeometry(RING_INNER * Math.SQRT2, RING_OUTER * Math.SQRT2, 4, 1, Math.PI / 4);
  private readonly ringMaterial = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: RING_OPACITY, depthWrite: false, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  private readonly rings: Mesh[] = [];
  private readonly labels: Sprite[] = [];
  private readonly textures = new Map<number, CanvasTexture>();
  private readonly tmp = new Matrix4();
  private readonly rot = new Matrix4();
  private readonly v = new Vector3();
  /** 札ごとの、セルの面の外向きの向き（世界座標） */
  private readonly normals: Vector3[] = [];
  private count = 0;
  /** 前のフレームで回転の途中だった（回し終えた次のフレームも描き直す） */
  private wasAnimating = false;
  private dirty = true;

  constructor(scene: Scene) {
    this.group.renderOrder = 5;
    this.labelGroup.renderOrder = 6;
    scene.add(this.group, this.labelGroup);
  }

  /** 鏡に映さないもの（番号の札） */
  get notReflected(): Object3D[] {
    return [this.labelGroup];
  }

  /** 印が変わった・キューブが作り直された */
  invalidate(): void {
    this.dirty = true;
  }

  /** 毎フレーム。描き直しが要るときだけ書き換えて true */
  update(state: CubeState, marks: readonly Mark[], anim: ActiveAnimation | null): boolean {
    const moving = anim !== null && marks.length > 0;
    if (!this.dirty && !moving && !this.wasAnimating) return false;
    this.dirty = false;
    this.wasAnimating = moving;
    this.ensure(marks.length);

    const n = state.n;
    const unit = CUBE_WORLD_SIZE / n;
    const half = (n - 1) / 2;
    const labelSize = Math.max(unit * LABEL_SIZE, LABEL_MIN);
    if (anim) {
      if (anim.axis === 'x') this.rot.makeRotationX(anim.phi);
      else if (anim.axis === 'y') this.rot.makeRotationY(anim.phi);
      else this.rot.makeRotationZ(anim.phi);
    }
    marks.forEach((mark, i) => {
      const ring = this.rings[i];
      const label = this.labels[i];
      const c = state.cubies[mark.cubie];
      if (!c) {
        ring.visible = label.visible = false;
        return;
      }
      ring.visible = label.visible = true;
      const turning = anim !== null && (anim.slices & (1 << c.pos[AXIS_INDEX[anim.axis]])) !== 0;
      // 小キューブの行列（向き → 拡大 → 位置）。回している途中なら、その層の回転を左から掛ける
      const base = this.tmp.copy(ORI_MATRIX4[c.ori]);
      base.setPosition((c.pos[0] - half) * unit, (c.pos[1] - half) * unit, (c.pos[2] - half) * unit);
      if (turning) base.premultiply(this.rot);
      ring.matrix.multiplyMatrices(base, new Matrix4().makeScale(unit, unit, unit)).multiply(RING_LOCAL[mark.body]);
      ring.matrixWorldNeedsUpdate = true;
      // 番号の札：セルの真ん中から、外へ少し浮かせた所
      const nv = FACE_NORMAL[FACES[mark.body]];
      this.v.set(nv[0], nv[1], nv[2]).multiplyScalar((0.5 + LABEL_LIFT) * unit).applyMatrix4(base);
      label.position.copy(this.v);
      this.normals[i].set(nv[0], nv[1], nv[2]).transformDirection(base);
      label.scale.set(labelSize, labelSize, 1);
    });
    for (let i = marks.length; i < this.rings.length; i++) this.rings[i].visible = this.labels[i].visible = false;
    this.count = marks.length;
    return true;
  }

  /** 描く直前に。セルの面がカメラのほうを向いている札だけを出す（裏の面の番号が透けて見えないように） */
  facing(cameraPosition: Vector3): void {
    for (let i = 0; i < this.count; i++) {
      const label = this.labels[i];
      if (!this.rings[i].visible) continue;
      this.v.copy(cameraPosition).sub(label.position);
      label.visible = this.v.dot(this.normals[i]) > 0.1 * this.v.length();
    }
  }

  /** 印の数だけ、囲みと札を用意する（足りない分だけ作る） */
  private ensure(count: number): void {
    while (this.rings.length < count) {
      const ring = new Mesh(this.ringGeometry, this.ringMaterial);
      ring.matrixAutoUpdate = false;
      ring.renderOrder = 5;
      ring.frustumCulled = false;
      this.group.add(ring);
      this.rings.push(ring);
      // 札 i はいつも番号 i + 1（印は番号の大きいほうから消すので、札と番号は入れ替わらない）
      const label = new Sprite(new SpriteMaterial({
        map: this.texture(this.labels.length + 1), transparent: true, depthWrite: false, depthTest: false,
      }));
      label.renderOrder = 6;
      this.labelGroup.add(label);
      this.labels.push(label);
      this.normals.push(new Vector3());
    }
  }

  /** 番号の絵（白い字に黒い縁。下の色が見えるよう、地は透明） */
  private texture(k: number): CanvasTexture {
    const cached = this.textures.get(k);
    if (cached) return cached;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const text = String(k);
    g.font = `700 ${text.length > 1 ? 78 : 100}px 'Noto Sans JP', system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    g.strokeText(text, size / 2, size / 2 + 4);
    g.fillStyle = '#ffffff';
    g.fillText(text, size / 2, size / 2 + 4);
    const t = new CanvasTexture(canvas);
    this.textures.set(k, t);
    return t;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.labelGroup.removeFromParent();
    this.ringGeometry.dispose();
    this.ringMaterial.dispose();
    for (const l of this.labels) l.material.dispose();
    for (const t of this.textures.values()) t.dispose();
  }
}
