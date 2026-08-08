/**
 * チャンクの取得と選択（第1分冊 3.3.3 / 4.4）
 *
 * 取得済みのものを優先して通信量を抑えつつ、出題が偏らないよう一定確率で未取得を選ぶ。
 */

import { chunkCache } from '../storage/chunkCache';
import { DATA_BASE_PATH, UNCACHED_CHUNK_PROBABILITY } from './config';
import { fetchJson } from './fetchJson';
import { sizeDir } from './manifest';
import { err, ok, parseChunk, type BoardSize, type Chunk, type ChunkSummary, type Result } from './types';

/** チャンクを取得する。IndexedDB キャッシュを優先する */
export async function load(n: BoardSize, file: string): Promise<Result<Chunk>> {
  const cached = await chunkCache.get(n, file);
  if (cached !== null) return ok(cached);

  const raw = await fetchJson(`${DATA_BASE_PATH}${sizeDir(n)}/${file}`);
  if (!raw.ok) return raw;

  const parsed = parseChunk(raw.value, n);
  if (!parsed.ok) return parsed;

  // 書き込みに失敗しても取得自体は成立しているため、縮退して続ける
  await chunkCache.put(n, file, parsed.value);
  return parsed;
}

/**
 * 候補から1チャンクを選ぶ。
 * キャッシュ済みを優先し、`UNCACHED_CHUNK_PROBABILITY` の確率で未取得を選ぶ（3.3.3）。
 */
export async function select(
  n: BoardSize,
  candidates: ChunkSummary[],
): Promise<Result<ChunkSummary>> {
  if (candidates.length === 0) {
    return err('DATA_INVALID', '候補チャンクが1件も無い');
  }

  const cachedKeys = new Set(await chunkCache.listKeys(n));
  const cached = candidates.filter((c) => cachedKeys.has(`${n}/${c.file}`));
  const uncached = candidates.filter((c) => !cachedKeys.has(`${n}/${c.file}`));

  if (cached.length === 0) return ok(pickOne(uncached));
  if (uncached.length === 0) return ok(pickOne(cached));

  const takeUncached = Math.random() < UNCACHED_CHUNK_PROBABILITY;
  return ok(pickOne(takeUncached ? uncached : cached));
}

/**
 * 候補から1チャンクを**確実に手に入れる**（3.3.3 / 4.4・C-152）。
 *
 * 選ぶ役（`select`）と取る役（`load`）は別であり、
 * **未取得チャンクの取得に失敗したらキャッシュ済みへ切り替える**という規定を担う役が
 * どちらにも属していなかった。ここがその役である。
 *
 * キャッシュ済みも尽きた場合は最初の失敗をそのまま返し、オフライン処理（3.9.3）へ委ねる。
 */
export async function acquire(n: BoardSize, candidates: ChunkSummary[]): Promise<Result<Chunk>> {
  const chosen = await select(n, candidates);
  if (!chosen.ok) return chosen;

  const first = await load(n, chosen.value.file);
  if (first.ok) return first;

  // 取得済みのものは通信を伴わないため、順に試しても待たされない
  const cached = await listCached(n);
  for (const summary of candidates) {
    if (summary.file === chosen.value.file) continue;
    if (!cached.includes(summary.file)) continue;
    const fallback = await load(n, summary.file);
    if (fallback.ok) return fallback;
  }

  return first;
}

/** 指定サイズのキャッシュ済みチャンクを列挙する */
export async function listCached(n: BoardSize): Promise<string[]> {
  const keys = await chunkCache.listKeys(n);
  const prefix = `${n}/`;
  return keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
}

function pickOne<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export const chunkLoader = { load, select, acquire, listCached };
