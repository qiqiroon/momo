/**
 * 既出管理の永続化（第1分冊 3.5.3 / 4.8）
 *
 * サイズ別のリングバッファ。**新しいものが末尾**に積み、上限を超えたら古い側から捨てる。
 * 既出として記録するのは**元問題ID**である（変換違いは同一とみなす）。
 */

import { RECENT_BUFFER_SIZE, STORAGE_VERSION } from '../data/config';
import {
  guards,
  ok,
  type BoardSize,
  type PuzzleId,
  type RecentIds,
  type Result,
} from '../data/types';
import { KEYS, readValidated, remove, write, writeMeta } from './localStore';

export function empty(): RecentIds {
  return { schemaVersion: STORAGE_VERSION, bufferSize: RECENT_BUFFER_SIZE, buffers: {} };
}

export function load(): RecentIds {
  return readValidated(KEYS.recent, validate, empty());
}

export function save(recent: RecentIds): Result<void> {
  const written = write(KEYS.recent, recent);
  if (written.ok) writeMeta();
  return written;
}

/** 指定サイズのリングバッファへ元問題IDを追加する */
export function push(n: BoardSize, id: PuzzleId): Result<RecentIds> {
  const recent = load();
  const buffer = [...(recent.buffers[n] ?? [])];

  // 同じIDが既にあれば、いちばん新しい扱いへ積み直す
  const seen = buffer.indexOf(id);
  if (seen >= 0) buffer.splice(seen, 1);
  buffer.push(id);

  const overflow = buffer.length - recent.bufferSize;
  if (overflow > 0) buffer.splice(0, overflow);

  const next: RecentIds = {
    ...recent,
    buffers: { ...recent.buffers, [n]: buffer },
  };

  const written = save(next);
  if (!written.ok) return written;
  return ok(next);
}

/** 指定サイズの既出IDリストを**新しい順**に返す */
export function list(n: BoardSize): PuzzleId[] {
  const buffer = load().buffers[n] ?? [];
  return [...buffer].reverse();
}

export function reset(n?: BoardSize): void {
  if (n === undefined) {
    remove(KEYS.recent);
    return;
  }
  const recent = load();
  const buffers = { ...recent.buffers };
  delete buffers[n];
  save({ ...recent, buffers });
}

function validate(raw: unknown): RecentIds | null {
  if (!guards.isRecord(raw)) return null;
  if (!guards.isRecord(raw.buffers)) return null;

  const buffers: RecentIds['buffers'] = {};
  for (const [key, value] of Object.entries(raw.buffers)) {
    const n = Number(key);
    if (!guards.isBoardSize(n)) continue;
    if (!Array.isArray(value)) continue;
    buffers[n] = value.filter((v): v is string => typeof v === 'string');
  }

  return {
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : STORAGE_VERSION,
    bufferSize:
      guards.isFiniteNumber(raw.bufferSize) && raw.bufferSize > 0
        ? Math.floor(raw.bufferSize)
        : RECENT_BUFFER_SIZE,
    buffers,
  };
}

export const recentStore = { load, save, push, list, reset };
