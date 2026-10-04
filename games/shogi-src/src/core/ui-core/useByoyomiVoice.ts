/**
 * ★v2.05: 秒読みの読み上げを、時計の動きに合わせて鳴らす（決まりは core/audio/byoyomi-voice.ts）。
 *
 * - 残りの秒数（30秒・20秒・10秒・5秒・4・3・2・1）は、**いま手番の側の時計**について、
 *   この端末が誰であっても（指している人・相手・観戦者）読み上げる
 * - **「時間切れ」は、時間切れになった側がこの端末で指している人のときだけ**
 *   （相手・観戦者・対 AI で AI が切れたときは言わない）
 * - 設定画面の「秒読み音」が OFF なら何も言わない（音量・ミュートは効果音と同じ）
 */

import { useEffect, useRef } from 'react';
import type { ClockState, TimeControl } from '../engine/time-control';
import { calloutFor, countdownMs, playVoice, preloadVoice } from '../audio/byoyomi-voice';
import { loadByomuSound } from '../store/ui-settings';

type Side = 'player1' | 'player2';

export interface ByoyomiVoiceInput {
  status: string;
  activeClockSide: Side | null;
  clocks: Record<Side, ClockState>;
  timeControl: TimeControl;
  locale: string;
  /** この端末で指している人の側（ネット対戦＝自分の側・対 AI＝人の側・ひとりで二人＝両方・観戦＝なし）。 */
  localSides: readonly Side[];
}

export function useByoyomiVoice({ status, activeClockSide, clocks, timeControl, locale, localSides }: ByoyomiVoiceInput): void {
  const last = useRef<{ side: Side | null; ms: number | null }>({ side: null, ms: null });
  const prevStatus = useRef(status);

  // 時間制限のある対局では、声を先に読み込んでおく（初めての声だけ遅れないように）。
  const limited = timeControl.mode !== 'no_limit';
  useEffect(() => {
    if (limited) preloadVoice(locale);
  }, [limited, locale]);

  const side = activeClockSide;
  const now = side && status === 'playing' ? countdownMs(timeControl, clocks[side]) : null;

  useEffect(() => {
    const ref = last.current;
    if (!side || status !== 'playing') {
      ref.side = null;
      ref.ms = null;
      return;
    }
    if (ref.side !== side || ref.ms === null || now === null || now > ref.ms) {
      // 手番が替わった・数え始め・秒読みが満タンに戻った＝数え直す（ここでは言わない）
      ref.side = side;
      ref.ms = now;
      return;
    }
    const line = calloutFor(ref.ms, now);
    ref.ms = now;
    if (line && loadByomuSound()) playVoice(locale, line);
  }, [side, now, status, locale]);

  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = status;
    if (before !== 'playing') return;
    const timedOut: Side | null = status === 'timeout_p1' ? 'player1' : status === 'timeout_p2' ? 'player2' : null;
    if (!timedOut || !localSides.includes(timedOut)) return;
    if (loadByomuSound()) playVoice(locale, 'timeup');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
}
