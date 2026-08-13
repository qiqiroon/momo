/**
 * AI に 1 手あたり何 ms 考えさせるかを決める (Phase 3・親 §7.4)。
 *
 * 設定の入口は人と共通 (親 §6.6.4) なので、対局で選んだ持ち時間をそのまま AI にも
 * 当てはめる。時間制限なしのときだけ、端末に応じた既定値 (スマホは短め) で考える。
 *
 * 考え過ぎて時間切れ負けにならないことを最優先にし、**残り時間より短くなる側に倒す**。
 */

import type { ClockState, TimeControl } from '../engine/time-control';

/** どんなに短くてもこれだけは考える (1 手も読まずに指さないため)。 */
export const MIN_THINK_MS = 200;

export function thinkBudgetMs(tc: TimeControl, clock: ClockState | null, baseMs: number): number {
  const clamp = (ms: number) => Math.max(MIN_THINK_MS, Math.min(baseMs, Math.floor(ms)));

  switch (tc.mode) {
    case 'no_limit':
      return baseMs;

    case 'byoyomi': {
      // 秒読みに入っていれば毎手その時間まで使える。本時間が残っていれば少し足す。
      const byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
      const mainMs = clock?.mainMs ?? 0;
      if (byoyomiMs <= 0) return clamp(mainMs / 30);
      const extra = clock?.inByoyomi ? 0 : mainMs / 60;
      return clamp(byoyomiMs * 0.6 + extra);
    }

    case 'sudden_death': {
      // 残り時間を 30 手ぶんに割る (終盤ほど自然に短くなる)。
      const mainMs = clock?.mainMs ?? tc.mainSeconds * 1000;
      return clamp(mainMs / 30);
    }

    case 'fischer': {
      // 加算ぶんは毎手戻ってくるので、加算 + 残りの一部まで使える。
      const incMs = (tc.incrementSeconds ?? 0) * 1000;
      const mainMs = clock?.mainMs ?? tc.mainSeconds * 1000;
      return clamp(incMs * 0.8 + mainMs / 40);
    }

    default:
      return baseMs;
  }
}
