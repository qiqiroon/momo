/**
 * 変換パラメータ（第2分冊 2.3 / 2.6 / 2.7 / 2.8）
 *
 * 出題ごとに乱数から決め、中断セッションへ保存する。**シード方式は採らない**（C-18）。
 * 保存されているのは結果そのものなので、乱数源を差し替えても復元は変わらない（2.7）。
 *
 * **サイズ固有の分岐は書かない。** N=1 が恒等になるのは、b=1 のとき順列が1通りしか無いことの
 * 帰結であり、特別扱いの結果ではない（2.6）。
 */

import { err, ok, type BoardSize, type Result } from '../data/types';
import { TRANSFORM_PARAMS_VERSION } from '../game/config';

/** 回転量（度）。**反時計回りを正**とする（2.3） */
export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export { TRANSFORM_PARAMS_VERSION };

export interface TransformParams {
  /** パラメータ構造の版。互換判定に用いる */
  version: typeof TRANSFORM_PARAMS_VERSION;

  /** 回転量（度）。反時計回り正 */
  rotation: Rotation;

  /** 鏡映の有無。true のとき左右反転を適用する */
  mirror: boolean;

  /** シンボル置換表。長さ N。`symbolMap[v - 1]` = 変換後の値（1..N）。1..N の全単射 */
  symbolMap: number[];

  /** バンド（ブロック行グループ）の並び。長さ b。0..b-1 の順列 */
  bandOrder: number[];

  /** 各バンド内の行の並び。b 個の、長さ b の順列 */
  rowOrderInBand: number[][];

  /** スタック（ブロック列グループ）の並び。長さ b。0..b-1 の順列 */
  stackOrder: number[];

  /** 各スタック内の列の並び。b 個の、長さ b の順列 */
  colOrderInStack: number[][];
}

/** 乱数源。0 以上 1 未満を返す。差し替え可能にしてあるのは検査のためである（2.7） */
export type RandomSource = () => number;

// ---------------------------------------------------------------- 生成

/** 恒等パラメータ。変換を行わないことが分かっている場面（検査・比較）で用いる */
export function identityParams(n: BoardSize, b: number): TransformParams {
  return {
    version: TRANSFORM_PARAMS_VERSION,
    rotation: 0,
    mirror: false,
    symbolMap: Array.from({ length: n }, (_, i) => i + 1),
    bandOrder: identityPermutation(b),
    rowOrderInBand: Array.from({ length: b }, () => identityPermutation(b)),
    stackOrder: identityPermutation(b),
    colOrderInStack: Array.from({ length: b }, () => identityPermutation(b)),
  };
}

/**
 * 乱数からパラメータを1組作る。
 * 順列は Fisher–Yates により**一様**に選ぶ（2.7）。偏ると変換の水増し効果が損なわれる。
 */
export function randomParams(
  n: BoardSize,
  b: number,
  random: RandomSource = Math.random,
): TransformParams {
  return {
    version: TRANSFORM_PARAMS_VERSION,
    rotation: ROTATIONS[pickIndex(ROTATIONS.length, random)],
    mirror: random() < 0.5,
    symbolMap: shuffle(
      Array.from({ length: n }, (_, i) => i + 1),
      random,
    ),
    bandOrder: shuffle(identityPermutation(b), random),
    rowOrderInBand: Array.from({ length: b }, () => shuffle(identityPermutation(b), random)),
    stackOrder: shuffle(identityPermutation(b), random),
    colOrderInStack: Array.from({ length: b }, () => shuffle(identityPermutation(b), random)),
  };
}

function identityPermutation(len: number): number[] {
  return Array.from({ length: len }, (_, i) => i);
}

/** 0..len-1 から1つ選ぶ。乱数源が 1 を返しても範囲外にならないよう抑える */
function pickIndex(len: number, random: RandomSource): number {
  const i = Math.floor(random() * len);
  return i < 0 ? 0 : i >= len ? len - 1 : i;
}

/** Fisher–Yates。元の配列は変更しない */
function shuffle<T>(source: T[], random: RandomSource): T[] {
  const a = source.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1, random);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// ---------------------------------------------------------------- 検証（2.8）

/**
 * パラメータの妥当性を検証する。**適用前に必ず通す**（2.8）。
 *
 * 中断セッションから復元した値は `unknown` で渡ってくる（データ層は中身を解釈しない）。
 * ここで弾かれた場合、呼び出し側は当該セッションを破棄して新規出題へ誘導する（12.4）。
 */
export function validateParams(raw: unknown, n: BoardSize, b: number): Result<TransformParams> {
  if (b * b !== n) {
    return err('DATA_INVALID', `盤面サイズとブロック辺が整合しない: n=${n} b=${b}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('DATA_INVALID', '変換パラメータが object ではない');
  }
  const p = raw as Record<string, unknown>;

  if (p.version !== TRANSFORM_PARAMS_VERSION) {
    return err('DATA_INVALID', `未知の変換パラメータ版: ${String(p.version)}`);
  }
  if (!(ROTATIONS as readonly unknown[]).includes(p.rotation)) {
    return err('DATA_INVALID', `rotation が不正: ${String(p.rotation)}`);
  }
  if (typeof p.mirror !== 'boolean') {
    return err('DATA_INVALID', 'mirror が boolean ではない');
  }
  if (!isSymbolMap(p.symbolMap, n)) {
    return err('DATA_INVALID', 'symbolMap が 1..N の全単射ではない');
  }
  if (!isPermutation(p.bandOrder, b)) return err('DATA_INVALID', 'bandOrder が順列ではない');
  if (!isPermutation(p.stackOrder, b)) return err('DATA_INVALID', 'stackOrder が順列ではない');
  if (!isPermutationList(p.rowOrderInBand, b)) {
    return err('DATA_INVALID', 'rowOrderInBand が順列の組ではない');
  }
  if (!isPermutationList(p.colOrderInStack, b)) {
    return err('DATA_INVALID', 'colOrderInStack が順列の組ではない');
  }

  return ok({
    version: TRANSFORM_PARAMS_VERSION,
    rotation: p.rotation as Rotation,
    mirror: p.mirror,
    symbolMap: (p.symbolMap as number[]).slice(),
    bandOrder: (p.bandOrder as number[]).slice(),
    rowOrderInBand: (p.rowOrderInBand as number[][]).map((row) => row.slice()),
    stackOrder: (p.stackOrder as number[]).slice(),
    colOrderInStack: (p.colOrderInStack as number[][]).map((col) => col.slice()),
  });
}

/** 0..len-1 をちょうど1回ずつ含む配列か */
function isPermutation(raw: unknown, len: number): raw is number[] {
  if (!Array.isArray(raw) || raw.length !== len) return false;
  const seen = new Array<boolean>(len).fill(false);
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 0 || v >= len || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

/** 長さ len の順列を len 個持つか */
function isPermutationList(raw: unknown, len: number): raw is number[][] {
  if (!Array.isArray(raw) || raw.length !== len) return false;
  return raw.every((row) => isPermutation(row, len));
}

/** 1..n をちょうど1回ずつ含む配列か */
function isSymbolMap(raw: unknown, n: number): raw is number[] {
  if (!Array.isArray(raw) || raw.length !== n) return false;
  const seen = new Array<boolean>(n + 1).fill(false);
  for (const v of raw) {
    if (!Number.isInteger(v) || v < 1 || v > n || seen[v]) return false;
    seen[v] = true;
  }
  return true;
}

/** 第2分冊 11.1 `TransformParamsService` */
export const transformParamsService = {
  random: randomParams,
  identity: identityParams,
  validate: validateParams,
};
