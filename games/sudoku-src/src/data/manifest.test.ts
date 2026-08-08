/**
 * 受入条件 2-1（解放済みサイズだけが選択肢になる）
 *
 * 実際に配る `public/data/manifest.json` そのものを読んで確かめる。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readData } from '../test/fixtures';
import { resetInFlight } from './fetchJson';
import { load, loadCached, releasedSizes, sizeDir, sizeEntry } from './manifest';
import { parseManifest, type Manifest } from './types';

const REAL_MANIFEST = readData('manifest.json');

function stubFetchOk(body: unknown) {
  const mock = vi.fn(
    async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) }) as unknown as Response,
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('マニフェスト（3.3.2 / 4.2）', () => {
  beforeEach(() => {
    resetInFlight();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('サイズディレクトリ名は n ＋ 2桁ゼロ詰め', () => {
    expect(sizeDir(1)).toBe('n01');
    expect(sizeDir(9)).toBe('n09');
    expect(sizeDir(49)).toBe('n49');
  });

  it('2-1: 配る予定のマニフェストが、そのまま読める', () => {
    const parsed = parseManifest(REAL_MANIFEST);
    expect(parsed.ok).toBe(true);
  });

  it('2-1: 配る予定の全7サイズが選択肢として返る', async () => {
    stubFetchOk(REAL_MANIFEST);

    const result = await load();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(releasedSizes(result.value)).toEqual([1, 4, 9, 16, 25, 36, 49]);
  });

  it('2-1: 在庫のあるサイズは件数も入っている', async () => {
    stubFetchOk(REAL_MANIFEST);
    const result = await load();
    if (!result.ok) throw new Error('取得に失敗した');

    for (const n of [4, 9, 16, 25, 36, 49] as const) {
      const entry = sizeEntry(result.value, n);
      expect(entry, `${n}×${n} のエントリが無い`).not.toBeNull();
      expect(entry?.released, `${n}×${n} が未解放`).toBe(true);
      expect(entry?.count, `${n}×${n} の件数`).toBe(100);
    }
  });

  /**
   * **絞り込みの働きそのものは、実物とは別に見張る。**
   * 全サイズを解放したことで実物からは未解放が消えたが、絞り込みが壊れても気づけないと困る
   * （第17セッション。在庫を貯めて 36 / 49 を解放したときに、この検査だけ作り物へ移した）。
   */
  it('2-1: 未解放のサイズは選択肢から外れ、エントリとしては引ける', async () => {
    const partial = {
      ...(REAL_MANIFEST as Manifest),
      sizes: (REAL_MANIFEST as Manifest).sizes.map((s) =>
        s.n === 49 ? { ...s, released: false, count: 0 } : s,
      ),
    };
    stubFetchOk(partial);

    const result = await load();
    if (!result.ok) throw new Error('取得に失敗した');

    expect(releasedSizes(result.value)).not.toContain(49);
    const n49 = sizeEntry(result.value, 49);
    expect(n49).not.toBeNull();
    expect(n49?.released).toBe(false);
    expect(n49?.count).toBe(0);
  });

  it('取得に成功すると退避され、次はオフラインでも読める（3.9.3）', async () => {
    stubFetchOk(REAL_MANIFEST);
    await load();

    const cached = loadCached();
    expect(cached).not.toBeNull();
    expect(releasedSizes(cached as Manifest)).toEqual([1, 4, 9, 16, 25, 36, 49]);
  });

  it('退避したものが対応しない版なら、破棄して未取得と同じ扱いにする', () => {
    const stale = { ...(REAL_MANIFEST as object), schemaVersion: '2.00' };
    localStorage.setItem('momo.sudoku.manifest.cache', JSON.stringify(stale));

    expect(loadCached()).toBeNull();
    expect(localStorage.getItem('momo.sudoku.manifest.cache')).toBeNull();
  });

  it('メジャー版が違うマニフェストは非互換として返る（3.4）', async () => {
    stubFetchOk({ ...(REAL_MANIFEST as object), schemaVersion: '2.00' });

    const result = await load();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('SCHEMA_INCOMPATIBLE');
  });

  it('マイナー版だけの違いは受理する（3.4）', async () => {
    stubFetchOk({ ...(REAL_MANIFEST as object), schemaVersion: '1.03' });

    const result = await load();
    expect(result.ok).toBe(true);
  });
});
