// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。
// 列としてあり得ない出来事（持っていない牌を切る・番でない人がツモる など）は例外で止める。

import { HIDDEN, mask, type Envelope, type Seat } from './events';
import { kindCounts, waitKinds } from './agari';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { scoreWin, type ScoreResult } from './score';
import { kindOf, tileSetFor, type TileId } from './tiles';

/** 局の進み具合。deal＝配っている途中／draw＝番の人がツモる前／discard＝番の人が切る（またはアガる）前／
 *  declare＝流局してテンパイ・ノーテンを宣言している（番の人が宣言する）／ended＝局が終わった */
export type Phase = 'idle' | 'deal' | 'draw' | 'discard' | 'declare' | 'ended';

/** ツモアガリの結果。score は開けた手牌・ドラ表示牌など全員に見えるものだけから出す＝どの端末でも同じ点数になる */
export type RoundResult =
  | { type: 'tsumo'; seat: Seat; winTile: TileId; ura: TileId[]; score: ScoreResult }
  /** 流局。tenpai＝席ごとの宣言／payments＝席ごとの点の動き（受け取りが＋、払いが−。合計 0） */
  | { type: 'exhaust'; tenpai: boolean[]; payments: number[] };

/** 流局したときにノーテンの人からテンパイの人へ動く点の合計（変えられない決まり） */
export const NOTEN_PENALTY = 3000;

/** テンパイの宣言から、席ごとの点の動き。全員テンパイ・全員ノーテンなら動かない */
export function notenPayments(tenpai: readonly boolean[]): number[] {
  const k = tenpai.filter(Boolean).length;
  if (k === 0 || k === 4) return tenpai.map(() => 0);
  return tenpai.map((t) => (t ? NOTEN_PENALTY / k : -NOTEN_PENALTY / (4 - k)));
}

/** リーチの状態。double＝ダブル立直（最初の打牌でリーチ） */
export type RiichiState = 'none' | 'riichi' | 'double';

/** リーチできるのは、宣言したあとにまだ自分のツモが来る（ツモれる牌が 4 枚以上残っている）とき */
export const RIICHI_MIN_WALL = 4;

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
  /** めくられたドラ表示牌（めくった順） */
  doraIndicators: TileId[];
  /** 席ごとのリーチの状態 */
  riichi: RiichiState[];
  /** 席ごとの、リーチを宣言した牌の河での位置（横に曲げて置く） */
  riichiAt: (number | null)[];
  /** 席ごとの、一発が残っているか（リーチの次の自分の打牌まで。鳴きで消えるのは段階3） */
  ippatsu: boolean[];
  /** 流局したときの、席ごとの宣言（まだなら null） */
  declared: (boolean | null)[];
  /** 席ごとの、同じ巡の見逃しによるフリテン（次の自分の打牌で解ける）。立てるのはロンが入る段階3 */
  missedTurn: boolean[];
  /** 席ごとの、リーチ後の見逃しによるフリテン（局の終わりまで解けない）。立てるのは段階3 */
  missedRiichi: boolean[];
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
  doraIndicators: [],
  riichi: ['none', 'none', 'none', 'none'],
  riichiAt: [null, null, null, null],
  ippatsu: [false, false, false, false],
  declared: [null, null, null, null],
  missedTurn: [false, false, false, false],
  missedRiichi: [false, false, false, false],
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
        doraIndicators: [],
        riichi: ['none', 'none', 'none', 'none'],
        riichiAt: [null, null, null, null],
        ippatsu: [false, false, false, false],
        declared: [null, null, null, null],
        missedTurn: [false, false, false, false],
        missedRiichi: [false, false, false, false],
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
    case 'doraReveal': {
      if (s.phase === 'idle' || s.phase === 'ended') throw new Error('局の外でドラをめくった');
      if (s.doraIndicators.length >= 5) throw new Error('ドラ表示牌は 5 枚まで');
      return { ...s, doraIndicators: [...s.doraIndicators, ev.tile] };
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
      const riichi = s.riichi.slice();
      const riichiAt = s.riichiAt.slice();
      const ippatsu = s.ippatsu.slice();
      if (s.riichi[ev.seat] !== 'none') {
        if (ev.riichi) throw new Error('リーチのあとにもう一度リーチした');
        // リーチのあとは手を変えられない＝ツモった牌をそのまま切るだけ（暗槓は段階3）
        if (!ev.tsumogiri) throw new Error('リーチのあとにツモった牌以外を切った');
        ippatsu[ev.seat] = false;
      } else if (ev.riichi) {
        if (liveWallLeft(s) < RIICHI_MIN_WALL) throw new Error('山が足りないのにリーチした');
        // 手牌が見えている端末では、切ったあとテンパイかも確かめる
        if (!hand.includes(HIDDEN) && waitKinds(hand).length === 0) throw new Error('テンパイでないのにリーチした');
        // 最初の打牌でのリーチはダブル立直（鳴きで消えるのは段階3）
        riichi[ev.seat] = s.discards[ev.seat].length === 0 ? 'double' : 'riichi';
        riichiAt[ev.seat] = s.discards[ev.seat].length;
        ippatsu[ev.seat] = true;
      }
      const discards = s.discards.map((d) => d.slice());
      discards[ev.seat].push(ev.tile);
      const drawn = s.drawn.slice();
      drawn[ev.seat] = null;
      // 同じ巡の見逃しは、自分が切ったところで解ける
      const missedTurn = s.missedTurn.slice();
      missedTurn[ev.seat] = false;
      return { ...s, phase: 'draw', turn: nextSeat(ev.seat), hands, discards, drawn, riichi, riichiAt, ippatsu, missedTurn };
    }
    case 'tsumo': {
      if (s.phase !== 'discard' || ev.seat !== s.turn) throw new Error('ツモアガリできる時ではない');
      const hands = s.hands.map((h) => h.slice());
      const known = hands[ev.seat];
      if (!known.includes(HIDDEN) && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
      if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
      const drawn = s.drawn[ev.seat];
      if (drawn !== HIDDEN && drawn !== ev.winTile) throw new Error('アガリ牌がツモった牌と違う');
      if (!ev.hand.includes(ev.winTile)) throw new Error('アガリ牌が手牌に無い');
      // 裏ドラはリーチしている人だけ、ドラ表示牌と同じ枚数をめくる
      const uraWant = s.riichi[ev.seat] === 'none' ? 0 : s.doraIndicators.length;
      if (ev.ura.length !== uraWant) throw new Error(`裏ドラ表示牌の枚数が違う（${ev.ura.length} 枚・正しくは ${uraWant} 枚）`);
      const score = scoreTsumo(s, ev.seat, ev.hand, ev.winTile, ev.ura);
      if (!score) throw new Error('アガリの形でない、または役が無いのにツモアガリした');
      hands[ev.seat] = ev.hand.slice();
      return { ...s, phase: 'ended', hands, result: { type: 'tsumo', seat: ev.seat, winTile: ev.winTile, ura: ev.ura.slice(), score } };
    }
    case 'exhaust': {
      if (s.phase !== 'draw' || liveWallLeft(s) > 0) throw new Error('山が残っているのに流局した');
      // 親から順に宣言する
      return { ...s, phase: 'declare', turn: s.dealer, drawn: [null, null, null, null] };
    }
    case 'declare': {
      if (s.phase !== 'declare' || ev.seat !== s.turn) throw new Error('宣言する時・席ではない');
      const known = s.hands[ev.seat];
      const visible = !known.includes(HIDDEN);
      if (ev.tenpai) {
        if (!ev.hand) throw new Error('テンパイの宣言なのに手牌を開けていない');
        if (visible && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
        if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
        if (waitKinds(ev.hand).length === 0) throw new Error('テンパイでないのにテンパイを宣言した');
      } else {
        if (ev.hand) throw new Error('ノーテンの宣言で手牌を開けた');
        if (s.riichi[ev.seat] !== 'none') throw new Error('リーチした人がノーテンを宣言した');
        // テンパイを隠してノーテンと言えるのは、ルールが許すときだけ（手牌が見える端末で確かめる）
        if (visible && waitKinds(known).length > 0 && !(s.rules?.family === 'jp' && s.rules.values.tenpaiHide === 'ok')) {
          throw new Error('テンパイなのにノーテンを宣言した（このルールではできない）');
        }
      }
      const hands = s.hands.map((h) => h.slice());
      if (ev.hand) hands[ev.seat] = ev.hand.slice();
      const declared = s.declared.slice();
      declared[ev.seat] = ev.tenpai;
      if (declared.every((d) => d !== null)) {
        const tenpai = declared as boolean[];
        return { ...s, hands, declared, phase: 'ended', result: { type: 'exhaust', tenpai, payments: notenPayments(tenpai) } };
      }
      return { ...s, hands, declared, turn: nextSeat(ev.seat) };
    }
  }
}

/** 自風（27＝東 … 30＝北）。親が東 */
export const seatWindOf = (s: GameState, seat: Seat): number => 27 + ((seat - s.dealer + 4) % 4);
/** 場風。東場の 4 局のあとが南場（局の進め方は段階4で決める） */
export const roundWindOf = (s: GameState): number => 27 + (Math.floor(Math.max(0, s.roundIndex) / 4) % 4);

/**
 * ツモアガリしたときの点数（ツモって切る前の局面で呼ぶ）。役が無ければ null。
 * 見える局面からでも全体の局面からでも同じ答えになるよう、手牌と ura は引数で受け取る。
 */
export function scoreTsumo(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
  if (!s.rules || s.rules.family !== 'jp') return null;
  const noDiscards = s.discards.every((d) => d.length === 0);
  return scoreWin({
    ctx: {
      concealed: kindCounts(hand),
      melds: [],
      winTile: kindOf(winTile),
      tsumo: true,
      seatWind: seatWindOf(s, seat),
      roundWind: roundWindOf(s),
      haitei: liveWallLeft(s) === 0,
      riichi: s.riichi[seat],
      ippatsu: s.ippatsu[seat],
      // 鳴きが入る段階3で「それまでに鳴きが無い」を足す
      tenhou: seat === s.dealer && noDiscards,
      chiihou: seat !== s.dealer && s.discards[seat].length === 0,
      rules: s.rules,
    },
    tiles: hand,
    indicators: s.doraIndicators,
    ura,
    dealer: seat === s.dealer,
  });
}

export function replay(log: readonly Envelope[]): GameState {
  return log.reduce(apply, initialState());
}

/** その席から見える局面（他の人の手牌・山の並びは伏せたまま） */
export function viewFor(log: readonly Envelope[], viewer: Seat): GameState {
  return replay(log.map((e) => mask(e, viewer)));
}

export const isHidden = (t: TileId) => t === HIDDEN;
