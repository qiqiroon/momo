// マーキング（2026-11-04 作者の指示）。描画に依存しない部分
//
// - 1 個のセル（ステッカー 1 枚）を選ぶと印が付き、付けた順に 1, 2, 3… の番号が出る
// - 印はステッカーそのものに付く（回すと一緒に動く）。消すときは番号の大きいほうから 1 つずつ
// - 手順の各手には、その手を回す直前に付いていた印を一緒に覚える（その手がどのセルを動かすためのものか）。
//   覚えるのは「記録を始めたときの画面の向き」から見た位置。再生では、いまの向きから見て同じ位置のセルに付け直す
import { cubieAt, type CubeState } from '../core/cubeState';
import { quarterTurns } from '../core/move';
import { AXIS_MATRIX, BODY_FACE_OF, mulVec, rotateIndex, ROT_MATRICES, transpose, WORLD_FACE_OF } from '../core/rotations';
import {
  AXIS_INDEX, FACES, FACE_AXIS, FACE_INDEX, FACE_NORMAL, type Face, type GridPos, type Move, type Vec3,
} from '../core/types';
import type { ViewFrame } from '../input/viewFrame';

/** 印 1 つ：どの小キューブの、体座標のどの面のステッカーか（回しても変わらない） */
export interface Mark {
  readonly cubie: number;
  readonly body: number;
}

/** キューブの表面の 1 か所：格子の位置と、外を向いている面 */
export interface Spot {
  readonly pos: GridPos;
  readonly face: Face;
}

/** 手順に覚える印：[画面の面, 画面の向きでの格子の位置 x, y, z] */
export type SeqMark = readonly [Face, number, number, number];

/** 1 つの手に覚える印の上限（保存が大きくなりすぎないため） */
export const MAX_MARKS = 54;

/** 印のいまの位置 */
export function spotOf(state: CubeState, mark: Mark): Spot | null {
  const c = state.cubies[mark.cubie];
  if (!c || c.base[mark.body] == null) return null;
  return { pos: c.pos, face: FACES[WORLD_FACE_OF[c.ori * 6 + mark.body]] };
}

/** その位置にあるステッカーの印。無ければ null */
export function markAt(state: CubeState, spot: Spot): Mark | null {
  const c = cubieAt(state, spot.pos);
  if (!c) return null;
  const body = BODY_FACE_OF[c.ori * 6 + FACE_INDEX[spot.face]];
  return c.base[body] == null ? null : { cubie: c.id, body };
}

/** 格子の位置を、中心が 0 の座標（2 倍して整数にしたもの）に */
function centered(pos: GridPos, n: number): Vec3 {
  return [2 * pos[0] - (n - 1), 2 * pos[1] - (n - 1), 2 * pos[2] - (n - 1)];
}

function fromCentered(v: Vec3, n: number): GridPos {
  return [(v[0] + n - 1) / 2, (v[1] + n - 1) / 2, (v[2] + n - 1) / 2];
}

function faceOf(v: Vec3): Face {
  return FACES.find((f) => {
    const nv = FACE_NORMAL[f];
    return nv[0] === v[0] && nv[1] === v[1] && nv[2] === v[2];
  })!;
}

/** キューブの位置 → 画面の向き frame から見た位置（手順に覚える形） */
export function toSeqMark(n: number, frame: ViewFrame, spot: Spot): SeqMark {
  const r = ROT_MATRICES[frame.ori];
  const p = fromCentered(mulVec(r, centered(spot.pos, n)), n);
  return [faceOf(mulVec(r, FACE_NORMAL[spot.face])), p[0], p[1], p[2]];
}

/** 手順に覚えた位置 → 画面の向き frame でのキューブの位置。おかしな値なら null */
export function fromSeqMark(n: number, frame: ViewFrame, m: SeqMark): Spot | null {
  const rt = transpose(ROT_MATRICES[frame.ori]);
  const pos = fromCentered(mulVec(rt, centered([m[1], m[2], m[3]], n)), n);
  const face = faceOf(mulVec(rt, FACE_NORMAL[m[0]]));
  return onSurface(n, { pos, face }) ? { pos, face } : null;
}

/** その面の外側の層にある位置か */
export function onSurface(n: number, spot: Spot): boolean {
  const { pos, face } = spot;
  if (!pos.every((v) => Number.isInteger(v) && v >= 0 && v < n)) return false;
  const a = AXIS_INDEX[FACE_AXIS[face]];
  return pos[a] === (FACE_NORMAL[face][a] > 0 ? n - 1 : 0);
}

/** 手 move を回したあとの位置 spot が、回す前にどこにあったか */
export function spotBefore(n: number, spot: Spot, move: Move): Spot {
  const a = AXIS_INDEX[move.axis];
  if ((move.slices & (1 << spot.pos[a])) === 0) return spot;
  // 回した向きの逆に回す（+90° を (4 − k) 回）
  const back = (4 - quarterTurns(move)) % 4;
  let pos = spot.pos;
  let normal = FACE_NORMAL[spot.face];
  for (let t = 0; t < back; t++) {
    pos = rotateIndex(pos, move.axis, n);
    normal = mulVec(AXIS_MATRIX[move.axis], normal);
  }
  return { pos, face: faceOf(normal) };
}

/** いま付いている印の列（付けた順。番号は添字 + 1） */
export class MarkSet {
  private list: Mark[] = [];
  /** 印が変わった（描き直し） */
  onChange: () => void = () => {};

  get all(): readonly Mark[] {
    return this.list;
  }

  get size(): number {
    return this.list.length;
  }

  /** 印を足す。もう付いているセル・上限を越える分は足さない。足したら true */
  add(mark: Mark): boolean {
    if (this.list.length >= MAX_MARKS) return false;
    if (this.list.some((m) => m.cubie === mark.cubie && m.body === mark.body)) return false;
    this.list.push(mark);
    this.onChange();
    return true;
  }

  /** 番号のいちばん大きい印を消す。消したら true */
  removeLast(): boolean {
    if (this.list.length === 0) return false;
    this.list.pop();
    this.onChange();
    return true;
  }

  /** 全部入れ替える（再生で、手順に覚えた印にする） */
  set(marks: readonly Mark[]): void {
    const same = marks.length === this.list.length
      && marks.every((m, i) => m.cubie === this.list[i].cubie && m.body === this.list[i].body);
    if (same) return;
    this.list = marks.slice(0, MAX_MARKS);
    this.onChange();
  }

  clear(): void {
    this.set([]);
  }
}
