// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。
// 列としてあり得ない出来事（持っていない牌を切る・番でない人がツモる など）は例外で止める。

import { HIDDEN, mask, type Envelope, type Seat } from './events';
import { kindCounts, waitKinds } from './agari';
import { furitenOf } from './furiten';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { scoreWin, type ScoreResult } from './score';
import type { Meld } from './yaku';
import { kindOf, tileSetFor, type TileId } from './tiles';

/** 局の進み具合。deal＝配っている途中／draw＝番の人がツモる前／discard＝番の人が切る（またはアガる）前／
 *  claim＝切られた牌にほかの 3 人が返事をしている（見送る・ロン。鳴きは段階3の 2 番目）／
 *  declare＝流局してテンパイ・ノーテンを宣言している（番の人が宣言する）／ended＝局が終わった */
export type Phase = 'idle' | 'deal' | 'draw' | 'discard' | 'claim' | 'declare' | 'ended';

/** ロンでアガった 1 人分。score は開けた手牌・ドラ表示牌など全員に見えるものだけから出す */
export interface RonWin {
  seat: Seat;
  ura: TileId[];
  score: ScoreResult;
}

/** チー・ポンの申し出（返事がそろって勝てば鳴く） */
export interface CallOffer {
  seat: Seat;
  meld: 'chi' | 'pon';
  /** 手牌から出す 2 枚 */
  tiles: TileId[];
}

/** 切られた牌への返事を集めているところ。replies は席ごと（切った人は最初から 'self'） */
export interface Claim {
  from: Seat;
  tile: TileId;
  replies: (null | 'self' | 'pass' | 'ron' | 'call')[];
  /** ロンと言った人（言った順）。点数は返事がそろってから result に移す */
  rons: RonWin[];
  /** チー・ポンの申し出 */
  calls: CallOffer[];
}

/** 鳴いた面子。tiles＝3 枚（切られた牌を含む）／called＝切られた牌／from＝切った人 */
export interface OpenMeld {
  type: 'chi' | 'pon';
  tiles: TileId[];
  called: TileId;
  from: Seat;
}

/** ツモアガリの結果。score は開けた手牌・ドラ表示牌など全員に見えるものだけから出す＝どの端末でも同じ点数になる */
export type RoundResult =
  | { type: 'tsumo'; seat: Seat; winTile: TileId; ura: TileId[]; score: ScoreResult }
  /** ロンアガリ。from＝切った人／wins＝アガった人（切った人から見て下家・対面・上家の順。2 人以上はダブロン・3 人アガリ） */
  | { type: 'ron'; from: Seat; winTile: TileId; wins: RonWin[] }
  /** 流局。tenpai＝席ごとの宣言／payments＝席ごとの点の動き（受け取りが＋、払いが−。合計 0） */
  | { type: 'exhaust'; tenpai: boolean[]; payments: number[] }
  /** 3 人が同じ牌でロンして、ルールで流局になった（三家和） */
  | { type: 'tripleRon'; from: Seat; seats: Seat[] };

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
  /** 切られた牌への返事を集めているところ（phase が claim のときだけ） */
  claim: Claim | null;
  /** 席ごとの、手牌を全員に開けたか（ツモ・ロンと言った・流局でテンパイと言った） */
  opened: boolean[];
  /** 席ごとの、鳴いた面子（鳴いた順） */
  melds: OpenMeld[][];
  /** 席ごとの、鳴かれて河から持っていかれた牌の位置（河の並びには残す＝フリテンは鳴かれた牌も数える一般則） */
  calledAway: number[][];
  /** この局で誰かが鳴いたか（天和・地和・ダブル立直は鳴きが入ると消える） */
  anyCall: boolean;
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
  claim: null,
  opened: [false, false, false, false],
  melds: [[], [], [], []],
  calledAway: [[], [], [], []],
  anyCall: false,
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
        claim: null,
        opened: [false, false, false, false],
        melds: [[], [], [], []],
        calledAway: [[], [], [], []],
        anyCall: false,
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
        riichi[ev.seat] = s.discards[ev.seat].length === 0 && !s.anyCall ? 'double' : 'riichi';
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
      // ほかの 3 人の返事を待つ（番は切った人のまま。全員見送ったら次の人へ）
      const replies: Claim['replies'] = [null, null, null, null];
      replies[ev.seat] = 'self';
      const claim: Claim = { from: ev.seat, tile: ev.tile, replies, rons: [], calls: [] };
      return { ...s, phase: 'claim', hands, discards, drawn, riichi, riichiAt, ippatsu, missedTurn, claim };
    }
    case 'pass': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c) throw new Error('返事をする時ではない');
      if (c.replies[ev.seat] !== null) throw new Error(`席 ${ev.seat} はもう返事をした（または切った本人）`);
      // アガれる牌を見送ったら見逃し＝フリテン（役が無くても待ちの牌なら見逃しになる）。
      // 手牌が見える端末でだけ分かる＝本人の端末と全体の局面でだけ立つ
      const missedTurn = s.missedTurn.slice();
      const missedRiichi = s.missedRiichi.slice();
      const hand = s.hands[ev.seat];
      if (!hand.includes(HIDDEN) && waitKinds(hand).includes(kindOf(c.tile))) {
        missedTurn[ev.seat] = true;
        if (s.riichi[ev.seat] !== 'none') missedRiichi[ev.seat] = true;
      }
      const replies = c.replies.slice();
      replies[ev.seat] = 'pass';
      return settleClaim({ ...s, missedTurn, missedRiichi, claim: { ...c, replies } });
    }
    case 'call': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c) throw new Error('鳴ける時ではない');
      if (c.replies[ev.seat] !== null) throw new Error(`席 ${ev.seat} はもう返事をした（または切った本人）`);
      const problem = callProblem(s, ev.seat, ev.meld, ev.tiles);
      if (problem) throw new Error(problem);
      // 待ちの牌を鳴いてロンしなかった＝見逃し（見送ったときと同じ）
      const missedTurn = s.missedTurn.slice();
      const missedRiichi = s.missedRiichi.slice();
      const hand = s.hands[ev.seat];
      if (!hand.includes(HIDDEN) && waitKinds(hand).includes(kindOf(c.tile))) missedTurn[ev.seat] = true;
      const replies = c.replies.slice();
      replies[ev.seat] = 'call';
      const calls = [...c.calls, { seat: ev.seat, meld: ev.meld, tiles: ev.tiles.slice() }];
      return settleClaim({ ...s, missedTurn, missedRiichi, claim: { ...c, replies, calls } });
    }
    case 'ron': {
      const c = s.claim;
      if (s.phase !== 'claim' || !c) throw new Error('ロンできる時ではない');
      if (c.replies[ev.seat] !== null) throw new Error(`席 ${ev.seat} はもう返事をした（または切った本人）`);
      const known = s.hands[ev.seat];
      if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
      if (!known.includes(HIDDEN)) {
        if (!sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
        if (furitenOf(s, ev.seat)?.reasons.length) throw new Error('フリテンなのにロンした');
      }
      const uraWant = s.riichi[ev.seat] === 'none' ? 0 : s.doraIndicators.length;
      if (ev.ura.length !== uraWant) throw new Error(`裏ドラ表示牌の枚数が違う（${ev.ura.length} 枚・正しくは ${uraWant} 枚）`);
      const score = scoreRon(s, ev.seat, ev.hand, c.tile, ev.ura);
      if (!score) throw new Error('アガリの形でない、または役が無いのにロンした');
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat] = ev.hand.slice();
      const replies = c.replies.slice();
      replies[ev.seat] = 'ron';
      const rons = [...c.rons, { seat: ev.seat, ura: ev.ura.slice(), score }];
      const opened = s.opened.slice();
      opened[ev.seat] = true;
      return settleClaim({ ...s, hands, opened, claim: { ...c, replies, rons } });
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
      const opened = s.opened.slice();
      opened[ev.seat] = true;
      return { ...s, phase: 'ended', hands, opened, result: { type: 'tsumo', seat: ev.seat, winTile: ev.winTile, ura: ev.ura.slice(), score } };
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
      const opened = s.opened.slice();
      if (ev.hand) {
        hands[ev.seat] = ev.hand.slice();
        opened[ev.seat] = true;
      }
      const declared = s.declared.slice();
      declared[ev.seat] = ev.tenpai;
      if (declared.every((d) => d !== null)) {
        const tenpai = declared as boolean[];
        return { ...s, hands, opened, declared, phase: 'ended', result: { type: 'exhaust', tenpai, payments: notenPayments(tenpai) } };
      }
      return { ...s, hands, opened, declared, turn: nextSeat(ev.seat) };
    }
  }
}

/**
 * 返事がそろったら局を進める。全員見送り＝次の人のツモへ。ロンがあれば、同時ロンの決まり（ルールの値）で結果を出す。
 * 2 人＝double（ダブロン＝2 人ともアガる／頭ハネ＝切った人の下家に近い 1 人）、3 人＝triple（流局／3 人とも／頭ハネ）
 */
function settleClaim(s: GameState): GameState {
  const c = s.claim!;
  if (c.replies.some((r) => r === null)) return s;
  if (c.rons.length === 0) {
    // 鳴き：ポンがチーより先（同じ牌を 2 人がポンすることは無い＝4 枚しかない）
    const call = c.calls.find((x) => x.meld === 'pon') ?? c.calls.find((x) => x.meld === 'chi');
    if (!call) return { ...s, phase: 'draw', turn: nextSeat(c.from), claim: null };
    return applyCall(s, c, call);
  }
  // 切った人の下家から順に並べる（頭ハネで先に来る人が先頭）
  const order = (seat: Seat) => (seat - c.from + 4) % 4;
  const rons = c.rons.slice().sort((a, b) => order(a.seat) - order(b.seat));
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  let wins = rons;
  if (rons.length === 2 && v?.double === 'atama') wins = rons.slice(0, 1);
  if (rons.length === 3) {
    if (v?.triple === 'ryukyoku') return { ...s, phase: 'ended', claim: null, result: { type: 'tripleRon', from: c.from, seats: rons.map((r) => r.seat) } };
    if (v?.triple === 'atama') wins = rons.slice(0, 1);
  }
  return { ...s, phase: 'ended', claim: null, result: { type: 'ron', from: c.from, winTile: c.tile, wins } };
}

/** チー・ポンの申し出がおかしければ理由を返す（無ければ null）。手牌が見える局面では持っている牌かも確かめる */
export function callProblem(s: GameState, seat: Seat, meld: 'chi' | 'pon', tiles: readonly TileId[]): string | null {
  const c = s.claim;
  if (!c) return '鳴ける時ではない';
  if (seat === c.from) return '自分の切った牌は鳴けない';
  if (s.riichi[seat] !== 'none') return 'リーチのあとは鳴けない';
  // 最後の捨て牌（河底）は鳴けない＝次のツモが無い
  if (liveWallLeft(s) <= 0) return '山が尽きたあとの捨て牌は鳴けない';
  if (tiles.length !== 2) return '鳴くには手牌から 2 枚出す';
  if (tiles[0] === tiles[1]) return '同じ牌を 2 回出した';
  const hand = s.hands[seat];
  if (!hand.includes(HIDDEN) && !tiles.every((t) => hand.includes(t))) return '持っていない牌で鳴こうとした';
  const k = kindOf(c.tile);
  const ks = tiles.map(kindOf);
  if (meld === 'pon') return ks.every((x) => x === k) ? null : 'ポンは同じ牌 3 枚';
  if (seat !== nextSeat(c.from)) return 'チーは上家の捨て牌だけ';
  const all = [k, ...ks].sort((a, b) => a - b);
  const suit = Math.floor(all[0] / 9);
  if (all[0] >= 27 || Math.floor(all[2] / 9) !== suit || all[1] !== all[0] + 1 || all[2] !== all[0] + 2) return 'チーは同じ色の続いた 3 枚';
  return null;
}

/** 鳴きを局面に入れる。鳴いた人の番になり、ツモらずに 1 枚切る。一発はみんな消える */
function applyCall(s: GameState, c: Claim, call: CallOffer): GameState {
  const hands = s.hands.map((h) => h.slice());
  const hand = hands[call.seat];
  for (const t of call.tiles) {
    let i = hand.indexOf(t);
    if (i < 0) i = hand.indexOf(HIDDEN);
    if (i < 0) throw new Error('鳴きに出す牌が手牌に無い');
    hand.splice(i, 1);
  }
  const melds = s.melds.map((m) => m.slice());
  const tiles = [...call.tiles, c.tile].sort((a, b) => kindOf(a) - kindOf(b) || a - b);
  melds[call.seat].push({ type: call.meld, tiles, called: c.tile, from: c.from });
  const calledAway = s.calledAway.map((x) => x.slice());
  calledAway[c.from].push(s.discards[c.from].length - 1);
  return {
    ...s,
    phase: 'discard',
    turn: call.seat,
    hands,
    melds,
    calledAway,
    anyCall: true,
    ippatsu: [false, false, false, false],
    drawn: [null, null, null, null],
    claim: null,
  };
}

/** 鳴いた面子を、役の判定が読む形にする */
const yakuMelds = (s: GameState, seat: Seat): Meld[] =>
  s.melds[seat].map((m) => ({ type: m.type, first: Math.min(...m.tiles.map(kindOf)), open: true }));
/** 鳴いた面子の牌（ドラ・赤ドラを数えるため） */
const meldTiles = (s: GameState, seat: Seat): TileId[] => s.melds[seat].flatMap((m) => m.tiles);

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
  const noDiscards = s.discards.every((d) => d.length === 0) && !s.anyCall;
  return scoreWin({
    ctx: {
      concealed: kindCounts(hand),
      melds: yakuMelds(s, seat),
      winTile: kindOf(winTile),
      tsumo: true,
      seatWind: seatWindOf(s, seat),
      roundWind: roundWindOf(s),
      haitei: liveWallLeft(s) === 0,
      riichi: s.riichi[seat],
      ippatsu: s.ippatsu[seat],
      // 鳴きが入る段階3で「それまでに鳴きが無い」を足す
      tenhou: seat === s.dealer && noDiscards,
      chiihou: seat !== s.dealer && s.discards[seat].length === 0 && !s.anyCall,
      rules: s.rules,
    },
    tiles: [...hand, ...meldTiles(s, seat)],
    indicators: s.doraIndicators,
    ura,
    dealer: seat === s.dealer,
  });
}

/**
 * ロンアガリしたときの点数（切られた牌に返事をしている局面で呼ぶ）。hand は 13 枚、winTile は切られた牌。役が無ければ null
 */
export function scoreRon(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
  if (!s.rules || s.rules.family !== 'jp') return null;
  const tiles = [...hand, winTile];
  return scoreWin({
    ctx: {
      concealed: kindCounts(tiles),
      melds: yakuMelds(s, seat),
      winTile: kindOf(winTile),
      tsumo: false,
      seatWind: seatWindOf(s, seat),
      roundWind: roundWindOf(s),
      houtei: liveWallLeft(s) === 0,
      riichi: s.riichi[seat],
      ippatsu: s.ippatsu[seat],
      // 人和（ルールの jinho）は段階3の途中で足す
      rules: s.rules,
    },
    tiles: [...tiles, ...meldTiles(s, seat)],
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
