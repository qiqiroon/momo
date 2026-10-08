// 検査用の打ち手（対局の画面では使わない）。ツモ切りだけだとアガリがほぼ起きず、
// 自動対局でアガリの道が通らない＝検査にならないので、形を寄せる素朴な打ち方を用意する。
// 強さは目的ではない：孤立した牌から切り、アガリの形ならアガる。切る牌でリーチできるならリーチする（リーチ・一発・裏ドラの道を通すため）。
// 字牌の対子はポンし、一度鳴いたらチー・ポンできるときはする（鳴きの道を通すため）。カンはできるときはする（大明槓は鳴いたあとだけ）。

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
  // 途中流局の道を検査に乗せるため：九種九牌で流せるなら流す
  const kyushu = legal.find((a) => a.type === 'kyushu');
  if (kyushu) return kyushu;
  // 検査用：オーラスでトップの親は続ける（続ける道を検査に乗せるため。画面の CPU はやめる）
  const go = legal.find((a) => a.type === 'yame' && !a.stop);
  if (go) return go;
  const noten = legal.find((a) => a.type === 'noten');
  if (noten) return noten;
  // カンの道を検査に乗らせるため：暗槓・加槓はできるときはする（リーチのあとの暗槓も）。大明槓は字牌か、鳴いたあとならする
  const kan = legal.find((a) => a.type === 'kan' && (a.kan !== 'minkan' || kindOf(a.tiles[0]) >= 27 || view.melds[seat].length > 0));
  if (kan) return kan;
  // 鳴きの道を検査に乗せるため：字牌の対子はポンする。一度鳴いたら、チー・ポンできるときはする
  const pon = legal.find((a) => a.type === 'pon');
  if (pon && pon.type === 'pon' && (kindOf(pon.tiles[0]) >= 27 || view.melds[seat].length > 0)) return pon;
  const chi = legal.find((a) => a.type === 'chi');
  if (chi && view.melds[seat].length > 0) return chi;
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
