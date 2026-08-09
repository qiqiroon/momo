/**
 * データ層設定値（第1分冊 4.13）
 *
 * 配信データの基底パスはここだけが知る。他モジュールへの直書きを禁じる（同 3.3.1）。
 */

import type { LoupeCorner } from './types';

/** 配信データ基底パス。開発時も本番サブパスも同じ式で解決する（C-09） */
export const DATA_BASE_PATH = `${import.meta.env.BASE_URL}data/`;

/** 対応スキーマ版。メジャー部分が異なるデータは受理しない（3.4） */
export const SUPPORTED_SCHEMA_VERSION = '1.04';

/** ユーザーデータのスキーマ版（3.6.2） */
export const STORAGE_VERSION = '1.02';

/** 取得タイムアウト（ミリ秒） */
export const FETCH_TIMEOUT_MS = 15000;

/** 取得失敗時の再試行回数 */
export const FETCH_RETRY_MAX = 2;

/** 再試行の待ち時間の基準（ミリ秒）。指数バックオフで 500 → 1000 と伸びる（3.3.4） */
export const FETCH_RETRY_BASE_DELAY_MS = 500;

/** 未取得チャンクをあえて選ぶ確率（3.3.3） */
export const UNCACHED_CHUNK_PROBABILITY = 0.2;

/** チャンクキャッシュの上限バイト数 */
export const CHUNK_CACHE_LIMIT_BYTES = 50 * 1024 * 1024;

/** 既出リングバッファの既定サイズ（サイズごと） */
export const RECENT_BUFFER_SIZE = 200;

/** 中断セッションの自動保存間隔（ミリ秒） */
export const SESSION_AUTOSAVE_INTERVAL_MS = 30000;

/** エクスポート案内を出し始めるクリア数 */
export const EXPORT_PROMPT_CLEAR_COUNT = 50;

/** 効果音の既定値（設計書 4.14 / 4.15） */
export const SOUND_ENABLED_DEFAULT = false;

/** 効果音の音量の既定値 */
export const SOUND_VOLUME_DEFAULT = 0.5;

/** 触覚フィードバックの既定値 */
export const HAPTIC_ENABLED_DEFAULT = true;

/**
 * 画面を寝かせないの既定値（C-209）
 *
 * **入で始める。** 考えているあいだに暗くなるという指摘への答えなので、
 * まず効いている状態から始めるのが素直である。要らなければ設定で切れる。
 */
export const KEEP_AWAKE_DEFAULT = true;

/** ルーペを置く角の既定値（C-185）。利用者の指定は右上である */
export const LOUPE_CORNER_DEFAULT: LoupeCorner = 'TOP_RIGHT';

/**
 * ルーペを開いた状態で始めるか（C-189）
 *
 * **ルーペは自分で開く道具になった。** 段階7 まではセルが小さくなると勝手に出ていたが、
 * 出るきっかけを虫眼鏡アイコンに一本化したため、初期は閉じておく。
 */
export const LOUPE_OPEN_DEFAULT = false;

/** ルーペが映す幅の既定値（セル数・C-189）。3×3 から始める */
export const LOUPE_SPAN_DEFAULT = 3;

/** 数字ボタンの大きさの既定倍率（C-190）。1 が仕様書どおりの 44px */
export const PALETTE_SCALE_DEFAULT = 1;
