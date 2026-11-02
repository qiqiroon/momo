// 面をつまんで押した向き → 回転命令（設計 04 §3.2・§3.3）。描画に依存しない純粋な計算
//
// 規則：掴んだ面の外向き法線 n と、面の中で押した向き d（どちらも立方体の軸）から
//   回転軸 a = n × d、a まわりに +90°。
// a まわりの +90° は n を d へ送る（a × n = d）ので、掴んだステッカーは押した向きへ動く。
// 矢印の操作（M6.5）も同じ pushToMove を使う
import { cubieAt, type CubeState } from '../core/cubeState';
import { makeMove, slicesFromDepths } from '../core/move';
import {
  AXIS_FACES, AXIS_INDEX, FACES, FACE_AXIS, FACE_NORMAL, FACE_SIGN, OPPOSITE,
  type Axis, type Face, type Move, type Vec3,
} from '../core/types';

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** 立方体の軸の単位ベクトル → その向きの面 */
function faceOfVector(v: Vec3): Face | null {
  return FACES.find((f) => FACE_NORMAL[f].every((c, i) => c === v[i])) ?? null;
}

/** 面 normal の中で押せる 4 つの向き（normal に垂直な面） */
export function inPlaneDirections(normal: Face): Face[] {
  return FACES.filter((f) => f !== normal && f !== OPPOSITE[normal]);
}

/** 回転軸 a = n × d と、その向き（正方向の軸 + 符号） */
export function pushAxis(normal: Face, dir: Face): { axis: Axis; sign: 1 | -1 } {
  const a = faceOfVector(cross(FACE_NORMAL[normal], FACE_NORMAL[dir]));
  if (!a) throw new RangeError(`dir ${dir} is not in the plane of ${normal}`);
  return { axis: FACE_AXIS[a], sign: FACE_SIGN[a] };
}

export type PushWidth = 'single' | 'wide';

/**
 * 面 normal 上の、軸 a の位置 sliceIndex の列を、面の中の向き dir へ押したときの Move。
 * wide のときは、掴んだ層から近いほうの面までをまとめて回す（その面から数えて 1〜k 枚、最低 2 枚）
 */
export function pushToMove(n: number, normal: Face, dir: Face, sliceIndex: number, width: PushWidth = 'single'): Move {
  const { axis, sign } = pushAxis(normal, dir);
  let slices = 1 << sliceIndex;
  if (width === 'wide' && n >= 2) {
    const [pos, neg] = AXIS_FACES[axis];
    // 近いほうの面から数えた深さ
    const depthFromNeg = sliceIndex + 1;
    const depthFromPos = n - sliceIndex;
    const face = depthFromPos <= depthFromNeg ? pos : neg;
    const depth = Math.max(2, face === pos ? depthFromPos : depthFromNeg);
    slices = slicesFromDepths(face, 1, Math.min(depth, n), n);
  }
  return makeMove(n, axis, slices, sign);
}

export interface Vec2 {
  x: number;
  y: number;
}

/** これより押した向きが候補と合わない（ほぼ面に垂直に押し込んだ）ときは回さない */
export const MIN_DIRECTION_SCORE = 0.35;

/**
 * 画面上のドラッグの向き drag に最も近い、面の中の向きを選ぶ（設計 04 §3.2）。
 * toScreen は 3D の点を画面の px（下向きが正）へ写す関数
 */
export function chooseDirection(
  normal: Face, point: Vec3, unit: number, drag: Vec2, toScreen: (p: Vec3) => Vec2,
): Face | null {
  const len = Math.hypot(drag.x, drag.y);
  if (len === 0) return null;
  const s0 = toScreen(point);
  let best: Face | null = null;
  let bestScore = -Infinity;
  for (const f of inPlaneDirections(normal)) {
    const d = FACE_NORMAL[f];
    const s1 = toScreen([point[0] + d[0] * unit * 0.25, point[1] + d[1] * unit * 0.25, point[2] + d[2] * unit * 0.25]);
    const sx = s1.x - s0.x;
    const sy = s1.y - s0.y;
    const sl = Math.hypot(sx, sy);
    if (sl < 1e-9) continue;
    const score = (sx * drag.x + sy * drag.y) / (sl * len);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return bestScore >= MIN_DIRECTION_SCORE ? best : null;
}

/** 掴んだ小キューブの位置で、回転軸 axis 上のスライス添字 */
export function sliceIndexOf(pos: readonly [number, number, number], axis: Axis): number {
  return pos[AXIS_INDEX[axis]];
}

/**
 * 視線（始点 o・向き r）が最初に入るキューブの面と、そこにあるステッカーの小キューブ（設計 04 §3.1）。
 * 描いた形（角丸・小キューブの隙間・ステッカーの縁）ではなく、キューブ全体の箱で当てる。
 * 色の境目や小キューブの隙間を押しても、見えている面の、その位置の列を掴める。外れたら null
 */
export function stickerOnRay(
  state: CubeState, size: number, o: Vec3, r: Vec3,
): { cubie: number; face: Face } | null {
  const h = size / 2;
  let tEnter = -Infinity;
  let tExit = Infinity;
  let enterAxis = -1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(r[i]) < 1e-12) {
      if (o[i] < -h || o[i] > h) return null;
      continue;
    }
    const t1 = (-h - o[i]) / r[i];
    const t2 = (h - o[i]) / r[i];
    const near = Math.min(t1, t2);
    if (near > tEnter) {
      tEnter = near;
      enterAxis = i;
    }
    tExit = Math.min(tExit, Math.max(t1, t2));
  }
  if (enterAxis < 0 || tEnter > tExit || tEnter < 0) return null;
  const n = state.n;
  const unit = size / n;
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (i === enterAxis) pos[i] = r[i] < 0 ? n - 1 : 0;
    else pos[i] = Math.min(n - 1, Math.max(0, Math.floor((o[i] + r[i] * tEnter + h) / unit)));
  }
  // 視線が −向きに進むなら + 側の面から入った
  const sign = r[enterAxis] < 0 ? 1 : -1;
  const face = FACES.find((f) => AXIS_INDEX[FACE_AXIS[f]] === enterAxis && FACE_SIGN[f] === sign)!;
  const c = cubieAt(state, [pos[0], pos[1], pos[2]]);
  return c ? { cubie: c.id, face } : null;
}
