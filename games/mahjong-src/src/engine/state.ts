// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。

import { HIDDEN, mask, type Envelope, type Seat } from './events';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { tileSetFor, type TileId } from './tiles';

export interface GameState {
  /** 次に来るはずの通し番号 */
  nextSeq: number;
  rules: Rules | null;
  roundIndex: number;
  dealer: Seat;
  /** 席ごとの手牌。見えない牌は HIDDEN */
  hands: TileId[][];
  /** 山の並び。種を知らない端末では null */
  wall: TileId[] | null;
  /** 山の残り枚数（並びを知らなくても数は分かる） */
  wallLeft: number;
}

export const initialState = (): GameState => ({
  nextSeq: 0,
  rules: null,
  roundIndex: -1,
  dealer: 0,
  hands: [[], [], [], []],
  wall: null,
  wallLeft: 0,
});

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
        hands: [[], [], [], []],
        wall: null,
        wallLeft: tileSetFor(s.rules).length,
      };
    }
    case 'wallSeed': {
      if (ev.seed === null || !s.rules) return s;
      return { ...s, wall: shuffle(tileSetFor(s.rules), createRng(ev.seed)) };
    }
    case 'deal': {
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat].push(...ev.tiles);
      return { ...s, hands, wallLeft: s.wallLeft - ev.tiles.length };
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
