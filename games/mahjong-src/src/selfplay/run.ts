// 自動対局の台。種を変えながら対局を回し、出来事ごとに見張り役を通す。
// 段階0は「配るだけ」。段階1でツモ切りの仮の CPU を入れて、1局まるごと回す。
//
// 失敗0件だけでは安心しない：回した局数と出来事の件数を必ず一緒に出す。

import type { Envelope, Seat } from '../engine/events';
import { Watcher } from '../engine/invariants';
import { startRound } from '../engine/round';
import { GENERAL_RULES, type Rules } from '../engine/rules';

export interface SelfplayResult {
  games: number;
  events: number;
  failures: { seed: string; seq: number; reasons: string[] }[];
}

/** 1対局（いまは配牌まで）を回す */
export function playOne(seed: string, rules: Rules = GENERAL_RULES): { events: number; failure: SelfplayResult['failures'][number] | null } {
  const w = new Watcher();
  const feed = (envs: Envelope[]) => {
    for (const env of envs) {
      const reasons = w.push(env);
      if (reasons.length) return { seed, seq: env.seq, reasons };
    }
    return null;
  };
  let failure = feed([{ seq: 0, to: 'all', ev: { type: 'gameStart', rules } }]);
  if (!failure) failure = feed(startRound(w.full, seed, 0, 0 as Seat));
  return { events: w.checked, failure };
}

export function runSelfplay(games: number, seedPrefix = 'selfplay'): SelfplayResult {
  const result: SelfplayResult = { games: 0, events: 0, failures: [] };
  for (let i = 0; i < games; i++) {
    const r = playOne(`${seedPrefix}-${i}`);
    result.games++;
    result.events += r.events;
    if (r.failure) result.failures.push(r.failure);
  }
  return result;
}
