/**
 * 中断セッションの保存・復元（第1分冊 3.6.4 / 4.9）
 *
 * **全体で1件のみ**保持する。変換適用後の盤面は保存せず、
 * 元問題IDと変換パラメータから再開時に復元する（3.2.6）。
 */

import { guards, type Result, type SuspendedSession } from '../data/types';
import { KEYS, readValidated, remove, write, writeMeta } from './localStore';

export function load(): SuspendedSession | null {
  return readValidated<SuspendedSession | null>(KEYS.session, validate, null);
}

export function save(session: SuspendedSession): Result<void> {
  const written = write(KEYS.session, session);
  if (written.ok) writeMeta();
  return written;
}

export function clear(): void {
  remove(KEYS.session);
}

export function exists(): boolean {
  return load() !== null;
}

function validate(raw: unknown): SuspendedSession | null {
  if (!guards.isRecord(raw)) return null;
  if (typeof raw.sourceId !== 'string' || raw.sourceId.length === 0) return null;
  if (!guards.isBoardSize(raw.n)) return null;
  if (!guards.isDifficulty(raw.difficulty)) return null;
  if (raw.transformParams === undefined) return null;

  const entered = numberArray(raw.entered);
  if (entered === null) return null;
  const notes = noteArray(raw.notes);
  if (notes === null) return null;
  if (!guards.isFiniteNumber(raw.elapsedMs)) return null;
  if (!guards.isFiniteNumber(raw.mistakeCount)) return null;
  if (typeof raw.failed !== 'boolean') return null;
  if (!guards.isFiniteNumber(raw.hintUsed)) return null;

  return {
    schemaVersion: typeof raw.schemaVersion === 'string' ? raw.schemaVersion : '',
    savedAt: typeof raw.savedAt === 'string' ? raw.savedAt : '',
    sourceId: raw.sourceId,
    n: raw.n,
    difficulty: raw.difficulty,
    // データ層は中身を解釈しない（3.2.6）
    transformParams: raw.transformParams,
    entered,
    notes,
    elapsedMs: raw.elapsedMs,
    mistakeCount: raw.mistakeCount,
    failed: raw.failed,
    hintUsed: raw.hintUsed,
  };
}

function numberArray(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((v) => guards.isFiniteNumber(v))) return null;
  return raw as number[];
}

function noteArray(raw: unknown): number[][] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[][] = [];
  for (const row of raw) {
    const values = numberArray(row);
    if (values === null) return null;
    out.push(values);
  }
  return out;
}

export const sessionStore = { load, save, clear, exists };
