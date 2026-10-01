/**
 * AI に 1 手あたり何 ms 考えさせるかを決める (Phase 3・親 §7.4)。
 *
 * 設定の入口は人と共通 (親 §6.6.4) なので、対局で選んだ持ち時間をそのまま AI にも
 * 当てはめる。ここで決めるのは**持ち時間から割り出した上限**で、段 (Easy / Hard /
 * Apocalypse) が求める時間との**小さい方**を思考ルーチンが採る (親 §7.5.3)。
 *
 * 考え過ぎて時間切れ負けにならないことを最優先にし、**残り時間より短くなる側に倒す**。
 *
 * ## ★v1.94 の割り出し方 (ユーザー判断 2026-10-01・親 §7.4.1)
 *
 * 「1 手の時間」＝秒読みなら秒読みの秒数、フィッシャーなら 1 手ごとの加算秒、切れ負けは 0。
 *
 * - **時間制限なし** → 上限そのもの (`capMs`)。
 * - **1 手の時間が 16 秒以上** → その秒数 − 1 秒。
 * - **1 手の時間が 15 秒以下** (切れ負けを含む) → **残りの本時間 ÷ 残り手数の見込み ＋ 1 手の時間**。
 *   残り手数の見込みは**最初 40・自分が 1 手指すごとに 0.5 ずつ減り・最低 12**。
 *   **王手をかけられているときは見込みを半分にする** (＝その手に倍の時間を使う)。
 *   例＝1 手 10 秒＋持ち時間 600 秒の 1 手目は 600 ÷ 40 ＋ 10 ＝ 25 秒。
 * - どの場合も、**使える時間 − 1 秒**を超えない (秒読みに入っていればその回の秒読みの残り、
 *   入っていなければ本時間＋秒読み、フィッシャーと切れ負けは本時間＝加算は指した後に入る)。
 */

import type { ClockState, TimeControl } from '../engine/time-control';

/** どんなに短くてもこれだけは考える (1 手も読まずに指さないため)。 */
export const MIN_THINK_MS = 200;

/** 時間切れにならないよう、使える時間からいつも残しておく分。 */
export const SAFETY_MS = 1000;

/** 「1 手の時間」がこれより長ければ、その時間 − 1 秒をそのまま使う。 */
export const LONG_PER_MOVE_MS = 15_000;

/** 残り手数の見込み (最初の値・1 手ごとに減る量・下限)。 */
export const MOVES_LEFT_START = 40;
export const MOVES_LEFT_STEP = 0.5;
export const MOVES_LEFT_MIN = 12;

export interface ThinkSituation {
  /** AI がこれまでに指した手の数。 */
  ownMovesPlayed: number;
  /** AI がいま王手をかけられているか。 */
  inCheck: boolean;
}

/** 残り手数の見込み。王手をかけられているときは半分＝その手に倍の時間を使う。 */
export function movesLeftEstimate(s: ThinkSituation): number {
  const n = Math.max(MOVES_LEFT_MIN, MOVES_LEFT_START - MOVES_LEFT_STEP * s.ownMovesPlayed);
  return s.inCheck ? n / 2 : n;
}

/** 1 手の時間 (ms)。秒読みの秒数・フィッシャーの加算秒。切れ負けは 0。 */
function perMoveMs(tc: TimeControl): number {
  if (tc.mode === 'byoyomi') return (tc.byoyomiSeconds ?? 0) * 1000;
  if (tc.mode === 'fischer') return (tc.incrementSeconds ?? 0) * 1000;
  return 0;
}

/** いま考えるのに使える時間 (ms)。これを使い切ると時間切れ。 */
function availableMs(tc: TimeControl, clock: ClockState | null): number {
  const mainMs = clock?.mainMs ?? tc.mainSeconds * 1000;
  if (tc.mode === 'byoyomi') {
    const byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
    if (clock?.inByoyomi) return clock.byoyomiMs;
    return mainMs + byoyomiMs;
  }
  // フィッシャーの加算は指した後に入るので、いま使えるのは本時間だけ。
  return mainMs;
}

export function thinkBudgetMs(
  tc: TimeControl,
  clock: ClockState | null,
  capMs: number,
  situation: ThinkSituation = { ownMovesPlayed: 0, inCheck: false },
): number {
  if (tc.mode === 'no_limit') return capMs;

  const perMove = perMoveMs(tc);
  let wanted: number;
  if (perMove > LONG_PER_MOVE_MS) {
    wanted = perMove - SAFETY_MS;
  } else {
    const mainMs = tc.mode === 'byoyomi' && clock?.inByoyomi ? 0 : (clock?.mainMs ?? tc.mainSeconds * 1000);
    wanted = mainMs / movesLeftEstimate(situation) + perMove;
  }
  const ceiling = availableMs(tc, clock) - SAFETY_MS;
  return Math.max(MIN_THINK_MS, Math.floor(Math.min(capMs, wanted, ceiling)));
}
