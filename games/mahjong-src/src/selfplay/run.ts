// 自動対局の台。種を変えながら対局を回し、出来事ごとに見張り役を通す。
// 段階1：1 局をまるごと（ツモアガリか流局まで）回す。打ち手は種の番号で交互に替える
//   偶数＝4 人ともツモ切りの仮の CPU（画面で使うもの）／奇数＝形を寄せる検査用の打ち手（アガリの道を通すため）
//
// 失敗0件だけでは安心しない：回した局数と出来事の件数、終わり方の内訳を必ず一緒に出す。

import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import type { Envelope, Seat } from '../engine/events';
import { Watcher } from '../engine/invariants';
import { nextStep } from '../engine/game';
import { act, advance, nextHand, rollForDealer, startRound } from '../engine/round';
import { GENERAL_RULES, type Rules } from '../engine/rules';
import type { GameState, OpenMeld, RoundResult } from '../engine/state';
import { kindOf } from '../engine/tiles';

export interface SelfplayResult {
  games: number;
  events: number;
  /** 終わり方の内訳（ツモアガリ・流局・途中で止まった） */
  endings: { tsumo: number; ron: number; exhaust: number; tripleRon: number; abort: number; cnWin: number; unfinished: number };
  /** 通った道の数（0 なら、その道は検査に乗っていない）：リーチ・ダブル立直・リーチでのツモ・一発・裏ドラが乗ったアガリ */
  paths: { riichi: number; double: number; riichiWin: number; ippatsu: number; ura: number; tenpaiCounts: number[]; doubleRon: number; missed: number; calls: number; chi: number; openWin: number; kan: { ankan: number; kakan: number; minkan: number; riichiAnkan: number; rinshanWin: number; chankan: number; kanDora: number; fourKans: number }; clash: { total: number; ronWon: number; ponWon: number; chiLost: number }; aborts: Record<string, number>; kuikaeBanned: number; nagashi: number; paoSet: number; riichiSticks: number;
    /** 缺一門（中国式）：伏せた回数・手に無い色を宣言した回数・宣言のあと捨てる色から切った回数・ほかの色を切った回数（捨てる色が残っていない） */
    que: { held: number; voidSuit: number; fromQue: number; other: number };
    /** 中国式のアガリ：ツモ・ロン・同じ牌で 2 人以上・番ごとの回数・上限で切った回数・見逃しの縛りが立った局 */
    cn: { tsumo: number; ron: number; multi: number; fans: Record<string, number>; capped: number; missed: number; winners: number[]; exhaustedAfterWin: number; kanIncome: Record<string, number>; kanReturned: number; robbed: number; draw: { hands: number; ready: number; noten: number; pig: number; chajiao: number; kanReturned: number } } };
  failures: { seed: string; seq: number; reasons: string[] }[];
}

type Failure = SelfplayResult['failures'][number];

/** 1 局を最後まで回しても終わらないときの打ち切り（ツモは山の数より多くならない。打牌のたびに 3 人の返事が付く） */
const MAX_EVENTS = 2000;
/** 1 対局の局の数の上限（連荘が続いても普通はこれより少ない。超えたら止まったものとして失敗にする） */
const MAX_HANDS = 120;

/** 1対局（いまは 1 局）を回す。出来事の列も返す（牌譜の土台・失敗の再現用） */
export type Player = typeof tsumogiriCpu;

export function playOne(
  seed: string,
  rules: Rules = GENERAL_RULES,
  /** 打ち手。席ごとに替えるときは 4 人ぶんの並び（CPU どうしの強さ比べ） */
  player: Player | readonly Player[] = tsumogiriCpu,
  /** true＝対局の終わりまで続けて打つ（局の進め方・半荘の完走を見る） */
  wholeGame = false,
): { events: number; missed: boolean; cnMissed: boolean; kuikaeBanned: number; final: GameState; clashes: { won: string; chi: boolean }[]; finalMelds: OpenMeld[][]; log: Envelope[]; ending: keyof SelfplayResult['endings']; result: RoundResult | null; failure: Failure | null } {
  const w = new Watcher();
  const who = (seat: Seat): Player => (typeof player === 'function' ? player : player[seat]);
  const seedNumber = [...seed].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const log: Envelope[] = [];
  let sawMissed = false;
  let sawCnMissed = false;
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
      if (w.full.cnMissed.some((x) => x !== null)) sawCnMissed = true;
      if (reasons.length) return { seed, seq: env.seq, reasons };
      log.push(env);
    }
    return null;
  };
  const done = (failure: Failure | null) => ({
    events: w.checked,
    missed: sawMissed,
    cnMissed: sawCnMissed,
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
  // 半荘を最後まで打つときは親決めから（起家が席 0 以外になる道も通す）。1 局だけのときは席 0 が親のまま
  if (!failure && wholeGame) failure = feed([{ seq: w.full.nextSeq, to: 'all', ev: rollForDealer(seed) }]);
  if (!failure) failure = feed(startRound(w.full, seed, 0, w.full.chicha));
  let hands = 1;
  while (!failure && w.full.phase !== 'gameover' && (wholeGame || w.full.phase !== 'ended')) {
    if (w.checked > MAX_EVENTS * hands) return done({ seed, seq: w.full.nextSeq, reasons: ['局が終わらない'] });
    if (hands > MAX_HANDS) return done({ seed, seq: w.full.nextSeq, reasons: [`対局が ${MAX_HANDS} 局で終わらない`] });
    const s = w.full;
    try {
      if (s.phase === 'ended') {
        // 局の終わり：親がやめるか選ぶ番なら親が選ぶ。そうでなければ次の局か対局の終わり
        const n = nextStep(s);
        if (n.type === 'yame') failure = feed(act(s, n.seat, who(n.seat)(w.views[n.seat], n.seat)));
        else {
          if (n.type === 'round') hands++;
          failure = feed(nextHand(s, seed));
        }
      } else if (s.phase === 'que') {
        // 缺一門：まだ伏せていない人が伏せる。4 人が同時に選ぶので、順番は種と通し番号で毎回変える
        const waiting = ([0, 1, 2, 3] as Seat[]).filter((x) => s.queHeld[x] === null);
        const seat = waiting[(seedNumber + s.nextSeq) % waiting.length];
        failure = feed(act(s, seat, who(seat)(w.views[seat], seat)));
      } else if (s.phase === 'claim') {
        // 返事がまだの人が、その席から見える局面で返事をする。オンラインでは届く順番が決まらないので、
        // 返事の順番は種と通し番号から決めて毎回変える（順番で結果が変わらないことも見張る）
        const waiting = ([1, 2, 3].map((d) => (s.claim!.from + d) % 4) as Seat[]).filter((x) => s.claim!.replies[x] === null);
        const seat = waiting[(seedNumber + s.nextSeq) % waiting.length];
        failure = feed(act(s, seat, who(seat)(w.views[seat], seat)));
      } else {
        failure =
          s.phase === 'discard' || s.phase === 'declare' ? feed(act(s, s.turn, who(s.turn)(w.views[s.turn], s.turn))) : feed(advance(s));
      }
    } catch (e) {
      failure = { seed, seq: s.nextSeq, reasons: [`進行役が止まった：${(e as Error).message}`] };
    }
  }
  return done(failure);
}

export function runSelfplay(games: number, seedPrefix = 'selfplay', rules: Rules = GENERAL_RULES): SelfplayResult {
  const result: SelfplayResult = {
    games: 0,
    events: 0,
    endings: { tsumo: 0, ron: 0, exhaust: 0, tripleRon: 0, abort: 0, cnWin: 0, unfinished: 0 },
    paths: { riichi: 0, double: 0, riichiWin: 0, ippatsu: 0, ura: 0, tenpaiCounts: [0, 0, 0, 0, 0], doubleRon: 0, missed: 0, calls: 0, chi: 0, openWin: 0, kan: { ankan: 0, kakan: 0, minkan: 0, riichiAnkan: 0, rinshanWin: 0, chankan: 0, kanDora: 0, fourKans: 0 }, clash: { total: 0, ronWon: 0, ponWon: 0, chiLost: 0 }, aborts: {}, kuikaeBanned: 0, nagashi: 0, paoSet: 0, riichiSticks: 0, que: { held: 0, voidSuit: 0, fromQue: 0, other: 0 }, cn: { tsumo: 0, ron: 0, multi: 0, fans: {}, capped: 0, missed: 0, winners: [0, 0, 0, 0], exhaustedAfterWin: 0, kanIncome: {}, kanReturned: 0, robbed: 0, draw: { hands: 0, ready: 0, noten: 0, pig: 0, chajiao: 0, kanReturned: 0 } } },
    failures: [],
  };
  for (let i = 0; i < games; i++) {
    const r = playOne(`${seedPrefix}-${i}`, rules, i % 2 === 0 ? tsumogiriCpu : benchCpu);
    result.games++;
    result.events += r.events;
    result.endings[r.ending]++;
    const k = result.paths.kan;
    const riichiSeats = new Set<number>();
    let indicators = 0;
    let kans = 0;
    const declared: (number | null)[] = [null, null, null, null];
    const suitOf = (t: number) => (kindOf(t) < 27 ? Math.floor(kindOf(t) / 9) : -1);
    for (const e of r.log) {
      if (e.ev.type === 'queHold') {
        result.paths.que.held++;
        if (e.ev.suit !== suitOf(e.ev.tile)) result.paths.que.voidSuit++;
      }
      if (e.ev.type === 'discard') {
        const q = declared[e.ev.seat];
        if (q !== null) result.paths.que[suitOf(e.ev.tile) === q ? 'fromQue' : 'other']++;
        if (e.ev.que !== undefined) declared[e.ev.seat] = e.ev.que;
      }
      if (e.ev.type === 'roundStart') declared.fill(null);
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
    if (r.result?.type === 'cnWin') {
      const cn = result.paths.cn;
      for (const w of r.result.wins) {
        cn[w.from === null ? 'tsumo' : 'ron']++;
        if (w.score.capped) cn.capped++;
        for (const f of w.score.fans) cn.fans[f.id] = (cn.fans[f.id] ?? 0) + 1;
      }
      // 同じ牌で 2 人以上（切った人とアガリ牌が同じロン）・1 局で何人アガったか（血戦到底）・アガった人がいて山が尽きた局
      const groups = new Map<string, number>();
      for (const w of r.result.wins) if (w.from !== null) groups.set(`${w.from}-${w.winTile}`, (groups.get(`${w.from}-${w.winTile}`) ?? 0) + 1);
      cn.multi += [...groups.values()].filter((n) => n > 1).length;
      cn.winners[r.result.wins.length]++;
      if (r.result.exhausted) cn.exhaustedAfterWin++;
      // 流局の精算（手順5）：精算した局・状態ごとの人数・查叫が動いた局・流局でカンの収入を返した局
      const d = r.result.draw;
      if (d) {
        cn.draw.hands++;
        for (const st of d.states) if (st) cn.draw[st]++;
        if (d.chajiao.some((x) => x !== 0)) cn.draw.chajiao++;
        if (d.kanReturn.some((x) => x !== 0)) cn.draw.kanReturned++;
      }
    }
    if (r.cnMissed) result.paths.cn.missed++;
    for (const k of r.final.cnKans) {
      result.paths.cn.kanIncome[k.kind] = (result.paths.cn.kanIncome[k.kind] ?? 0) + 1;
      if (k.returned) result.paths.cn.kanReturned++;
    }
    result.paths.cn.robbed += r.final.robbedKans;
    if (r.failure) result.failures.push(r.failure);
  }
  return result;
}

export interface GameRunResult {
  games: number;
  hands: number;
  maxHands: number;
  events: number;
  /** 対局の終わり方（last＝予定どおり・tobi・yame・extension＝延長の終わり・unfinished） */
  ends: Record<string, number>;
  /** 通った道：延長に入った対局・連荘した局・親が流れた局・アガリやめ/テンパイやめを選ぶ番になった回数・本場の最大 */
  paths: { extension: number; renchan: number; rotated: number; yameAsked: number; maxHonba: number; tobiSeats: number };
  failures: { seed: string; seq: number; reasons: string[] }[];
}

/** 対局（半荘など）を終わりまで回す。打ち手は種の番号で交互に替える */
export function runGames(games: number, seedPrefix = 'game', rules: Rules = GENERAL_RULES): GameRunResult {
  const out: GameRunResult = { games: 0, hands: 0, maxHands: 0, events: 0, ends: {}, paths: { extension: 0, renchan: 0, rotated: 0, yameAsked: 0, maxHonba: 0, tobiSeats: 0 }, failures: [] };
  const lastRound = rules.family === 'jp' && rules.values.length === 'east' ? 3 : 7;
  for (let i = 0; i < games; i++) {
    const r = playOne(`${seedPrefix}-${i}`, rules, i % 2 === 0 ? tsumogiriCpu : benchCpu, true);
    out.games++;
    out.events += r.events;
    const starts = r.log.filter((e) => e.ev.type === 'roundStart');
    out.hands += starts.length;
    out.maxHands = Math.max(out.maxHands, starts.length);
    const end = r.log.find((e) => e.ev.type === 'gameEnd');
    const reason = end && end.ev.type === 'gameEnd' ? end.ev.reason : 'unfinished';
    out.ends[reason] = (out.ends[reason] ?? 0) + 1;
    if (starts.some((e) => e.ev.type === 'roundStart' && e.ev.roundIndex > lastRound)) out.paths.extension++;
    for (let j = 1; j < starts.length; j++) {
      const a = starts[j - 1].ev;
      const b = starts[j].ev;
      if (a.type !== 'roundStart' || b.type !== 'roundStart') continue;
      if (a.dealer === b.dealer) out.paths.renchan++;
      else out.paths.rotated++;
      out.paths.maxHonba = Math.max(out.paths.maxHonba, b.honba ?? 0);
    }
    if (r.log.some((e) => e.ev.type === 'yame')) out.paths.yameAsked++;
    if (reason === 'tobi') out.paths.tobiSeats++;
    if (r.failure) out.failures.push(r.failure);
    else if (reason === 'unfinished') out.failures.push({ seed: `${seedPrefix}-${i}`, seq: -1, reasons: ['対局の終わりまで行かなかった'] });
  }
  return out;
}
