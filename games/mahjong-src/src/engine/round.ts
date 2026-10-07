// 局を始める側（一人用ではその端末、オンラインでは段階5で決める配り役）が出す出来事を作る。
// ここは山の並びを知っている側だけが呼ぶ。作った出来事は列に積み、局面は state.ts の apply で作る。

import { SEATS, type Envelope, type GameEvent, type Seat, type Visibility } from './events';
import { liveWallLeft, RIICHI_MIN_WALL, scoreTsumo, type GameState } from './state';
import { doraIndicatorAt, uraIndicatorAt } from './dora';
import { waitKinds } from './agari';
import { createRng, shuffle } from './rng';
import { kindOf, tileSetFor, type TileId } from './tiles';

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
  // 配り終えたらドラ表示牌をめくる（日本式だけ）
  if (state.rules.family === 'jp') push('all', { type: 'doraReveal', tile: doraIndicatorAt(wall, 0) });
  return out;
}

// ---- 局の進行（段階1：ツモって切る） ----
// 進め方：番の人がツモる前（phase='draw'）なら advance、切る前（phase='discard'）ならその席の人（画面か CPU）が選んだ act を出す。
// どちらも「全部を知る局面」を受け取り、次の出来事を返すだけ。局面を変えるのは state.ts の apply だけ。

/** 番の人が選べること。打牌は背番号で指す（同じ種類でも赤5かどうかで別の牌） */
export type Action = { type: 'discard'; tile: TileId } | { type: 'riichi'; tile: TileId } | { type: 'tsumo' };

/** リーチを宣言して切れる牌（切ったあとテンパイになる牌）。リーチできないときは空 */
export function riichiTiles(view: GameState, seat: Seat): TileId[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  if (view.rules?.family !== 'jp' || view.riichi[seat] !== 'none') return [];
  // 鳴いている手はリーチできない（鳴きは段階3）。1000 点未満のリーチの扱いは持ち点が入る段階4で足す
  if (liveWallLeft(view) < RIICHI_MIN_WALL) return [];
  const hand = view.hands[seat];
  const byKind = new Map<number, boolean>();
  return hand.filter((tile) => {
    const k = kindOf(tile);
    let ok = byKind.get(k);
    if (ok === undefined) {
      const rest = hand.slice();
      rest.splice(rest.indexOf(tile), 1);
      ok = waitKinds(rest).length > 0;
      byKind.set(k, ok);
    }
    return ok;
  });
}

/** その席がいま選べること（その席から見える局面だけで決まる＝画面と CPU が使う） */
export function legalActions(view: GameState, seat: Seat): Action[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  const hand = view.hands[seat];
  const out: Action[] = [];
  // アガリの形で、役がある（縛りに届く）ときだけツモアガリできる
  const drawn = view.drawn[seat];
  if (drawn !== null && scoreTsumo(view, seat, hand, drawn)) out.push({ type: 'tsumo' });
  // リーチのあとはツモった牌を切るだけ
  if (view.riichi[seat] !== 'none') {
    if (drawn !== null) out.push({ type: 'discard', tile: drawn });
    return out;
  }
  for (const tile of hand) out.push({ type: 'discard', tile });
  for (const tile of riichiTiles(view, seat)) out.push({ type: 'riichi', tile });
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
      if (full.riichi[seat] !== 'none' && action.tile !== full.drawn[seat]) throw new Error('リーチのあとはツモった牌しか切れない');
      return [at('all', { type: 'discard', seat, tile: action.tile, tsumogiri: action.tile === full.drawn[seat] })];
    case 'riichi':
      if (!riichiTiles(full, seat).includes(action.tile)) throw new Error(`その牌ではリーチできない（背番号 ${action.tile}）`);
      return [at('all', { type: 'discard', seat, tile: action.tile, tsumogiri: action.tile === full.drawn[seat], riichi: true })];
    case 'tsumo': {
      const winTile = full.drawn[seat];
      if (winTile === null || !scoreTsumo(full, seat, hand, winTile)) throw new Error('アガリの形になっていない（または役が無い）');
      // 裏ドラはリーチでアガったときだけ、ドラ表示牌の真下をめくる
      if (!full.wall) throw new Error('山の並びを知らない端末は進行役になれない');
      const wall = full.wall;
      const ura = full.riichi[seat] === 'none' ? [] : full.doraIndicators.map((_, i) => uraIndicatorAt(wall, i));
      return [at('all', { type: 'tsumo', seat, hand: hand.slice(), winTile, ura })];
    }
  }
}
