// レベルの定義と解データ。正本は製造機の出力（generator\out\levels.json）を写した src/data/levels.json。
// 解データは実行時に作らない（仕様書 §2.3）。DOM を触らない。
// 解の保証なしのレベル（9 以上。§2.4）は駒が多いので、駒は別のファイル（src/data/pieces-<n>.json）に分け、
// 遊ぶときに loadPieces で読み込む

import raw from '../data/levels.json';
import { type Cell, holesOf, normalize } from './geometry';

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
  /** 完成形の1つ（開始時に見せる。ヒントの答えではない）。8 以上（見本を置かないレベル）は空 */
  solution: Placement[];
  /** 駒の種類の数（駒を読み込む前でも、レベル選択の画面に出せるように） */
  kinds: number;
  /** 解けると証明されていない（解データを持っていない。§2.2・§5.2） */
  unproven: boolean;
}

interface RawLevel {
  id: string;
  n: number;
  variant: Variant;
  count: number;
  board?: string[];
  /** 解の保証なしのレベルの盤面：幅 w・高さ h の長方形の上辺の真ん中に top マスの出っ張り */
  auto?: { w: number; h: number; top: number };
  kinds?: number;
  /** 見本（solution）は持たないが、完成できる形だと分かっている（8。2026-11-07） */
  proven?: boolean;
  solution: Placement[];
}

interface RawData {
  format: number;
  pieceSets: Record<string, Array<{ name: string; cells: number[][]; holes: number[][] }>>;
  levels: RawLevel[];
}

const data = raw as unknown as RawData;
if (data.format !== 1) throw new Error('levels.json の形式が違う');

const toCells = (a: number[][]): Cell[] => a.map(([x, y]) => [x, y] as Cell);

const pieceSets = new Map<number, PieceDef[]>(
  Object.entries(data.pieceSets).map(([n, ps]) => [Number(n), ps.map((p) => ({ name: p.name, cells: toCells(p.cells), holes: toCells(p.holes) }))]),
);

/** 製造機の autoRows と同じ：出っ張りの行（あれば）を先に、そのあと長方形 */
export function autoRows({ w, h, top }: { w: number; h: number; top: number }): string[] {
  const rows: string[] = [];
  if (top) {
    const left = Math.floor((w - top) / 2);
    rows.push('.'.repeat(left) + '#'.repeat(top) + '.'.repeat(w - left - top));
  }
  for (let y = 0; y < h; y++) rows.push('#'.repeat(w));
  return rows;
}

export const LEVELS: readonly LevelDef[] = data.levels.map((lv) => ({
  id: lv.id,
  n: lv.n,
  variant: lv.variant,
  count: lv.count,
  board: lv.board ?? autoRows(lv.auto!),
  solution: lv.solution,
  kinds: lv.kinds ?? data.pieceSets[lv.n].length,
  unproven: lv.solution.length === 0 && !lv.proven,
}))
  // 同じ LEVEL の中では、レガシーを先に、バリエーション（variant 'simple'）をあとに並べる（2026-11-06 利用者の指示）
  .map((lv, i) => ({ lv, i }))
  .sort((a, b) => a.lv.n - b.lv.n || variantRank(a.lv.variant) - variantRank(b.lv.variant) || a.i - b.i)
  .map(({ lv }) => lv);

function variantRank(v: Variant): number {
  return v === 'legacy' ? 0 : v === 'simple' ? 1 : 0;
}

export function levelById(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** 駒がもう使えるか（解の保証なしのレベルは、loadPieces が済むまで使えない） */
export function piecesReady(level: LevelDef): boolean {
  return pieceSets.has(level.n);
}

// 駒の別ファイル（ビルドでは別々の小さなファイルに分かれ、要るときにだけ読まれる）
const pieceFiles = import.meta.glob<{ format: number; n: number; shapes: string[] }>('../data/pieces-*.json', { import: 'default' });

/** 形の文字列（'/' で行区切り、'#' がマス）をマスの一覧に */
function parseShape(str: string): Cell[] {
  const cells: Cell[] = [];
  str.split('/').forEach((line, y) => [...line].forEach((ch, x) => { if (ch === '#') cells.push([x, y]); }));
  return normalize(cells);
}

/** 解の保証なしのレベルの駒を読み込む。名前は通し番号（製造機の並び順。§3.1）、穴はここで求める */
export async function loadPieces(level: LevelDef): Promise<void> {
  if (pieceSets.has(level.n)) return;
  const load = pieceFiles[`../data/pieces-${level.n}.json`];
  if (!load) throw new Error(`n=${level.n} の駒のファイルが無い`);
  const file = await load();
  if (file.format !== 1 || file.n !== level.n) throw new Error(`pieces-${level.n}.json の形式が違う`);
  pieceSets.set(level.n, file.shapes.map((sh, i) => {
    const cells = parseShape(sh);
    return { name: String(i + 1), cells, holes: holesOf(cells) };
  }));
}

export function piecesOf(level: LevelDef): PieceDef[] {
  const ps = pieceSets.get(level.n);
  if (!ps) throw new Error(`n=${level.n} の駒が無い`);
  return ps;
}

const cellsCache = new WeakMap<LevelDef, Cell[]>();

/** 盤面のマスの一覧（大きい盤面もあるので、作ったものを使い回す。書き換えないこと） */
export function boardCells(level: LevelDef): Cell[] {
  const hit = cellsCache.get(level);
  if (hit) return hit;
  const out: Cell[] = [];
  level.board.forEach((line, y) => [...line].forEach((ch, x) => { if (ch === '#') out.push([x, y]); }));
  cellsCache.set(level, out);
  return out;
}

/** 盤面を行ごとの横の並び（y, 左端 x0, 右端の次 x1）にしたもの。大きい盤面を少ない四角で描くため */
export function boardRuns(level: LevelDef): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  level.board.forEach((line, y) => {
    for (const m of line.matchAll(/#+/g)) out.push([y, m.index!, m.index! + m[0].length]);
  });
  return out;
}

export function boardSize(level: LevelDef): { w: number; h: number } {
  return { w: Math.max(...level.board.map((l) => l.length)), h: level.board.length };
}

/** 駒の総数（同じ形の個数も数える） */
export function pieceTotal(level: LevelDef): number {
  return level.kinds * level.count;
}
