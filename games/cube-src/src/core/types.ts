// 論理層の基本型と面の定数表（設計 01 §1・§4.1、08 §1）
// core/ は Three.js に依存しない。値はすべて整数

export type Axis = 'x' | 'y' | 'z';
export type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';
export type StickerColor = 'W' | 'Y' | 'G' | 'B' | 'R' | 'O';

/** 行優先の 3×3 整数行列。成分は 0 または ±1、行列式は +1。v' = M · v */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** 格子添字。各成分 0..n-1 */
export type GridPos = readonly [number, number, number];

export type Vec3 = readonly [number, number, number];

/** 回転命令の正準形（設計 02 §1）。生成は makeMove だけで行う */
export interface Move {
  readonly n: number;
  readonly axis: Axis;
  readonly slices: number;
  readonly turns: -2 | -1 | 1 | 2;
}

export type MoveOrigin = 'user' | 'shuffle' | 'undo' | 'redo' | 'solver';

/** この順序は FACE_INDEX・BODY_FACE_OF・ステッカー配列の添字の基準。変えないこと */
export const FACES: readonly Face[] = ['U', 'D', 'L', 'R', 'F', 'B'];

export const FACE_INDEX: Record<Face, number> = { U: 0, D: 1, L: 2, R: 3, F: 4, B: 5 };
export const FACE_AXIS: Record<Face, Axis> = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
export const FACE_SIGN: Record<Face, 1 | -1> = { U: 1, D: -1, R: 1, L: -1, F: 1, B: -1 };
export const OPPOSITE: Record<Face, Face> = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };

export const AXES: readonly Axis[] = ['x', 'y', 'z'];
export const AXIS_INDEX: Record<Axis, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };
/** [正方向面, 負方向面] */
export const AXIS_FACES: Record<Axis, readonly [Face, Face]> = {
  x: ['R', 'L'],
  y: ['U', 'D'],
  z: ['F', 'B'],
};

export const FACE_NORMAL: Record<Face, Vec3> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
};

export const SOLVED_FACE_COLOR: Record<Face, StickerColor> = {
  U: 'W', D: 'Y', F: 'G', B: 'B', R: 'R', L: 'O',
};

/** 配色の差し替え点。論理層は参照しない */
export const COLOR_HEX: Record<StickerColor, number> = {
  W: 0xf5f5f5, Y: 0xf2d024, G: 0x00a54f,
  B: 0x0051ba, R: 0xd42f2f, O: 0xf07c24,
};

export const MIN_SIZE = 1;
export const MAX_SIZE = 10;
