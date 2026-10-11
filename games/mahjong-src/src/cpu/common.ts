// CPU の段階どうしで共通に使う下ごしらえ（段階7）。見える局面だけを使う。

import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { isSuit, kindOf, type KindId, type TileId } from '../engine/tiles';
import { shanten } from './shanten';

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
  const counts = kindCounts(view.hands[seat]);
  const open = meldCount(view, seat);
  const memo = new Map<KindId, number>();
  return (tile) => {
    const k = kindOf(tile);
    let s = memo.get(k);
    if (s === undefined) {
      counts[k]--;
      s = shanten(counts, open);
      counts[k]++;
      memo.set(k, s);
    }
    return s;
  };
}

/** 鳴いたあと（手牌から tiles を出した残り）、いちばんうまく 1 枚切ったときの向聴数 */
export function shantenAfterCall(view: GameState, seat: Seat, tiles: readonly TileId[]): number {
  const rest = view.hands[seat].slice();
  for (const t of tiles) rest.splice(rest.indexOf(t), 1);
  const counts = kindCounts(rest);
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

/** 選べることの中から、決まった種類のものを探す */
export const pick = <T extends Action['type']>(legal: readonly Action[], type: T) =>
  legal.find((a): a is Extract<Action, { type: T }> => a.type === type);
