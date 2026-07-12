/**
 * 持ち時間の型定義（段階 2-8 v0.35 追加）。
 *
 * 4 モード:
 * - byoyomi     : 本時間 + 一手ごとに秒読み（本時間切れると秒読み時間が毎手リセット）
 * - sudden_death: 本時間のみ・切れたら負け
 * - fischer     : 本時間 + 一手ごとに加算
 * - no_limit    : 時間管理なし
 *
 * 元は features/matchmaking/store.ts に定義していたが、game-store（core）でも
 * 使うので core に移した。matchmaking の store.ts はここから re-export する。
 */

export type TimeControlMode = 'byoyomi' | 'sudden_death' | 'fischer' | 'no_limit';

export interface TimeControl {
  mode: TimeControlMode;
  mainSeconds: number;
  byoyomiSeconds?: number;
  incrementSeconds?: number;
}

/** ロビー既定値（部屋作成のデフォルト）：秒読み 10 分＋ 30 秒 */
export const DEFAULT_TIME_CONTROL: TimeControl = {
  mode: 'byoyomi',
  mainSeconds: 600,
  byoyomiSeconds: 30,
};

/** オフライン既定値：時間管理なし（vs 人 / vs AI で使う） */
export const NO_LIMIT_TIME_CONTROL: TimeControl = {
  mode: 'no_limit',
  mainSeconds: 0,
};

/** 各プレイヤーの時計状態 */
export interface ClockState {
  /** 残り本時間 (ms) */
  mainMs: number;
  /** 残り秒読み (ms)。byoyomi モードで inByoyomi=true のときに使う */
  byoyomiMs: number;
  /** 秒読みフェーズ入りかどうか */
  inByoyomi: boolean;
}

export function initClockState(tc: TimeControl): ClockState {
  return {
    mainMs: tc.mainSeconds * 1000,
    byoyomiMs: (tc.byoyomiSeconds ?? 0) * 1000,
    inByoyomi: false,
  };
}
