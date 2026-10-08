// 局を始める側（一人用ではその端末、オンラインでは段階5で決める配り役）が出す出来事を作る。
// ここは山の並びを知っている側だけが呼ぶ。作った出来事は列に積み、局面は state.ts の apply で作る。

import { HIDDEN, SEATS, type Envelope, type GameEvent, type Seat, type Visibility } from './events';
import { furitenOf } from './furiten';
import { callProblem, liveWallLeft, RIICHI_MIN_WALL, scoreRon, scoreTsumo, type GameState } from './state';
import { doraIndicatorAt, uraIndicatorAt } from './dora';
import { waitKinds } from './agari';
import { createRng, shuffle } from './rng';
import { isRed, kindOf, tileSetFor, type TileId } from './tiles';

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
export type Action =
  | { type: 'discard'; tile: TileId }
  | { type: 'riichi'; tile: TileId }
  | { type: 'tsumo' }
  /** 流局したときの宣言 */
  | { type: 'tenpai' }
  | { type: 'noten' }
  /** 切られた牌への返事。chi・pon の tiles は手牌から出す 2 枚 */
  | { type: 'pass' }
  | { type: 'ron' }
  | { type: 'chi' | 'pon'; tiles: TileId[] };

/** 牌の見分け（赤5かどうかまで）。同じ見分けの牌はどれを出しても同じ＝選ぶ候補を 1 つにまとめる */
const faceOf = (view: GameState, t: TileId) => `${kindOf(t)}${view.rules && isRed(t, view.rules) ? 'r' : ''}`;

/** その席が切られた牌でできるチー・ポン（手牌が見えている本人の局面で決まる）。赤5を出すかどうかは別の候補 */
export function callOptions(view: GameState, seat: Seat): Action[] {
  const c = view.claim;
  if (view.phase !== 'claim' || !c || c.replies[seat] !== null) return [];
  const hand = view.hands[seat];
  if (hand.includes(HIDDEN)) return [];
  const out: Action[] = [];
  const seen = new Set<string>();
  const offer = (meld: 'chi' | 'pon', tiles: TileId[]) => {
    const key = meld + tiles.map((t) => faceOf(view, t)).sort().join(',');
    if (seen.has(key) || callProblem(view, seat, meld, tiles)) return;
    seen.add(key);
    out.push({ type: meld, tiles });
  };
  const k = kindOf(c.tile);
  const ofKind = (kind: number) => hand.filter((t) => kindOf(t) === kind);
  const same = ofKind(k);
  for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length; j++) offer('pon', [same[i], same[j]]);
  if (k < 27) {
    for (const [a, b] of [[-2, -1], [-1, 1], [1, 2]]) {
      const ka = k + a;
      const kb = k + b;
      if (Math.floor(ka / 9) !== Math.floor(k / 9) || Math.floor(kb / 9) !== Math.floor(k / 9) || ka < 0 || kb < 0) continue;
      for (const ta of ofKind(ka)) for (const tb of ofKind(kb)) offer('chi', [ta, tb]);
    }
  }
  return out;
}

/** 切られた牌でロンできるか（手牌が見えている本人の局面で決まる）。フリテン・役なしはできない */
export function canRon(view: GameState, seat: Seat): boolean {
  const c = view.claim;
  if (view.phase !== 'claim' || !c || c.replies[seat] !== null) return false;
  const hand = view.hands[seat];
  if (hand.includes(HIDDEN)) return false;
  if (furitenOf(view, seat)?.reasons.length) return false;
  return scoreRon(view, seat, hand, c.tile) !== null;
}

/** リーチを宣言して切れる牌（切ったあとテンパイになる牌）。リーチできないときは空 */
export function riichiTiles(view: GameState, seat: Seat): TileId[] {
  if (view.phase !== 'discard' || view.turn !== seat) return [];
  if (view.rules?.family !== 'jp' || view.riichi[seat] !== 'none') return [];
  // 鳴いている手はリーチできない（暗槓は鳴きに数えない＝段階3の 3 で足す）。1000 点未満のリーチの扱いは持ち点が入る段階4で足す
  if (view.melds[seat].length > 0) return [];
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
  if (view.phase === 'declare' && view.turn === seat) return declareOptions(view, seat);
  if (view.phase === 'claim') {
    if (view.claim?.replies[seat] !== null) return [];
    return [...(canRon(view, seat) ? [{ type: 'ron' } as Action] : []), ...callOptions(view, seat), { type: 'pass' }];
  }
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

/** 流局したときに言えること。テンパイならテンパイと言える。ノーテンと言えるのはノーテンのとき、
 *  またはテンパイでもリーチしておらず、ルールが「テンパイでもノーテンと言える」のとき */
function declareOptions(view: GameState, seat: Seat): Action[] {
  const tenpai = waitKinds(view.hands[seat]).length > 0;
  const out: Action[] = [];
  if (tenpai) out.push({ type: 'tenpai' });
  const mayHide = view.riichi[seat] === 'none' && view.rules?.family === 'jp' && view.rules.values.tenpaiHide === 'ok';
  if (!tenpai || mayHide) out.push({ type: 'noten' });
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
  if (full.phase === 'declare' && full.turn === seat) {
    if (!declareOptions(full, seat).some((a) => a.type === action.type)) throw new Error(`その宣言はできない（${action.type}）`);
    const tenpai = action.type === 'tenpai';
    return [{ seq: full.nextSeq, to: 'all', ev: { type: 'declare', seat, tenpai, hand: tenpai ? full.hands[seat].slice() : null } }];
  }
  const at = envelopeAt(full);
  if (full.phase === 'claim') {
    if (full.claim?.replies[seat] !== null) throw new Error(`席 ${seat} は返事をする人ではない（または返事をした）`);
    if (action.type === 'pass') return [at('all', { type: 'pass', seat })];
    if (action.type === 'chi' || action.type === 'pon') {
      const problem = callProblem(full, seat, action.type, action.tiles);
      if (problem) throw new Error(problem);
      return [at('all', { type: 'call', seat, meld: action.type, tiles: action.tiles.slice() })];
    }
    if (action.type !== 'ron') throw new Error(`いまは返事しかできない（${action.type}）`);
    if (!canRon(full, seat)) throw new Error('ロンできない（アガリの形でない・役が無い・フリテン）');
    if (!full.wall) throw new Error('山の並びを知らない端末は進行役になれない');
    const wall = full.wall;
    const ura = full.riichi[seat] === 'none' ? [] : full.doraIndicators.map((_, i) => uraIndicatorAt(wall, i));
    return [at('all', { type: 'ron', seat, hand: full.hands[seat].slice(), ura })];
  }
  if (full.phase !== 'discard' || full.turn !== seat) throw new Error(`席 ${seat} の番ではない`);
  const hand = full.hands[seat];
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
    default:
      throw new Error(`いまはできない（${action.type}）`);
  }
}
