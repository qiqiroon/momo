// CPU の段階どうしで共通に使う下ごしらえ（段階7）。見える局面だけを使う。

import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import { queOn, type GameState } from '../engine/state';
import { isSuit, kindOf, type KindId, type TileId } from '../engine/tiles';
import { acceptance, shanten } from './shanten';

// ---- 缺一門（段階9 手順7） ----
// 捨てる色の牌はアガリに使えない＝手の良し悪しを測るときは「手に無いもの」として数える。
// こうすると、捨てる色の牌を引くことも受け入れに入らない（足しても面子・塔子にならない）

/** 缺一門で捨てる色（0 萬・1 筒・2 索）。缺一門の無いルール・まだ決めていないなら null */
export function queSuitOf(view: GameState, seat: Seat): number | null {
  if (!queOn(view.rules)) return null;
  return view.que[seat] ?? view.queHeldSuit[seat];
}

const suitOfKind = (k: KindId) => (k < 27 ? Math.floor(k / 9) : -1);

/** 手を測るための種類ごとの枚数：捨てる色の牌は数えない */
export function handCounts(view: GameState, seat: Seat, tiles: readonly TileId[] = view.hands[seat]): number[] {
  const counts = kindCounts(tiles);
  const q = queSuitOf(view, seat);
  if (q !== null) for (let k = q * 9; k < q * 9 + 9; k++) counts[k] = 0;
  return counts;
}

/** 捨てる色の牌か（手を測る枚数に入っていない牌＝切っても手は変わらない） */
export function isQueTile(view: GameState, seat: Seat, tile: TileId): boolean {
  const q = queSuitOf(view, seat);
  return q !== null && suitOfKind(kindOf(tile)) === q;
}

/** 役牌の種類：三元牌と、場風・自風（鳴いて刻子にすれば役が付く） */
export function yakuhaiKinds(view: GameState, seat: Seat): Set<KindId> {
  const round = 27 + (Math.floor(view.roundIndex / 4) % 4);
  const own = 27 + ((seat - view.dealer + 4) % 4);
  return new Set([31, 32, 33, round, own]);
}

/** 鳴いた面子の数（暗槓も面子の数には入る＝手牌の枚数が減る） */
export const meldCount = (view: GameState, seat: Seat) => view.melds[seat].length;

/** すでに役牌を鳴いているか（鳴いた手に役が付いている） */
export function hasOpenYakuhai(view: GameState, seat: Seat): boolean {
  const y = yakuhaiKinds(view, seat);
  return view.melds[seat].some((m) => m.type !== 'chi' && y.has(kindOf(m.tiles[0])));
}

/** 牌が手の中でどれだけ他とつながっているか（同じ種類・隣・1 つ飛び）。小さいほど孤立している */
export function connection(tile: TileId, counts: readonly number[]): number {
  const k = kindOf(tile);
  let score = (counts[k] - 1) * 3;
  if (isSuit(k)) {
    const n = k % 9;
    for (const [d, w] of [[-2, 1], [-1, 2], [1, 2], [2, 1]] as const) {
      if (n + d >= 0 && n + d <= 8 && counts[k + d] > 0) score += w;
    }
  }
  return score;
}

/** 切ったあとの向聴数。同じ種類の牌は同じ答えなので種類ごとに覚える */
export function shantenAfterDiscard(view: GameState, seat: Seat): (tile: TileId) => number {
  const counts = handCounts(view, seat);
  const open = meldCount(view, seat);
  const memo = new Map<KindId, number>();
  return (tile) => {
    const k = kindOf(tile);
    let s = memo.get(k);
    if (s === undefined) {
      // 捨てる色の牌は数えていない＝切っても手は変わらない
      const que = isQueTile(view, seat, tile);
      if (!que) counts[k]--;
      s = shanten(counts, open);
      if (!que) counts[k]++;
      memo.set(k, s);
    }
    return s;
  };
}

/** 鳴いたあと（手牌から tiles を出した残り）、いちばんうまく 1 枚切ったときの向聴数 */
export function shantenAfterCall(view: GameState, seat: Seat, tiles: readonly TileId[]): number {
  const rest = view.hands[seat].slice();
  for (const t of tiles) rest.splice(rest.indexOf(t), 1);
  const counts = handCounts(view, seat, rest);
  const open = meldCount(view, seat) + 1;
  let best = 99;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    counts[k]--;
    best = Math.min(best, shanten(counts, open));
    counts[k]++;
  }
  return best;
}

/**
 * 缺一門の捨てる色と伏せる牌を決める（段階9 手順7）。
 * 色ごとに「その色を捨てたあとの手」を測り、一番よい色を捨てる：
 *   1. 残りの手の向聴数が小さい（アガリに近い）
 *   2. 捨てる色の牌が少ない（捨て終えるまでの手数が少ない）
 *   3. 残りの手の受け入れが多い
 * 伏せる牌は、その色の中で一番孤立した牌。手に 1 枚も無い色を捨てる色にするときは、伏せた牌が最初の打牌になるので、
 * 伏せても残りの手の向聴数が一番下がらない数牌（同じなら一番孤立した牌）を伏せる
 */
export function chooseQue(view: GameState, seat: Seat, legal: readonly Action[]): Action {
  const hand = view.hands[seat];
  const all = kindCounts(hand);
  const open = meldCount(view, seat);
  let best: Action | null = null;
  let bestKey: number[] | null = null;
  for (const suit of [0, 1, 2]) {
    const options = legal.filter((a): a is Extract<Action, { type: 'que' }> => a.type === 'que' && a.suit === suit);
    if (!options.length) continue;
    const rest = all.slice();
    for (let k = suit * 9; k < suit * 9 + 9; k++) rest[k] = 0;
    const inSuit = all.slice(suit * 9, suit * 9 + 9).reduce((a, b) => a + b, 0);
    for (const a of options) {
      const k = kindOf(a.tile);
      // 手に無い色を捨てる色にするなら、伏せた牌は残りの手から抜ける
      const left = rest.slice();
      if (suitOfKind(k) !== suit) left[k]--;
      const acc = acceptance(left, open);
      const key = [acc.shanten, inSuit, -acc.tiles, connection(a.tile, all), a.tile];
      if (!bestKey || lexLess(key, bestKey)) [best, bestKey] = [a, key];
    }
  }
  return best ?? legal[0];
}

/** 前から順に比べて a が小さいか */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** 選べることの中から、決まった種類のものを探す */
export const pick = <T extends Action['type']>(legal: readonly Action[], type: T) =>
  legal.find((a): a is Extract<Action, { type: T }> => a.type === type);
