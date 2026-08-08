/**
 * 変換の適用と座標写像（第2分冊 2.1 / 2.4 / 2.5 / 2.6）
 *
 * 元問題に幾何変換・シンボル置換・バンド/スタック入替を合成して出題盤面を作る。
 * **`puzzle` と `solution` に同一の変換を掛ける**ため、一意解性と難易度は保存される（設計書 2.4）。
 *
 * 適用は 2.4 の正準順序に固定する。順序が違うと、同じパラメータから別の盤面が復元される。
 *
 *   [1] バンド入替 → バンド内 行入替
 *   [2] スタック入替 → スタック内 列入替
 *   [3] 幾何変換（鏡映 → 回転）
 *   [4] シンボル置換
 *
 * **層の向き**: データ層の型のみに依存する。React・Canvas・DOM は参照しない（1.2）。
 */

import { err, ok, type BoardSize, type Grid, type Puzzle, type Result } from '../data/types';
import { validateParams, type TransformParams } from './params';

/** 位置の写像。索引は行優先の1次元（`row * n + col`） */
export interface CellMapping {
  /** 元セル → 変換後セル */
  forward(index: number): number;
  /** 変換後セル → 元セル */
  inverse(index: number): number;
}

/** 値の写像。0（空）は 0 のまま。**位置の写像とは独立である**（2.5） */
export interface ValueMapping {
  forward(value: number): number;
  inverse(value: number): number;
}

export interface Transform {
  readonly n: BoardSize;
  readonly b: number;
  readonly params: TransformParams;
  readonly cell: CellMapping;
  readonly value: ValueMapping;
  /** 盤面1枚へ変換を適用する。長さは N×N でなければならない */
  applyGrid(grid: Grid): Result<Grid>;
}

/** 変換後の出題盤面（11.2）。`given` は変換後の初期盤面、`solution` は変換後の完成解 */
export interface TransformedBoard {
  n: BoardSize;
  b: number;
  given: Grid;
  solution: Grid;
}

// ---------------------------------------------------------------- 構築

/**
 * パラメータを検証したうえで変換を組み立てる。
 * 検証に失敗した場合は変換を行わずエラーを返す（2.8）。
 */
export function createTransform(raw: unknown, n: BoardSize, b: number): Result<Transform> {
  const validated = validateParams(raw, n, b);
  if (!validated.ok) return validated;
  const params = validated.value;

  // [1][2] 行と列の並べ替え。**dst → src** の対応として作る
  const rowSource = buildLineSource(params.bandOrder, params.rowOrderInBand, b);
  const colSource = buildLineSource(params.stackOrder, params.colOrderInStack, b);
  const rowDest = invertPermutation(rowSource);
  const colDest = invertPermutation(colSource);

  // 位置の写像は全セルぶん先に引いておく。最大でも 49×49 = 2401 件である
  const cellForward = new Array<number>(n * n);
  const cellInverse = new Array<number>(n * n);
  for (let index = 0; index < n * n; index++) {
    const row = Math.floor(index / n);
    const col = index % n;
    // [1][2] を先に、[3] を後に掛ける。これが正準順序である
    const moved = rotateForward(rowDest[row], colDest[col], n, params);
    const destIndex = moved.row * n + moved.col;
    cellForward[index] = destIndex;
    cellInverse[destIndex] = index;
  }

  // [4] シンボル置換。位置に依存しないので最後に掛ける
  const valueInverse = new Array<number>(n + 1).fill(0);
  for (let v = 1; v <= n; v++) valueInverse[params.symbolMap[v - 1]] = v;

  const value: ValueMapping = {
    forward: (v) => (v === 0 ? 0 : params.symbolMap[v - 1]),
    inverse: (v) => (v === 0 ? 0 : valueInverse[v]),
  };

  const cell: CellMapping = {
    forward: (index) => cellForward[index],
    inverse: (index) => cellInverse[index],
  };

  const applyGrid = (grid: Grid): Result<Grid> => {
    if (grid.length !== n * n) {
      return err('DATA_INVALID', `盤面の長さが N×N ではない: ${grid.length}`);
    }
    const out = new Array<number>(n * n).fill(0);
    for (let index = 0; index < grid.length; index++) {
      out[cellForward[index]] = value.forward(grid[index]);
    }
    return ok(out);
  };

  return ok({ n, b, params, cell, value, applyGrid });
}

/**
 * 元問題1件へ変換を適用し、出題盤面の `given` / `solution` を返す（11.2）。
 * **`puzzle` と `solution` へ同一の変換を掛ける**ので、一意解性と難易度は保存される。
 */
export function apply(source: Puzzle, params: unknown): Result<TransformedBoard> {
  const built = createTransform(params, source.n, source.b);
  if (!built.ok) return built;
  const transform = built.value;

  const given = transform.applyGrid(source.puzzle);
  if (!given.ok) return given;
  const solution = transform.applyGrid(source.solution);
  if (!solution.ok) return solution;

  return ok({ n: source.n, b: source.b, given: given.value, solution: solution.value });
}

/**
 * 元座標 → 変換後座標（11.2）。**デバッグ表示・不具合解析のための窓口**である（2.5）。
 * パラメータが不正か索引が範囲外のときは -1 を返す。
 *
 * 盤面1枚をまとめて写すときは `createTransform` を1回組み立てて使うこと。
 * こちらは呼ぶたびに組み立て直す。
 */
export function mapIndex(index: number, n: BoardSize, b: number, params: unknown): number {
  const built = createTransform(params, n, b);
  if (!built.ok || index < 0 || index >= n * n) return -1;
  return built.value.cell.forward(index);
}

/** 変換後座標 → 元座標（11.2）。不正時は -1 */
export function unmapIndex(index: number, n: BoardSize, b: number, params: unknown): number {
  const built = createTransform(params, n, b);
  if (!built.ok || index < 0 || index >= n * n) return -1;
  return built.value.cell.inverse(index);
}

/**
 * 元の値 → 変換後の値（11.2）。0（空）は 0 のまま。
 * **位置の写像とは独立**なので、盤面の大きさを知らなくても引ける（2.5）。
 */
export function mapValue(value: number, params: TransformParams): number {
  if (value === 0) return 0;
  return params.symbolMap[value - 1];
}

/** 第2分冊 11.2 `Transformer` */
export const transformer = { apply, mapIndex, unmapIndex, mapValue };

// ---------------------------------------------------------------- 内部

/**
 * バンド（またはスタック）入替と、その内側の入替を1本の対応へ畳む。
 *
 * 返す配列は **変換後の行（列）→ 元の行（列）** である。
 * 変換後の i 番目のバンドには元の `groupOrder[i]` 番目のバンドが入り、
 * そのバンド内の並びを `withinOrder[i]` が決める。
 */
function buildLineSource(groupOrder: number[], withinOrder: number[][], b: number): number[] {
  const source = new Array<number>(b * b);
  for (let group = 0; group < b; group++) {
    for (let within = 0; within < b; within++) {
      source[group * b + within] = groupOrder[group] * b + withinOrder[group][within];
    }
  }
  return source;
}

function invertPermutation(source: number[]): number[] {
  const inverted = new Array<number>(source.length);
  for (let i = 0; i < source.length; i++) inverted[source[i]] = i;
  return inverted;
}

/**
 * 幾何変換 [3]。**鏡映が先、回転が後**である（2.4。順序を入れ替えると結果が変わる）。
 *
 * 鏡映は左右反転。回転は反時計回りを正とし、90度ごとに `(r, c) → (N-1-c, r)` を掛ける。
 */
function rotateForward(
  row: number,
  col: number,
  n: number,
  params: TransformParams,
): { row: number; col: number } {
  let r = row;
  let c = params.mirror ? n - 1 - col : col;
  for (let turn = params.rotation / 90; turn > 0; turn--) {
    const nextRow = n - 1 - c;
    const nextCol = r;
    r = nextRow;
    c = nextCol;
  }
  return { row: r, col: c };
}
