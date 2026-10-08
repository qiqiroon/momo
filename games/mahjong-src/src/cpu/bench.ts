// 検査用の打ち手（対局の画面では使わない）。ツモ切りだけだとアガリがほぼ起きず、
// 自動対局でアガリの道が通らない＝検査にならないので、形を寄せる素朴な打ち方を用意する。
// 強さは目的ではない：孤立した牌から切り、アガリの形ならアガる。切る牌でリーチできるならリーチする（リーチ・一発・裏ドラの道を通すため）。

import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { isSuit, kindOf, type TileId } from '../engine/tiles';

/** その牌が手の中でどれだけ他とつながっているか（同じ種類・隣・1つ飛び） */
function connection(tile: TileId, counts: readonly number[]): number {
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

export function benchCpu(view: GameState, seat: Seat): Action {
  const legal = legalActions(view, seat);
  const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron' || a.type === 'tenpai');
  if (win) return win;
  const noten = legal.find((a) => a.type === 'noten');
  if (noten) return noten;
  const pass = legal.find((a) => a.type === 'pass');
  if (pass) return pass;
  const counts = kindCounts(view.hands[seat]);
  let best: Action = legal[0];
  let bestScore = Infinity;
  for (const a of legal) {
    if (a.type !== 'discard') continue;
    const s = connection(a.tile, counts);
    if (s < bestScore) [best, bestScore] = [a, s];
  }
  if (best.type === 'discard') {
    const tile = best.tile;
    const riichi = legal.find((a) => a.type === 'riichi' && a.tile === tile);
    if (riichi) return riichi;
  }
  return best;
}
