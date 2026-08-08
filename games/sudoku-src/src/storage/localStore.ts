/**
 * 端末内保存の共通作法（第1分冊 3.6.2）
 *
 * 設定・成績・既出・中断の4か所が同じ作法を必要とするため、ここに集約する。
 *
 * - 値はすべて JSON 文字列として格納する
 * - 読み出しに失敗したら**当該キーのみ**初期値へ復旧し、他のキーには影響させない
 * - 移行の要否は `StorageMeta.storageVersion` **のみ**で判定する（各データが持つ版は履歴に留める）
 *
 * 仕様書 2.4 の部品一覧には無い裏方である（2026-08-06 に合意のうえ追加）。
 */

import { SOUND_VOLUME_DEFAULT, STORAGE_VERSION } from '../data/config';
import { err, ok, type Result, type StorageMeta } from '../data/types';
import { APP_VERSION } from '../version';

/** localStorage キー（3.6.2）。接頭辞はすべて `momo.sudoku.` */
export const KEYS = {
  settings: 'momo.sudoku.settings',
  stats: 'momo.sudoku.stats',
  recent: 'momo.sudoku.recent',
  session: 'momo.sudoku.session',
  meta: 'momo.sudoku.meta',
  manifestCache: 'momo.sudoku.manifest.cache',
} as const;

/** 移行・初期化の対象となるキー。**退避マニフェストは対象外**（3.6.2） */
const MIGRATABLE_KEYS = [KEYS.settings, KEYS.stats, KEYS.recent, KEYS.session] as const;

export function isAvailable(): boolean {
  try {
    const probe = 'momo.sudoku.__probe';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * 1件読み出して検証する。
 * 読めない・壊れている場合は初期値を返す（**他のキーは巻き添えにしない**）。
 */
export function readValidated<T>(
  key: string,
  validate: (raw: unknown) => T | null,
  fallback: T,
): T {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  const value = validate(raw);
  if (value === null) {
    console.warn(`[storage] ${key} の内容が不正なため初期値へ復旧した`);
    return fallback;
  }
  return value;
}

/** JSON として読み出す。存在しない・壊れている場合は null */
export function readRaw(key: string): unknown | null {
  let text: string | null;
  try {
    text = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    console.warn(`[storage] ${key} を JSON として読めないため初期値へ復旧した`);
    return null;
  }
}

export function write(key: string, value: unknown): Result<void> {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return ok(undefined);
  } catch (e: unknown) {
    if (isQuotaError(e)) {
      return err('STORAGE_FULL', `${key} の書き込みが容量超過で失敗した`, true);
    }
    return err('STORAGE_UNAVAILABLE', `${key} へ書き込めない: ${String(e)}`);
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 利用不可の環境では何もしない（縮退動作）
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

// ---------------------------------------------------------------- 版と移行（3.6.2）

export function readMeta(): StorageMeta | null {
  const raw = readRaw(KEYS.meta);
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.storageVersion !== 'string') return null;
  return {
    storageVersion: rec.storageVersion,
    appVersion: typeof rec.appVersion === 'string' ? rec.appVersion : '',
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : '',
  };
}

export function writeMeta(): Result<void> {
  const meta: StorageMeta = {
    storageVersion: STORAGE_VERSION,
    appVersion: APP_VERSION,
    updatedAt: new Date().toISOString(),
  };
  return write(KEYS.meta, meta);
}

/**
 * 必要なら移行してから使う。起動時に1度だけ呼ぶ。
 *
 * 移行はユーザーへ通知しない（3.6.2）。移行手順を持たない版からの読み出しは初期化する。
 * **退避マニフェストは移行・初期化の対象外**である。
 */
export function ensureMigrated(): void {
  if (!isAvailable()) return;

  const meta = readMeta();
  let from = meta?.storageVersion ?? (hasAnyUserData() ? '1.00' : STORAGE_VERSION);

  if (from === STORAGE_VERSION) {
    if (meta === null) writeMeta();
    return;
  }

  // "1.00" → "1.01"：Settings のみ初期化する（zoomPreference の意味が変わったため）
  if (from === '1.00') {
    remove(KEYS.settings);
    from = '1.01';
  }

  // "1.01" → "1.02"：Settings の既存値を保ったまま soundVolume を既定値で補完する
  if (from === '1.01') {
    patchSoundVolume();
    from = '1.02';
  }

  if (from !== STORAGE_VERSION) {
    // 移行手順を持たない版。全部初期化する
    console.warn(`[storage] 移行手順を持たない版 ${from} を検出したため初期化した`);
    for (const key of MIGRATABLE_KEYS) remove(key);
  }

  writeMeta();
}

function hasAnyUserData(): boolean {
  return MIGRATABLE_KEYS.some((key) => readRaw(key) !== null);
}

function patchSoundVolume(): void {
  const raw = readRaw(KEYS.settings);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.soundVolume === 'number') return;
  rec.soundVolume = SOUND_VOLUME_DEFAULT;
  write(KEYS.settings, rec);
}
