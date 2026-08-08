/**
 * ストレージ保護（第1分冊 3.8 / 4.11）
 *
 * iOS の ITP による7日間のストレージ削除は、アプリ側で完全には回避できない。
 * **ここにあるのは緩和策であり保証ではない。**
 */

import { EXPORT_PROMPT_CLEAR_COUNT } from '../data/config';
import type { Stats } from '../data/types';

/** 初回起動時に永続化を要求する。拒否されても動作は継続する */
export async function requestPersist(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function estimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export async function isPersisted(): Promise<boolean> {
  try {
    if (!navigator.storage?.persisted) return false;
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/** エクスポート案内を出すべきか。閾値は `EXPORT_PROMPT_CLEAR_COUNT` */
export function shouldPromptExport(stats: Stats): boolean {
  const cleared = Object.values(stats.entries).reduce((sum, e) => sum + e.clearCount, 0);
  return cleared >= EXPORT_PROMPT_CLEAR_COUNT;
}

export const persistenceService = { requestPersist, estimate, isPersisted, shouldPromptExport };
