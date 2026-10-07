// 局を始める側（一人用ではその端末、オンラインでは段階5で決める配り役）が出す出来事を作る。
// ここは山の並びを知っている側だけが呼ぶ。作った出来事は列に積み、局面は state.ts の apply で作る。

import { SEATS, type Envelope, type GameEvent, type Seat, type Visibility } from './events';
import type { GameState } from './state';
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
