// 鳴ける牌の予告（段階5の4c・工程表 v0.03 段階5・利用者決定 Q1=A）。
// ほかの人の番のあいだに「この牌が出たら鳴ける」を並べ、牌ごとに先に「その場で聞く／鳴く／見送る」を選んでおける。
//  - 押すたびに「その場で聞く → 鳴く → 見送る」（ポンもカンもできる牌は「その場で聞く → ポン → カン → 見送る」）
//  - チーは上家の牌のときだけ。組み合わせが何通りもある牌は、一覧から選ぶ（選ばなければ「その場で聞く」）
//  - 手が変わるたびに作り直し、まだ鳴ける牌の選択は残す
// ここは画面にも通信にも触らない（選んだことから、返事の番にどう返すかを決めるだけ）。

import type { Seat } from '../engine/events';
import { waitKinds } from '../engine/agari';
import type { Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { kindOf, type KindId } from '../engine/tiles';

export type RonPick = 'ask' | 'yes' | 'no';
export type PonPick = 'ask' | 'pon' | 'kan' | 'no';
/** チー：組み合わせ（手牌から出す 2 枚の種類）を選んだら、その組み合わせで鳴く */
export type ChiPick = 'ask' | 'no' | { with: [KindId, KindId] };

export interface Preset {
  ron?: RonPick;
  pon?: PonPick;
  chi?: ChiPick;
}

export type Presets = Map<KindId, Preset>;

/** その種類の牌が出たらできること（手牌から決まる） */
export interface Callable {
  kind: KindId;
  ron: boolean;
  pon: boolean;
  kan: boolean;
  /** チーで手牌から出す 2 枚の種類の組み合わせ（上家の牌のときだけ使える） */
  chi: [KindId, KindId][];
}

/** いまの手牌で、出たら鳴ける・ロンできる牌（リーチのあとはロンだけ。「鳴かない」ならロンだけ） */
export function callables(view: GameState, seat: Seat, noCalls: boolean, hand: readonly number[] = view.hands[seat]): Callable[] {
  if (hand.length === 0 || hand.some((t) => t < 0)) return [];
  const count = new Map<KindId, number>();
  for (const t of hand) count.set(kindOf(t), (count.get(kindOf(t)) ?? 0) + 1);
  const waits = new Set(hand.length % 3 === 1 ? waitKinds(hand) : []);
  const callsOk = !noCalls && view.riichi[seat] === 'none';
  const out: Callable[] = [];
  for (let k = 0; k < 34; k++) {
    const n = count.get(k) ?? 0;
    const chi: [KindId, KindId][] = [];
    if (callsOk && k < 27) {
      const suit = Math.floor(k / 9);
      for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]] as const) {
        const ka = k + a;
        const kb = k + b;
        if (ka < 0 || kb > 26 || Math.floor(ka / 9) !== suit || Math.floor(kb / 9) !== suit) continue;
        if ((count.get(ka) ?? 0) > 0 && (count.get(kb) ?? 0) > 0) chi.push([ka, kb]);
      }
    }
    const c: Callable = { kind: k, ron: waits.has(k), pon: callsOk && n >= 2, kan: callsOk && n >= 3, chi };
    if (c.ron || c.pon || c.kan || c.chi.length) out.push(c);
  }
  return out;
}

/** 押すたびの次の選び方 */
export function nextRon(p: RonPick | undefined): RonPick {
  return p === 'yes' ? 'no' : p === 'no' ? 'ask' : 'yes';
}

export function nextPon(p: PonPick | undefined, kan: boolean): PonPick {
  if (p === 'pon') return kan ? 'kan' : 'no';
  if (p === 'kan') return 'no';
  if (p === 'no') return 'ask';
  return 'pon';
}

/** 手が変わったら、もう鳴けない牌の選択を消す（まだ鳴ける牌の選択は残す） */
export function prunePresets(presets: Presets, list: readonly Callable[]): void {
  for (const [k, p] of [...presets]) {
    const c = list.find((x) => x.kind === k);
    const keep: Preset = {};
    if (c?.ron && p.ron) keep.ron = p.ron;
    if (c?.pon && p.pon && (p.pon !== 'kan' || c.kan)) keep.pon = p.pon;
    const chi = p.chi;
    if (c && chi !== undefined && c.chi.length) {
      if (typeof chi === 'string') keep.chi = chi;
      else if (c.chi.some(([a, b]) => a === chi.with[0] && b === chi.with[1])) keep.chi = chi;
    }
    if (keep.ron || keep.pon || keep.chi) presets.set(k, keep);
    else presets.delete(k);
  }
}

/**
 * 返事の番に、選んでおいたことから返事を決める。
 * 鳴く・ロンと決めてあればそれ（ロン＞ポン・カン＞チー）。どれも「見送る」なら見送る。
 * 「その場で聞く」が 1 つでも残れば 'ask'（ボタンを出して待つ）
 */
export function presetReply(view: GameState, legal: readonly Action[], presets: Presets): Action | 'ask' {
  const c = view.claim;
  if (view.phase !== 'claim' || !c) return 'ask';
  const p = presets.get(kindOf(c.tile)) ?? {};
  const pass = legal.find((a) => a.type === 'pass');
  let ask = false;
  const ron = legal.find((a) => a.type === 'ron');
  if (ron) {
    if (p.ron === 'yes') return ron;
    if (p.ron !== 'no') ask = true;
  }
  const pons = legal.filter((a) => a.type === 'pon');
  const kans = legal.filter((a) => a.type === 'kan');
  if (pons.length || kans.length) {
    if (p.pon === 'pon' && pons.length) return pons[0];
    if (p.pon === 'kan' && kans.length) return kans[0];
    if (p.pon === undefined || p.pon === 'ask' || (p.pon === 'kan' && !kans.length && pons.length)) ask = true;
  }
  const chis = legal.filter((a) => a.type === 'chi') as { type: 'chi'; tiles: number[] }[];
  if (chis.length) {
    const pick = p.chi;
    if (pick && typeof pick === 'object') {
      const hit = chis.find((a) => {
        const ks = a.tiles.map(kindOf).sort((x, y) => x - y);
        return ks[0] === pick.with[0] && ks[1] === pick.with[1];
      });
      if (hit) return hit;
      ask = true;
    } else if (pick !== 'no') ask = true;
  }
  if (ask || !pass) return 'ask';
  return pass;
}
