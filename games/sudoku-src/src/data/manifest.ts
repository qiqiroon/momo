/**
 * マニフェスト取得と解放サイズの提供（第1分冊 3.3.2 / 4.2）
 *
 * 起動時の入口。`released: true` のサイズのみを選択肢として公開する。
 */

import { KEYS, readRaw, remove, write } from '../storage/localStore';
import { DATA_BASE_PATH } from './config';
import { fetchJson } from './fetchJson';
import { parseManifest, type BoardSize, type Manifest, type Result, type SizeEntry } from './types';

/** サイズディレクトリ名。`n` ＋ 2桁ゼロ詰め（配信サーバー実装仕様書 3.2） */
export function sizeDir(n: BoardSize): string {
  return `n${String(n).padStart(2, '0')}`;
}

/** マニフェストを取得する。成功時は localStorage へ退避する（3.9.3） */
export async function load(): Promise<Result<Manifest>> {
  const raw = await fetchJson(`${DATA_BASE_PATH}manifest.json`);
  if (!raw.ok) return raw;

  const parsed = parseManifest(raw.value);
  if (!parsed.ok) return parsed;

  write(KEYS.manifestCache, parsed.value);
  return parsed;
}

/**
 * 退避済みマニフェストを読み出す。オフライン起動時に用いる（3.9.3）。
 * 非互換であれば破棄して未取得と同じ扱いにする。
 */
export function loadCached(): Manifest | null {
  const raw = readRaw(KEYS.manifestCache);
  if (raw === null) return null;

  const parsed = parseManifest(raw);
  if (!parsed.ok) {
    remove(KEYS.manifestCache);
    return null;
  }
  return parsed.value;
}

/** `released: true` のサイズのみを返す */
export function releasedSizes(manifest: Manifest): BoardSize[] {
  return manifest.sizes.filter((s) => s.released).map((s) => s.n);
}

/** 指定サイズのエントリを返す */
export function sizeEntry(manifest: Manifest, n: BoardSize): SizeEntry | null {
  return manifest.sizes.find((s) => s.n === n) ?? null;
}

export const manifestService = { load, loadCached, releasedSizes, sizeEntry };
