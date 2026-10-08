// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。
// 列としてあり得ない出来事（持っていない牌を切る・番でない人がツモる など）は例外で止める。

import { HIDDEN, mask, type Envelope, type Seat } from './events';
import { kindCounts, TERMINAL_HONOR_KINDS, waitKinds } from './agari';
import { decompose } from './yaku';
import { furitenOf } from './furiten';
import { nextStep, type GameEndReason } from './game';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { scoreWin, type ScoreResult } from './score';
import type { Meld } from './yaku';
import { kindOf, tileSetFor, type TileId } from './tiles';

/** 局の進み具合。deal＝配っている途中／draw＝番の人がツモる前（カンのあとは嶺上牌を引く前）／discard＝番の人が切る（またはアガる・カンする）前／
 *  claim＝切られた牌（または加槓・暗槓の牌）にほかの 3 人が返事をしている（見送る・ロン・鳴く）／
 *  declare＝流局してテンパイ・ノーテンを宣言している（番の人が宣言する）／ended＝局が終わった */
export type Phase = 'idle' | 'deal' | 'draw' | 'discard' | 'claim' | 'declare' | 'ended' | 'gameover';

/** ロンでアガった 1 人分。score は開けた手牌・ドラ表示牌など全員に見えるものだけから出す */
export interface RonWin {
  seat: Seat;
  ura: TileId[];
  score: ScoreResult;
}

/** チー・ポン・大明槓の申し出（返事がそろって勝てば鳴く） */
export interface CallOffer {
  seat: Seat;
  meld: 'chi' | 'pon' | 'kan';
  /** 手牌から出す 2 枚（カンは 3 枚） */
  tiles: TileId[];
}

/** 返事を集めている牌の出どころ。discard＝打牌（ロン・鳴き）／kakan＝加槓の牌（槍槓のロンだけ）／ankan＝暗槓の牌（国士無双のロンだけ） */
export type ClaimKind = 'discard' | 'kakan' | 'ankan';

/** 切られた牌への返事を集めているところ。replies は席ごと（切った人は最初から 'self'） */
export interface Claim {
  kind: ClaimKind;
  from: Seat;
  tile: TileId;
  replies: (null | 'self' | 'pass' | 'ron' | 'call')[];
  /** ロンと言った人（言った順）。点数は返事がそろってから result に移す */
  rons: RonWin[];
  /** チー・ポンの申し出 */
  calls: CallOffer[];
}

/** 鳴いた面子と暗槓。tiles＝3 枚（カンは 4 枚。切られた牌を含む）／called＝鳴いた牌（暗槓は null）／from＝切った人（暗槓は本人）。
 *  minkan＝大明槓／kakan＝加槓（もとのポンの called・from を引き継ぐ。added＝足した牌）／ankan＝暗槓 */
export interface OpenMeld {
  type: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan';
  tiles: TileId[];
  called: TileId | null;
  from: Seat;
  added?: TileId;
}

export const isKanMeld = (m: OpenMeld): boolean => m.type === 'minkan' || m.type === 'kakan' || m.type === 'ankan';

/** 1 局のカンは 4 回まで（変えられない決まり） */
export const MAX_KANS = 4;

/** ツモアガリの結果。score は開けた手牌・ドラ表示牌など全員に見えるものだけから出す＝どの端末でも同じ点数になる */
export type RoundResult =
  | { type: 'tsumo'; seat: Seat; winTile: TileId; ura: TileId[]; score: ScoreResult }
  /** ロンアガリ。from＝切った人／wins＝アガった人（切った人から見て下家・対面・上家の順。2 人以上はダブロン・3 人アガリ） */
  | { type: 'ron'; from: Seat; winTile: TileId; wins: RonWin[]; robbed?: 'kakan' | 'ankan' }
  /** 流局。tenpai＝席ごとの宣言／payments＝席ごとの点の動き（受け取りが＋、払いが−。合計 0）。
   *  nagashi＝流し満貫が成り立った席（いれば、テンパイ・ノーテンの支払いの代わりに満貫のツモと同じ支払い） */
  | { type: 'exhaust'; tenpai: boolean[]; payments: number[]; nagashi?: Seat[] }
  /** 3 人が同じ牌でロンして、ルールで流局になった（三家和） */
  | { type: 'tripleRon'; from: Seat; seats: Seat[] }
  /** 途中流局。kyushu＝九種九牌（seat が流した）／sufon＝四風連打／suricchi＝四家立直／sukan＝四開槓 */
  | { type: 'abort'; reason: AbortReason; seat?: Seat };

export type AbortReason = 'kyushu' | 'sufon' | 'suricchi' | 'sukan';

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

/** ルールが「ツモ番の無いリーチはできない」のとき：宣言したあとにまだ自分のツモが来る（ツモれる牌が 4 枚以上残っている）ときだけ */
export const RIICHI_MIN_WALL = 4;

/** リーチできる山の残りの下限。ツモ番の無いリーチが「できる」なら 1 枚（海底牌を引いたあとはできない） */
export function riichiMinWall(rules: Rules | null): number {
  return rules?.family === 'jp' && rules.values.riichiNoDraw === 'ok' ? 1 : RIICHI_MIN_WALL;
}

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
  /** この局で誰かが鳴いたか（天和・地和・ダブル立直は鳴きが入ると消える。暗槓はルールの tenhouAnkan が「消える」のときだけ数える） */
  anyCall: boolean;
  /** この局のカンの数（宣言した数。槍槓で崩れたカンも数える） */
  kans: number;
  /** 引いた嶺上牌の数（山の並びのどこまで取ったかを出すため） */
  rinshanTaken: number;
  /** カンのあと、嶺上牌を引く番（phase は draw） */
  rinshanDue: boolean;
  /** いま手にあるツモ牌が嶺上牌（嶺上開花の判定） */
  rinshanDraw: boolean;
  /** カンをしたが、まだめくっていないカンドラの数 */
  pendingDora: number;
  /** 最後のカンのカンドラを、打牌のときまでめくらない（kandoraWhen が split で、最後のカンが大明槓・加槓） */
  deferDora: boolean;
  /** 喰い替え禁止で、番の人が次に切れない牌の種類（チー・ポンした直後だけ。切ったら空） */
  kuikaeBan: number[];
  /** 席ごとの持ち点（局をまたいで続く） */
  scores: number[];
  /** この局の本場の数 */
  honba: number;
  /** 卓に出ているリーチ棒（供託）の本数（局をまたいで残る） */
  kyotaku: number;
  /** 席ごとの、この局でリーチ棒を出したか（宣言牌が通ったとき出す。ロンされたら出さない） */
  riichiStick: boolean[];
  /** 席ごとの責任払い（包）：その席が役満を仕上げる鳴きをさせた人と役（鳴かせた時点で決まる） */
  pao: (Pao | null)[];
  /** 局の終わりの点の動き（席ごと。リーチ棒は出したときに引いてあるので入らない）。局が終わるまで null */
  settlement: number[] | null;
  /** オーラスでトップの親が選んだこと（true＝やめる／false＝続ける／null＝まだ・聞いていない） */
  yame: boolean | null;
  /** この対局で始めた局の数（山の種を局ごとに変えるため。連荘で局の番号が同じでも別の山になる） */
  handCount: number;
  /** 対局が終わった理由（終わるまで null） */
  gameOver: GameEndReason | null;
  result: RoundResult | null;
}

/** 責任払い（包）。seat＝包の人／yaku＝その役 */
export interface Pao {
  seat: Seat;
  yaku: 'daisangen' | 'daisuushii' | 'suukantsu';
}

/** 本場 1 本の点（ロンは 300 点・ツモは 1 人 100 点。変えられない決まり） */
export const HONBA_POINTS = 300;
/** リーチ棒 1 本 */
export const RIICHI_STICK = 1000;

/** ルールの持ち点（日本式の start は千点単位の文字） */
export function startPoints(rules: Rules | null): number {
  if (!rules) return 0;
  const n = Number(rules.values.start);
  return Number.isFinite(n) ? n * 1000 : 0;
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
  kans: 0,
  rinshanTaken: 0,
  rinshanDue: false,
  rinshanDraw: false,
  pendingDora: 0,
  deferDora: false,
  kuikaeBan: [],
  scores: [0, 0, 0, 0],
  honba: 0,
  kyotaku: 0,
  riichiStick: [false, false, false, false],
  pao: [null, null, null, null],
  settlement: null,
  yame: null,
  handCount: 0,
  gameOver: null,
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
    case 'gameStart': {
      const p = startPoints(ev.rules);
      return { ...s, rules: ev.rules, scores: [p, p, p, p], honba: 0, kyotaku: 0 };
    }
    case 'roundStart': {
      if (!s.rules) throw new Error('対局が始まる前に局が始まった');
      if (s.phase === 'gameover') throw new Error('対局が終わったあとに局が始まった');
      // 2 局目からは、局の進め方（nextStep）と同じ局・親・本場でなければ止める
      if (s.roundIndex >= 0) {
        const n = nextStep(s);
        if (n.type !== 'round' || n.roundIndex !== ev.roundIndex || n.dealer !== ev.dealer || n.honba !== (ev.honba ?? 0)) {
          throw new Error(`局の進め方と違う局が始まった（${JSON.stringify(n)}）`);
        }
      }
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
        kans: 0,
        rinshanTaken: 0,
        rinshanDue: false,
        rinshanDraw: false,
        pendingDora: 0,
        deferDora: false,
        kuikaeBan: [],
        honba: ev.honba ?? 0,
        yame: null,
        handCount: s.handCount + 1,
        riichiStick: [false, false, false, false],
        pao: [null, null, null, null],
        settlement: null,
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
      // 2 枚目からはカンドラ＝めくっていないカンがあるときだけ
      if (s.doraIndicators.length > 0 && s.pendingDora <= 0) throw new Error('カンが無いのにカンドラをめくった');
      const pendingDora = s.doraIndicators.length > 0 ? s.pendingDora - 1 : s.pendingDora;
      return { ...s, doraIndicators: [...s.doraIndicators, ev.tile], pendingDora, deferDora: pendingDora > 0 && s.deferDora };
    }
    case 'draw': {
      // 最初のツモで配り終わりになる
      if (s.phase !== 'deal' && s.phase !== 'draw') throw new Error('ツモる時ではない');
      if (ev.seat !== s.turn) throw new Error(`番でない席がツモった（番 ${s.turn}・ツモ ${ev.seat}）`);
      const rinshan = !!ev.rinshan;
      if (rinshan !== s.rinshanDue) throw new Error(rinshan ? 'カンしていないのに嶺上牌を引いた' : 'カンのあとなのに嶺上牌でなく山から引いた');
      // 嶺上牌は王牌から引く（カンできるのは山が残っているときだけ＝引いたあとも王牌は山の尻から補われて 14 枚のまま）
      if (!rinshan && liveWallLeft(s) <= 0) throw new Error('山が尽きているのにツモった');
      if (rinshan && s.rinshanTaken >= s.kans) throw new Error('カンの数より多く嶺上牌を引いた');
      // めくるはずのカンドラ（前のカンの分・すぐめくるカンの分）をめくる前に嶺上牌は引かない
      if (rinshan && s.pendingDora > (s.deferDora ? 1 : 0)) throw new Error('めくるはずのカンドラをめくる前に嶺上牌を引いた');
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat].push(ev.tile);
      const drawn = s.drawn.slice();
      drawn[ev.seat] = ev.tile;
      return {
        ...s,
        phase: 'discard',
        hands,
        drawn,
        wallLeft: s.wallLeft - 1,
        rinshanDue: false,
        rinshanDraw: rinshan,
        rinshanTaken: s.rinshanTaken + (rinshan ? 1 : 0),
      };
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
      if (s.kuikaeBan.includes(kindOf(ev.tile))) throw new Error('喰い替えになる牌を切った（このルールでは禁止）');
      if (s.rules?.family === 'jp' && s.rules.values.kyushuHow === 'force' && kyushuOk(s, ev.seat)) throw new Error('九種九牌は必ず流すルールなのに切った');
      hand.splice(i, 1);
      const riichi = s.riichi.slice();
      const riichiAt = s.riichiAt.slice();
      const ippatsu = s.ippatsu.slice();
      if (s.riichi[ev.seat] !== 'none') {
        if (ev.riichi) throw new Error('リーチのあとにもう一度リーチした');
        // リーチのあとは手を変えられない＝ツモった牌をそのまま切るだけ（暗槓は別の出来事）
        if (!ev.tsumogiri) throw new Error('リーチのあとにツモった牌以外を切った');
        ippatsu[ev.seat] = false;
      } else if (ev.riichi) {
        if (liveWallLeft(s) < riichiMinWall(s.rules)) throw new Error('山が足りないのにリーチした');
        if (s.melds[ev.seat].some((m) => m.type !== 'ankan')) throw new Error('鳴いているのにリーチした');
        if (!riichiAffordable(s, ev.seat)) throw new Error('持ち点が 1000 点未満なのにリーチした（このルールではできない）');
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
      const claim: Claim = { kind: 'discard', from: ev.seat, tile: ev.tile, replies, rons: [], calls: [] };
      const after: GameState = { ...s, phase: 'claim', hands, discards, drawn, riichi, riichiAt, ippatsu, missedTurn, claim, rinshanDraw: false, kuikaeBan: [] };
      // 四家立直：ルールが「4 人目が宣言したとき」なら、宣言牌への返事を待たずに流局
      const v = s.rules?.family === 'jp' ? s.rules.values : null;
      if (ev.riichi && v?.suricchi === 'on' && v.suricchiWhen === 'declare' && riichi.every((r) => r !== 'none')) {
        // 宣言した時点で成り立つ＝リーチ棒も出す
        return finish({ ...depositRiichi(after, ev.seat), claim: null }, { type: 'abort', reason: 'suricchi' }, [0, 0, 0, 0]);
      }
      return after;
    }
    case 'kyushu': {
      if (s.phase !== 'discard' || ev.seat !== s.turn) throw new Error('九種九牌で流せる時ではない');
      const known = s.hands[ev.seat];
      if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
      if (!known.includes(HIDDEN) && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
      if (!kyushuOk({ ...s, hands: s.hands.map((h, i) => (i === ev.seat ? ev.hand.slice() : h)) }, ev.seat)) throw new Error('九種九牌で流せない');
      const hands = s.hands.map((h) => h.slice());
      hands[ev.seat] = ev.hand.slice();
      const opened = s.opened.slice();
      opened[ev.seat] = true;
      return finish({ ...s, hands, opened }, { type: 'abort', reason: 'kyushu', seat: ev.seat }, [0, 0, 0, 0]);
    }
    case 'kan': {
      if (s.phase !== 'discard' || ev.seat !== s.turn) throw new Error('カンできる時ではない');
      const problem = kanProblem(s, ev.seat, ev.kan, ev.tiles);
      if (problem) throw new Error(problem);
      const hands = s.hands.map((h) => h.slice());
      const hand = hands[ev.seat];
      for (const t of ev.tiles) {
        let i = hand.indexOf(t);
        if (i < 0) i = hand.indexOf(HIDDEN);
        if (i < 0) throw new Error('カンに出す牌が手牌に無い');
        hand.splice(i, 1);
      }
      const melds = s.melds.map((m) => m.slice());
      if (ev.kan === 'ankan') {
        const tiles = ev.tiles.slice().sort((a, b) => a - b);
        melds[ev.seat].push({ type: 'ankan', tiles, called: null, from: ev.seat });
      } else {
        const k = kindOf(ev.tiles[0]);
        const i = melds[ev.seat].findIndex((m) => m.type === 'pon' && kindOf(m.tiles[0]) === k);
        const pon = melds[ev.seat][i];
        const tiles = [...pon.tiles, ev.tiles[0]].sort((a, b) => kindOf(a) - kindOf(b) || a - b);
        melds[ev.seat][i] = { ...pon, type: 'kakan', tiles, added: ev.tiles[0] };
      }
      const v = s.rules?.family === 'jp' ? s.rules.values : null;
      const drawn = s.drawn.slice();
      drawn[ev.seat] = null;
      // 一発：暗槓はその場で全員消える。加槓はルールの値（槍槓の確認のあと／加槓した時点）
      const clearIppatsu = ev.kan === 'ankan' || v?.ippatsuKakan === 'at';
      const kanDora = v?.kandora === 'on';
      const next: GameState = {
        ...s,
        hands,
        melds,
        drawn,
        kans: s.kans + 1,
        rinshanDraw: false,
        ippatsu: clearIppatsu ? [false, false, false, false] : s.ippatsu,
        anyCall: s.anyCall || ev.kan === 'kakan' || v?.tenhouAnkan === 'lost',
        pendingDora: s.pendingDora + (kanDora ? 1 : 0),
        deferDora: kanDora && ev.kan === 'kakan' && v?.kandoraWhen === 'split',
      };
      // 加槓は槍槓、暗槓は（ルールが許せば）国士無双のロンを待つ
      if (ev.kan === 'kakan' || v?.kokushiAnkan === 'on') {
        const replies: Claim['replies'] = [null, null, null, null];
        replies[ev.seat] = 'self';
        return { ...next, phase: 'claim', claim: { kind: ev.kan, from: ev.seat, tile: ev.tiles[0], replies, rons: [], calls: [] } };
      }
      return { ...next, phase: 'draw', rinshanDue: true };
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
      if (!score) throw new Error(c.kind === 'ankan' ? '暗槓の牌でロンできるのは国士無双だけ' : 'アガリの形でない、または役が無いのにロンした');
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
      const result: RoundResult = { type: 'tsumo', seat: ev.seat, winTile: ev.winTile, ura: ev.ura.slice(), score };
      return finish({ ...s, hands, opened }, result, tsumoSettlement(s, ev.seat, score));
    }
    case 'exhaust': {
      if (s.phase !== 'draw' || s.rinshanDue || liveWallLeft(s) > 0) throw new Error('山が残っているのに流局した');
      // 親から順に宣言する
      return { ...s, phase: 'declare', turn: s.dealer, drawn: [null, null, null, null] };
    }
    case 'yame': {
      const n = s.phase === 'ended' ? nextStep(s) : null;
      if (!n || n.type !== 'yame' || n.seat !== ev.seat) throw new Error('アガリやめ・テンパイやめを選ぶ時・席ではない');
      return { ...s, yame: ev.stop };
    }
    case 'gameEnd': {
      const n = s.phase === 'ended' ? nextStep(s) : null;
      if (!n || n.type !== 'end' || n.reason !== ev.reason) throw new Error(`対局が終わる時ではない（${JSON.stringify(n)}）`);
      return { ...s, phase: 'gameover', gameOver: ev.reason };
    }
    case 'declare': {
      if (s.phase !== 'declare' || ev.seat !== s.turn) throw new Error('宣言する時・席ではない');
      const known = s.hands[ev.seat];
      const visible = !known.includes(HIDDEN);
      if (ev.tenpai) {
        if (!ev.hand) throw new Error('テンパイの宣言なのに手牌を開けていない');
        if (visible && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
        if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
        if (!tenpaiForDeclare(s, ev.seat, ev.hand)) throw new Error('テンパイでないのにテンパイを宣言した（形式テンパイ「なし」なら役が要る）');
      } else {
        if (ev.hand) throw new Error('ノーテンの宣言で手牌を開けた');
        if (s.riichi[ev.seat] !== 'none') throw new Error('リーチした人がノーテンを宣言した');
        // テンパイを隠してノーテンと言えるのは、ルールが許すときだけ（手牌が見える端末で確かめる）
        if (visible && tenpaiForDeclare(s, ev.seat, known) && !(s.rules?.family === 'jp' && s.rules.values.tenpaiHide === 'ok')) {
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
        // 流し満貫が成り立つ人がいれば、テンパイ・ノーテンの支払いの代わりに満貫のツモと同じ支払い
        const nagashi = nagashiSeats(s);
        const payments = nagashi.length > 0 ? nagashiPayments(s, nagashi) : notenPayments(tenpai);
        const result: RoundResult = nagashi.length > 0 ? { type: 'exhaust', tenpai, payments, nagashi } : { type: 'exhaust', tenpai, payments };
        return finish({ ...s, hands, opened, declared }, result, payments);
      }
      return { ...s, hands, opened, declared, turn: nextSeat(ev.seat) };
    }
  }
}

/**
 * 返事がそろったら局を進める。全員見送り＝次の人のツモへ。ロンがあれば、同時ロンの決まり（ルールの値）で結果を出す。
 * 2 人＝double（ダブロン＝2 人ともアガる／頭ハネ＝切った人の下家に近い 1 人）、3 人＝triple（流局／3 人とも／頭ハネ）
 */
function settleClaim(s0: GameState): GameState {
  const c = s0.claim!;
  if (c.replies.some((r) => r === null)) return s0;
  // リーチの宣言牌が通った（ロンされなかった）ら、リーチ棒を出す
  const declaredNow = c.kind === 'discard' && s0.riichi[c.from] !== 'none' && s0.riichiAt[c.from] === s0.discards[c.from].length - 1 && !s0.riichiStick[c.from];
  const s = declaredNow && c.rons.length === 0 ? depositRiichi(s0, c.from) : s0;
  if (c.rons.length === 0 && c.kind !== 'discard') {
    // カンの牌を誰もロンしなかった＝カンした人が嶺上牌を引く。加槓の一発は、ルールが「槍槓の確認のあと」ならここで消える
    return { ...s, phase: 'draw', turn: c.from, claim: null, rinshanDue: true, ippatsu: c.kind === 'kakan' ? [false, false, false, false] : s.ippatsu };
  }
  if (c.rons.length === 0) {
    // 鳴き：ポン・カンがチーより先（同じ牌を 2 人がポン・カンすることは無い＝4 枚しかない）
    const call = c.calls.find((x) => x.meld === 'pon' || x.meld === 'kan') ?? c.calls.find((x) => x.meld === 'chi');
    if (!call) {
      // 打牌が通った（誰もロンも鳴きもしない）ところで、途中流局を確かめる
      const reason = abortAfterPass(s, c);
      if (reason) return finish({ ...s, claim: null }, { type: 'abort', reason }, [0, 0, 0, 0]);
      return { ...s, phase: 'draw', turn: nextSeat(c.from), claim: null };
    }
    return applyCall(s, c, call);
  }
  // 切った人の下家から順に並べる（頭ハネで先に来る人が先頭）
  const order = (seat: Seat) => (seat - c.from + 4) % 4;
  const rons = c.rons.slice().sort((a, b) => order(a.seat) - order(b.seat));
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  let wins = rons;
  if (rons.length === 2 && v?.double === 'atama') wins = rons.slice(0, 1);
  if (rons.length === 3) {
    if (v?.triple === 'ryukyoku') return finish({ ...s, claim: null }, { type: 'tripleRon', from: c.from, seats: rons.map((r) => r.seat) }, [0, 0, 0, 0]);
    if (v?.triple === 'atama') wins = rons.slice(0, 1);
  }
  const robbed = c.kind === 'discard' ? {} : { robbed: c.kind };
  const result: RoundResult = { type: 'ron', from: c.from, winTile: c.tile, wins, ...robbed };
  return finish({ ...s, claim: null }, result, ronSettlement(s, c.from, wins));
}

/** 局を終える：結果を置き、点の動きを持ち点に足す。供託は、アガった人に渡した分（settlement に入れた分）だけ卓から消える */
function finish(s: GameState, result: RoundResult, settlement: number[]): GameState {
  const scores = s.scores.map((p, i) => p + settlement[i]);
  const taken = result.type === 'tsumo' || result.type === 'ron' ? s.kyotaku : 0;
  return { ...s, phase: 'ended', result, settlement, scores, kyotaku: s.kyotaku - taken };
}

/** リーチ棒を出す（持ち点から 1000 点を卓へ） */
function depositRiichi(s: GameState, seat: Seat): GameState {
  const scores = s.scores.slice();
  scores[seat] -= RIICHI_STICK;
  const riichiStick = s.riichiStick.slice();
  riichiStick[seat] = true;
  return { ...s, scores, riichiStick, kyotaku: s.kyotaku + 1 };
}

/** リーチ棒を出せるか（1000 点未満のリーチがルールで「できない」なら、持ち点 1000 点以上） */
export function riichiAffordable(s: GameState, seat: Seat): boolean {
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  return v?.riichiUnder === 'ok' || s.scores[seat] >= RIICHI_STICK;
}

const honbaOn = (s: GameState) => s.rules?.family === 'jp' && s.rules.values.honba === 'on';

/**
 * 役満のうち、包の人が受け持つ割合（0〜1）。包が無い・その役が成り立っていないなら 0。
 * 「その役満分だけ包」なら、包の役の倍数 ÷ 全部の役満の倍数。「全額を包」なら 1
 */
function paoShare(s: GameState, seat: Seat, score: ScoreResult): { pao: Seat; share: number } | null {
  const p = s.pao[seat];
  if (!p || score.limit !== 'yakuman' || score.yakuman <= 0) return null;
  const hit = score.yaku.find((y) => y.id === p.yaku);
  if (!hit) return null;
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  const share = v?.paoMix === 'all' ? 1 : hit.yakuman / score.yakuman;
  return { pao: p.seat, share };
}

/** ツモアガリの点の動き：払う人は本場 1 本につき 100 点ずつ足す（包があれば包の人が受け持つ分と本場を払う）。供託はアガった人へ */
function tsumoSettlement(s: GameState, winner: Seat, score: ScoreResult): number[] {
  const out = [0, 0, 0, 0];
  const pay = (from: Seat, n: number) => {
    out[from] -= n;
    out[winner] += n;
  };
  const p = score.payment;
  if (p.type !== 'tsumo') throw new Error('ツモの支払いでない');
  const honba = honbaOn(s) ? s.honba : 0;
  const pao = paoShare(s, winner, score);
  const rest = pao ? 1 - pao.share : 1;
  for (const seat of SEATS_) {
    if (seat === winner) continue;
    pay(seat, Math.round((seat === s.dealer ? p.fromDealer || p.fromOthers : p.fromOthers) * rest));
  }
  if (pao) pay(pao.pao, Math.round(score.total * pao.share));
  // 本場：包があれば包の人がまとめて、無ければ 1 人 100 点ずつ
  if (pao) pay(pao.pao, honba * HONBA_POINTS);
  else for (const seat of SEATS_) if (seat !== winner) pay(seat, honba * (HONBA_POINTS / 3));
  out[winner] += s.kyotaku * RIICHI_STICK;
  return out;
}

/**
 * ロンアガリの点の動き。アガった人ごとに、切った人が払う（包があれば受け持つ分を包の人と折半）。
 * 本場と供託：1 人なら全部その人。2 人以上はルールの multiWinSticks（上家取り／積み棒は全員・リーチ棒は本人に戻す）。
 * 包のときの本場はルールの paoHonba（包の人／放銃者）
 */
function ronSettlement(s: GameState, from: Seat, wins: readonly RonWin[]): number[] {
  const out = [0, 0, 0, 0];
  const pay = (payer: Seat, to: Seat, n: number) => {
    out[payer] -= n;
    out[to] += n;
  };
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  const honba = honbaOn(s) ? s.honba : 0;
  const each = wins.length > 1 && v?.multiWinSticks === 'each';
  wins.forEach((w, i) => {
    const pao = paoShare(s, w.seat, w.score);
    const paoPart = pao ? Math.round(w.score.total * pao.share) : 0;
    if (pao && pao.pao !== from) {
      pay(pao.pao, w.seat, paoPart / 2);
      pay(from, w.seat, w.score.total - paoPart / 2);
    } else {
      pay(from, w.seat, w.score.total);
    }
    if (i === 0 || each) {
      const honbaPayer = pao && pao.pao !== from && v?.paoHonba === 'pao' ? pao.pao : from;
      pay(honbaPayer, w.seat, honba * HONBA_POINTS);
    }
  });
  // 供託：積み棒は全員のルールでは、この局でリーチしたアガった人が自分のリーチ棒を取り戻し、残りは最初の人
  let sticks = s.kyotaku;
  if (each) {
    for (const w of wins) {
      if (s.riichiStick[w.seat] && sticks > 0) {
        out[w.seat] += RIICHI_STICK;
        sticks--;
      }
    }
  }
  out[wins[0].seat] += sticks * RIICHI_STICK;
  return out;
}

const SEATS_: readonly Seat[] = [0, 1, 2, 3];

/** 流し満貫が成り立つ席：ルールが「あり」、河が全部么九牌で、1 枚も鳴かれていない（自分が鳴いていても成り立つ） */
export function nagashiSeats(s: GameState): Seat[] {
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (v?.nagashi !== 'on') return [];
  return SEATS_.filter((seat) => {
    const d = s.discards[seat];
    return d.length > 0 && s.calledAway[seat].length === 0 && d.every((t) => TERMINAL_HONOR_KINDS.includes(kindOf(t)));
  });
}

/** 流し満貫の支払い：満貫のツモと同じ（親 4000 オール・子は親 4000／子 2000）。何人でもそれぞれ */
function nagashiPayments(s: GameState, seats: readonly Seat[]): number[] {
  const out = [0, 0, 0, 0];
  for (const w of seats) {
    for (const seat of SEATS_) {
      if (seat === w) continue;
      const n = w === s.dealer || seat === s.dealer ? 4000 : 2000;
      out[seat] -= n;
      out[w] += n;
    }
  }
  return out;
}

/** チー・ポンの申し出がおかしければ理由を返す（無ければ null）。手牌が見える局面では持っている牌かも確かめる */
export function callProblem(s: GameState, seat: Seat, meld: 'chi' | 'pon' | 'kan', tiles: readonly TileId[]): string | null {
  const c = s.claim;
  if (!c) return '鳴ける時ではない';
  if (c.kind !== 'discard') return 'カンの牌は鳴けない（ロンだけ）';
  if (seat === c.from) return '自分の切った牌は鳴けない';
  if (s.riichi[seat] !== 'none') return 'リーチのあとは鳴けない';
  // 最後の捨て牌（河底）は鳴けない＝次のツモが無い
  if (liveWallLeft(s) <= 0) return '山が尽きたあとの捨て牌は鳴けない';
  if (meld === 'kan' && s.kans >= MAX_KANS) return 'カンは 1 局 4 回まで';
  const need = meld === 'kan' ? 3 : 2;
  if (tiles.length !== need) return `${meld === 'kan' ? 'カン' : '鳴く'}には手牌から ${need} 枚出す`;
  if (new Set(tiles).size !== tiles.length) return '同じ牌を 2 回出した';
  const hand = s.hands[seat];
  if (!hand.includes(HIDDEN) && !tiles.every((t) => hand.includes(t))) return '持っていない牌で鳴こうとした';
  const k = kindOf(c.tile);
  const ks = tiles.map(kindOf);
  if (meld === 'kan') return ks.every((x) => x === k) ? null : 'カンは同じ牌 4 枚';
  if (meld === 'pon') {
    if (!ks.every((x) => x === k)) return 'ポンは同じ牌 3 枚';
  } else {
    if (seat !== nextSeat(c.from)) return 'チーは上家の捨て牌だけ';
    const all = [k, ...ks].sort((a, b) => a - b);
    const suit = Math.floor(all[0] / 9);
    if (all[0] >= 27 || Math.floor(all[2] / 9) !== suit || all[1] !== all[0] + 1 || all[2] !== all[0] + 2) return 'チーは同じ色の続いた 3 枚';
  }
  // 喰い替え禁止のルールで、鳴いたあと切れる牌が 1 枚も無いなら鳴けない
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (v?.kuikae === 'ng' && !hand.includes(HIDDEN)) {
    const ban = kuikaeKinds(meld, c.tile, tiles);
    const rest = hand.filter((t) => !tiles.includes(t));
    if (rest.every((t) => ban.includes(kindOf(t)))) return '鳴いたあと切れる牌が無い（喰い替え禁止）';
  }
  return null;
}

/**
 * 自分の番のカン（暗槓・加槓）がおかしければ理由を返す（無ければ null）。手牌が見える局面では持っている牌かも確かめる。
 * リーチのあとの暗槓は、ルールが許し、ツモった牌を使い、待ちが変わらない（条件が「刻子としか読めない形」ならそれも）ときだけ
 */
export function kanProblem(s: GameState, seat: Seat, kan: 'ankan' | 'kakan', tiles: readonly TileId[]): string | null {
  if (s.kans >= MAX_KANS) return 'カンは 1 局 4 回まで';
  // 最後のツモ（海底）のあとはカンできない＝嶺上牌を引いたあとの山が無い
  if (liveWallLeft(s) <= 0) return '山が尽きたあとはカンできない';
  if (tiles.length === 0) return 'カンに出す牌が無い';
  if (new Set(tiles).size !== tiles.length) return '同じ牌を 2 回出した';
  const hand = s.hands[seat];
  const visible = !hand.includes(HIDDEN);
  if (visible && !tiles.every((t) => hand.includes(t))) return '持っていない牌でカンしようとした';
  const k = kindOf(tiles[0]);
  if (!tiles.every((t) => kindOf(t) === k)) return 'カンは同じ牌 4 枚';
  if (kan === 'kakan') {
    if (tiles.length !== 1) return '加槓は手牌から 1 枚';
    if (!s.melds[seat].some((m) => m.type === 'pon' && kindOf(m.tiles[0]) === k)) return '加槓はポンした面子にだけ';
    return null;
  }
  if (tiles.length !== 4) return '暗槓は手牌から 4 枚';
  if (s.riichi[seat] === 'none') return null;
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (!v || v.riichiAnkan !== 'ok') return 'このルールではリーチのあと暗槓できない';
  if (!visible) return null;
  const drawn = s.drawn[seat];
  if (drawn === null || !tiles.includes(drawn)) return 'リーチのあとの暗槓はツモった牌でだけ';
  if (!riichiAnkanKeepsWait(hand.filter((t) => t !== drawn), k, v.ankanCond)) return 'リーチのあとの暗槓で待ちが変わる';
  return null;
}

/**
 * リーチのあとの暗槓で手が変わらないか。before＝ツモる前の手牌（鳴き・暗槓を除いた 13 枚ぶん）、k＝カンする牌の種類。
 * wait＝待ちの種類が変わらなければよい／shape＝さらに、どの待ちでアガっても k がいつも刻子として読める（刻子としか読めない形）
 */
export function riichiAnkanKeepsWait(before: readonly TileId[], k: number, cond: string): boolean {
  const waits = waitKinds(before);
  const rest = before.filter((t) => kindOf(t) !== k);
  if (rest.length !== before.length - 3) return false;
  // 刻子を抜いた残りの待ち＝カンしたあとの待ち
  const after = waitKinds(rest);
  if (waits.length === 0 || waits.join() !== after.join()) return false;
  if (cond !== 'shape') return true;
  return waits.every((w) => {
    const c = kindCounts(before);
    c[w]++;
    const ds = decompose(c);
    return ds.length > 0 && ds.every((d) => d.sets.some((x) => x.type === 'tri' && x.first === k));
  });
}

/**
 * 打牌が通ったときの途中流局（ルールで「あり」のものだけ）。全員に見えることだけで決まる＝どの端末でも同じ。
 * 四風連打＝鳴きが無いまま 4 人の最初の打牌が同じ風牌／四家立直＝4 人目のリーチの宣言牌が通った（成立時点が「通ったとき」のルール）／
 * 四開槓＝2 人以上で合わせて 4 回カンして、そのあとの打牌が通った（1 人で 4 回なら続ける＝四槓子の見込み）
 */
function abortAfterPass(s: GameState, c: Claim): AbortReason | null {
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (!v) return null;
  if (v.sufon === 'on' && !s.anyCall && s.discards.every((d) => d.length === 1)) {
    const k = kindOf(s.discards[0][0]);
    if (k >= 27 && k <= 30 && s.discards.every((d) => kindOf(d[0]) === k)) return 'sufon';
  }
  if (v.suricchi === 'on' && v.suricchiWhen === 'pass' && s.riichi.every((r) => r !== 'none') && s.riichiAt[c.from] === s.discards[c.from].length - 1) {
    return 'suricchi';
  }
  if (v.sukan === 'on' && s.kans >= MAX_KANS && s.melds.filter((ms) => ms.some(isKanMeld)).length >= 2) return 'sukan';
  return null;
}

/** 九種九牌で流せるか：ルールが「あり」、自分の最初のツモで、それまでに誰も鳴いていない、么九牌が 9 種類以上 */
export function kyushuOk(s: GameState, seat: Seat): boolean {
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (!v || v.kyushu !== 'on') return false;
  if (s.phase !== 'discard' || s.turn !== seat || s.discards[seat].length > 0 || s.anyCall || s.rinshanDraw) return false;
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN) || hand.length !== 14) return false;
  const kinds = new Set(hand.map(kindOf));
  return TERMINAL_HONOR_KINDS.filter((k) => kinds.has(k)).length >= 9;
}

/**
 * 流局のときテンパイと言えるか。形の上でテンパイ（待ちがある）で、形式テンパイ「なし」のルールなら、
 * どれかの待ちで役が付く（縛りに届く）ことも要る。最後のツモ・最後の捨て牌の役（海底・河底）は数えない
 */
export function tenpaiForDeclare(s: GameState, seat: Seat, hand: readonly TileId[]): boolean {
  const waits = waitKinds(hand);
  if (waits.length === 0) return false;
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (!v || v.keishiki === 'on') return true;
  // 海底・河底が付かないように、山が残っている局面として数える（局面を変えるのではなく、数えるための写し）
  const probe: GameState = { ...s, wallLeft: s.wallLeft + 100, claim: null, drawn: [null, null, null, null], rinshanDraw: false };
  return waits.some((k) => {
    const t = k * 4 + 3;
    return scoreRon(probe, seat, hand, t) !== null || scoreTsumo(probe, seat, [...hand, t], t) !== null;
  });
}

/**
 * 喰い替え禁止のとき、鳴いた直後に切れない牌の種類。ポン＝その牌（現物）。チー＝鳴いた牌と、両面の反対側（筋）。
 * 例）3萬4萬で 2萬をチー → 2萬と 5萬は切れない。2萬4萬で 3萬をチー → 3萬だけ
 */
export function kuikaeKinds(meld: 'chi' | 'pon', called: TileId, tiles: readonly TileId[]): number[] {
  const k = kindOf(called);
  if (meld === 'pon') return [k];
  const ks = tiles.map(kindOf).sort((a, b) => a - b);
  const out = [k];
  if (k + 1 === ks[0] && ks[1] === k + 2 && (k % 9) + 3 <= 8) out.push(k + 3);
  if (k - 1 === ks[1] && ks[0] === k - 2 && (k % 9) - 3 >= 0) out.push(k - 3);
  return out;
}

/** 鳴きを局面に入れる。鳴いた人の番になり、ツモらずに 1 枚切る（大明槓は嶺上牌を引いてから切る）。一発はみんな消える */
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
  const kan = call.meld === 'kan';
  melds[call.seat].push({ type: call.meld === 'kan' ? 'minkan' : call.meld, tiles, called: c.tile, from: c.from });
  const pao = s.pao.slice();
  const p = paoFromCall(s, melds[call.seat], c.from);
  if (p && !pao[call.seat]) pao[call.seat] = p;
  const calledAway = s.calledAway.map((x) => x.slice());
  calledAway[c.from].push(s.discards[c.from].length - 1);
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  const kanDora = kan && v?.kandora === 'on';
  return {
    ...s,
    kuikaeBan: !kan && call.meld !== 'kan' && v?.kuikae === 'ng' ? kuikaeKinds(call.meld, c.tile, call.tiles) : [],
    phase: kan ? 'draw' : 'discard',
    rinshanDue: kan,
    kans: s.kans + (kan ? 1 : 0),
    pendingDora: s.pendingDora + (kanDora ? 1 : 0),
    deferDora: kanDora && v?.kandoraWhen === 'split',
    pao,
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

/**
 * 鳴いたことで包が決まるか。ルールの pao：2＝大三元・大四喜／3＝それに四槓子。
 * 大三元＝三元牌の 3 つ目の刻子・槓子を鳴かせた人／大四喜＝風牌の 4 つ目／四槓子＝4 つ目のカンを大明槓させた人
 */
function paoFromCall(s: GameState, melds: readonly OpenMeld[], from: Seat): Pao | null {
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  if (!v || (v.pao !== '2' && v.pao !== '3')) return null;
  const last = melds[melds.length - 1];
  if (last.type === 'chi') return null;
  const k = kindOf(last.tiles[0]);
  const triKinds = melds.filter((m) => m.type !== 'chi').map((m) => kindOf(m.tiles[0]));
  if (k >= 31 && triKinds.filter((x) => x >= 31).length === 3) return { seat: from, yaku: 'daisangen' };
  if (k >= 27 && k <= 30 && triKinds.filter((x) => x >= 27 && x <= 30).length === 4) return { seat: from, yaku: 'daisuushii' };
  if (v.pao === '3' && last.type === 'minkan' && melds.filter(isKanMeld).length === 4) return { seat: from, yaku: 'suukantsu' };
  return null;
}

/** 鳴いた面子を、役の判定が読む形にする */
const yakuMelds = (s: GameState, seat: Seat): Meld[] =>
  s.melds[seat].map((m) => ({
    type: m.type === 'chi' || m.type === 'pon' ? m.type : 'kan',
    first: Math.min(...m.tiles.map(kindOf)),
    open: m.type !== 'ankan',
  }));
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
      rinshan: s.rinshanDraw,
      honba: s.honba,
      riichi: s.riichi[seat],
      ippatsu: s.ippatsu[seat],
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
 * ロンアガリしたときの点数（切られた牌に返事をしている局面で呼ぶ）。hand は 13 枚、winTile は切られた牌。役が無ければ null。
 * 加槓の牌へのロンは槍槓（一発との複合はルールの ippatsuChankan）。暗槓の牌へのロンは国士無双だけ
 */
export function scoreRon(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
  if (!s.rules || s.rules.family !== 'jp') return null;
  const kind = s.claim?.kind ?? 'discard';
  const v = s.rules.values;
  if (kind === 'ankan' && v.kokushiAnkan !== 'on') return null;
  const tiles = [...hand, winTile];
  const score = scoreWin({
    ctx: {
      concealed: kindCounts(tiles),
      melds: yakuMelds(s, seat),
      winTile: kindOf(winTile),
      tsumo: false,
      seatWind: seatWindOf(s, seat),
      roundWind: roundWindOf(s),
      houtei: kind === 'discard' && liveWallLeft(s) === 0,
      chankan: kind === 'kakan',
      honba: s.honba,
      riichi: s.riichi[seat],
      ippatsu: s.ippatsu[seat] && (kind !== 'kakan' || v.ippatsuChankan === 'yes'),
      // 人和（ルールの jinho）は段階3の途中で足す
      rules: s.rules,
    },
    tiles: [...tiles, ...meldTiles(s, seat)],
    indicators: s.doraIndicators,
    ura,
    dealer: seat === s.dealer,
  });
  if (kind === 'ankan' && score && score.reading.form !== 'kokushi') return null;
  return score;
}

export function replay(log: readonly Envelope[]): GameState {
  return log.reduce(apply, initialState());
}

/** その席から見える局面（他の人の手牌・山の並びは伏せたまま） */
export function viewFor(log: readonly Envelope[], viewer: Seat): GameState {
  return replay(log.map((e) => mask(e, viewer)));
}

export const isHidden = (t: TileId) => t === HIDDEN;
