// アシストモードの鳴く前の注意（段階4・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md §6）。
// 鳴いたあとの手を仮に作って役の候補を数え直し、今の候補と比べる：
//  - 鳴くと届かなくなる役（門前の役・リーチなど）
//  - 鳴くとアガれる形が 1 つも無くなる（役なし。中国式は最低の番に届かない）
// 見える局面だけで決める。画面は触らない。

import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import type { GameState, OpenMeld } from '../engine/state';
import { yakuPlanFull, type YakuPlan } from './yakuPlan';

/** 鳴けば必ず消える門前の役・番（鳴いたあとを数えきれなかったときは、これだけを「消える」と出す） */
const CLOSED_ONLY: ReadonlySet<string> = new Set(['pinfu', 'iipeikou', 'ryanpeikou', 'chiitoitsu', 'menqing', 'menqianqing', 'qiduiG', 'qidui', 'riichi']);

export interface CallLoss {
  /** 鳴くと届かなくなる役（日本式で門前ならリーチも 'riichi' で入れる） */
  lost: string[];
  /** 鳴くとアガれる形が 1 つも無くなる */
  none: boolean;
}

/** 切られた牌をチー・ポン・大明槓したあとの局面（その席から見える形）。鳴けない場面なら null */
export function afterCall(view: GameState, seat: Seat, a: Action): GameState | null {
  const c = view.claim;
  if (!c || (a.type !== 'chi' && a.type !== 'pon' && !(a.type === 'kan' && a.kan === 'minkan'))) return null;
  const used = new Set(a.tiles);
  const meld: OpenMeld = { type: a.type === 'kan' ? 'minkan' : a.type, tiles: [...a.tiles, c.tile], called: c.tile, from: c.from };
  const hands = view.hands.map((h, s) => (s === seat ? h.filter((t) => !used.has(t)) : h));
  const melds = view.melds.map((m, s) => (s === seat ? [...m, meld] : m));
  // 鳴かれた牌は河に残し、鳴かれた印を付ける（見えている枚数を 2 度数えない）
  const calledAway = view.calledAway.map((x, s) => (s === c.from ? [...x, view.discards[c.from].length - 1] : x));
  return { ...view, hands, melds, calledAway, claim: null, drawn: [null, null, null, null] };
}

/** 鳴く前と鳴いたあとの役の候補を比べる。before＝今の候補（手牌 13 枚のとき数えたもの） */
export function callLoss(view: GameState, seat: Seat, a: Action, before: readonly YakuPlan[], budgetMs = 150): CallLoss | null {
  const next = afterCall(view, seat, a);
  if (!next) return null;
  // 行数の上限なし（打ち切ると、届く役まで「消える」と出してしまう）。時間が切れたら、確実に消える門前の役だけを出す
  const { rows: after, truncated } = yakuPlanFull(next, seat, { budgetMs, limit: 10000 });
  const has = new Set(after.flatMap((p) => p.ids));
  const lost = [...new Set(before.flatMap((p) => p.ids))].filter((id) => !has.has(id) && (!truncated || CLOSED_ONLY.has(id)));
  // 日本式で門前なら、鳴くとリーチもできなくなる（リーチは場面の役なので候補には出ていない）
  if (view.rules?.family === 'jp' && view.melds[seat].every((m) => m.type === 'ankan') && view.riichi[seat] === 'none') lost.push('riichi');
  return { lost, none: after.length === 0 && !truncated };
}
