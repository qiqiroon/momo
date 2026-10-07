// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。
// 列としてあり得ない出来事（持っていない牌を切る・番でない人がツモる など）は例外で止める。

import { HIDDEN, mask, type Envelope, type Seat } from './events';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { tileSetFor, type TileId } from './tiles';

/** 局の進み具合。deal＝配っている途中／draw＝番の人がツモる前／discard＝番の人が切る（またはアガる）前／ended＝局が終わった */
export type Phase = 'idle' | 'deal' | 'draw' | 'discard' | 'ended';

export type RoundResult = { type: 'tsumo'; seat: Seat } | { type: 'exhaust' };

export interface GameState {
  /** 次に来るはずの通し番号 */
  nextSeq: number;
  rules: Rules | null;
  roundIndex: number;
  dealer: Seat;
  phase: Phase;
  /** 番の人 */
  turn: Seat;
  /** 席ごとの手牌（ツモった牌も含む・並びは届いた順）。見えない牌は HIDDEN */
  hands: TileId[][];
  /** 席ごとの河（切った順） */
  discards: TileId[][];
  /** 席ごとの、いま手にあるツモ牌（切ったら null）。見えない席は HIDDEN */
  drawn: (TileId | null)[];
  /** 山の並び。種を知らない端末では null */
  wall: TileId[] | null;
  /** 山の残り枚数（王牌も含む。並びを知らなくても数は分かる） */
  wallLeft: number;
  result: RoundResult | null;
}

export const initialState = (): GameState => ({
  nextSeq: 0,
  rules: null,
  roundIndex: -1,
  dealer: 0,
  phase: 'idle',
  turn: 0,
  hands: [[], [], [], []],
  discards: [[], [], [], []],
  drawn: [null, null, null, null],
  wall: null,
  wallLeft: 0,
  result: null,
});

/** 王牌（ツモらずに残す山の尻）の枚数。日本式は 14 枚で固定（136 枚と同じく変えられない決まり）。中国式は段階9で決める */
export function deadWallSize(rules: Rules): number {
  return rules.family === 'jp' ? 14 : 0;
}

/** まだツモれる枚数 */
export function liveWallLeft(s: GameState): number {
  return s.rules ? s.wallLeft - deadWallSize(s.rules) : 0;
}

const nextSeat = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;

/** 同じ牌の集まりか（並びは問わない） */
function sameTiles(a: readonly TileId[], b: readonly TileId[]): boolean {
  if (a.length !== b.length) return false;
  const x = a.slice().sort((p, q) => p - q);
  const y = b.slice().sort((p, q) => p - q);
  return x.every((t, i) => t === y[i]);
}

export function apply(state: GameState, env: Envelope): GameState {
  if (env.seq !== state.nextSeq) {
    throw new Error(`出来事の通し番号が合わない（期待 ${state.nextSeq}・届いた ${env.seq}）`);
  }
  const s: GameState = { ...state, nextSeq: state.nextSeq + 1 };
  const ev = env.ev;
  switch (ev.type) {
    case 'gameStart':
      return { ...s, rules: ev.rules };
    case 'roundStart': {
      if (!s.rules) throw new Error('対局が始まる前に局が始まった');
      return {
        ...s,
        roundIndex: ev.roundIndex,
        dealer: ev.dealer,
        phase: 'deal',
        turn: ev.dealer,
        hands: [[], [], [], []],
        discards: [[], [], [], []],
        drawn: [null, null, null, null],
        wall: null,
        wallLeft: tileSetFor(s.rules).length,
        result: null,
      };
    }
    case 'wallSeed': {
      if (ev.seed === null || !s.rules) return s;
      return { ...s, wall: shuffle(tileSetFor(s.rules), createRng(ev.seed)) };
    }
    case 'deal': {
      if (s.phase !== 'deal') throw new Error('配る時ではないのに配牌が来た');
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat].push(...ev.tiles);
      return { ...s, hands, wallLeft: s.wallLeft - ev.tiles.length };
    }
    case 'draw': {
      // 最初のツモで配り終わりになる
      if (s.phase !== 'deal' && s.phase !== 'draw') throw new Error('ツモる時ではない');
      if (ev.seat !== s.turn) throw new Error(`番でない席がツモった（番 ${s.turn}・ツモ ${ev.seat}）`);
      if (liveWallLeft(s) <= 0) throw new Error('山が尽きているのにツモった');
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat].push(ev.tile);
      const drawn = s.drawn.slice();
      drawn[ev.seat] = ev.tile;
      return { ...s, phase: 'discard', hands, drawn, wallLeft: s.wallLeft - 1 };
    }
    case 'discard': {
      if (s.phase !== 'discard') throw new Error('切る時ではない');
      if (ev.seat !== s.turn) throw new Error(`番でない席が切った（番 ${s.turn}・切った ${ev.seat}）`);
      const hands = s.hands.map((h) => h.slice());
      const hand = hands[ev.seat];
      // 自分の手牌なら切った牌そのもの、伏せて見ている他人の手牌なら伏せた牌を 1 枚減らす
      let i = hand.indexOf(ev.tile);
      if (i < 0) i = hand.indexOf(HIDDEN);
      if (i < 0) throw new Error(`持っていない牌を切った（席 ${ev.seat}・背番号 ${ev.tile}）`);
      hand.splice(i, 1);
      const discards = s.discards.map((d) => d.slice());
      discards[ev.seat].push(ev.tile);
      const drawn = s.drawn.slice();
      drawn[ev.seat] = null;
      return { ...s, phase: 'draw', turn: nextSeat(ev.seat), hands, discards, drawn };
    }
    case 'tsumo': {
      if (s.phase !== 'discard' || ev.seat !== s.turn) throw new Error('ツモアガリできる時ではない');
      const hands = s.hands.map((h) => h.slice());
      const known = hands[ev.seat];
      if (!known.includes(HIDDEN) && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
      if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
      hands[ev.seat] = ev.hand.slice();
      return { ...s, phase: 'ended', hands, result: { type: 'tsumo', seat: ev.seat } };
    }
    case 'exhaust': {
      if (s.phase !== 'draw' || liveWallLeft(s) > 0) throw new Error('山が残っているのに流局した');
      return { ...s, phase: 'ended', result: { type: 'exhaust' } };
    }
  }
}

export function replay(log: readonly Envelope[]): GameState {
  return log.reduce(apply, initialState());
}

/** その席から見える局面（他の人の手牌・山の並びは伏せたまま） */
export function viewFor(log: readonly Envelope[], viewer: Seat): GameState {
  return replay(log.map((e) => mask(e, viewer)));
}

export const isHidden = (t: TileId) => t === HIDDEN;
