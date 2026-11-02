// 選んだ面のまわりの矢印とカーソル枠（設計 10 §3）。光の影響を受けない平たい形を、面の平面に並べる
// まっすぐな矢印・曲がった矢印はそれぞれ InstancedMesh 1 つ（ステッカーとは別の色のバッファ。INV10）
// 鏡には映さない（2026-11-02 作者）。鏡の絵を描く間は MirrorRoom が隠す（objects）
import {
  Color, DoubleSide, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Path, Shape, ShapeGeometry, Vector3,
  type Object3D, type Scene,
} from 'three';
import { FACE_NORMAL, type Face } from '../core/types';
import { arrowMetrics, dirFace, FACE_FRAME, type ArrowId, type ArrowLayout } from '../input/arrowActions';

/** 列矢印 4N（N=10 で 40）＋全体を転がす 4 */
const MAX_STRAIGHT = 44;
/** 面回し 2 ＋全体を面のまわりに回す 2 */
const MAX_CURVED = 4;

/** 長さ 1・幅 1、+Y 向きの矢印（中心が原点） */
function straightShape(): Shape {
  const s = new Shape();
  const shaft = 0.21;
  s.moveTo(-shaft, -0.5);
  s.lineTo(shaft, -0.5);
  s.lineTo(shaft, 0.02);
  s.lineTo(0.5, 0.02);
  s.lineTo(0, 0.5);
  s.lineTo(-0.5, 0.02);
  s.lineTo(-shaft, 0.02);
  s.closePath();
  return s;
}

/** 直径 1 の 3/4 周の弧と矢じり。+Z から見て反時計回り（曲がった向きは x を裏返して作る） */
function curvedShape(): Shape {
  const outer = 0.5;
  const inner = 0.3;
  const mid = (outer + inner) / 2;
  const start = -0.25 * Math.PI;
  const end = start + 1.4 * Math.PI;
  const steps = 28;
  const s = new Shape();
  const at = (r: number, a: number) => [r * Math.cos(a), r * Math.sin(a)] as const;
  s.moveTo(...at(outer, start));
  for (let i = 1; i <= steps; i++) s.lineTo(...at(outer, start + ((end - start) * i) / steps));
  // 矢じり：弧の先で外と内へ張り出し、進む向きに尖らせる
  s.lineTo(...at(outer + 0.13, end));
  s.lineTo(...at(mid, end + 0.55));
  s.lineTo(...at(inner - 0.13, end));
  for (let i = steps; i >= 0; i--) s.lineTo(...at(inner, start + ((end - start) * i) / steps));
  s.closePath();
  return s;
}

/** 1 辺 1 の正方形の枠 */
function frameShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0.5, 0.5);
  s.lineTo(-0.5, 0.5);
  s.closePath();
  const hole = new Path();
  const k = 0.42;
  hole.moveTo(-k, -k);
  hole.lineTo(-k, k);
  hole.lineTo(k, k);
  hole.lineTo(k, -k);
  hole.closePath();
  s.holes.push(hole);
  return s;
}

const material = (): MeshBasicMaterial => new MeshBasicMaterial({
  color: 0xffffff, transparent: true, opacity: 0.92, side: DoubleSide, depthWrite: false,
});

const v3 = (f: Face) => new Vector3(...FACE_NORMAL[f]);

export class ArrowView {
  private readonly straight: InstancedMesh;
  private readonly curved: InstancedMesh;
  private readonly cursor: Mesh;
  /** インスタンスの並び（色を付け直すため） */
  private straightIds: ArrowId[] = [];
  private curvedIds: ArrowId[] = [];
  private readonly m = new Matrix4();
  private readonly color = new Color();

  /** 描くもの（鏡の絵を描く間は隠してもらう） */
  get objects(): Object3D[] {
    return [this.straight, this.curved, this.cursor];
  }

  constructor(scene: Scene) {
    this.straight = new InstancedMesh(new ShapeGeometry(straightShape()), material(), MAX_STRAIGHT);
    this.curved = new InstancedMesh(new ShapeGeometry(curvedShape(), 4), material(), MAX_CURVED);
    const cursorMat = material();
    cursorMat.color.set(0xffffff);
    this.cursor = new Mesh(new ShapeGeometry(frameShape()), cursorMat);
    for (const mesh of [this.straight, this.curved, this.cursor]) {
      mesh.visible = false;
      mesh.renderOrder = 5;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
  }

  /** 面 face のまわりに矢印を並べる。face が null なら隠す */
  show(face: Face | null, n: number, layouts: readonly ArrowLayout[]): void {
    this.straightIds = [];
    this.curvedIds = [];
    if (!face) {
      this.straight.visible = this.curved.visible = this.cursor.visible = false;
      return;
    }
    const metrics = arrowMetrics(n);
    const N = v3(face);
    const U = v3(FACE_FRAME[face].u);
    const V = v3(FACE_FRAME[face].v);
    for (const a of layouts) {
      const pos = N.clone().multiplyScalar(metrics.h + metrics.lift).addScaledVector(U, a.s).addScaledVector(V, a.t);
      if (a.dir) {
        // 横（X）・矢印の向き（Y）・面の外向き（Z）
        const Y = v3(dirFace(face, a.dir));
        const X = Y.clone().cross(N);
        this.m.makeBasis(X.multiplyScalar(a.width), Y.multiplyScalar(a.length), N.clone()).setPosition(pos);
        this.straight.setMatrixAt(this.straightIds.length, this.m);
        this.straightIds.push(a.id);
      } else {
        // 時計回りは、外から見て裏返した形
        const cw = (a.id.kind === 'faceTurn' || a.id.kind === 'wholeTwist') && a.id.cw;
        this.m.makeBasis(U.clone().multiplyScalar(cw ? -a.width : a.width), V.clone().multiplyScalar(a.length), N.clone())
          .setPosition(pos);
        this.curved.setMatrixAt(this.curvedIds.length, this.m);
        this.curvedIds.push(a.id);
      }
    }
    this.straight.count = this.straightIds.length;
    this.curved.count = this.curvedIds.length;
    this.straight.instanceMatrix.needsUpdate = true;
    this.curved.instanceMatrix.needsUpdate = true;
    this.straight.visible = this.curved.visible = true;
  }

  /** カーソルのマス（面の中の左から u・下から v）。null で隠す */
  showCursor(face: Face | null, n: number, cell: { u: number; v: number } | null): void {
    if (!face || !cell) {
      this.cursor.visible = false;
      return;
    }
    const metrics = arrowMetrics(n);
    const N = v3(face);
    const U = v3(FACE_FRAME[face].u);
    const V = v3(FACE_FRAME[face].v);
    const at = (k: number) => (k - (n - 1) / 2) * metrics.unit;
    const pos = N.clone().multiplyScalar(metrics.h + metrics.lift * 2)
      .addScaledVector(U, at(cell.u)).addScaledVector(V, at(cell.v));
    const size = metrics.unit * 0.96;
    this.m.makeBasis(U.multiplyScalar(size), V.multiplyScalar(size), N).setPosition(pos);
    this.cursor.matrix.copy(this.m);
    this.cursor.matrixAutoUpdate = false;
    this.cursor.matrixWorldNeedsUpdate = true;
    this.cursor.visible = true;
  }

  /** 矢印ごとの色（16 進） */
  paint(colorOf: (id: ArrowId) => number): void {
    this.straightIds.forEach((id, i) => this.straight.setColorAt(i, this.color.setHex(colorOf(id))));
    this.curvedIds.forEach((id, i) => this.curved.setColorAt(i, this.color.setHex(colorOf(id))));
    if (this.straight.instanceColor) this.straight.instanceColor.needsUpdate = true;
    if (this.curved.instanceColor) this.curved.instanceColor.needsUpdate = true;
  }
}
