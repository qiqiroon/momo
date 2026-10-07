// 局を始める側（一人用ではその端末、オンラインでは段階5で決める配り役）が出す出来事を作る。
// ここは山の並びを知っている側だけが呼ぶ。作った出来事は列に積み、局面は state.ts の apply で作る。

import { SEATS, type Envelope, type GameEvent, type Seat, type Visibility } from './events';
import { liveWallLeft, type GameState } from './state';
import { isWinningHand } from './agari';
import { createRng, shuffle } from './rng';
import { tileSetFor, type TileId } from './tiles';

const HAND_SIZE = 13;

/** 対局の種から、その局の山の種を決める（「同じ山で勝負」では対局の種をリンクで配る） */
export function roundSeed(gameSeed: string, roundIndex: number): string {
  return `${gameSeed}#${roundIndex}`;
}

/** 配る順に山から取る。親から 4 枚ずつ 3 周、そのあと 1 枚ずつ 1 周（親の 14 枚目は最初のツモ）。
 *  1 回ずつを出来事にする＝どの時点でも「配った牌は山の先頭から順」が成り立つ */
function dealChunks(wall: readonly TileId[], dealer: Seat): { seat: Seat; tiles: TileId[] }[] {
  const chunks: { seat: Seat; tiles: TileId[] }[] = [];
  let p = 0;
  for (const size of [4, 4, 4, 1]) {
    for (let i = 0; i < 4; i++) {
      chunks.push({ seat: ((dealer + i) % 4) as Seat, tiles: wall.slice(p, p + size) });
      p += size;
    }
  }
  return chunks;
}

/** 局の始まりから配牌までの出来事 */
export function startRound(state: GameState, gameSeed: string, roundIndex: number, dealer: Seat): Envelope[] {
  if (!state.rules) throw new Error('対局が始まっていない');
  const seed = roundSeed(gameSeed, roundIndex);
  const wall = shuffle(tileSetFor(state.rules), createRng(seed));
  const chunks = dealChunks(wall, dealer);
  for (const seat of SEATS) {
    const n = chunks.filter((c) => c.seat === seat).reduce((m, c) => m + c.tiles.length, 0);
    if (n !== HAND_SIZE) throw new Error('配牌の枚数が合わない');
  }

  const out: Envelope[] = [];
  const push = (to: Visibility, ev: GameEvent) => out.push({ seq: state.nextSeq + out.length, to, ev });
  push('all', { type: 'roundStart', roundIndex, dealer });
  push([], { type: 'wallSeed', seed });
  for (const c of chunks) push([c.seat], { type: 'deal', seat: c.seat, tiles: c.tiles });
  return out;
}

// ---- 局の進行（段階1：ツモって切る） ----
// 進め方：番の人がツモる前（phase='draw'）なら advance、切る前（phase='discard'）ならその席の人（画面か CPU）が選んだ act を出す。
// どちらも「全部を知る局面」を受け取り、次の出来事を返すだけ。局面を変えるのは state.ts の apply だけ。

/** 番の人が選べること。打牌は背番号で指す（同じ種類でも赤5かどうかで別の牌） */
export type Action = { type: 'discard'; tile: TileId } | { type: 'tsumo' };

/** その席がいま選べること（その席から見える局面だけで決まる＝画面と CPU が使う） */
export function legalActions(view: GameState, seat: Seat): Action[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  const hand = view.hands[seat];
  const out: Action[] = [];
  if (isWinningHand(hand)) out.push({ type: 'tsumo' });
  for (const tile of hand) out.push({ type: 'discard', tile });
  return out;
}

const envelopeAt = (state: GameState) => (to: Visibility, ev: GameEvent): Envelope => ({ seq: state.nextSeq, to, ev });

/** ツモる前の局面から、次の出来事（ツモ、または山が尽きての流局）を作る */
export function advance(full: GameState): Envelope[] {
  if (full.phase !== 'draw' && full.phase !== 'deal') throw new Error('ツモる時ではない');
  if (!full.wall) throw new Error('山の並びを知らない端末は進行役になれない');
  const at = envelopeAt(full);
  if (liveWallLeft(full) <= 0) return [at('all', { type: 'exhaust' })];
  const tile = full.wall[full.wall.length - full.wallLeft];
  return [at([full.turn], { type: 'draw', seat: full.turn, tile })];
}

/** 番の人が選んだことを出来事にする。選べないことなら例外 */
export function act(full: GameState, seat: Seat, action: Action): Envelope[] {
  if (full.phase !== 'discard' || full.turn !== seat) throw new Error(`席 ${seat} の番ではない`);
  const hand = full.hands[seat];
  const at = envelopeAt(full);
  switch (action.type) {
    case 'discard':
      if (!hand.includes(action.tile)) throw new Error(`持っていない牌は切れない（背番号 ${action.tile}）`);
      return [at('all', { type: 'discard', seat, tile: action.tile, tsumogiri: action.tile === full.drawn[seat] })];
    case 'tsumo':
      if (!isWinningHand(hand)) throw new Error('アガリの形になっていない');
      return [at('all', { type: 'tsumo', seat, hand: hand.slice() })];
  }
}
