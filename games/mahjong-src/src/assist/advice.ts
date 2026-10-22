// アシストモードの行動の助言（段階6・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md §7）。
// いちばん大事な 1 つだけを、決まった文の組み合わせで（同じ局面なら同じ助言）。中身は CPU の考えの部品から作る：
//  - おすすめの牌＝Apocalypse の CPU が選ぶ牌（cpu/thinker.ts）。押すか降りるかもその判断に従う
//  - 受け入れ・テンパイ＝cpu/thinker.ts の discardPlans、狙う役＝役の候補一覧の先頭、相手＝danger.ts
// 見える局面だけで決める。画面は触らない（文は画面が言葉のキーから作る）。

import { cpuOf } from '../cpu/strength';
import { APOCALYPSE, discardPlans } from '../cpu/thinker';
import { establishedYaku } from '../engine/hints';
import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { kindOf, type KindId } from '../engine/tiles';
import { suspectsOf } from './danger';
import type { YakuPlan } from './yakuPlan';

export interface Advice {
  /** 言葉のキー（ad◯◯） */
  key: string;
  /** 差し込む値。name＝席の番号・state＝tpState◯◯ のキー・suit＝色の番号・combo＝役の組み合わせ（行の key） */
  vars: Record<string, string | number>;
  /** 文のあとに絵で出す牌（おすすめの牌・待ち） */
  tiles: KindId[];
  /** combo を出すときの役の組み合わせ（画面が名前にする） */
  combo?: string[];
}

/** 染め手が見えている相手（鳴いた面子が 2 つ以上で、字牌以外が全部 1 色） */
function flushSuit(view: GameState, s: Seat): number | null {
  const ms = view.melds[s];
  if (ms.length < 2) return null;
  const suits = new Set(ms.map((m) => kindOf(m.tiles[0])).filter((k) => k < 27).map((k) => Math.floor(k / 9)));
  return suits.size === 1 ? [...suits][0] : null;
}

/** いまの局面での助言（出すものが無ければ null）。legal＝自分の選べること・plan＝役の候補一覧（あと何枚の少ない順） */
export function adviceOf(view: GameState, me: Seat, legal: readonly Action[], plan: readonly YakuPlan[]): Advice | null {
  if (view.phase === 'ended' || view.phase === 'gameover' || view.roundIndex < 0) return null;
  if (view.hands[me].some((t) => t < 0)) return null;
  // 1. アガれる
  const how = legal.some((a) => a.type === 'tsumo') ? 'tsumo' : legal.some((a) => a.type === 'ron') ? 'ron' : null;
  if (how && (view.rules?.family !== 'jp' || (establishedYaku(view, me, how)?.length ?? 0) > 0)) return { key: 'adWin', vars: { how }, tiles: [] };

  const sus = suspectsOf(view, me);
  const threat = sus[0];
  const state = (s: (typeof sus)[number]) => (s.riichi ? 'tpStateRiichi' : 'tpStateMaybe');
  const top = plan[0];
  const discards = legal.filter((a) => a.type === 'discard' || a.type === 'riichi');

  // 2・3. 自分の番（切る牌を選ぶ）
  if (discards.length > 0 && view.phase === 'discard') {
    const pick = cpuOf('apocalypse')(view, me);
    if (pick.type === 'tsumo' || pick.type === 'kyushu' || pick.type === 'kan') return null;
    const tile = pick.type === 'discard' || pick.type === 'riichi' ? pick.tile : null;
    if (tile === null) return null;
    const plans = discardPlans(view, me, legal, APOCALYPSE);
    const best = Math.min(...plans.map((p) => p.shanten));
    const mine = plans.find((p) => p.tile === tile);
    const k = kindOf(tile);
    if (threat && mine) {
      // CPU が近さを落としてまで切る＝降りる。同じ近さなら押す
      if (mine.shanten > best) return { key: 'adFold', vars: { name: threat.seat, state: state(threat) }, tiles: [k] };
      return { key: 'adPush', vars: { name: threat.seat, state: state(threat) }, tiles: [k] };
    }
    if (pick.type === 'riichi' || legal.some((a) => a.type === 'riichi' && a.tile === tile)) return { key: 'adRiichi', vars: { n: mine?.waits ?? 0 }, tiles: [k] };
    if (mine && mine.shanten === 0) return { key: 'adTenpai', vars: { n: mine.waits }, tiles: [k] };
    // 狙う役：おすすめの牌を切っても遠くならない行（その牌が余っている）のうち一番上。無ければ言わない
    // （一覧の先頭をそのまま言うと、おすすめの牌を切るとその役が遠くなることがあり、話がちぐはぐになる）
    const aim = plan.find((p) => !p.partial && p.spare.has(k));
    if (view.discards[me].length < 6 && aim) return { key: 'adEarly', vars: {}, tiles: [k], combo: aim.ids };
    if (aim) return { key: 'adMid', vars: { need: aim.need }, tiles: [k], combo: aim.ids };
    return { key: 'adPick', vars: {}, tiles: [k] };
  }

  // 4. 自分の番でないとき
  if (threat) return { key: 'adWatch', vars: { name: threat.seat, state: state(threat) }, tiles: [] };
  for (const s of [0, 1, 2, 3] as Seat[]) {
    if (s === me) continue;
    const suit = flushSuit(view, s);
    if (suit !== null) return { key: 'adFlush', vars: { name: s, suit }, tiles: [] };
  }
  if (top && top.need === 1) return { key: 'adWaiting', vars: {}, tiles: top.tiles.map((x) => x.kind), combo: top.ids };
  if (top) return { key: 'adAim', vars: { need: top.need }, tiles: [], combo: top.ids };
  return null;
}
