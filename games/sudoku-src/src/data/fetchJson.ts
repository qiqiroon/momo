/**
 * 配信データ取得の共通作法（第1分冊 3.3.4）
 *
 * マニフェスト・インデックス・チャンクの3か所が同じ作法を必要とするため、ここに集約する。
 * **同一URLの重複排除は3か所を串刺しで見ないと成立しない**ため、進行中の要求はこのモジュールが1つだけ持つ。
 *
 * 仕様書 2.4 の部品一覧には無い裏方である（2026-08-06 に合意のうえ追加）。
 */

import { FETCH_RETRY_BASE_DELAY_MS, FETCH_RETRY_MAX, FETCH_TIMEOUT_MS } from './config';
import { diagnostics } from './diagnostics';
import { err, ok, type Result } from './types';

/** 進行中の要求。同一URLへの並行要求はこの Promise を共有する（3.3.4） */
const inFlight = new Map<string, Promise<Result<unknown>>>();

/**
 * JSON を1件取得する。
 *
 * - GET のみ。認証ヘッダ・Cookie は用いない
 * - gzip 解凍は配信側に委ね、こちらでは行わない
 * - タイムアウトは `FETCH_TIMEOUT_MS`
 * - 失敗時は指数バックオフで `FETCH_RETRY_MAX` 回まで再試行し、それでも失敗したらエラーを返す
 * - 同一URLへの並行要求は1回の通信にまとめる
 */
export function fetchJson(url: string): Promise<Result<unknown>> {
  const shared = inFlight.get(url);
  if (shared) return shared;

  const started = attemptWithRetry(url).finally(() => {
    inFlight.delete(url);
  });
  inFlight.set(url, started);
  return started;
}

/** 進行中の要求を捨てる。検査用 */
export function resetInFlight(): void {
  inFlight.clear();
}

/** 現在まとめられている要求の数。検査用 */
export function inFlightCount(): number {
  return inFlight.size;
}

async function attemptWithRetry(url: string): Promise<Result<unknown>> {
  let last: Result<unknown> = err('NETWORK', '取得を試行していない', true);

  for (let attempt = 0; attempt <= FETCH_RETRY_MAX; attempt++) {
    if (attempt > 0) {
      await sleep(FETCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    last = await attemptOnce(url, attempt);
    if (last.ok) return last;
    // 中身が壊れているだけなら何度取り直しても同じである
    if (!last.error.retryable) return last;
  }

  return last;
}

async function attemptOnce(url: string, attempt: number): Promise<Result<unknown>> {
  const controller = new AbortController();
  // **時間切れと、それ以外の中断を取り違えない**ため、打ち切ったのが自分かどうかを覚えておく
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);
  const startedAt = now();

  try {
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    if (!res.ok) {
      diagnostics.record({
        url,
        attempt,
        outcome: 'http',
        status: res.status,
        elapsedMs: now() - startedAt,
      });
      return err('NETWORK', `${url} が HTTP ${res.status} を返した`, true);
    }

    // **文字列で受けてから読む。**そうしないと「何文字受け取ったか」が分からず、
    // 途中で切れているのか、そもそも中身が違うのかを区別できない（C-168）
    const declaredBytes = declaredLength(res);
    const text = await res.text();
    try {
      const value = JSON.parse(text) as unknown;
      diagnostics.record({
        url,
        attempt,
        outcome: 'ok',
        status: res.status,
        elapsedMs: now() - startedAt,
        declaredBytes,
        receivedChars: text.length,
      });
      return ok(value);
    } catch {
      diagnostics.record({
        url,
        attempt,
        outcome: 'parse',
        status: res.status,
        elapsedMs: now() - startedAt,
        declaredBytes,
        receivedChars: text.length,
      });
      return err('DATA_INVALID', `${url} の中身が JSON として読めない（${text.length}字受信）`);
    }
  } catch (e: unknown) {
    const aborted = isAbort(e);
    diagnostics.record({
      url,
      attempt,
      outcome: timedOut ? 'timeout' : aborted ? 'aborted' : 'offline',
      elapsedMs: now() - startedAt,
      detail: describe(e),
    });
    if (timedOut) {
      return err('NETWORK', `${url} が ${FETCH_TIMEOUT_MS}ms で時間切れ`, true);
    }
    return err('NETWORK', `${url} を取得できない: ${describe(e)}`, true);
  } finally {
    clearTimeout(timer);
  }
}

/** サーバーの申告する長さ。ヘッダを持たない相手（検査の作り物など）でも落ちないようにする */
function declaredLength(res: Response): number | null {
  const raw = res.headers?.get?.('content-length');
  if (raw === null || raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

function describe(e: unknown): string {
  if (typeof e === 'object' && e !== null) {
    const { name, message } = e as { name?: string; message?: string };
    if (name || message) return `${name ?? 'Error'}: ${message ?? ''}`.trim();
  }
  return String(e);
}

/** 経過時間の物差し。`performance` が無い環境でも測れるようにする */
function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
