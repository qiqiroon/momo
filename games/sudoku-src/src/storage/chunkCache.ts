/**
 * チャンクの永続キャッシュ（第1分冊 3.6.5 / 4.10）
 *
 * チャンクは容量が大きく再取得コストが高いため IndexedDB へ置く。
 * **IndexedDB が使えない環境では、キャッシュなしで動作を継続する**（毎回取得する縮退動作）。
 */

import { CHUNK_CACHE_LIMIT_BYTES, SUPPORTED_SCHEMA_VERSION } from '../data/config';
import { err, ok, type BoardSize, type Chunk, type Result } from '../data/types';

const DB_NAME = 'momo-sudoku';
const STORE = 'chunks';
const DB_VERSION = 1;

interface CachedChunk {
  key: string;
  n: BoardSize;
  file: string;
  schemaVersion: string;
  fetchedAt: string;
  lastUsedAt: string;
  byteSize: number;
  chunk: Chunk;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let unavailable = false;

export function cacheKey(n: BoardSize, file: string): string {
  return `${n}/${file}`;
}

export function isAvailable(): boolean {
  return !unavailable && typeof indexedDB !== 'undefined';
}

/** 検査用。開いた接続を捨てて次回に開き直させる */
export function resetForTest(): void {
  dbPromise = null;
  unavailable = false;
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') {
    unavailable = true;
    return Promise.resolve(null);
  }

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('n', 'n');
        store.createIndex('lastUsedAt', 'lastUsedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      unavailable = true;
      console.warn('[cache] IndexedDB を開けないためキャッシュなしで継続する');
      resolve(null);
    };
  }).then(async (db) => {
    if (db !== null) await purgeIncompatible(db);
    return db;
  });

  return dbPromise;
}

/**
 * スキーマ版が現行と異なるチャンクを破棄する（3.4 / 3.6.5）。
 * 版を上げた直後は保存済みのすべてが旧版であるため、結果として全件が破棄される。
 */
async function purgeIncompatible(db: IDBDatabase): Promise<void> {
  const all = await runRead<CachedChunk[]>(db, (store) => store.getAll());
  if (all === null) return;
  const stale = all.filter((r) => r.schemaVersion !== SUPPORTED_SCHEMA_VERSION);
  if (stale.length === 0) return;
  await runWrite(db, (store) => {
    for (const r of stale) store.delete(r.key);
  });
  console.warn(`[cache] スキーマ版の変更によりチャンク ${stale.length} 件を破棄した`);
}

export async function get(n: BoardSize, file: string): Promise<Chunk | null> {
  const db = await openDb();
  if (db === null) return null;

  const key = cacheKey(n, file);
  const record = await runRead<CachedChunk | undefined>(db, (store) => store.get(key));
  if (!record) return null;

  if (record.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    await runWrite(db, (store) => store.delete(key));
    return null;
  }

  // LRU の基準となる最終使用時刻を更新する
  await runWrite(db, (store) => {
    store.put({ ...record, lastUsedAt: new Date().toISOString() });
  });
  return record.chunk;
}

export async function put(n: BoardSize, file: string, chunk: Chunk): Promise<Result<void>> {
  const db = await openDb();
  if (db === null) return err('STORAGE_UNAVAILABLE', 'IndexedDB が使えない');

  const now = new Date().toISOString();
  const record: CachedChunk = {
    key: cacheKey(n, file),
    n,
    file,
    schemaVersion: chunk.schemaVersion,
    fetchedAt: now,
    lastUsedAt: now,
    byteSize: JSON.stringify(chunk).length,
    chunk,
  };

  const written = await runWrite(db, (store) => {
    store.put(record);
  });
  if (!written) return err('STORAGE_FULL', 'チャンクを書き込めない', true);

  if ((await totalBytes()) > CHUNK_CACHE_LIMIT_BYTES) {
    await evict([record.key]);
  }
  return ok(undefined);
}

export async function listKeys(n?: BoardSize): Promise<string[]> {
  const db = await openDb();
  if (db === null) return [];
  const all = await runRead<CachedChunk[]>(db, (store) => store.getAll());
  if (all === null) return [];
  return all.filter((r) => n === undefined || r.n === n).map((r) => r.key);
}

/** 上限超過時に LRU で削除する。`protect` は削除対象から除外する（3.6.5） */
export async function evict(protect: string[]): Promise<Result<number>> {
  const db = await openDb();
  if (db === null) return err('STORAGE_UNAVAILABLE', 'IndexedDB が使えない');

  const all = await runRead<CachedChunk[]>(db, (store) => store.getAll());
  if (all === null) return err('STORAGE_UNAVAILABLE', 'キャッシュを読み出せない');

  let total = all.reduce((sum, r) => sum + r.byteSize, 0);
  if (total <= CHUNK_CACHE_LIMIT_BYTES) return ok(0);

  const guarded = new Set(protect);
  const victims = all
    .filter((r) => !guarded.has(r.key))
    .sort((a, b) => a.lastUsedAt.localeCompare(b.lastUsedAt));

  const removing: string[] = [];
  for (const v of victims) {
    if (total <= CHUNK_CACHE_LIMIT_BYTES) break;
    removing.push(v.key);
    total -= v.byteSize;
  }
  if (removing.length === 0) return ok(0);

  await runWrite(db, (store) => {
    for (const key of removing) store.delete(key);
  });
  return ok(removing.length);
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  if (db === null) return;
  await runWrite(db, (store) => {
    store.clear();
  });
}

export async function totalBytes(): Promise<number> {
  const db = await openDb();
  if (db === null) return 0;
  const all = await runRead<CachedChunk[]>(db, (store) => store.getAll());
  if (all === null) return 0;
  return all.reduce((sum, r) => sum + r.byteSize, 0);
}

// ---------------------------------------------------------------- IndexedDB の下ごしらえ

function runRead<T>(db: IDBDatabase, body: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return new Promise((resolve) => {
    let req: IDBRequest;
    try {
      const tx = db.transaction(STORE, 'readonly');
      req = body(tx.objectStore(STORE));
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => resolve(null);
  });
}

function runWrite(db: IDBDatabase, body: (store: IDBObjectStore) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, 'readwrite');
      body(tx.objectStore(STORE));
    } catch {
      resolve(false);
      return;
    }
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

export const chunkCache = {
  get,
  put,
  listKeys,
  evict,
  clearAll,
  totalBytes,
  isAvailable,
};
