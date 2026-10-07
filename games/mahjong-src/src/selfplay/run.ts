// 自動対局の台。種を変えながら対局を回し、出来事ごとに見張り役を通す。
// 段階1：1 局をまるごと（ツモアガリか流局まで）回す。打ち手は種の番号で交互に替える
//   偶数＝4 人ともツモ切りの仮の CPU（画面で使うもの）／奇数＝形を寄せる検査用の打ち手（アガリの道を通すため）
//
// 失敗0件だけでは安心しない：回した局数と出来事の件数、終わり方の内訳を必ず一緒に出す。

import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import type { Envelope, Seat } from '../engine/events';
import { Watcher } from '../engine/invariants';
import { act, advance, startRound } from '../engine/round';
import { GENERAL_RULES, type Rules } from '../engine/rules';
import type { RoundResult } from '../engine/state';

export interface SelfplayResult {
  games: number;
  events: number;
  /** 終わり方の内訳（ツモアガリ・流局・途中で止まった） */
  endings: { tsumo: number; exhaust: number; unfinished: number };
  /** 通った道の数（0 なら、その道は検査に乗っていない）：リーチ・ダブル立直・リーチでのツモ・一発・裏ドラが乗ったアガリ */
  paths: { riichi: number; double: number; riichiWin: number; ippatsu: number; ura: number };
  failures: { seed: string; seq: number; reasons: string[] }[];
}

type Failure = SelfplayResult['failures'][number];

/** 1 局を最後まで回しても終わらないときの打ち切り（ツモは山の数より多くならない） */
const MAX_EVENTS = 1000;

/** 1対局（いまは 1 局）を回す。出来事の列も返す（牌譜の土台・失敗の再現用） */
export type Player = typeof tsumogiriCpu;

export function playOne(
  seed: string,
  rules: Rules = GENERAL_RULES,
  player: Player = tsumogiriCpu,
): { events: number; log: Envelope[]; ending: keyof SelfplayResult['endings']; result: RoundResult | null; failure: Failure | null } {
  const w = new Watcher();
  const log: Envelope[] = [];
  const feed = (envs: Envelope[]): Failure | null => {
    for (const env of envs) {
      const reasons = w.push(env);
      if (reasons.length) return { seed, seq: env.seq, reasons };
      log.push(env);
    }
    return null;
  };
  const done = (failure: Failure | null) => ({
    events: w.checked,
    log,
    ending: w.full.result?.type ?? ('unfinished' as const),
    result: w.full.result,
    failure,
  });

  let failure = feed([{ seq: 0, to: 'all', ev: { type: 'gameStart', rules } }]);
  if (!failure) failure = feed(startRound(w.full, seed, 0, 0 as Seat));
  while (!failure && w.full.phase !== 'ended') {
    if (w.checked > MAX_EVENTS) return done({ seed, seq: w.full.nextSeq, reasons: ['局が終わらない'] });
    const s = w.full;
    try {
      failure =
        s.phase === 'discard' ? feed(act(s, s.turn, player(w.views[s.turn], s.turn))) : feed(advance(s));
    } catch (e) {
      failure = { seed, seq: s.nextSeq, reasons: [`進行役が止まった：${(e as Error).message}`] };
    }
  }
  return done(failure);
}

export function runSelfplay(games: number, seedPrefix = 'selfplay'): SelfplayResult {
  const result: SelfplayResult = {
    games: 0,
    events: 0,
    endings: { tsumo: 0, exhaust: 0, unfinished: 0 },
    paths: { riichi: 0, double: 0, riichiWin: 0, ippatsu: 0, ura: 0 },
    failures: [],
  };
  for (let i = 0; i < games; i++) {
    const r = playOne(`${seedPrefix}-${i}`, GENERAL_RULES, i % 2 === 0 ? tsumogiriCpu : benchCpu);
    result.games++;
    result.events += r.events;
    result.endings[r.ending]++;
    for (const e of r.log) {
      if (e.ev.type === 'discard' && e.ev.riichi) result.paths.riichi++;
    }
    const last = r.log[r.log.length - 1]?.ev;
    if (last?.type === 'tsumo' && last.ura.length > 0) result.paths.riichiWin++;
    if (r.result?.type === 'tsumo') {
      const ids = r.result.score.yaku.map((y) => y.id);
      if (ids.includes('doubleRiichi')) result.paths.double++;
      if (ids.includes('ippatsu')) result.paths.ippatsu++;
      if (r.result.score.dora.ura > 0) result.paths.ura++;
    }
    if (r.failure) result.failures.push(r.failure);
  }
  return result;
}
