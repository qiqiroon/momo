// 1 手ごとの制限時間（段階10の2・利用者決定 2026-10-16）：時間切れのときに本人の端末が代わりに選ぶこと。
// 時間切れは「何もしなかった」扱い＝考えずに決まる選び方にする（CPU の考えで選ぶと素人には得になる＝利用者指摘）。
//  - 返事（ポン・チー・カン・ロン）は見送る／自分の番はツモ切り（アガリ・リーチはしない）
//  - ツモ切りできない（ポン・チーした直後・缺一門の縛りで切れない）ときは、手牌の左端から切れる牌（Q5=A）
//  - 九種九牌は流さない（ルールが「必ず流す」のときだけ流す）／流局の宣言はテンパイならテンパイ／やめるかは続ける
//  - 缺一門は左端の牌の色を捨てる色に・換三張は左端の牌と同じ色を左から 3 枚（Q4=B）
// 「左端」は画面の手牌の並び（牌の種類の順＝萬子→筒子→索子→字牌、同じ種類は背番号の順）。

import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import { suitOfKind, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';

/** 画面の手牌と同じ並び */
const byHand = (a: TileId, b: TileId) => kindOf(a) - kindOf(b) || a - b;
const suitOf = (t: TileId) => suitOfKind(kindOf(t));

/** 時間切れのときに選ぶこと（選べることが無い・時間切れで決めない場面なら null） */
export function timeoutAction(v: GameState, seat: Seat, legal: readonly Action[]): Action | null {
  if (legal.length === 0) return null;
  const hand = v.hands[seat].filter((t) => t >= 0).sort(byHand);
  switch (v.phase) {
    case 'claim':
      return legal.find((a) => a.type === 'pass') ?? null;
    case 'declare':
      return legal.find((a) => a.type === 'tenpai') ?? legal[0];
    case 'ended':
      return legal.find((a) => a.type === 'yame' && !a.stop) ?? null;
    case 'que':
      return queOnTimeout(hand, legal);
    case 'huan3':
      return huan3OnTimeout(hand, legal);
    case 'discard':
      return discardOnTimeout(v, seat, hand, legal);
    default:
      return null;
  }
}

function discardOnTimeout(v: GameState, seat: Seat, hand: TileId[], legal: readonly Action[]): Action | null {
  const discards = new Set(legal.flatMap((a) => (a.type === 'discard' ? [a.tile] : [])));
  // 九種九牌で「必ず流す」ルール：切れない（流すかアガるかしか無い）ので流す
  if (discards.size === 0) return legal.find((a) => a.type === 'kyushu') ?? null;
  const drawn = v.drawn[seat];
  if (drawn !== null && discards.has(drawn)) return { type: 'discard', tile: drawn };
  const left = hand.find((t) => discards.has(t));
  return left !== undefined ? { type: 'discard', tile: left } : null;
}

/** 缺一門：左端の数牌の色を捨てる色にし、その牌を伏せる */
function queOnTimeout(hand: TileId[], legal: readonly Action[]): Action | null {
  const opts = legal.filter((a): a is Extract<Action, { type: 'que' }> => a.type === 'que');
  const left = hand.find((t) => suitOf(t) >= 0);
  if (left !== undefined) {
    const s = suitOf(left);
    const hit = opts.find((a) => a.suit === s && kindOf(a.tile) === kindOf(left));
    if (hit) return { type: 'que', tile: left, suit: s };
  }
  return opts[0] ?? null;
}

/** 換三張：左端の牌の色から左の 3 枚（その色が 3 枚に満たなければ、次の色へ） */
function huan3OnTimeout(hand: TileId[], legal: readonly Action[]): Action | null {
  const opts = legal.filter((a): a is Extract<Action, { type: 'huan3' }> => a.type === 'huan3');
  const faces = (ts: readonly TileId[]) => ts.map(kindOf).sort((a, b) => a - b).join(',');
  const suits = [...new Set(hand.map(suitOf).filter((s) => s >= 0))];
  for (const s of suits) {
    const tiles = hand.filter((t) => suitOf(t) === s).slice(0, 3);
    if (tiles.length === 3 && opts.some((a) => faces(a.tiles) === faces(tiles))) return { type: 'huan3', tiles };
  }
  return opts[0] ?? null;
}
