/**
 * サイズインデックスの取得とキャッシュ（第1分冊 3.3.2 / 4.3）
 *
 * `index.json` は軽量なため**メモリキャッシュのみ**とし、IndexedDB へは保存しない。
 * セッションをまたいだ再取得は許容する（3.3.2）。
 */

import { DATA_BASE_PATH } from './config';
import { fetchJson } from './fetchJson';
import { sizeDir } from './manifest';
import {
  parseSizeIndex,
  type BoardSize,
  type ChunkSummary,
  type Difficulty,
  type Result,
  type SizeIndex,
} from './types';

const memory = new Map<BoardSize, SizeIndex>();

export interface ChunkFilterResult {
  chunks: ChunkSummary[];
  /** 難易度指定が満たせずフォールバックしたか。**UI表示には用いない**（3.5.2） */
  fellBack: boolean;
}

/** サイズインデックスを取得する。メモリキャッシュを優先する */
export async function load(n: BoardSize): Promise<Result<SizeIndex>> {
  const cached = memory.get(n);
  if (cached) return { ok: true, value: cached };

  const raw = await fetchJson(`${DATA_BASE_PATH}${sizeDir(n)}/index.json`);
  if (!raw.ok) return raw;

  const parsed = parseSizeIndex(raw.value, n);
  if (!parsed.ok) return parsed;

  memory.set(n, parsed.value);
  return parsed;
}

/**
 * 難易度を含むチャンクのみを返す。
 * **候補が0件なら全チャンクへ戻す**（フォールバック・通知なし・3.3.2 手順[3]）。
 */
export function filterChunks(index: SizeIndex, difficulty: Difficulty | null): ChunkFilterResult {
  if (difficulty === null) {
    return { chunks: index.chunks, fellBack: false };
  }
  const matched = index.chunks.filter((c) => c.difficultyCount[difficulty] > 0);
  if (matched.length === 0) {
    return { chunks: index.chunks, fellBack: true };
  }
  return { chunks: matched, fellBack: false };
}

/** メモリキャッシュを破棄する */
export function invalidate(n?: BoardSize): void {
  if (n === undefined) memory.clear();
  else memory.delete(n);
}

export const indexLoader = { load, filterChunks, invalidate };
