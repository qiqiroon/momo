/**
 * 受入条件 2-2（並行要求のまとめ）／ 2-3（指数バックオフでの再試行）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DIAG_CAPACITY, diagnostics } from './diagnostics';
import { fetchJson, inFlightCount, resetInFlight } from './fetchJson';

/**
 * 応答の作り物。**本物と同じく文字列で受け取れる形**にする（C-168）。
 * `length` を指定すると「申告した長さ」だけを偽れるため、途中で切れた応答を作れる。
 */
function response(body: string, init?: { ok?: boolean; status?: number; length?: number }): Response {
  const declared = init?.length ?? body.length;
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    headers: { get: (name: string) => (name === 'content-length' ? String(declared) : null) },
    text: async () => body,
  } as unknown as Response;
}

describe('取り込みの共通作法（3.3.4）', () => {
  beforeEach(() => {
    resetInFlight();
    diagnostics.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('2-2: 同一URLへの並行要求が1回の通信にまとまる', async () => {
    let release!: (value: unknown) => void;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await gate;
      return response('{"hello":"world"}');
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = fetchJson('/data/manifest.json');
    const b = fetchJson('/data/manifest.json');
    const c = fetchJson('/data/other.json');

    expect(inFlightCount()).toBe(2); // 同じURLの2件は1つに畳まれている
    release(null);

    const [ra, rb] = await Promise.all([a, b, c]);
    expect(fetchMock).toHaveBeenCalledTimes(2); // manifest と other の2回だけ
    expect(ra).toEqual(rb);
    expect(inFlightCount()).toBe(0); // 済んだら片付く
  });

  it('2-2: 済んだあとの同じURLは、あらためて通信する', async () => {
    const fetchMock = vi.fn(async () => response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchJson('/data/manifest.json');
    await fetchJson('/data/manifest.json');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('2-3: 失敗すると 500ms → 1000ms と間を空けて2回まで挑み直す', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error('回線が無い');
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchJson('/data/manifest.json');

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).toHaveBeenCalledTimes(1); // まだ待っている

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1回目の挑み直し

    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 2回目は倍待つ

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('NETWORK');
      expect(result.error.retryable).toBe(true);
    }
    expect(fetchMock).toHaveBeenCalledTimes(3); // これ以上は挑まない
  });

  it('2-3: HTTP エラー応答も再試行の対象になる', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => response('{}', { ok: false, status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const pending = fetchJson('/data/manifest.json');
    await vi.advanceTimersByTimeAsync(2000);
    const result = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
  });

  it('中身が壊れているだけなら、取り直さずに諦める', async () => {
    const fetchMock = vi.fn(async () => response('JSON ではない'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchJson('/data/manifest.json');

    expect(fetchMock).toHaveBeenCalledTimes(1); // 何度取っても同じなので繰り返さない
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('DATA_INVALID');
  });

  // ---------------------------------------------------------------- 取り込みの記録（C-168）

  it('C-168: 取れたときは、かかった時間と受け取った長さを記録する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('{"a":1}')));

    await fetchJson('/data/n16/c0000.json');

    const [entry] = diagnostics.list();
    expect(entry.outcome).toBe('ok');
    expect(entry.status).toBe(200);
    expect(entry.receivedChars).toBe(7);
    expect(entry.declaredBytes).toBe(7);
    expect(entry.url).toBe('/data/n16/c0000.json');
  });

  it('C-168: 申告より短く届いたことが記録に残る（途中で切れた応答）', async () => {
    // 申告 88000 に対して実際は 5 字しか来ない＝転送が途中で終わっている姿
    vi.stubGlobal('fetch', vi.fn(async () => response('{"a":', { length: 88000 })));

    await fetchJson('/data/n25/c0000.json');

    const [entry] = diagnostics.list();
    expect(entry.outcome).toBe('parse'); // 読めないので中身の異常として扱う
    expect(entry.receivedChars).toBe(5);
    expect(entry.declaredBytes).toBe(88000); // **食い違いがそのまま残る**
    expect(diagnostics.formatRecord(entry)).toContain('5字/申告88000');
  });

  it('C-168: サーバーのエラー応答は番号ごと記録され、試みの回数も残る', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => response('404', { ok: false, status: 404 })));

    const pending = fetchJson('/data/n16/c0000.json');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    const entries = diagnostics.list();
    expect(entries).toHaveLength(3); // 初回＋挑み直し2回
    expect(entries.every((e) => e.outcome === 'http' && e.status === 404)).toBe(true);
    expect(entries[2].attempt).toBe(2);
    expect(diagnostics.formatRecord(entries[2])).toContain('3回目');
  });

  it('C-168: 時間切れは、ただの通信断とは別物として記録される', async () => {
    vi.useFakeTimers();
    // 応答しないまま放置される相手。打ち切りの合図で初めて終わる
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const e = new Error('中断');
              e.name = 'AbortError';
              reject(e);
            });
          }),
      ),
    );

    const pending = fetchJson('/data/n25/c0000.json');
    await vi.advanceTimersByTimeAsync(20000);

    expect(diagnostics.list()[0].outcome).toBe('timeout');
    await vi.advanceTimersByTimeAsync(60000);
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('時間切れ');
  });

  it('C-168: 通信そのものが成立しないときは offline として残る', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    const pending = fetchJson('/data/manifest.json');
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    const entries = diagnostics.list();
    expect(entries[0].outcome).toBe('offline');
    expect(entries[0].detail).toContain('Failed to fetch');
  });

  it('C-168: 記録は上限を超えると古いものから捨てられる', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response('{}')));

    for (let i = 0; i < DIAG_CAPACITY + 5; i++) {
      await fetchJson(`/data/x${i}.json`);
    }

    const entries = diagnostics.list();
    expect(entries).toHaveLength(DIAG_CAPACITY);
    expect(entries[0].seq).toBe(6); // 先頭の5件が押し出されている
    expect(entries[entries.length - 1].seq).toBe(DIAG_CAPACITY + 5);
  });
});
