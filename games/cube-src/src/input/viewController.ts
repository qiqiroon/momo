// 全体の回転（視点）：自由回転・グリッド・視点コマンド・ホーム・ズーム（設計 04 §4）
// キューブは動かさず、カメラが原点のまわりを回る。論理状態・手数には触れない（決定 D12）
import { Euler, Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { FACE_NORMAL, type Face } from '../core/types';
import { CUBE_WORLD_SIZE } from '../render/cubeView';
import { easeInOutQuad } from '../util/easing';
import { GROUP_QUATERNIONS, nearestOri, viewFrameOf, type ViewFrame } from './viewFrame';

export type ViewCommand =
  | { kind: 'rotate'; about: Face; quarter: -2 | -1 | 1 | 2 }
  | { kind: 'home' }
  | { kind: 'snap' };

export type ViewGrid = 0 | 15 | 45 | 90;

export interface ViewSettings {
  viewGrid: ViewGrid;
  /** 離したあと勢いで回り続ける（05 §5。既定オフ） */
  viewInertia?: boolean;
  /** 層の 90° の時間（ms）。全体回転のキーもこれにそろえる */
  quarterMs?: number;
}

export const CAMERA_FOV = 38;
/** 見えない球の半径＝キューブの外接球 */
export const BALL_RADIUS = (CUBE_WORLD_SIZE * Math.sqrt(3)) / 2;
const FIT_MARGIN = 1.12;
/** 近づける限度：キューブだけが画面に収まる距離に対する割合（鏡の像は画面の外へ出て消える） */
const ZOOM_MIN = 0.75;
const ZOOM_MAX = 2.2;
const DRAG_GAIN = 1.1;
const HOME_MS = 400;
const SNAP_MS = 150;
/** 全体回転のキー（x・y・z）も層の回転と同じ速さにそろえる（02 §3.5 の全体回転 ×1.2） */
const WHOLE_FACTOR = 1.2;
const DEFAULT_QUARTER_MS = 70;
/** 慣性：離す直前この時間より古い動きは勢いに数えない（ms）・勢いが半分になる時間・止まったとみなす角速度（rad/ms） */
const INERTIA_WINDOW_MS = 80;
const INERTIA_HALF_MS = 350;
const INERTIA_MIN = 0.00005;

/** ホームの向き：方位 35°（+Z から +X へ）・極角 58°（+Y から）から原点を見る。U・F・R が見える */
export function homeQuaternion(): Quaternion {
  const az = (35 * Math.PI) / 180;
  const pol = (58 * Math.PI) / 180;
  const eye = new Vector3(Math.sin(pol) * Math.sin(az), Math.cos(pol), Math.sin(pol) * Math.cos(az));
  const m = new Matrix4().lookAt(eye, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  return new Quaternion().setFromRotationMatrix(m);
}

/**
 * 指の位置 → 見えない球の表面の点（カメラ座標。原点＝重心、x 右・y 上・z 手前）。
 * 球の内側は手前側の表面へ持ち上げ、外側は球の縁（画面と平行な大円）に置く
 */
export function ballPoint(x: number, y: number, rho: number): Vector3 {
  const r2 = x * x + y * y;
  if (r2 < rho * rho) return new Vector3(x, y, Math.sqrt(rho * rho - r2));
  const k = rho / Math.sqrt(r2);
  return new Vector3(x * k, y * k, 0);
}

/**
 * 球の表面の点 p を、画面上の移動 (dx, dy)（px。下向きが正）の向きへ転がす回転軸（カメラ座標）。
 * 動かない（軸が決まらない）ときは null
 */
export function rollAxis(p: Vector3, dx: number, dy: number): Vector3 | null {
  const axis = new Vector3().crossVectors(p, new Vector3(dx, -dy, 0));
  return axis.lengthSq() < 1e-12 ? null : axis.normalize();
}

/** Δ を格子に寄せる。90 は 24 通りの向き、15・45 は Y→X→Z のオイラー角を刻みに丸める */
export function snapDelta(delta: Quaternion, grid: 15 | 45 | 90): Quaternion {
  if (grid === 90) return GROUP_QUATERNIONS[nearestOri(delta)].clone();
  const step = (grid * Math.PI) / 180;
  const e = new Euler().setFromQuaternion(delta, 'YXZ');
  const round = (a: number) => Math.round(a / step) * step;
  return new Quaternion().setFromEuler(new Euler(round(e.x), round(e.y), round(e.z), 'YXZ'));
}

interface ViewAnimation {
  from: Quaternion;
  elapsed: number;
  duration: number;
}

export class ViewController {
  private readonly camera: PerspectiveCamera;
  private readonly settings: ViewSettings;
  private readonly home = homeQuaternion();
  /** カメラの向き（カメラ座標 → 世界座標） */
  private readonly c: Quaternion;
  /** 視点アニメーションの到達先。止まっているときは c と同じ */
  private readonly target: Quaternion;
  private anim: ViewAnimation | null = null;
  /** 慣性の回転（カメラ座標の軸と、角速度 rad/ms） */
  private spin: { axis: Vector3; w: number } | null = null;
  /** 直近のドラッグの動き（慣性の勢いを求める） */
  private lastDrag: { axis: Vector3; angle: number; at: number; dt: number } | null = null;
  /** 横回し・縦回しのドラッグで回すキューブの軸（世界座標）。ドラッグの最初に決める */
  private dragAxis: { horizontal: boolean; world: Vector3 } | null = null;
  private dragStartX = 0;
  private readonly now: () => number;
  private zoomScale = 1;
  private fitDistance = 12;
  /** キューブだけが収まる距離（ピンチで近づける限度と、そこへ近づくほど中央に寄せるのに使う） */
  private cubeFitDistance = 12;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private viewportMin = 1;
  private lastFrame: ViewFrame | null = null;
  /** 写したい球（カメラ座標） */
  private framing: { q: Vector3; radius: number }[];
  /** 写したい範囲を画面の中央に寄せるための、描く窓のずらし（px） */
  private offsetPx = { x: 0, y: 0 };

  /**
   * framing：画面に収めたい球（ホームのときの世界座標）。既定はキューブだけ。
   * 鏡を置くときは、鏡に映る像も入れる
   */
  constructor(
    camera: PerspectiveCamera,
    settings: ViewSettings,
    framing: { center: Vector3; radius: number }[] = [{ center: new Vector3(), radius: BALL_RADIUS }],
    now: () => number = () => performance.now(),
  ) {
    this.camera = camera;
    this.settings = settings;
    this.now = now;
    camera.fov = CAMERA_FOV;
    this.framing = this.toCameraFraming(framing);
    this.c = this.home.clone();
    this.target = this.home.clone();
    this.applyCamera();
  }

  /** Δ = C_home · C⁻¹（見た目の回り具合。ホームで恒等） */
  get delta(): Quaternion {
    return this.home.clone().multiply(this.c.clone().invert());
  }

  get targetDelta(): Quaternion {
    return this.home.clone().multiply(this.target.clone().invert());
  }

  /** キーの面の解決に使う 24 通りの向き（目標の向きで決める） */
  get frame(): ViewFrame {
    this.lastFrame = viewFrameOf(this.targetDelta, this.lastFrame);
    return this.lastFrame;
  }

  get isActive(): boolean {
    return this.anim !== null || this.spin !== null;
  }

  /** 画面に収めたい球を変える（鏡を消したとき、キューブだけを大きく写す） */
  setFraming(framing: { center: Vector3; radius: number }[]): void {
    this.framing = this.toCameraFraming(framing);
    this.setViewport(this.viewportWidth, this.viewportHeight);
  }

  private toCameraFraming(framing: { center: Vector3; radius: number }[]): { q: Vector3; radius: number }[] {
    const toCamera = this.home.clone().invert();
    return framing.map((s) => ({ q: s.center.clone().applyQuaternion(toCamera), radius: s.radius }));
  }

  get distance(): number {
    return this.fitDistance * this.zoomScale;
  }

  /** 近づける限度（zoomScale）。鏡の像が消えて、キューブが画面からはみ出す手前まで寄れる */
  private get zoomMin(): number {
    return Math.min(ZOOM_MIN, (this.cubeFitDistance * ZOOM_MIN) / this.fitDistance);
  }

  /** キューブの重心が写る位置の、画面中央からのずれ（px、下向きが正）。ドラッグの見えない球の中心 */
  get cubeScreenOffset(): { x: number; y: number } {
    return { x: -this.offsetPx.x, y: -this.offsetPx.y };
  }

  /** ビューポートの大きさが変わったとき。写したい球がすべて収まる距離を求め直す */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.viewportMin = Math.min(width, height);
    this.fitDistance = this.fitFor(this.framing);
    this.cubeFitDistance = this.fitFor([{ q: new Vector3(), radius: BALL_RADIUS }]);
    this.zoomScale = Math.max(this.zoomScale, this.zoomMin);
    this.camera.aspect = width / height;
    this.applyCamera();
  }

  /** 球がすべて収まるいちばん近い距離。距離を延ばすほど写る範囲は小さくなるので二分法で探す */
  private fitFor(framing: { q: Vector3; radius: number }[]): number {
    const tanV = Math.tan((CAMERA_FOV * Math.PI) / 360);
    const tanH = tanV * (this.viewportWidth / this.viewportHeight);
    const fits = (d: number) => {
      const b = this.bounds(d, framing);
      return b !== null && (b.maxX - b.minX) / 2 <= tanH / FIT_MARGIN && (b.maxY - b.minY) / 2 <= tanV / FIT_MARGIN;
    };
    let lo = 1;
    let hi = 1000;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  /**
   * カメラ距離 d のとき、写したい球の画面上の広がり（tan の単位。カメラ座標の x 右・y 上）。
   * 部屋（鏡）は画面に固定なので、カメラ座標での球の位置は回しても変わらない
   */
  private bounds(d: number, framing = this.framing): { minX: number; maxX: number; minY: number; maxY: number } | null {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const { q, radius } of framing) {
      const depth = d - q.z;
      if (depth <= radius) return null;
      const x = q.x / depth;
      const y = q.y / depth;
      const r = radius / Math.sqrt(depth * depth - radius * radius);
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minY = Math.min(minY, y - r);
      maxY = Math.max(maxY, y + r);
    }
    return { minX, maxX, minY, maxY };
  }

  /**
   * ドラッグ 1 回分の自由回転（設計 04 §4.2）。
   * (x, y) は指の今の位置（ビューポートの中心からの px、下向きが正）、(dx, dy) は今回の移動
   */
  freeRotate(x: number, y: number, dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    this.anim = null;
    this.spin = null;
    const s = (2 * this.distance * Math.tan((CAMERA_FOV * Math.PI) / 360)) / this.viewportHeight;
    const p = ballPoint((x - dx / 2) * s, -(y - dy / 2) * s, BALL_RADIUS);
    const axis = rollAxis(p, dx, dy);
    if (!axis) return;
    const angle = (Math.hypot(dx, dy) * 2 * Math.PI * DRAG_GAIN) / this.viewportMin;
    this.c.multiply(new Quaternion().setFromAxisAngle(axis, -angle)).normalize();
    this.target.copy(this.c);
    const at = this.now();
    this.lastDrag = { axis, angle, at, dt: this.lastDrag ? Math.max(1, at - this.lastDrag.at) : 16 };
    this.applyCamera();
  }

  /**
   * ドラッグの始まり。横回しか縦回しかは、最初に動いた向きで決め直す。
   * x：始めた位置の、キューブの重心が写る位置からの横のずれ（px、右が正）。縦回しでどちらの面を上へ送るかに使う
   */
  beginDrag(x = 0): void {
    this.dragAxis = null;
    this.dragStartX = x;
  }

  /**
   * ドラッグ 1 回分の全体の回転を、横回しか縦回しに寄せる（2026-11-02 作者：斜めの中途半端な回転を避ける）。
   * 最初に動いた向きが横なら、画面の縦にいちばん近いキューブの軸のまわり（横回し）。
   * 縦なら縦回し：キューブの左側で始めたら左に見えている側面を、右側で始めたら右に見えている側面を
   * 上（下へ引いたら下）へ送る（2026-11-02 作者：右側を上へ引いたら右の面が上に来る）。
   * そのドラッグの間は軸を変えず、指の動きのうちその向きの成分だけで回す。
   * キューブの軸のまわりなので、離して寄せると 24 通りの向きにぴったり戻る
   */
  dragRotate(dx: number, dy: number): void {
    if (!this.dragAxis) {
      if (dx === 0 && dy === 0) return;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const up = this.nearestCubeAxis(new Vector3(0, 1, 0));
      this.dragAxis = { horizontal, world: horizontal ? up : this.sideFace(up).cross(up) };
    }
    const amount = this.dragAxis.horizontal ? dx : -dy;
    if (amount === 0) return;
    this.anim = null;
    this.spin = null;
    // カメラ座標での軸。横回しは画面の縦の軸のまわりで、右へ引くと手前が右へ動く向き。
    // 縦回しは 側面 × 上 のまわりで、上へ引くと側面が上へ動く向き（+θ は側面を上へ送る）
    const axis = this.dragAxis.world.clone().applyQuaternion(this.c.clone().invert()).multiplyScalar(Math.sign(amount));
    const angle = (Math.abs(amount) * 2 * Math.PI * DRAG_GAIN) / this.viewportMin;
    this.c.multiply(new Quaternion().setFromAxisAngle(axis, -angle)).normalize();
    this.target.copy(this.c);
    const at = this.now();
    this.lastDrag = { axis, angle, at, dt: this.lastDrag ? Math.max(1, at - this.lastDrag.at) : 16 };
    this.applyCamera();
  }

  /**
   * 縦回しで上へ送る側面（世界座標の単位ベクトル）：上の軸に垂直な 4 面のうち、カメラの方を向いているもので、
   * ドラッグを始めた側（左・右）にいちばん寄って見えるもの
   */
  private sideFace(up: Vector3): Vector3 {
    const toCamera = this.c.clone().invert();
    const side = this.dragStartX >= 0 ? 1 : -1;
    let best: Vector3 | null = null;
    let bestX = -Infinity;
    for (const e of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      if (Math.abs(e.dot(up)) > 0.5) continue;
      for (const f of [e.clone(), e.clone().negate()]) {
        const v = f.clone().applyQuaternion(toCamera);
        if (v.z <= 1e-6) continue;
        if (side * v.x > bestX) {
          bestX = side * v.x;
          best = f;
        }
      }
    }
    // 真正面から見ているなどで決まらなければ、手前の面
    return best ?? this.nearestCubeAxis(new Vector3(0, 0, 1));
  }

  /** 画面の向き screen（カメラ座標）にいちばん近いキューブの軸（世界座標。screen と同じ側を向ける） */
  private nearestCubeAxis(screen: Vector3): Vector3 {
    const toCamera = this.c.clone().invert();
    let best = new Vector3(1, 0, 0);
    let bestDot = 0;
    for (const e of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      const d = e.clone().applyQuaternion(toCamera).dot(screen);
      if (Math.abs(d) > Math.abs(bestDot)) {
        bestDot = d;
        best = e;
      }
    }
    return best.multiplyScalar(Math.sign(bestDot));
  }

  /** ドラッグ終了。慣性があれば回り続け、止まってから（なければすぐ）グリッドへ寄せる */
  release(): void {
    const d = this.lastDrag;
    this.lastDrag = null;
    if (this.settings.viewInertia && d && this.now() - d.at <= INERTIA_WINDOW_MS) {
      const w = d.angle / Math.min(d.dt, INERTIA_WINDOW_MS);
      if (w > INERTIA_MIN) {
        this.spin = { axis: d.axis, w };
        return;
      }
    }
    if (this.settings.viewGrid !== 0) this.command({ kind: 'snap' });
  }

  zoom(factor: number): void {
    this.zoomScale = Math.min(ZOOM_MAX, Math.max(this.zoomMin, this.zoomScale * factor));
    this.applyCamera();
  }

  command(cmd: ViewCommand): void {
    this.spin = null;
    switch (cmd.kind) {
      case 'home':
        this.startAnimation(this.home, HOME_MS);
        return;
      case 'snap': {
        const grid = this.settings.viewGrid;
        if (grid === 0) return;
        this.startAnimation(this.cameraFor(snapDelta(this.targetDelta, grid)), SNAP_MS);
        return;
      }
      case 'rotate': {
        const n = FACE_NORMAL[cmd.about];
        const r = new Quaternion().setFromAxisAngle(new Vector3(...n), (cmd.quarter * Math.PI) / 2);
        const d = this.targetDelta.multiply(r);
        const quarterMs = (this.settings.quarterMs ?? DEFAULT_QUARTER_MS) * WHOLE_FACTOR;
        this.startAnimation(this.cameraFor(d), quarterMs * (Math.abs(cmd.quarter) === 2 ? 1.45 : 1));
      }
    }
  }

  /** 毎フレーム。視点が動いたら true */
  update(dtMs: number): boolean {
    if (this.spin) return this.updateSpin(dtMs);
    const a = this.anim;
    if (!a) return false;
    a.elapsed = Math.min(a.duration, a.elapsed + dtMs);
    const t = a.duration > 0 ? a.elapsed / a.duration : 1;
    this.c.slerpQuaternions(a.from, this.target, easeInOutQuad(t)).normalize();
    if (t >= 1) {
      this.c.copy(this.target);
      this.anim = null;
    }
    this.applyCamera();
    return true;
  }

  private updateSpin(dtMs: number): boolean {
    const s = this.spin!;
    this.c.multiply(new Quaternion().setFromAxisAngle(s.axis, -s.w * dtMs)).normalize();
    this.target.copy(this.c);
    s.w *= Math.pow(0.5, dtMs / INERTIA_HALF_MS);
    if (s.w < INERTIA_MIN) {
      this.spin = null;
      if (this.settings.viewGrid !== 0) this.command({ kind: 'snap' });
    }
    this.applyCamera();
    return true;
  }

  /** 見た目の向き Δ になるカメラの向き：C = Δ⁻¹ · C_home */
  private cameraFor(delta: Quaternion): Quaternion {
    return delta.clone().invert().multiply(this.home);
  }

  private startAnimation(to: Quaternion, duration: number): void {
    this.target.copy(to);
    this.anim = { from: this.c.clone(), elapsed: 0, duration };
  }

  private applyCamera(): void {
    this.camera.quaternion.copy(this.c);
    this.camera.position.set(0, 0, this.distance).applyQuaternion(this.c);
    this.camera.updateMatrixWorld();
    // 写したい範囲（キューブと鏡の像）の真ん中を画面の中央へ。描く窓をずらす。
    // ピンチで近づくほどずらしを減らし、キューブだけが収まる距離より近ければキューブを真ん中に置く
    const b = this.bounds(this.distance);
    const w = this.viewportWidth;
    const h = this.viewportHeight;
    if (b) {
      const tanV = Math.tan((CAMERA_FOV * Math.PI) / 360);
      const tanH = tanV * (w / h);
      const span = this.fitDistance - this.cubeFitDistance;
      const k = span > 1e-9 ? Math.min(1, Math.max(0, (this.distance - this.cubeFitDistance) / span)) : 1;
      this.offsetPx = {
        x: k * (((b.minX + b.maxX) / 2) / tanH) * (w / 2),
        y: -k * (((b.minY + b.maxY) / 2) / tanV) * (h / 2),
      };
    }
    if (Math.abs(this.offsetPx.x) > 1e-6 || Math.abs(this.offsetPx.y) > 1e-6) {
      this.camera.setViewOffset(w, h, this.offsetPx.x, this.offsetPx.y, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }
}
