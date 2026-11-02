// 軸回転の添字置換と 24 元回転群（設計 01 §2・§3、08 §3）
import {
  AXES, AXIS_INDEX, FACES, FACE_AXIS, FACE_NORMAL, FACE_SIGN,
  type Axis, type Face, type GridPos, type Mat3, type Move, type Vec3,
} from './types';

/** 正方向軸まわり +90°（右手則）の格子添字写像 */
export function rotateIndex(pos: GridPos, axis: Axis, n: number): GridPos {
  const [x, y, z] = pos;
  switch (axis) {
    case 'x': return [x, n - 1 - z, y];
    case 'y': return [z, y, n - 1 - x];
    case 'z': return [n - 1 - y, x, z];
  }
}

/** 面と深さ（1 始まり、1 が最外層）→ その軸上のスライス添字 */
export function sliceOf(face: Face, depth: number, n: number): number {
  return FACE_SIGN[face] === 1 ? n - depth : depth - 1;
}

/**
 * 面を法線側から見て時計回り（cw）＝外向き法線まわりの −90°（設計 01 §2.1）。
 * double は cw と同じ向きに 180°（アニメーションの向きをそろえるため符号を持つ）
 */
export function turnsForFace(face: Face, variant: 'cw' | 'ccw' | 'double'): Move['turns'] {
  const s = FACE_SIGN[face];
  switch (variant) {
    case 'cw': return s === 1 ? -1 : 1;
    case 'ccw': return s === 1 ? 1 : -1;
    case 'double': return s === 1 ? -2 : 2;
  }
}

// --- 行列 ---

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 正方向軸まわり +90° の行列 */
export const AXIS_MATRIX: Record<Axis, Mat3> = {
  x: [1, 0, 0, 0, 0, -1, 0, 1, 0],
  y: [0, 0, 1, 0, 1, 0, -1, 0, 0],
  z: [0, -1, 0, 1, 0, 0, 0, 0, 1],
};

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
    }
  }
  return r as unknown as Mat3;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function det(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

const matKey = (m: Mat3): string => m.join(',');

function faceOfNormal(v: Vec3): number {
  for (let f = 0; f < 6; f++) {
    const nv = FACE_NORMAL[FACES[f]];
    if (nv[0] === v[0] && nv[1] === v[1] && nv[2] === v[2]) return f;
  }
  throw new Error(`not a face normal: ${v.join(',')}`);
}

// --- 24 元回転群の事前計算（モジュール初期化時に 1 回だけ） ---

function buildGroup(): Mat3[] {
  const seen = new Map<string, Mat3>([[matKey(IDENTITY), IDENTITY]]);
  const queue: Mat3[] = [IDENTITY];
  while (queue.length > 0) {
    const m = queue.shift()!;
    for (const axis of AXES) {
      const next = mulMat(AXIS_MATRIX[axis], m);
      const key = matKey(next);
      if (!seen.has(key)) {
        seen.set(key, next);
        queue.push(next);
      }
    }
  }
  const idKey = matKey(IDENTITY);
  const rest = [...seen.keys()].filter((k) => k !== idKey).sort();
  return [IDENTITY, ...rest.map((k) => seen.get(k)!)];
}

export const ROT_MATRICES: readonly Mat3[] = buildGroup();

const ORI_OF = new Map<string, number>(ROT_MATRICES.map((m, i) => [matKey(m), i]));

/** 行列 → 群の添字。群に属さなければ例外 */
export function oriOf(m: Mat3): number {
  const i = ORI_OF.get(matKey(m));
  if (i === undefined) throw new Error(`not a cube rotation: ${matKey(m)}`);
  return i;
}

/** COMPOSE[a*24+b] = a∘b（先に b、次に a） */
export const COMPOSE = new Uint8Array(24 * 24);
export const INVERSE = new Uint8Array(24);
/** 正方向軸まわり +90° を左から合成した結果 */
export const AXIS_TURN: Record<Axis, Uint8Array> = {
  x: new Uint8Array(24),
  y: new Uint8Array(24),
  z: new Uint8Array(24),
};
/** [ori*6 + 世界面idx] = 体面idx */
export const BODY_FACE_OF = new Uint8Array(24 * 6);
/** [ori*6 + 体面idx] = 世界面idx */
export const WORLD_FACE_OF = new Uint8Array(24 * 6);

for (let a = 0; a < 24; a++) {
  const ma = ROT_MATRICES[a];
  for (let b = 0; b < 24; b++) {
    const c = oriOf(mulMat(ma, ROT_MATRICES[b]));
    COMPOSE[a * 24 + b] = c;
    if (c === 0) INVERSE[a] = b;
  }
  for (const axis of AXES) AXIS_TURN[axis][a] = oriOf(mulMat(AXIS_MATRIX[axis], ma));
  // 姿勢行列は体座標 → 世界座標。体面の法線を世界へ、世界面の法線を体へ写す
  const mt = transpose(ma);
  for (let f = 0; f < 6; f++) {
    const nv = FACE_NORMAL[FACES[f]];
    WORLD_FACE_OF[a * 6 + f] = faceOfNormal(mulVec(ma, nv));
    BODY_FACE_OF[a * 6 + f] = faceOfNormal(mulVec(mt, nv));
  }
}

/** 面の軸の添字（0..2）。cubeState と notation の共通ヘルパ */
export function faceAxisIndex(face: Face): 0 | 1 | 2 {
  return AXIS_INDEX[FACE_AXIS[face]];
}
