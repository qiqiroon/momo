/**
 * 受入条件 2-7（2回目は通信せずに読める）／ 2-8（スキーマ版が変われば全件破棄）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkCache, resetForTest } from '../storage/chunkCache';
import { readData } from '../test/fixtures';
import { load, listCached, select } from './chunkLoader';
import { resetInFlight } from './fetchJson';
import { parseChunk, type Chunk, type ChunkSummary } from './types';

const RAW_N09_C0 = readData('n09/c0000.json');
const N09_INDEX = readData('n09/index.json') as { chunks: ChunkSummary[] };

function chunkOf(raw: unknown): Chunk {
  const parsed = parseChunk(raw, 9);
  if (!parsed.ok) throw new Error('チャンクが読めない');
  return parsed.value;
}

async function wipeCache(): Promise<void> {
  await chunkCache.clearAll();
  resetForTest();
}

describe('チャンクの取得と選択（3.3.3 / 3.6.5 / 4.4）', () => {
  beforeEach(async () => {
    resetInFlight();
    await wipeCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('2-7: 1回目は取得し、2回目は通信せずキャッシュから読める', async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify(RAW_N09_C0) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await load(9, 'c0000.json');
    expect(first.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await load(9, 'c0000.json');
    expect(second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // 通信していない

    if (first.ok && second.ok) {
      expect(second.value.puzzles.map((p) => p.id)).toEqual(first.value.puzzles.map((p) => p.id));
    }
  });

  it('2-7: キャッシュ済みのチャンクは列挙できる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(RAW_N09_C0) }) as unknown as Response),
    );

    expect(await listCached(9)).toEqual([]);
    await load(9, 'c0000.json');
    expect(await listCached(9)).toEqual(['c0000.json']);
    expect(await listCached(16)).toEqual([]);
  });

  it('2-8: スキーマ版が変わると、保存済みのチャンクは全件破棄される', async () => {
    // 旧版（1.03）で保存されていた状況を作る
    const old = chunkOf(RAW_N09_C0);
    await chunkCache.put(9, 'c0000.json', { ...old, schemaVersion: '1.03' });
    await chunkCache.put(9, 'c0001.json', { ...old, schemaVersion: '1.03' });
    expect(await chunkCache.listKeys()).toHaveLength(2);

    // アプリを開き直す（対応版は 1.04）
    resetForTest();
    expect(await chunkCache.listKeys()).toEqual([]);
  });

  it('2-8: 現行版のチャンクは開き直しても残る', async () => {
    await chunkCache.put(9, 'c0000.json', chunkOf(RAW_N09_C0));
    resetForTest();
    expect(await chunkCache.listKeys()).toEqual(['9/c0000.json']);
  });

  it('候補のうちキャッシュ済みがあれば、それを優先して選ぶ', async () => {
    const candidates = N09_INDEX.chunks;
    await chunkCache.put(9, 'c0002.json', chunkOf(RAW_N09_C0));

    // 未取得を選ぶ確率（0.2）を外して、確実にキャッシュ側を引く
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const chosen = await select(9, candidates);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.file).toBe('c0002.json');

    vi.mocked(Math.random).mockRestore();
  });

  it('一定確率で未取得のチャンクを選ぶ（出題が偏らないように）', async () => {
    const candidates = N09_INDEX.chunks;
    await chunkCache.put(9, 'c0002.json', chunkOf(RAW_N09_C0));

    vi.spyOn(Math, 'random').mockReturnValue(0.0);

    const chosen = await select(9, candidates);
    expect(chosen.ok).toBe(true);
    if (chosen.ok) expect(chosen.value.file).not.toBe('c0002.json');

    vi.mocked(Math.random).mockRestore();
  });

  it('候補が無ければ不正として返す', async () => {
    const chosen = await select(9, []);
    expect(chosen.ok).toBe(false);
  });

  it('壊れた問題は1件だけ除き、残りを使う（3.9.4）', () => {
    const raw = structuredClone(RAW_N09_C0) as { puzzles: unknown[] };
    raw.puzzles[0] = { ...(raw.puzzles[0] as object), solution: '1,2,3' }; // 長さが合わない

    const parsed = parseChunk(raw, 9);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.puzzles).toHaveLength(24);
  });

  it('全部壊れていれば、そのチャンクは使わない（3.9.4）', () => {
    const raw = structuredClone(RAW_N09_C0) as { puzzles: unknown[] };
    raw.puzzles = raw.puzzles.map((p) => ({ ...(p as object), solution: '1,2,3' }));

    const parsed = parseChunk(raw, 9);
    expect(parsed.ok).toBe(false);
  });
});
