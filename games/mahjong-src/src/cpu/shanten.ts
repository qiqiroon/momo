// CPU の物差し（段階7の1）：アガリまでの近さ（向聴数）と、進む牌の枚数（受け入れ）。
// 向聴数＝あと何枚入れ替えればテンパイか。テンパイ＝0、アガリの形＝−1。
// 4面子1雀頭・七対子・国士無双のうち一番近いものを採る（七対子・国士は鳴いていない手だけ）。
//
// 手牌は種類ごとの枚数（長さ 34）で受け取る。鳴いた面子の数は別に渡す（手牌の枚数は 13−3×鳴き か 14−3×鳴き）。
// 速さのため、数牌は 1 色ぶん（9 種の枚数）ごとに「作れる面子と塔子の組み合わせ」を覚えておく。

import { TERMINAL_HONOR_KINDS } from '../engine/agari';
import { HIDDEN, type Seat } from '../engine/events';
import type { GameState } from '../engine/state';
import { kindOf, type KindId } from '../engine/tiles';

/** 1 色から取れる（面子の数, 塔子の数）の組み合わせ。ほかの組に負けるもの（両方少ない）は除いてある */
type Blocks = readonly (readonly [number, number])[];

const suitMemo = new Map<number, Blocks>();

/**
 * 1 色（9 種）の枚数から、取れる（面子, 塔子）を全部出す。塔子＝対子・両面/辺張・嵌張。
 * 一番小さい牌の使い方（刻子・順子・対子・塔子 2 通り・孤立）で分かれ、残りの枚数ごとに答えを覚える
 * （残りが同じなら同じ答え＝1 色に牌が多い手でも数え直さない。2026-10-13 段階9 手順7：全部の道を並べてから比べる形は、
 *   萬子だけの 14 枚で 1 回 90ms ほどかかっていた）
 */
function suitBlocks(c: readonly number[], from: number): Blocks {
  return blocksOf(c.slice(from, from + 9));
}

function blocksOf(local: number[]): Blocks {
  let key = 0;
  for (let i = 0; i < 9; i++) key = key * 5 + local[i];
  const hit = suitMemo.get(key);
  if (hit) return hit;
  let i = 0;
  while (i < 9 && local[i] === 0) i++;
  if (i >= 9) {
    const none: Blocks = [[0, 0]];
    suitMemo.set(key, none);
    return none;
  }
  const found: [number, number][] = [];
  const take = (dm: number, dt: number, ...idx: number[]) => {
    for (const x of idx) local[x]--;
    for (const [m, t] of blocksOf(local)) found.push([m + dm, t + dt]);
    for (const x of idx) local[x]++;
  };
  if (local[i] >= 3) take(1, 0, i, i, i);
  if (i <= 6 && local[i + 1] > 0 && local[i + 2] > 0) take(1, 0, i, i + 1, i + 2);
  if (local[i] >= 2) take(0, 1, i, i);
  if (i <= 7 && local[i + 1] > 0) take(0, 1, i, i + 1);
  if (i <= 6 && local[i + 2] > 0) take(0, 1, i, i + 2);
  // この牌は孤立牌として使わない
  take(0, 0, i);
  const uniq: [number, number][] = [];
  for (const b of found) {
    if (found.some(([m2, t2]) => m2 >= b[0] && t2 >= b[1] && (m2 > b[0] || t2 > b[1]))) continue;
    if (!uniq.some((u) => u[0] === b[0] && u[1] === b[1])) uniq.push(b);
  }
  suitMemo.set(key, uniq);
  return uniq;
}

/** 雀頭を抜いた（または抜かない）残りで、面子と塔子を一番うまく取ったときの向聴数 */
function bestWithoutPair(c: number[], openMelds: number, hasPair: boolean): number {
  // 字牌は刻子か対子（塔子）だけ
  let hm = 0;
  let ht = 0;
  for (let k = 27; k < 34; k++) {
    if (c[k] >= 3) hm++;
    else if (c[k] === 2) ht++;
  }
  const a = suitBlocks(c, 0);
  const b = suitBlocks(c, 9);
  const d = suitBlocks(c, 18);
  const need = 4 - openMelds;
  let best = 8;
  for (const [m1, t1] of a) for (const [m2, t2] of b) for (const [m3, t3] of d) {
    const m = m1 + m2 + m3 + hm;
    let t = t1 + t2 + t3 + ht;
    if (m + t > need) t = Math.max(0, need - m);
    const mm = Math.min(m, need);
    const sh = 8 - 2 * (mm + openMelds) - t - (hasPair ? 1 : 0);
    if (sh < best) best = sh;
  }
  return best;
}

/** 4面子1雀頭の向聴数 */
export function standardShanten(counts: readonly number[], openMelds = 0): number {
  const c = counts.slice(0, 34);
  let best = bestWithoutPair(c, openMelds, false);
  for (let k = 0; k < 34; k++) {
    if (c[k] < 2) continue;
    c[k] -= 2;
    const sh = bestWithoutPair(c, openMelds, true);
    c[k] += 2;
    if (sh < best) best = sh;
  }
  return best;
}

/** 七対子の向聴数（同じ牌 4 枚は 1 組と数える＝日本式） */
export function sevenPairsShanten(counts: readonly number[]): number {
  let pairs = 0;
  let kinds = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] > 0) kinds++;
    if (counts[k] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双の向聴数 */
export function orphansShanten(counts: readonly number[]): number {
  let kinds = 0;
  let pair = false;
  for (const k of TERMINAL_HONOR_KINDS) {
    if (counts[k] > 0) kinds++;
    if (counts[k] >= 2) pair = true;
  }
  return 13 - kinds - (pair ? 1 : 0);
}

/** 向聴数（3 つの形のうち一番近いもの）。鳴いていれば 4面子1雀頭だけ */
export function shanten(counts: readonly number[], openMelds = 0): number {
  const s = standardShanten(counts, openMelds);
  if (openMelds > 0) return s;
  return Math.min(s, sevenPairsShanten(counts), orphansShanten(counts));
}

/**
 * その席から見えている牌を種類ごとに数える（自分の手牌・全員の河・鳴いた面子・ドラ表示牌）。
 * 鳴かれた牌は河の並びにも残っている（calledAway）ので、面子の側だけで数える。伏せた牌（HIDDEN）は数えない。
 */
export function visibleCounts(view: GameState, seat: Seat): number[] {
  const c = new Array<number>(34).fill(0);
  const add = (t: number) => {
    if (t === HIDDEN) return;
    const k = kindOf(t);
    if (k < 34) c[k]++;
  };
  view.hands[seat].forEach(add);
  for (let s = 0; s < 4; s++) {
    const away = new Set(view.calledAway[s]);
    view.discards[s].forEach((t, i) => {
      if (!away.has(i)) add(t);
    });
    for (const m of view.melds[s]) m.tiles.forEach(add);
  }
  view.doraIndicators.forEach(add);
  return c;
}

/**
 * 受け入れ：この手（テンパイ前の 13−3×鳴き 枚）に入ると向聴数が下がる牌の種類と、その残り枚数。
 * 残り枚数＝4−見えている枚数（visible には自分の手牌も含める）。visible を省くと自分の手牌だけ引く。
 */
export function acceptance(
  counts: readonly number[],
  openMelds = 0,
  visible: readonly number[] = counts,
): { kinds: KindId[]; tiles: number; shanten: number } {
  const c = counts.slice(0, 34);
  const now = shanten(c, openMelds);
  const kinds: KindId[] = [];
  let tiles = 0;
  for (let k = 0; k < 34; k++) {
    if (c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, openMelds) < now) {
      kinds.push(k);
      tiles += Math.max(0, 4 - visible[k]);
    }
    c[k]--;
  }
  return { kinds, tiles, shanten: now };
}
