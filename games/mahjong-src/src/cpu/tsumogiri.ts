// 段階1の仮の CPU。アガリの形ならツモアガリ、そうでなければ引いた牌をそのまま切る。
// 自分の席から見える局面（viewFor）だけを受け取る＝他の人の手牌も山も知らない。

import type { Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import type { GameState } from '../engine/state';

export function tsumogiriCpu(view: GameState, seat: Seat): Action {
  const legal = legalActions(view, seat);
  if (legal.length === 0) throw new Error(`席 ${seat} はいま選べることが無い`);
  const win = legal.find((a) => a.type === 'tsumo' || a.type === 'tenpai');
  if (win) return win;
  const noten = legal.find((a) => a.type === 'noten');
  if (noten) return noten;
  const drawn = view.drawn[seat];
  return legal.find((a) => a.type === 'discard' && a.tile === drawn) ?? legal[legal.length - 1];
}
