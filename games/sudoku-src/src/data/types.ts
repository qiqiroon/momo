/**
 * データ層の型定義と検証（第1分冊 3.2 / 4.1）
 *
 * 配信データの型は設計書 2章のスキーマに1対1で対応する。
 * 取得した JSON はここで検証してから上位層へ渡す。**上位層は文字列表現を扱わない**（3.2.1）。
 */

import { SUPPORTED_SCHEMA_VERSION } from './config';

// ---------------------------------------------------------------- 基本型（3.2.1）

/** 対応サイズ。N = b² */
export type BoardSize = 1 | 4 | 9 | 16 | 25 | 36 | 49;

/** 難易度ランク */
export type Difficulty = 'Easy' | 'Hard' | 'Apocalypse';

/** 難易度別件数 */
export type DifficultyCount = Record<Difficulty, number>;

/** 盤面。行優先の1次元配列。0 = 空、1..N = 確定値 */
export type Grid = number[];

/** 元問題の識別子。例 "N25-000001" */
export type PuzzleId = string;

/** solution の SHA-256 先頭8桁（小文字16進） */
export type PuzzleHash = string;

export const BOARD_SIZES: readonly BoardSize[] = [1, 4, 9, 16, 25, 36, 49];
export const DIFFICULTIES: readonly Difficulty[] = ['Easy', 'Hard', 'Apocalypse'];

// ---------------------------------------------------------------- 配信データ（3.2.2〜3.2.5）

export interface GeneratorMeta {
  appVersion: string;
  algo: string;
  createdAt: string;
  genTimeMs: number;
  truncated: boolean;
}

export interface Puzzle {
  schemaVersion: string;
  id: PuzzleId;
  hash: PuzzleHash;
  n: BoardSize;
  b: number;
  difficulty: Difficulty;
  clueCount: number;
  clueRatio: number;
  puzzle: Grid;
  solution: Grid;
  generator: GeneratorMeta;
}

export interface SizeEntry {
  n: BoardSize;
  released: boolean;
  count: number;
  path: string;
}

export interface Manifest {
  schemaVersion: string;
  updatedAt: string;
  sizes: SizeEntry[];
}

export interface ChunkSummary {
  file: string;
  count: number;
  idRange: [PuzzleId, PuzzleId];
  difficultyCount: DifficultyCount;
  clueRatioRange: [number, number];
  truncatedCount: number;
}

export interface SizeIndex {
  schemaVersion: string;
  n: BoardSize;
  b: number;
  released: boolean;
  count: number;
  chunkSize: number;
  updatedAt: string;
  difficultyCount: DifficultyCount;
  chunks: ChunkSummary[];
}

export interface Chunk {
  schemaVersion: string;
  n: BoardSize;
  count: number;
  puzzles: Puzzle[];
}

// ---------------------------------------------------------------- ユーザーデータ（3.2.6）

export type LocaleCode = 'ja' | 'en' | 'zh' | 'cat';

/** ルーペを置く角（C-185）。既定は右上 */
export type LoupeCorner = 'TOP_LEFT' | 'TOP_RIGHT' | 'BOTTOM_LEFT' | 'BOTTOM_RIGHT';

export const LOUPE_CORNERS: readonly LoupeCorner[] = [
  'TOP_LEFT',
  'TOP_RIGHT',
  'BOTTOM_LEFT',
  'BOTTOM_RIGHT',
];

export function isLoupeCorner(value: unknown): value is LoupeCorner {
  return typeof value === 'string' && (LOUPE_CORNERS as readonly string[]).includes(value);
}

export interface Settings {
  locale: LocaleCode;
  lastSize: BoardSize | null;
  lastDifficulty: Difficulty | null;
  /** fitZoom に対する比（絶対倍率ではない・R-21） */
  zoomPreference: number | null;
  recentBufferSize: number;
  undoLimit: number;
  soundEnabled: boolean;
  soundVolume: number;
  hapticEnabled: boolean;
  /** ルーペを置く角（C-185） */
  loupeCorner: LoupeCorner;
  /** ルーペを開いているか（C-189）。**次回も同じ状態で始める** */
  loupeOpen: boolean;
  /**
   * ルーペが映す幅（セル数・C-189）。3 なら 3×3、0.33 なら1マスの3分の1。
   * **小さいほど拡大**である。
   */
  loupeSpan: number;
  /** 数字ボタンの大きさの倍率（C-190）。1 が既定 */
  paletteScale: number;
}

export interface StatsEntry {
  clearCount: number;
  failedCount: number;
  bestTimeMs: number | null;
  hintUsedTotal: number;
  playCount: number;
}

export type StatsKey = `${BoardSize}:${Difficulty}`;

export interface Stats {
  schemaVersion: string;
  entries: Record<StatsKey, StatsEntry>;
  updatedAt: string;
}

export interface RecentIds {
  schemaVersion: string;
  bufferSize: number;
  /** 新しいものが末尾 */
  buffers: Partial<Record<BoardSize, PuzzleId[]>>;
}

/**
 * 変換パラメータ。中身はドメイン層（第2分冊）が定義する。
 * **データ層は内容を解釈せず、シリアライズ可能な値としてそのまま保存・復元する**（3.2.6）。
 */
export type TransformParams = unknown;

/** 中断セッション。全体で1件のみ */
export interface SuspendedSession {
  schemaVersion: string;
  savedAt: string;
  sourceId: PuzzleId;
  n: BoardSize;
  difficulty: Difficulty;
  transformParams: TransformParams;
  /** ユーザー入力値（ヒントセルは0） */
  entered: Grid;
  /** 候補メモ。セルごとの値配列 */
  notes: number[][];
  elapsedMs: number;
  mistakeCount: number;
  failed: boolean;
  hintUsed: number;
}

export interface StorageMeta {
  /** ユーザーデータのスキーマ版。**移行の要否はこの値のみで判定する**（3.6.2） */
  storageVersion: string;
  appVersion: string;
  updatedAt: string;
}

export interface ExportBundle {
  format: 'momo-sudoku-backup';
  storageVersion: string;
  appVersion: string;
  exportedAt: string;
  settings: Settings;
  stats: Stats;
  recent: RecentIds;
  session: SuspendedSession | null;
}

/** 1セッション分の結果（4.7）。`mistakeCount` は表示専用で保存しない */
export interface SessionResult {
  n: BoardSize;
  difficulty: Difficulty;
  completed: boolean;
  failed: boolean;
  elapsedMs: number;
  hintUsed: number;
  mistakeCount: number;
}

// ---------------------------------------------------------------- 結果型（4.1）

export type DataErrorKind =
  | 'NETWORK'
  | 'SCHEMA_INCOMPATIBLE'
  | 'DATA_INVALID'
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_FULL';

export interface DataError {
  kind: DataErrorKind;
  message: string;
  retryable: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: DataError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T>(kind: DataErrorKind, message: string, retryable = false): Result<T> {
  return { ok: false, error: { kind, message, retryable } };
}

// ---------------------------------------------------------------- スキーマ版の照合（3.4）

export type SchemaVerdict = 'ok' | 'incompatible' | 'invalid';

/**
 * 配信データのスキーマ版を対応版と照合する。
 * **メジャー部分（整数部）が異なる場合のみ非互換**とし、マイナー差は受理する（3.4）。
 */
export function checkSchema(version: unknown): SchemaVerdict {
  if (typeof version !== 'string') return 'invalid';
  const major = majorOf(version);
  if (major === null) return 'invalid';
  const supported = majorOf(SUPPORTED_SCHEMA_VERSION);
  return major === supported ? 'ok' : 'incompatible';
}

function majorOf(version: string): number | null {
  const head = version.split('.')[0];
  if (!/^\d+$/.test(head)) return null;
  return Number(head);
}

// ---------------------------------------------------------------- 検証の下ごしらえ

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBoardSize(v: unknown): v is BoardSize {
  return typeof v === 'number' && (BOARD_SIZES as readonly number[]).includes(v);
}

function isDifficulty(v: unknown): v is Difficulty {
  return typeof v === 'string' && (DIFFICULTIES as readonly string[]).includes(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isDifficultyCount(v: unknown): v is DifficultyCount {
  if (!isRecord(v)) return false;
  return DIFFICULTIES.every((d) => isFiniteNumber(v[d]));
}

/**
 * `,` 区切りの数値列を Grid へデコードする（3.2.1）。
 * 長さが N×N であること、各要素が 0..N の整数であることを検証する。
 */
export function decodeGrid(raw: unknown, n: BoardSize): Grid | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length !== n * n) return null;
  const grid: Grid = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const value = Number(parts[i]);
    if (!Number.isInteger(value) || value < 0 || value > n) return null;
    grid[i] = value;
  }
  return grid;
}

// ---------------------------------------------------------------- 配信データの検証

export function parseManifest(raw: unknown): Result<Manifest> {
  if (!isRecord(raw)) return err('DATA_INVALID', 'マニフェストが object ではない');

  const verdict = checkSchema(raw.schemaVersion);
  if (verdict === 'invalid') return err('DATA_INVALID', 'マニフェストの schemaVersion が不正');
  if (verdict === 'incompatible') {
    return err('SCHEMA_INCOMPATIBLE', `対応しないスキーマ版: ${String(raw.schemaVersion)}`);
  }
  if (typeof raw.updatedAt !== 'string') return err('DATA_INVALID', 'マニフェストの updatedAt が不正');
  if (!Array.isArray(raw.sizes)) return err('DATA_INVALID', 'マニフェストの sizes が配列ではない');

  const sizes: SizeEntry[] = [];
  for (const entry of raw.sizes) {
    if (!isRecord(entry)) return err('DATA_INVALID', 'サイズエントリが object ではない');
    if (!isBoardSize(entry.n)) return err('DATA_INVALID', `未対応のサイズ: ${String(entry.n)}`);
    if (typeof entry.released !== 'boolean') return err('DATA_INVALID', 'released が boolean ではない');
    if (!isFiniteNumber(entry.count)) return err('DATA_INVALID', 'count が数値ではない');
    if (typeof entry.path !== 'string') return err('DATA_INVALID', 'path が文字列ではない');
    sizes.push({ n: entry.n, released: entry.released, count: entry.count, path: entry.path });
  }

  return ok({ schemaVersion: raw.schemaVersion as string, updatedAt: raw.updatedAt, sizes });
}

export function parseSizeIndex(raw: unknown, expectedN: BoardSize): Result<SizeIndex> {
  if (!isRecord(raw)) return err('DATA_INVALID', 'インデックスが object ではない');

  const verdict = checkSchema(raw.schemaVersion);
  if (verdict === 'invalid') return err('DATA_INVALID', 'インデックスの schemaVersion が不正');
  if (verdict === 'incompatible') {
    return err('SCHEMA_INCOMPATIBLE', `対応しないスキーマ版: ${String(raw.schemaVersion)}`);
  }
  if (!isBoardSize(raw.n) || raw.n !== expectedN) {
    return err('DATA_INVALID', `インデックスのサイズが一致しない: ${String(raw.n)}`);
  }
  if (!isFiniteNumber(raw.b)) return err('DATA_INVALID', 'b が数値ではない');
  if (typeof raw.released !== 'boolean') return err('DATA_INVALID', 'released が boolean ではない');
  if (!isFiniteNumber(raw.count)) return err('DATA_INVALID', 'count が数値ではない');
  if (!isFiniteNumber(raw.chunkSize)) return err('DATA_INVALID', 'chunkSize が数値ではない');
  if (typeof raw.updatedAt !== 'string') return err('DATA_INVALID', 'updatedAt が不正');
  if (!isDifficultyCount(raw.difficultyCount)) return err('DATA_INVALID', 'difficultyCount が不正');
  if (!Array.isArray(raw.chunks)) return err('DATA_INVALID', 'chunks が配列ではない');

  const chunks: ChunkSummary[] = [];
  for (const c of raw.chunks) {
    if (!isRecord(c)) return err('DATA_INVALID', 'チャンク要約が object ではない');
    if (typeof c.file !== 'string') return err('DATA_INVALID', 'チャンク要約の file が不正');
    if (!isFiniteNumber(c.count)) return err('DATA_INVALID', 'チャンク要約の count が不正');
    if (!isDifficultyCount(c.difficultyCount)) {
      return err('DATA_INVALID', 'チャンク要約の difficultyCount が不正');
    }
    const idRange = asPair<string>(c.idRange, (v): v is string => typeof v === 'string');
    if (idRange === null) return err('DATA_INVALID', 'チャンク要約の idRange が不正');
    const clueRatioRange = asPair<number>(c.clueRatioRange, isFiniteNumber);
    if (clueRatioRange === null) return err('DATA_INVALID', 'チャンク要約の clueRatioRange が不正');
    if (!isFiniteNumber(c.truncatedCount)) return err('DATA_INVALID', 'truncatedCount が不正');
    chunks.push({
      file: c.file,
      count: c.count,
      idRange,
      difficultyCount: c.difficultyCount,
      clueRatioRange,
      truncatedCount: c.truncatedCount,
    });
  }

  return ok({
    schemaVersion: raw.schemaVersion as string,
    n: raw.n,
    b: raw.b,
    released: raw.released,
    count: raw.count,
    chunkSize: raw.chunkSize,
    updatedAt: raw.updatedAt,
    difficultyCount: raw.difficultyCount,
    chunks,
  });
}

function asPair<T>(raw: unknown, guard: (v: unknown) => v is T): [T, T] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  if (!guard(raw[0]) || !guard(raw[1])) return null;
  return [raw[0], raw[1]];
}

/**
 * チャンクを検証する。
 * **個別の問題が検証に失敗した場合は当該問題のみを除外**し、残りを使用する（3.9.4）。
 * 除外の結果が空になった場合は不正として返し、呼び出し側が別チャンクへ移る。
 */
export function parseChunk(raw: unknown, expectedN: BoardSize): Result<Chunk> {
  if (!isRecord(raw)) return err('DATA_INVALID', 'チャンクが object ではない');

  const verdict = checkSchema(raw.schemaVersion);
  if (verdict === 'invalid') return err('DATA_INVALID', 'チャンクの schemaVersion が不正');
  if (verdict === 'incompatible') {
    return err('SCHEMA_INCOMPATIBLE', `対応しないスキーマ版: ${String(raw.schemaVersion)}`);
  }
  if (!isBoardSize(raw.n) || raw.n !== expectedN) {
    return err('DATA_INVALID', `チャンクのサイズが一致しない: ${String(raw.n)}`);
  }
  if (!Array.isArray(raw.puzzles)) return err('DATA_INVALID', 'puzzles が配列ではない');

  const puzzles: Puzzle[] = [];
  let dropped = 0;
  for (const p of raw.puzzles) {
    const parsed = parsePuzzle(p, raw.n);
    if (parsed === null) dropped++;
    else puzzles.push(parsed);
  }

  if (puzzles.length === 0) {
    return err('DATA_INVALID', 'チャンクに使用できる問題が1件も無い');
  }
  if (dropped > 0) {
    console.warn(`[data] チャンクの問題 ${dropped} 件を検証失敗として除外した（3.9.4）`);
  }

  return ok({
    schemaVersion: raw.schemaVersion as string,
    n: raw.n,
    count: puzzles.length,
    puzzles,
  });
}

/** 1問を検証してデコードする。失敗時は null（呼び出し側が除外する） */
export function parsePuzzle(raw: unknown, expectedN: BoardSize): Puzzle | null {
  if (!isRecord(raw)) return null;
  if (checkSchema(raw.schemaVersion) !== 'ok') return null;
  if (typeof raw.id !== 'string' || raw.id.length === 0) return null;
  if (typeof raw.hash !== 'string') return null;
  if (!isBoardSize(raw.n) || raw.n !== expectedN) return null;
  if (!isFiniteNumber(raw.b)) return null;
  if (!isDifficulty(raw.difficulty)) return null;
  if (!isFiniteNumber(raw.clueCount)) return null;
  if (!isFiniteNumber(raw.clueRatio)) return null;

  const puzzle = decodeGrid(raw.puzzle, raw.n);
  if (puzzle === null) return null;
  const solution = decodeGrid(raw.solution, raw.n);
  if (solution === null) return null;

  const generator = parseGeneratorMeta(raw.generator);
  if (generator === null) return null;

  return {
    schemaVersion: raw.schemaVersion as string,
    id: raw.id,
    hash: raw.hash,
    n: raw.n,
    b: raw.b,
    difficulty: raw.difficulty,
    clueCount: raw.clueCount,
    clueRatio: raw.clueRatio,
    puzzle,
    solution,
    generator,
  };
}

function parseGeneratorMeta(raw: unknown): GeneratorMeta | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.appVersion !== 'string') return null;
  if (typeof raw.algo !== 'string') return null;
  if (typeof raw.createdAt !== 'string') return null;
  if (!isFiniteNumber(raw.genTimeMs)) return null;
  if (typeof raw.truncated !== 'boolean') return null;
  return {
    appVersion: raw.appVersion,
    algo: raw.algo,
    createdAt: raw.createdAt,
    genTimeMs: raw.genTimeMs,
    truncated: raw.truncated,
  };
}

// ---------------------------------------------------------------- ユーザーデータの検証で使う共通判定

export const guards = {
  isRecord,
  isBoardSize,
  isDifficulty,
  isFiniteNumber,
};
