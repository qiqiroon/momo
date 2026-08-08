/**
 * 成績の読み書き（第1分冊 3.10 / 4.7）
 *
 * 計上規則は 3.10。**失敗扱いのセッションはクリア数・最短時間に計上しない**（C-06）。
 */

import { STORAGE_VERSION } from '../data/config';
import {
  guards,
  ok,
  type Result,
  type SessionResult,
  type Stats,
  type StatsEntry,
  type StatsKey,
} from '../data/types';
import { KEYS, readValidated, remove, write, writeMeta } from './localStore';

export function emptyEntry(): StatsEntry {
  return { clearCount: 0, failedCount: 0, bestTimeMs: null, hintUsedTotal: 0, playCount: 0 };
}

export function empty(): Stats {
  return { schemaVersion: STORAGE_VERSION, entries: {} as Record<StatsKey, StatsEntry>, updatedAt: '' };
}

export function load(): Stats {
  return readValidated(KEYS.stats, validate, empty());
}

export function save(stats: Stats): Result<void> {
  const written = write(KEYS.stats, stats);
  if (written.ok) writeMeta();
  return written;
}

/** 1セッション分の結果を反映して保存する（計上規則は 3.10） */
export function record(result: SessionResult): Result<Stats> {
  const stats = load();
  const key: StatsKey = `${result.n}:${result.difficulty}`;
  const entry = { ...(stats.entries[key] ?? emptyEntry()) };

  entry.playCount += 1;
  entry.hintUsedTotal += result.hintUsed;

  if (result.completed) {
    if (result.failed) {
      entry.failedCount += 1;
    } else {
      entry.clearCount += 1;
      if (entry.bestTimeMs === null || result.elapsedMs < entry.bestTimeMs) {
        entry.bestTimeMs = result.elapsedMs;
      }
    }
  }

  const next: Stats = {
    schemaVersion: STORAGE_VERSION,
    entries: { ...stats.entries, [key]: entry },
    updatedAt: new Date().toISOString(),
  };

  const written = save(next);
  if (!written.ok) return written;
  return ok(next);
}

export function reset(): void {
  remove(KEYS.stats);
}

function validate(raw: unknown): Stats | null {
  if (!guards.isRecord(raw)) return null;
  if (!guards.isRecord(raw.entries)) return null;

  const entries = {} as Record<StatsKey, StatsEntry>;
  for (const [key, value] of Object.entries(raw.entries)) {
    const entry = validateEntry(value);
    if (entry === null) continue; // 壊れた1件は捨てて残りを使う
    entries[key as StatsKey] = entry;
  }

  return {
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : STORAGE_VERSION,
    entries,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
  };
}

function validateEntry(raw: unknown): StatsEntry | null {
  if (!guards.isRecord(raw)) return null;
  if (!guards.isFiniteNumber(raw.clearCount)) return null;
  if (!guards.isFiniteNumber(raw.failedCount)) return null;
  if (!guards.isFiniteNumber(raw.hintUsedTotal)) return null;
  if (!guards.isFiniteNumber(raw.playCount)) return null;
  const best = raw.bestTimeMs;
  if (best !== null && !guards.isFiniteNumber(best)) return null;
  return {
    clearCount: raw.clearCount,
    failedCount: raw.failedCount,
    bestTimeMs: best === null ? null : (best as number),
    hintUsedTotal: raw.hintUsedTotal,
    playCount: raw.playCount,
  };
}

export const statsStore = { load, save, record, reset };
