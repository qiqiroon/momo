// アシストモードの守りの手がかり（段階4・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md §5）。
//  - テンパイしていそうな人（リーチの人は確か）と、その理由・あやしい待ち
//  - 手牌の牌ごとの危なさ（3 段階）と理由
// 物差しは CPU の守り（cpu/defense.ts の dangerOf・Apocalypse の細かい見分け）と同じ数を使い、理由も一緒に返す。
// 見える局面だけで決める（ほかの人の手牌は見ない）。画面は触らない。

import type { Seat } from '../engine/events';
import type { GameState } from '../engine/state';
import { kindOf, type KindId } from '../engine/tiles';
import { visibleCounts } from '../cpu/shanten';

/** 理由（画面の言葉のキーと差し込む値。name は席の番号で渡し、画面が名前にする） */
export interface Reason {
  key: string;
  vars?: Record<string, number>;
}

export interface Suspect {
  seat: Seat;
  /** リーチしている（確か）。していなければ「テンパイ？」 */
  riichi: boolean;
  why: Reason;
  /** あやしい待ち（危なさの高い順に 3 つまで・まだ見えていない牌だけ） */
  waits: KindId[];
}

export interface TileRisk {
  /** 0＝印なし・1＝少し危ない（黄）・2＝すごく危ない（赤） */
  level: 0 | 1 | 2;
  /** 一番危ない相手 */
  who: Seat;
  why: Reason;
}

/** 筋が無い数牌の危なさ（1〜9）。cpu/defense.ts と同じ */
const NO_SUJI = [6, 9, 10, 12, 12, 12, 10, 9, 6];

/** 危なさの数を 3 段階へ（赤＝筋の無い 3〜7・黄＝片筋や筋の無い端寄り・まだ見えていない字牌） */
const levelOf = (d: number): 0 | 1 | 2 => (d >= 10 ? 2 : d >= 4 ? 1 : 0);

/** テンパイしていそうか（リーチ以外）。理由を返す（していなさそうなら null） */
function readyWhy(view: GameState, s: Seat): Reason | null {
  const melds = view.melds[s].length;
  const turns = view.discards[s].length;
  if (view.rules?.family === 'cn') {
    if (view.cnOut[s]) return null;
    // 最低の番が要るルール（香港・国標）：鳴きが 3 組以上か、2 組鳴いて 1 色にそろっている（cpu/defense.ts の looksReady と同じ目安）
    if (Number(view.rules.values.minFan) > 0) {
      if (melds >= 3) return { key: 'tpMelds', vars: { n: melds } };
      const suits = new Set(view.melds[s].map((m) => kindOf(m.tiles[0])).filter((k) => k < 27).map((k) => Math.floor(k / 9)));
      return melds >= 2 && suits.size <= 1 ? { key: 'tpFlush', vars: { n: melds } } : null;
    }
    if (melds >= 2) return { key: 'tpMelds', vars: { n: melds } };
    if (turns >= 10) return { key: 'tpLate', vars: { d: turns } };
    if (melds >= 1 && turns >= 7) return { key: 'tpMeldsLate', vars: { n: melds, d: turns } };
    return null;
  }
  // 日本式（リーチしていない人）：鳴きの数と巡目の目安
  if (melds >= 3) return { key: 'tpMelds', vars: { n: melds } };
  if (melds >= 2 && turns >= 8) return { key: 'tpMeldsLate', vars: { n: melds, d: turns } };
  if (melds >= 1 && turns >= 12) return { key: 'tpMeldsLate', vars: { n: melds, d: turns } };
  if (turns >= 15) return { key: 'tpLate', vars: { d: turns } };
  return null;
}

/** 相手 t に対して通る種類（現物と、リーチのあとにほかの人が切って通った牌） */
function safeKinds(view: GameState, t: Seat): Set<KindId> {
  const safe = new Set(view.discards[t].map(kindOf));
  const at = view.riichiAt[t];
  if (at !== null) {
    for (let s = 0; s < 4; s++) {
      if (s === t) continue;
      const d = view.discards[s];
      for (let i = Math.min(d.length, at + (s > t ? 0 : 1)); i < d.length; i++) safe.add(kindOf(d[i]));
    }
  }
  return safe;
}

/** 相手 t に種類 k を切ったときの危なさと理由（cpu/defense.ts の dangerOf の fine と同じ数） */
function riskTo(view: GameState, t: Seat, k: KindId, visible: readonly number[], safe: Set<KindId>): { d: number; why: Reason } {
  const cn = view.rules?.family === 'cn';
  if (cn && view.que[t] !== null && k < 27 && Math.floor(k / 9) === view.que[t]) return { d: 0, why: { key: 'dgQue', vars: { name: t } } };
  if (safe.has(k)) return cn ? { d: 2, why: { key: 'dgGenbutsuCn', vars: { name: t } } } : { d: 0, why: { key: 'dgGenbutsu', vars: { name: t } } };
  if (k >= 27) {
    const v = visible[k];
    return v >= 3 ? { d: 1, why: { key: 'dgHonorSeen', vars: { n: v } } } : v === 2 ? { d: 3, why: { key: 'dgHonorSeen', vars: { n: v } } } : { d: 6, why: { key: 'dgHonorLive', vars: { name: t } } };
  }
  const n = k % 9;
  const base = k - n;
  const low = n - 3 >= 0 && safe.has(base + n - 3);
  const high = n + 3 <= 8 && safe.has(base + n + 3);
  const edge = n <= 2 ? high : n >= 6 ? low : low && high;
  let r: { d: number; why: Reason } = edge
    ? { d: Math.ceil(NO_SUJI[n] / 2), why: { key: 'dgSuji', vars: { name: t } } }
    : low || high
      ? { d: Math.ceil(NO_SUJI[n] * 0.75), why: { key: 'dgHalfSuji', vars: { name: t } } }
      : { d: NO_SUJI[n], why: { key: n >= 2 && n <= 6 ? 'dgNoSujiMid' : 'dgNoSuji', vars: { name: t } } };
  // 壁：隣の牌が 4 枚見えていれば、その向こう側の両面待ちは無い
  const wallBelow = n >= 1 && visible[k - 1] >= 4;
  const wallAbove = n <= 7 && visible[k + 1] >= 4;
  if (((n <= 1 && wallAbove) || (n >= 7 && wallBelow)) && r.d > 3) r = { d: 3, why: { key: 'dgWall' } };
  return r;
}

/** テンパイしていそうな人（自分以外。リーチの人を含む） */
export function suspectsOf(view: GameState, me: Seat): Suspect[] {
  const visible = visibleCounts(view, me);
  const out: Suspect[] = [];
  for (const s of [0, 1, 2, 3] as Seat[]) {
    if (s === me) continue;
    const riichi = view.riichi[s] !== 'none';
    const why = riichi ? { key: 'tpRiichi' } : readyWhy(view, s);
    if (!why) continue;
    const safe = safeKinds(view, s);
    const waits = Array.from({ length: 34 }, (_, k) => k)
      .filter((k) => visible[k] < 4 && (view.rules?.family !== 'cn' || k < 27 || view.rules.values.honors === 'on'))
      .map((k) => ({ k, d: riskTo(view, s, k, visible, safe).d }))
      .filter((x) => x.d >= 4)
      .sort((a, b) => b.d - a.d || a.k - b.k)
      .slice(0, 3)
      .map((x) => x.k);
    out.push({ seat: s, riichi, why, waits });
  }
  return out;
}

/** 手牌の種類ごとの危なさ（テンパイしていそうな人がいなければ空） */
export function risksOf(view: GameState, me: Seat, sus: readonly Suspect[]): Map<KindId, TileRisk> {
  const out = new Map<KindId, TileRisk>();
  if (sus.length === 0) return out;
  const visible = visibleCounts(view, me);
  const safes = new Map(sus.map((x) => [x.seat, safeKinds(view, x.seat)]));
  for (const t of view.hands[me]) {
    if (t < 0) continue;
    const k = kindOf(t);
    if (out.has(k)) continue;
    let worst: TileRisk | null = null;
    let worstD = -1;
    for (const x of sus) {
      const r = riskTo(view, x.seat, k, visible, safes.get(x.seat)!);
      if (r.d > worstD) {
        worstD = r.d;
        worst = { level: levelOf(r.d), who: x.seat, why: r.why };
      }
    }
    if (worst) out.set(k, worst);
  }
  return out;
}
