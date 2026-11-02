// キューブの論理状態：生成・回転の適用・完成判定・直列化（設計 01 §4〜§5、08 §4）
import {
  AXIS_TURN, BODY_FACE_OF, WORLD_FACE_OF, faceAxisIndex, rotateIndex, sliceOf,
} from './rotations';
import { quarterTurns } from './move';
import {
  AXIS_INDEX, FACES, FACE_INDEX, MAX_SIZE, MIN_SIZE, SOLVED_FACE_COLOR,
  type Axis, type Face, type GridPos, type Move, type StickerColor,
} from './types';

export interface Cubie {
  /** 完成状態での通し番号。不変 */
  readonly id: number;
  pos: GridPos;
  /** 24 元回転群の添字 0..23 */
  ori: number;
  /** 体座標系 6 面の色。FACES 順。内側は null。姿勢が変わっても書き換えない */
  readonly base: readonly (StickerColor | null)[];
}

export interface CubeState {
  readonly n: number;
  /** 表面の小キューブのみ（決定 D3） */
  readonly cubies: Cubie[];
  /** 格子キー → cubies の添字。内部は -1 */
  readonly index: Int32Array;
}

export interface CubeSnapshot {
  n: number;
  ori: Uint8Array;
  pos: Uint16Array;
}

export function gridKey(pos: GridPos, n: number): number {
  return pos[0] * n * n + pos[1] * n + pos[2];
}

function keyToPos(key: number, n: number): GridPos {
  return [Math.floor(key / (n * n)), Math.floor(key / n) % n, key % n];
}

/** その位置で外に出ている世界の面 */
function exposedFaces(pos: GridPos, n: number): Face[] {
  return FACES.filter((f) => pos[faceAxisIndex(f)] === sliceOf(f, 1, n));
}

export function createSolved(n: number): CubeState {
  if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
    throw new RangeError(`n out of range: ${n}`);
  }
  const cubies: Cubie[] = [];
  const index = new Int32Array(n * n * n).fill(-1);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      for (let z = 0; z < n; z++) {
        const pos: GridPos = [x, y, z];
        const exposed = exposedFaces(pos, n);
        if (exposed.length === 0) continue;
        const base = FACES.map((f) => (exposed.includes(f) ? SOLVED_FACE_COLOR[f] : null));
        index[gridKey(pos, n)] = cubies.length;
        cubies.push({ id: cubies.length, pos, ori: 0, base });
      }
    }
  }
  return { n, cubies, index };
}

export function cubieAt(state: CubeState, pos: GridPos): Cubie | null {
  const i = state.index[gridKey(pos, state.n)];
  return i < 0 ? null : state.cubies[i];
}

/** 世界の面 f に現れる色。露出していない面では null */
export function colorAt(cubie: Cubie, face: Face): StickerColor | null {
  return cubie.base[BODY_FACE_OF[cubie.ori * 6 + FACE_INDEX[face]]];
}

/** 指定スライスに属する小キューブ。面層で O(N²)、内側スライスで O(N) */
export function sliceCubies(state: CubeState, axis: Axis, slices: number): Cubie[] {
  const { n, cubies, index } = state;
  const a = AXIS_INDEX[axis];
  const out: Cubie[] = [];
  for (let s = 0; s < n; s++) {
    if ((slices & (1 << s)) === 0) continue;
    for (let u = 0; u < n; u++) {
      for (let v = 0; v < n; v++) {
        const pos = [0, 0, 0];
        pos[a] = s;
        pos[(a + 1) % 3] = u;
        pos[(a + 2) % 3] = v;
        const i = index[(pos[0] * n + pos[1]) * n + pos[2]];
        if (i >= 0) out.push(cubies[i]);
      }
    }
  }
  return out;
}

export function applyMove(state: CubeState, move: Move): void {
  const { n, index } = state;
  if (move.n !== n) throw new RangeError(`move.n (${move.n}) !== state.n (${n})`);
  const k = quarterTurns(move);
  if (k === 0) return;
  const moved = sliceCubies(state, move.axis, move.slices);
  const turn = AXIS_TURN[move.axis];
  const slots: number[] = [];
  for (const c of moved) {
    const key = gridKey(c.pos, n);
    slots.push(index[key]);
    index[key] = -1;
    for (let t = 0; t < k; t++) {
      c.pos = rotateIndex(c.pos, move.axis, n);
      c.ori = turn[c.ori];
    }
  }
  for (let j = 0; j < moved.length; j++) index[gridKey(moved[j].pos, n)] = slots[j];
}

// 各面を正面から見たときの「右」と「下」（軸の添字と向き）。展開図の標準の向き
const FACE_VIEW: Record<Face, { right: [number, 1 | -1]; down: [number, 1 | -1] }> = {
  F: { right: [0, 1], down: [1, -1] },
  B: { right: [0, -1], down: [1, -1] },
  R: { right: [2, -1], down: [1, -1] },
  L: { right: [2, 1], down: [1, -1] },
  U: { right: [0, 1], down: [2, 1] },
  D: { right: [0, 1], down: [2, -1] },
};

/** 面を正面から見た左上から右・上から下の順に N² 個の色 */
export function faceColors(state: CubeState, face: Face): (StickerColor | null)[] {
  const { n } = state;
  const { right, down } = FACE_VIEW[face];
  const out: (StickerColor | null)[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const pos = [0, 0, 0];
      pos[faceAxisIndex(face)] = sliceOf(face, 1, n);
      pos[right[0]] = right[1] === 1 ? c : n - 1 - c;
      pos[down[0]] = down[1] === 1 ? r : n - 1 - r;
      const cubie = cubieAt(state, pos as unknown as GridPos);
      out.push(cubie ? colorAt(cubie, face) : null);
    }
  }
  return out;
}

/** 6 面それぞれが単色か。どの色がどの面かは問わない */
export function isSolved(state: CubeState): boolean {
  for (const face of FACES) {
    const colors = faceColors(state, face);
    for (let i = 1; i < colors.length; i++) {
      if (colors[i] !== colors[0]) return false;
    }
  }
  return true;
}

export function snapshot(state: CubeState): CubeSnapshot {
  const { n, cubies } = state;
  return {
    n,
    ori: Uint8Array.from(cubies, (c) => c.ori),
    pos: Uint16Array.from(cubies, (c) => gridKey(c.pos, n)),
  };
}

export function restore(snap: CubeSnapshot): CubeState {
  const state = createSolved(snap.n);
  const { n, cubies, index } = state;
  if (snap.ori.length !== cubies.length || snap.pos.length !== cubies.length) {
    throw new RangeError('snapshot length mismatch');
  }
  index.fill(-1);
  cubies.forEach((c, i) => {
    c.ori = snap.ori[i];
    c.pos = keyToPos(snap.pos[i], n);
    index[snap.pos[i]] = i;
  });
  assertInvariants(state);
  return state;
}

/** INV1・INV2・INV4（設計 08 §9）。破れていれば例外 */
export function assertInvariants(state: CubeState): void {
  const { n, cubies, index } = state;
  cubies.forEach((c, i) => {
    if (!Number.isInteger(c.ori) || c.ori < 0 || c.ori >= 24) {
      throw new Error(`INV4: cubie ${c.id} ori=${c.ori}`);
    }
    if (index[gridKey(c.pos, n)] !== i) throw new Error(`INV2: cubie ${c.id} index mismatch`);
    const stickered = new Set<number>();
    c.base.forEach((col, bodyFace) => {
      if (col !== null) stickered.add(WORLD_FACE_OF[c.ori * 6 + bodyFace]);
    });
    const exposed = exposedFaces(c.pos, n).map((f) => FACE_INDEX[f]);
    if (stickered.size !== exposed.length || !exposed.every((f) => stickered.has(f))) {
      throw new Error(`INV1: cubie ${c.id} stickers do not match exposed faces`);
    }
  });
  const live = index.reduce((acc, v) => acc + (v >= 0 ? 1 : 0), 0);
  if (live !== cubies.length) throw new Error('INV2: index has stray entries');
}
