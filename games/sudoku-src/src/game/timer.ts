/**
 * 経過時間計測（第2分冊 9章 / 11.10）
 *
 * **画面が見えている時間のみ**を累積する（C-11）。非表示・離脱中は止める。
 *
 * ドメイン層は DOM を参照しないため（1.2）、可視性の変化は
 * **UI層からの通知として受け取る**（9.3）。`visibilitychange` などの購読は UI層の仕事である。
 *
 * 時刻は**単調増加時刻**を用いる。システム時刻の変更で経過時間が飛ばないようにするためで、
 * 取得手段は生成時に差し替えられる（単体テストで固定時刻を注入する）。
 */

/** 単調増加時刻の取得。`performance` が無い環境では `Date.now()` へ落とす */
export type Clock = () => number;

export const defaultClock: Clock = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export interface TimerState {
  /** 停止中に確定している累積値（ミリ秒） */
  elapsedMs: number;
  /** 計測中の起点。停止中は null */
  startedAt: number | null;
  /** 完成・破棄により終了したか。終了後は再開しない */
  stopped: boolean;
  now: Clock;
}

/** 中断からの再開では保存された `elapsedMs` を初期累積値として渡す（9.4） */
export function create(initialElapsedMs: number, now: Clock = defaultClock): TimerState {
  const initial = Number.isFinite(initialElapsedMs) && initialElapsedMs > 0 ? initialElapsedMs : 0;
  return { elapsedMs: initial, startedAt: null, stopped: false, now };
}

export function start(timer: TimerState): void {
  if (timer.stopped || timer.startedAt !== null) return;
  timer.startedAt = timer.now();
}

export function pause(timer: TimerState): void {
  if (timer.startedAt === null) return;
  timer.elapsedMs += timer.now() - timer.startedAt;
  timer.startedAt = null;
}

export function resume(timer: TimerState): void {
  start(timer);
}

/**
 * 完成・破棄で計測を終える。
 * **終了後は `resume` を受け付けない。** 結果を確定したあとに時間が伸びないようにするためである。
 */
export function stop(timer: TimerState): void {
  pause(timer);
  timer.stopped = true;
}

/** 現在の累積経過時間（ミリ秒）。**問い合わせで取る**。定期通知は持たない（9.5） */
export function elapsed(timer: TimerState): number {
  if (timer.startedAt === null) return timer.elapsedMs;
  return timer.elapsedMs + (timer.now() - timer.startedAt);
}

export function running(timer: TimerState): boolean {
  return timer.startedAt !== null;
}

/** 第2分冊 11.10 `TimerService` */
export const timerService = { create, start, pause, resume, stop, elapsed, running };
