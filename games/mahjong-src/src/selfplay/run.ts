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
import type { GameState, OpenMeld, RoundResult } from '../engine/state';
import { kindOf } from '../engine/tiles';

export interface SelfplayResult {
  games: number;
  events: number;
  /** 終わり方の内訳（ツモアガリ・流局・途中で止まった） */
  endings: { tsumo: number; ron: number; exhaust: number; tripleRon: number; abort: number; unfinished: number };
  /** 通った道の数（0 なら、その道は検査に乗っていない）：リーチ・ダブル立直・リーチでのツモ・一発・裏ドラが乗ったアガリ */
  paths: { riichi: number; double: number; riichiWin: number; ippatsu: number; ura: number; tenpaiCounts: number[]; doubleRon: number; missed: number; calls: number; chi: number; openWin: number; kan: { ankan: number; kakan: number; minkan: number; riichiAnkan: number; rinshanWin: number; chankan: number; kanDora: number; fourKans: number }; clash: { total: number; ronWon: number; ponWon: number; chiLost: number }; aborts: Record<string, number>; kuikaeBanned: number; nagashi: number; paoSet: number; riichiSticks: number };
  failures: { seed: string; seq: number; reasons: string[] }[];
}

type Failure = SelfplayResult['failures'][number];

/** 1 局を最後まで回しても終わらないときの打ち切り（ツモは山の数より多くならない。打牌のたびに 3 人の返事が付く） */
const MAX_EVENTS = 2000;

/** 1対局（いまは 1 局）を回す。出来事の列も返す（牌譜の土台・失敗の再現用） */
export type Player = typeof tsumogiriCpu;

export function playOne(
  seed: string,
  rules: Rules = GENERAL_RULES,
  player: Player = tsumogiriCpu,
): { events: number; missed: boolean; kuikaeBanned: number; final: GameState; clashes: { won: string; chi: boolean }[]; finalMelds: OpenMeld[][]; log: Envelope[]; ending: keyof SelfplayResult['endings']; result: RoundResult | null; failure: Failure | null } {
  const w = new Watcher();
  const seedNumber = [...seed].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const log: Envelope[] = [];
  let sawMissed = false;
  // 同じ牌に 2 人以上が宣言した（見送り以外の返事が 2 つ以上）ときの、勝った宣言
  const clashes: { won: string; chi: boolean }[] = [];
  // 喰い替え禁止で切れない牌を持ったまま切る番になった回数（禁止の道が検査に乗っているか）
  let kuikaeBanned = 0;
  const feed = (envs: Envelope[]): Failure | null => {
    for (const env of envs) {
      const before = w.full;
      const reasons = w.push(env);
      if (w.full.kuikaeBan.length > 0 && w.full.hands[w.full.turn].some((t) => w.full.kuikaeBan.includes(kindOf(t)))) kuikaeBanned++;
      const c = before.claim;
      if (c && w.full.claim === null) {
        const said = c.calls.map((x) => x.meld as string).concat(c.rons.map(() => 'ron'));
        if (env.ev.type === 'ron') said.push('ron');
        if (env.ev.type === 'call') said.push(env.ev.meld);
        if (said.length >= 2) {
          const won = w.full.result?.type === 'ron' || w.full.result?.type === 'tripleRon' ? 'ron' : (w.full.melds[w.full.turn].at(-1)?.type ?? 'none');
          clashes.push({ won: won === 'minkan' ? 'kan' : won, chi: said.includes('chi') });
        }
      }
      if (w.full.missedTurn.some(Boolean)) sawMissed = true;
      if (reasons.length) return { seed, seq: env.seq, reasons };
      log.push(env);
    }
    return null;
  };
  const done = (failure: Failure | null) => ({
    events: w.checked,
    missed: sawMissed,
    kuikaeBanned,
    final: w.full,
    clashes,
    finalMelds: w.full.melds,
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
      if (s.phase === 'claim') {
        // 返事がまだの人が、その席から見える局面で返事をする。オンラインでは届く順番が決まらないので、
        // 返事の順番は種と通し番号から決めて毎回変える（順番で結果が変わらないことも見張る）
        const waiting = ([1, 2, 3].map((d) => (s.claim!.from + d) % 4) as Seat[]).filter((x) => s.claim!.replies[x] === null);
        const seat = waiting[(seedNumber + s.nextSeq) % waiting.length];
        failure = feed(act(s, seat, player(w.views[seat], seat)));
      } else {
        failure =
          s.phase === 'discard' || s.phase === 'declare' ? feed(act(s, s.turn, player(w.views[s.turn], s.turn))) : feed(advance(s));
      }
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
    endings: { tsumo: 0, ron: 0, exhaust: 0, tripleRon: 0, abort: 0, unfinished: 0 },
    paths: { riichi: 0, double: 0, riichiWin: 0, ippatsu: 0, ura: 0, tenpaiCounts: [0, 0, 0, 0, 0], doubleRon: 0, missed: 0, calls: 0, chi: 0, openWin: 0, kan: { ankan: 0, kakan: 0, minkan: 0, riichiAnkan: 0, rinshanWin: 0, chankan: 0, kanDora: 0, fourKans: 0 }, clash: { total: 0, ronWon: 0, ponWon: 0, chiLost: 0 }, aborts: {}, kuikaeBanned: 0, nagashi: 0, paoSet: 0, riichiSticks: 0 },
    failures: [],
  };
  for (let i = 0; i < games; i++) {
    const r = playOne(`${seedPrefix}-${i}`, GENERAL_RULES, i % 2 === 0 ? tsumogiriCpu : benchCpu);
    result.games++;
    result.events += r.events;
    result.endings[r.ending]++;
    const k = result.paths.kan;
    const riichiSeats = new Set<number>();
    let indicators = 0;
    let kans = 0;
    for (const e of r.log) {
      if (e.ev.type === 'discard' && e.ev.riichi) {
        result.paths.riichi++;
        riichiSeats.add(e.ev.seat);
      }
      if (e.ev.type === 'kan') {
        k[e.ev.kan]++;
        kans++;
        if (e.ev.kan === 'ankan' && riichiSeats.has(e.ev.seat)) k.riichiAnkan++;
      }
      if (e.ev.type === 'call' && e.ev.meld === 'kan') {
        k.minkan++;
        kans++;
      }
      if (e.ev.type === 'doraReveal') indicators++;
    }
    k.kanDora += Math.max(0, indicators - 1);
    if (r.result?.type === 'abort') result.paths.aborts[r.result.reason] = (result.paths.aborts[r.result.reason] ?? 0) + 1;
    result.paths.kuikaeBanned += r.kuikaeBanned;
    if (r.result?.type === 'exhaust' && r.result.nagashi) result.paths.nagashi++;
    result.paths.paoSet += r.final.pao.filter(Boolean).length;
    result.paths.riichiSticks += r.final.riichiStick.filter(Boolean).length;
    const c = result.paths.clash;
    c.total += r.clashes.length;
    c.ronWon += r.clashes.filter((x) => x.won === 'ron').length;
    c.ponWon += r.clashes.filter((x) => x.won === 'pon' || x.won === 'kan').length;
    c.chiLost += r.clashes.filter((x) => x.chi && x.won !== 'chi').length;
    if (kans === 4) k.fourKans++;
    if (r.result?.type === 'tsumo' && r.result.score.yaku.some((y) => y.id === 'rinshan')) k.rinshanWin++;
    if (r.result?.type === 'ron' && r.result.robbed) k.chankan++;
    if (r.result?.type === 'ron' && r.result.wins.length > 1) result.paths.doubleRon++;
    const melds = r.finalMelds;
    result.paths.calls += melds.reduce((n, ms) => n + ms.length, 0);
    result.paths.chi += melds.reduce((n, ms) => n + ms.filter((m) => m.type === 'chi').length, 0);
    const winners = r.result?.type === 'tsumo' ? [r.result.seat] : r.result?.type === 'ron' ? r.result.wins.map((w) => w.seat) : [];
    if (winners.some((seat) => melds[seat].length > 0)) result.paths.openWin++;
    if (r.missed) result.paths.missed++;
    const last = r.log[r.log.length - 1]?.ev;
    if (last?.type === 'tsumo' && last.ura.length > 0) result.paths.riichiWin++;
    if (r.result?.type === 'exhaust') result.paths.tenpaiCounts[r.result.tenpai.filter(Boolean).length]++;
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
