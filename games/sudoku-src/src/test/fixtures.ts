/**
 * 検査で使う配信データの読み出し。
 *
 * **作り物ではなく、実際に配る予定のファイルそのもの**を読む。
 * 目次と索引が食い違っていた第5セッションの取りこぼしは、実物を見れば出る種類の不整合であった。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseChunk, type BoardSize, type Puzzle } from '../data/types';

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(here, '..', '..', 'public', 'data');

export function readData(relPath: string): unknown {
  return JSON.parse(readFileSync(resolve(DATA_DIR, relPath), 'utf-8')) as unknown;
}

export function readDataText(relPath: string): string {
  return readFileSync(resolve(DATA_DIR, relPath), 'utf-8');
}

export function sizeDirName(n: number): string {
  return `n${String(n).padStart(2, '0')}`;
}

/** 在庫があり、実物を読めるサイズ（`manifest.json` の `released` と一致する） */
export const RELEASED_SIZES: readonly BoardSize[] = [1, 4, 9, 16, 25];

/** 在庫が空で、実物を読めないサイズ。検査では合成盤面で代用する */
export const UNRELEASED_SIZES: readonly BoardSize[] = [36, 49];

/** 実物の先頭チャンクを読み、検証を通した問題を返す */
export function firstChunkPuzzles(n: BoardSize): Puzzle[] {
  const parsed = parseChunk(readData(`${sizeDirName(n)}/c0000.json`), n);
  if (!parsed.ok) throw new Error(`${n}×${n} の先頭チャンクを読めない: ${parsed.error.message}`);
  return parsed.value.puzzles;
}

/**
 * 合成の完成盤。**36×36 と 49×49 は在庫が空で実物が無い**ため、検査ではこれを使う。
 *
 * `value(r, c) = ((b·(r mod b) + ⌊r/b⌋ + c) mod N) + 1` は任意の `N = b²` で数独制約を満たす。
 * **サイズごとの場合分けは無い**（全サイズで同じ式が通る）。在庫を貯めたら実物へ置き換える。
 */
export function syntheticSolution(n: BoardSize, b: number): number[] {
  const grid = new Array<number>(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      grid[row * n + col] = ((b * (row % b) + Math.floor(row / b) + col) % n) + 1;
    }
  }
  return grid;
}

/** 合成の元問題。`keepEvery` マスに1つだけヒントを残す */
export function syntheticPuzzle(n: BoardSize, b: number, keepEvery = 3): Puzzle {
  const solution = syntheticSolution(n, b);
  const puzzle = solution.map((v, i) => (i % keepEvery === 0 ? v : 0));
  const clueCount = puzzle.filter((v) => v !== 0).length;
  return {
    schemaVersion: '1.04',
    id: `N${String(n).padStart(2, '0')}-SYNTH1`,
    hash: '00000000',
    n,
    b,
    difficulty: 'Easy',
    clueCount,
    clueRatio: clueCount / (n * n),
    puzzle,
    solution,
    generator: {
      appVersion: 'test',
      algo: 'synthetic',
      createdAt: '2026-08-06T00:00:00.000Z',
      genTimeMs: 0,
      truncated: false,
    },
  };
}
