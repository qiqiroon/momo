/**
 * 既出管理（第2分冊 8章 / 11.9）
 *
 * サイズ別リングバッファで「最近出題した元問題ID」を保持する。
 * **元問題ID単位**で記録し、変換違いは同一とみなす（設計書 4.3）。
 *
 * 分担は 8.3 のとおりである。**本モジュールは保持・追加・列挙のみを行い、永続化しない。**
 * 保存は `storage/recentStore.ts`、出題時の除外適用は `data/pick.ts` が担う。
 * 枯渇（除外の結果が0件）の解除も `pick` の責務であり、ここは関与しない（8.4）。
 */

import { STORAGE_VERSION } from '../data/config';
import type { BoardSize, PuzzleId, RecentIds } from '../data/types';
import { RECENT_BUFFER_SIZE_DEFAULT } from '../game/config';

export function create(bufferSize: number = RECENT_BUFFER_SIZE_DEFAULT): RecentIds {
  return { schemaVersion: STORAGE_VERSION, bufferSize: bounded(bufferSize), buffers: {} };
}

/**
 * 出題確定時に元問題IDを追加する（8.2）。**新しいものが末尾**である。
 *
 * 既に入っているIDは、いちばん新しい扱いへ積み直す。
 * N=1 のように在庫が1件しかないサイズでは同じIDが繰り返し出題されるため、
 * そのまま積むとバッファが同一IDで埋まり、他のIDを覚えておく余地が失われる。
 * **永続化側（`storage/recentStore.ts`）と同じ扱いに揃えてある。**
 */
export function push(recent: RecentIds, n: BoardSize, id: PuzzleId): RecentIds {
  const buffer = [...(recent.buffers[n] ?? [])];

  const seen = buffer.indexOf(id);
  if (seen >= 0) buffer.splice(seen, 1);
  buffer.push(id);

  const overflow = buffer.length - bounded(recent.bufferSize);
  if (overflow > 0) buffer.splice(0, overflow);

  return { ...recent, buffers: { ...recent.buffers, [n]: buffer } };
}

/** 指定サイズの既出IDを**新しい順**に返す（`pick` へ渡す） */
export function list(recent: RecentIds, n: BoardSize): PuzzleId[] {
  return [...(recent.buffers[n] ?? [])].reverse();
}

/** バッファ長の変更（`Settings.recentBufferSize`）。**超過分は古い側から捨てる** */
export function resize(recent: RecentIds, bufferSize: number): RecentIds {
  const size = bounded(bufferSize);
  const buffers: RecentIds['buffers'] = {};
  for (const [key, buffer] of Object.entries(recent.buffers)) {
    const n = Number(key) as BoardSize;
    if (buffer === undefined) continue;
    buffers[n] = buffer.length > size ? buffer.slice(buffer.length - size) : [...buffer];
  }
  return { ...recent, bufferSize: size, buffers };
}

function bounded(bufferSize: number): number {
  return Number.isInteger(bufferSize) && bufferSize > 0 ? bufferSize : RECENT_BUFFER_SIZE_DEFAULT;
}

/** 第2分冊 11.9 `RecentIdsService` */
export const recentIdsService = { create, push, list, resize };
