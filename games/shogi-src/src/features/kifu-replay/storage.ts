/**
 * 直前の 1 局の受け皿 (親 §9.2.1)。
 *
 * **これは正本ではない**。保存し忘れを防ぐためだけの控えで、
 * **次の対局が始まった時点で置き換わる**。棋譜の正本は書き出したファイルの側。
 *
 * iOS の Safari は 7 日間開かないサイトのこの領域を消すが、受け皿は
 * 「対局した直後に拾えればよい」ものなので、消えても困らない。
 */

import type { KifuFile } from './types';
import { KIFU_FORMAT } from './types';

const KEY_LAST = 'shogi.kifu.last';

export function saveLastKifu(file: KifuFile): void {
  try {
    localStorage.setItem(KEY_LAST, JSON.stringify(file));
  } catch {
    // 置き場が使えない環境 (シークレット・容量超過) では受け皿を持たないだけ。
    // 書き出しは手動でできるので、対局そのものには影響しない。
  }
}

export function loadLastKifu(): KifuFile | null {
  try {
    const raw = localStorage.getItem(KEY_LAST);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    if ((parsed as KifuFile).format !== KIFU_FORMAT) return null;
    return parsed as KifuFile;
  } catch {
    return null;
  }
}

export function clearLastKifu(): void {
  try {
    localStorage.removeItem(KEY_LAST);
  } catch {
    // 消せなくても、次の対局の終局で上書きされる。
  }
}
