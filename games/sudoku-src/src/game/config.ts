/**
 * ドメイン層設定値（第2分冊 11.12）
 *
 * **データ層の設定（`data/config.ts`）とは分離する。** 層をまたぐ設定の共有を行わない。
 * 調整する可能性のある値はすべてここに集約し、他モジュールへの直書きを禁じる。
 */

import type { Difficulty } from '../data/types';

/** 難易度別ミス上限（C-05）。`null` は無制限 */
export const MISTAKE_LIMIT: Readonly<Record<Difficulty, number | null>> = {
  Easy: null,
  Hard: 3,
  Apocalypse: 3,
};

/** Undo/Redo 上限の既定値（C-14） */
export const UNDO_LIMIT_DEFAULT = 100;

/** 既出リングバッファの既定サイズ（設計書 4.7） */
export const RECENT_BUFFER_SIZE_DEFAULT = 200;

/** ヒント使用回数の上限。`null` = 無制限（6.8 / U-09） */
export const HINT_LIMIT: number | null = null;

/** `TransformParams.version`（2.3） */
export const TRANSFORM_PARAMS_VERSION = 1;
