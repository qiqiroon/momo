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

/**
 * プレイ回数を1つ数える（3.10 / C-206）
 *
 * **出題が確定した時点で呼ぶ。** 中断しても破棄しても、始めた1回として数える——
 * これが 3.10 の定める意味である。**中断からの再開では呼ばない**（第2分冊 12.3）。
 * 同じ1回のプレイの続きだからである。
 *
 * 段階7 までは完成したときにまとめて数えていたため、**途中でやめた対局が1回も
 * 数えられず、「プレイ」の数が必ず「クリア＋失敗」と一致していた**（＝何も表していなかった）。
 */
export function countPlay(key: StatsKey): Result<Stats> {
  const stats = load();
  const entry = { ...(stats.entries[key] ?? emptyEntry()) };
  entry.playCount += 1;

  const next: Stats = {
    schemaVersion: STORAGE_VERSION,
    entries: { ...stats.entries, [key]: entry },
    updatedAt: new Date().toISOString(),
  };
  const written = save(next);
  if (!written.ok) return written;
  return ok(next);
}

/**
 * 1セッション分の結果を反映して保存する（計上規則は 3.10）
 *
 * **`playCount` はここでは触らない**（C-206）。開始時に `countPlay` で計上済みである。
 */
export function record(result: SessionResult): Result<Stats> {
  const stats = load();
  const key: StatsKey = `${result.n}:${result.difficulty}`;
  const entry = { ...(stats.entries[key] ?? emptyEntry()) };

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

export const statsStore = { load, save, countPlay, record, reset };
