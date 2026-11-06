// レベルの定義と解データ。正本は製造機の出力（generator\out\levels.json）を写した src/data/levels.json。
// 解データは実行時に作らない（仕様書 §2.3）。DOM を触らない

import raw from '../data/levels.json';
import { type Cell } from './geometry';

export type Variant = 'simple' | 'legacy' | null;

export interface PieceDef {
  /** 駒の名前（n=4・5 はアルファベット、ほかは番号） */
  name: string;
  /** 駒リストに出す基準の向き */
  cells: Cell[];
  /** 駒の穴（穴あき駒だけ） */
  holes: Cell[];
}

export interface Placement {
  piece: number;
  /** 同じ形が複数個あるレベル（4 レガシー）での何個目か（0 から） */
  copy: number;
  /** 向き（geometry.orient の o） */
  o: number;
  x: number;
  y: number;
}

export interface LevelDef {
  /** '4-legacy' など。記録・保存のキーにも使う */
  id: string;
  n: number;
  variant: Variant;
  /** 各駒の個数 */
  count: number;
  /** 盤面。'#' がマス（駒の穴が乗るマスも含む） */
  board: string[];
  /** 完成形の1つ（開始時に見せる。ヒントの答えではない） */
  solution: Placement[];
}

interface RawData {
  format: number;
  pieceSets: Record<string, Array<{ name: string; cells: number[][]; holes: number[][] }>>;
  levels: LevelDef[];
}

const data = raw as unknown as RawData;
if (data.format !== 1) throw new Error('levels.json の形式が違う');

const toCells = (a: number[][]): Cell[] => a.map(([x, y]) => [x, y] as Cell);

const pieceSets = new Map<number, PieceDef[]>(
  Object.entries(data.pieceSets).map(([n, ps]) => [Number(n), ps.map((p) => ({ name: p.name, cells: toCells(p.cells), holes: toCells(p.holes) }))]),
);

export const LEVELS: readonly LevelDef[] = data.levels;

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export function piecesOf(level: LevelDef): PieceDef[] {
  const ps = pieceSets.get(level.n);
  if (!ps) throw new Error(`n=${level.n} の駒が無い`);
  return ps;
}

/** 盤面のマスの一覧 */
export function boardCells(level: LevelDef): Cell[] {
  const out: Cell[] = [];
  level.board.forEach((line, y) => [...line].forEach((ch, x) => { if (ch === '#') out.push([x, y]); }));
  return out;
}

export function boardSize(level: LevelDef): { w: number; h: number } {
  return { w: Math.max(...level.board.map((l) => l.length)), h: level.board.length };
}

/** 駒の総数（同じ形の個数も数える） */
export function pieceTotal(level: LevelDef): number {
  return piecesOf(level).length * level.count;
}
