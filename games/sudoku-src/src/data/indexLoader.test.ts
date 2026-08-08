/**
 * 受入条件 2-4（難易度によるチャンク絞込と、候補0件のときの戻し）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readData } from '../test/fixtures';
import { resetInFlight } from './fetchJson';
import { filterChunks, invalidate, load } from './indexLoader';
import { parseSizeIndex, type SizeIndex } from './types';

const N09 = readData('n09/index.json');
const N01 = readData('n01/index.json');

function indexOf(raw: unknown, n: 1 | 9): SizeIndex {
  const parsed = parseSizeIndex(raw, n);
  if (!parsed.ok) throw new Error('索引が読めない');
  return parsed.value;
}

describe('サイズインデックス（3.3.2 / 4.3）', () => {
  beforeEach(() => {
    resetInFlight();
    invalidate();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('2-4: 難易度を指定すると、その難易度を含むチャンクだけが候補になる', () => {
    const index = indexOf(N09, 9);

    const hard = filterChunks(index, 'Hard');
    expect(hard.fellBack).toBe(false);
    expect(hard.chunks.map((c) => c.file)).toEqual(['c0001.json']);

    const apoc = filterChunks(index, 'Apocalypse');
    expect(apoc.chunks.map((c) => c.file)).toEqual(['c0000.json']);

    const easy = filterChunks(index, 'Easy');
    expect(easy.chunks.map((c) => c.file)).toEqual(['c0002.json', 'c0003.json']);
  });

  it('2-4: 候補が0件のときは全チャンクへ戻る（通知しない）', () => {
    // 1×1 の在庫は Easy 1件のみ。Hard を指定すると候補は0件になる
    const index = indexOf(N01, 1);

    const hard = filterChunks(index, 'Hard');
    expect(hard.fellBack).toBe(true);
    expect(hard.chunks).toHaveLength(index.chunks.length);
  });

  it('2-4: 難易度を指定しなければ全チャンクが候補になる', () => {
    const index = indexOf(N09, 9);
    const all = filterChunks(index, null);
    expect(all.fellBack).toBe(false);
    expect(all.chunks).toHaveLength(4);
  });

  it('索引はメモリに残り、同じセッション中は取り直さない（3.3.2）', async () => {
    const fetchMock = vi.fn(
      async () => ({ ok: true, status: 200, text: async () => JSON.stringify(N09) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await load(9);
    const second = await load(9);

    expect(first.ok && second.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    invalidate(9);
    await load(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('索引のサイズが要求と食い違えば不正として返す', () => {
    const parsed = parseSizeIndex(N09, 16);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('DATA_INVALID');
  });
});
