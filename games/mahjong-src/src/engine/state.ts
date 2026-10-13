// 局面。出来事の列を頭から順に当てはめて作る。ここに書いてあること以外の方法で局面を変えない。
// 列としてあり得ない出来事（持っていない牌を切る・番でない人がツモる など）は例外で止める。

import { HIDDEN, mask, type Envelope, type GameEvent, type Seat } from './events';
import { isThirteenOrphans, kindCounts, TERMINAL_HONOR_KINDS, waitKinds } from './agari';
import { decompose } from './yaku';
import { furitenOf } from './furiten';
import { nextStep, type GameEndReason } from './game';
import { createRng, shuffle } from './rng';
import type { Rules } from './rules';
import { scoreWin, type ScoreResult } from './score';
import { sichuanScore, type CnScore } from './sichuan';
import { hongkongScore } from './hongkong';
import type { Meld } from './yaku';
import { kindOf, tileSetFor, type TileId } from './tiles';

/** 局の進み具合。deal＝配っている途中／draw＝番の人がツモる前（カンのあとは嶺上牌を引く前）／discard＝番の人が切る（またはアガる・カンする）前／
 *  claim＝切られた牌（または加槓・暗槓の牌）にほかの 3 人が返事をしている（見送る・ロン・鳴く）／
 *  declare＝流局してテンパイ・ノーテンを宣言している（番の人が宣言する）／ended＝局が終わった／
 *  que＝缺一門（中国式・四川）：親が 14 枚目を引いたあと、4 人が捨てる色の牌を 1 枚伏せて置く（4 人そろうまで親は切れない） */
export type Phase = 'idle' | 'deal' | 'draw' | 'que' | 'discard' | 'claim' | 'declare' | 'ended' | 'gameover';

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
  /** 切った人が嶺上牌を引いたあとの捨て牌か（槓振り） */
  afterKan?: boolean;
  /** 中国式の加槓で、4 枚目を引いてすぐカンした（刮风下雨の 1 点はそのときだけ） */
  fresh?: boolean;
  /** 中国式のロン（言った順）。日本式の rons と別に持つ（点数の形が違う） */
  cnRons?: { seat: Seat; score: CnScore }[];
}

/** ロンと言った人の数（日本式・中国式） */
const ronCount = (c: Claim) => c.rons.length + (c.cnRons?.length ?? 0);

/** 鳴いた面子と暗槓。tiles＝3 枚（カンは 4 枚。切られた牌を含む）／called＝鳴いた牌（暗槓は null）／from＝切った人（暗槓は本人）。
 *  minkan＝大明槓／kakan＝加槓（もとのポンの called・from を引き継ぐ。added＝足した牌）／ankan＝暗槓 */
export interface OpenMeld {
  type: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan';
  tiles: TileId[];
  called: TileId | null;
  from: Seat;
  added?: TileId;
  /** 槍槓されて無効になった加槓（MIL §10-8）。牌の置き場は加槓のまま（足した牌はアガった人のアガリ牌として数える）、
   *  得点ではポン（3 枚）として数え、画面でもポンの形で見せる（利用者 2026-10-12 Q1=A） */
  robbed?: boolean;
}

/** 得点で数える面子の枚数（槍槓で無効になった加槓はポンの 3 枚） */
export const meldSize = (m: OpenMeld): 3 | 4 => (isKanMeld(m) && !m.robbed ? 4 : 3);

/** 槍槓された加槓に「無効」の印を付ける（足した牌が tile の面子） */
function markRobbed(s: GameState, seat: Seat, tile: TileId): GameState {
  const melds = s.melds.map((ms, i) => (i === seat ? ms.map((m) => (m.type === 'kakan' && m.added === tile ? { ...m, robbed: true } : m)) : ms));
  return { ...s, melds };
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
  | { type: 'abort'; reason: AbortReason; seat?: Seat }
  /** 中国式のアガリ（段階9）。wins＝アガった人（アガった順。同じ牌のロンは切った人の下家から順＝ルールの multiWin）。
   *  血戦到底（アガった人が抜けて続く）は、局の終わりにその局の全部のアガリを入れる。exhausted＝山が尽きて終わった（アガった人がいなくてカンの収入だけのときも＝wins は空） */
  | { type: 'cnWin'; wins: CnWin[]; exhausted?: boolean; draw?: CnDraw };

/** 流局のときのアガっていない人の状態（MIL §11-1）：ready＝テンパイ／noten＝ノーテン／pig＝花豬（捨てる色の牌が 1 枚でも残っている＝利用者 Q4=A。
 *  ルールの huazhu が「なし」なら、捨てる色の牌が残っている人はノーテン） */
export type CnDrawState = 'ready' | 'noten' | 'pig';

/** 中国式の流局の精算（MIL §8-5・§11）。点の動きは席ごと（受け取りが＋） */
export interface CnDraw {
  /** 席ごとの状態（アガって抜けた人は null） */
  states: (CnDrawState | null)[];
  /** テンパイの人の「理論上の最大点」（ルールの chajiaoPts。テンパイでない人は null） */
  maxPoints: (number | null)[];
  /** 查叫：ノーテンの人がテンパイの人それぞれへ最大点を払う（§11-3。ルールの chajiao） */
  chajiao: number[];
  /** 花豬の罰：48 点を払い、誰も受け取らない（§11-2・利用者 Q1=A＝持ち点の合計がその分減る） */
  pig: number[];
  /** 返したカンの収入：テンパイでない人（ノーテン・花豬＝利用者 Q2=A）がこの局のカンの収入を全部返す（§8-5） */
  kanReturn: number[];
}

/** 花豬の罰（MIL §11-2） */
export const PIG_PENALTY = 48;

/** 中国式のアガリ 1 人分。from＝切った人（ツモは null）。pays＝席ごとの点の動き（受け取りが＋・合計 0） */
export interface CnWin {
  seat: Seat;
  from: Seat | null;
  winTile: TileId;
  score: CnScore;
  pays: number[];
  /** 搶槓（加槓・暗槓の牌へのロン）。香港はカンした人がツモの 3 人分を払う */
  rob?: true;
}

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
  /** 起家（最初の親）。親決めが無い牌譜（10-09 より前）は席 0 */
  chicha: Seat;
  /** 親決めで振ったサイコロ（振っていなければ null） */
  dealerDice: [number, number] | null;
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
  /** 番の人が打牌せずに続けてカンした回数（香港の槓上槓自摸＝2 回以上カンして嶺上牌でツモ）。打牌で 0 */
  kanChain: number;
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
  /** 続けてアガっている人と回数（八連荘。流局・途中流局をはさむと途切れる＝Q35＝A。局をまたぐ） */
  winStreak: { seat: Seat; n: number } | null;
  /** 対局が終わった理由（終わるまで null） */
  gameOver: GameEndReason | null;
  result: RoundResult | null;
  /** 缺一門：席ごとの伏せて置いた牌（伏せていない・もう切った＝null。ほかの人の分は HIDDEN）。牌は手牌の中に入れたまま */
  queHeld: (TileId | null)[];
  /** 缺一門：伏せたときに決めた捨てる色（0 萬・1 筒・2 索。ほかの人の分は HIDDEN） */
  queHeldSuit: (number | null)[];
  /** 缺一門：最初の打牌で宣言した捨てる色（全員に見える。宣言する前は null） */
  que: (number | null)[];
  /** 中国式の見逃し（ルールの miss が nextDraw）：ロンできたのに見送った人の、そのときの基本点（次に自分が引くまで、それより高くなければロンできない）。
   *  手牌が見える本人の端末と全体の局面でだけ立つ */
  cnMissed: (number | null)[];
  /** 中国式の見逃し（ルールの miss が sameTile＝香港の「同巡內不能食跟張牌」）：ロンできたのに見送った牌の種類。次に自分が引くまで、同じ種類ではロンできない */
  cnMissedKinds: number[][];
  /** 香港の跟張（ルールの baopai が「あり」のとき）：自分が引くまでに、鳴けたのに見送った牌と自分が切った牌の種類。
   *  同じ種類を鳴いて包牌が生じるなら鳴けない（原典 鳴牌禁例 1・2） */
  cnFollowKinds: number[][];
  /** 血戦到底：アガって抜けた席（局の終わりまで打たない・手牌は開けたまま） */
  cnOut: boolean[];
  /** 血戦到底：この局のアガリ（アガった順。点はアガったときに持ち点へ足してある） */
  cnWins: CnWin[];
  /** 刮风下雨：この局のカンの収入（カンした順。点はカンしたときに持ち点へ足してある。返したものは returned） */
  cnKans: CnKan[];
  /** 槍槓で無効になったカンの数（血戦到底で局が続くとき、嶺上牌を引かないカン） */
  robbedKans: number;
  /** 花豬の罰で卓から消えた点の合計（対局をまたいで足していく。見張り役が「持ち点の合計＋これ＝持ち点 4 人分」を確かめる） */
  cnBurned: number;
}

/** 刮风下雨のカンの収入 1 回分。pays＝席ごとの点の動き（合計 0） */
export interface CnKan {
  seat: Seat;
  kind: 'minkan' | 'ankan' | 'kakan';
  pays: number[];
  /** 返した（直後の打牌で放銃した＝MIL §8-4・流局でノーテン＝§8-5） */
  returned?: boolean;
  /** 返したのが流局のとき（テンパイでなかった＝§8-5）。画面で理由を書き分ける */
  atDraw?: boolean;
}

/** 血戦到底のルールか（中国式で afterWin が「抜けて続く」） */
export const bloodBattle = (rules: Rules | null): boolean => rules?.family === 'cn' && rules.values.afterWin === 'leave';

/** seat の下家から順に、まだ抜けていない最初の席（抜けた人がいなければ下家） */
export function nextActive(s: GameState, seat: Seat): Seat {
  let x = seat;
  for (let i = 0; i < 4; i++) {
    x = ((x + 1) % 4) as Seat;
    if (!s.cnOut[x]) return x;
  }
  return x;
}

/** 缺一門のルールか（中国式で queyimen が「あり」） */
export const queOn = (rules: Rules | null): boolean => rules?.family === 'cn' && rules.values.queyimen === 'on';

/** 数牌の色（0 萬・1 筒・2 索）。字牌・花牌は -1 */
export const suitOfKind = (k: number): number => (k < 27 ? Math.floor(k / 9) : -1);
const suitOf = (t: TileId): number => suitOfKind(kindOf(t));

/**
 * 缺一門の打牌の縛り（MIL §5）。切れないなら理由、切れるなら null。手牌が見える局面でだけ確かめる。
 * 最初の打牌は伏せた牌だけ／宣言したあとは、捨てる色の牌が手に残るうちはその色しか切れない
 */
export function queDiscardProblem(s: GameState, seat: Seat, tile: TileId): string | null {
  if (!queOn(s.rules)) return null;
  const held = s.queHeld[seat];
  if (s.que[seat] === null) {
    if (held === null) return '捨てる色の牌を伏せる前に切った';
    if (held !== HIDDEN && tile !== held) return '最初の打牌は伏せておいた牌（缺一門）';
    return null;
  }
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN)) return null;
  const q = s.que[seat];
  if (suitOf(tile) !== q && hand.some((t) => suitOf(t) === q)) return '捨てる色の牌が手に残っているうちは、ほかの牌を切れない（缺一門）';
  return null;
}

/** 缺一門で伏せる牌と色がおかしければ理由を返す（手牌が見える局面でだけ確かめる） */
export function queHoldProblem(s: GameState, seat: Seat, tile: TileId, suit: number): string | null {
  if (!queOn(s.rules)) return 'このルールに缺一門は無い';
  if (s.phase !== 'que') return '捨てる色を決める時ではない';
  if (s.queHeld[seat] !== null) return '捨てる色の牌はもう伏せた';
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN) || tile === HIDDEN) return null;
  if (!hand.includes(tile)) return '持っていない牌を伏せた';
  if (![0, 1, 2].includes(suit)) return '捨てる色は萬子・筒子・索子のどれか';
  if (suitOf(tile) < 0) return '伏せる牌は数牌（萬子・筒子・索子）';
  // 伏せた牌と違う色を宣言できるのは、手牌にその色が 1 枚も無いときだけ（MIL §5-4）
  if (suit !== suitOf(tile) && hand.some((t) => suitOf(t) === suit)) return '伏せた牌と違う色を捨てる色にできるのは、その色が手に 1 枚も無いときだけ';
  return null;
}

/** 責任払い（包）。seat＝包の人／yaku＝その役 */
export interface Pao {
  seat: Seat;
  /** 日本式＝包の役満。香港＝twelve（十二章包）・dragons（大三元包） */
  yaku: 'daisangen' | 'daisuushii' | 'suukantsu' | 'twelve' | 'dragons';
}

/** 本場 1 本の点（ロンは 300 点・ツモは 1 人 100 点。変えられない決まり） */
export const HONBA_POINTS = 300;
/** リーチ棒 1 本 */
export const RIICHI_STICK = 1000;

/** ルールの持ち点（日本式の start は千点単位の文字。中国式は点そのもの＝0点から・500点） */
export function startPoints(rules: Rules | null): number {
  if (!rules) return 0;
  const n = Number(rules.values.start);
  if (!Number.isFinite(n)) return 0;
  return rules.family === 'jp' ? n * 1000 : n;
}

export const initialState = (): GameState => ({
  nextSeq: 0,
  rules: null,
  roundIndex: -1,
  dealer: 0,
  chicha: 0,
  dealerDice: null,
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
  kanChain: 0,
  pendingDora: 0,
  deferDora: false,
  kuikaeBan: [],
  scores: [0, 0, 0, 0],
  honba: 0,
  kyotaku: 0,
  riichiStick: [false, false, false, false],
  pao: [null, null, null, null],
  settlement: null,
  winStreak: null,
  yame: null,
  handCount: 0,
  gameOver: null,
  result: null,
  queHeld: [null, null, null, null],
  queHeldSuit: [null, null, null, null],
  que: [null, null, null, null],
  cnMissed: [null, null, null, null],
  cnMissedKinds: [[], [], [], []],
  cnFollowKinds: [[], [], [], []],
  cnOut: [false, false, false, false],
  cnWins: [],
  cnKans: [],
  robbedKans: 0,
  cnBurned: 0,
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
      return { ...s, rules: ev.rules, scores: [p, p, p, p], honba: 0, kyotaku: 0, cnBurned: 0 };
    }
    case 'dealerDice': {
      if (!s.rules) throw new Error('対局が始まる前に親決めをした');
      if (s.roundIndex >= 0) throw new Error('局が始まったあとに親決めをした');
      const [d1, d2] = ev.dice;
      if (![d1, d2].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) throw new Error('サイコロの目が 1〜6 でない');
      if (ev.dealer !== dealerByDice(ev.by, ev.dice)) throw new Error('サイコロの目と起家が合わない');
      return { ...s, chicha: ev.dealer, dealerDice: ev.dice };
    }
    case 'roundStart': {
      if (!s.rules) throw new Error('対局が始まる前に局が始まった');
      // 最初の局の親は起家（親決めで決まった人）
      if (s.roundIndex < 0 && ev.dealer !== s.chicha) throw new Error('最初の局の親が起家と違う');
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
        kanChain: 0,
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
        queHeld: [null, null, null, null],
        queHeldSuit: [null, null, null, null],
        que: [null, null, null, null],
        cnMissed: [null, null, null, null],
        cnMissedKinds: [[], [], [], []],
        cnFollowKinds: [[], [], [], []],
        cnOut: [false, false, false, false],
        cnWins: [],
        cnKans: [],
        robbedKans: 0,
      };
    }
    case 'queHold': {
      const problem = queHoldProblem(s, ev.seat, ev.tile, ev.suit);
      if (problem) throw new Error(problem);
      const queHeld = s.queHeld.slice();
      const queHeldSuit = s.queHeldSuit.slice();
      queHeld[ev.seat] = ev.tile;
      queHeldSuit[ev.seat] = ev.suit;
      // 4 人とも伏せたら、親が最初の 1 枚（伏せた牌）を切る
      return { ...s, queHeld, queHeldSuit, phase: queHeld.every((t) => t !== null) ? 'discard' : 'que' };
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
      if (s.cnOut[ev.seat]) throw new Error('アガって抜けた人がツモった');
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
      // 中国式の見逃しの縛りは、自分が引いたところで解ける
      const cnMissed = s.cnMissed.slice();
      cnMissed[ev.seat] = null;
      const cnMissedKinds = s.cnMissedKinds.map((x, i) => (i === ev.seat ? [] : x));
      const cnFollowKinds = s.cnFollowKinds.map((x, i) => (i === ev.seat ? [] : x));
      return {
        ...s,
        cnMissed,
        cnMissedKinds,
        cnFollowKinds,
        // 缺一門のルールでは、親の 14 枚目で配り終えたところで 4 人が捨てる色を決める
        phase: s.phase === 'deal' && queOn(s.rules) ? 'que' : 'discard',
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
      if (s.rules?.family === 'jp' && s.rules.values.kyushuHow === 'must' && kyushuOk(s, ev.seat)) throw new Error('九種九牌は必ず流すルールなのに切った');
      // 缺一門：最初の打牌で捨てる色を宣言する（伏せた牌を切る）。そのあとは捨てる色が残るうちはその色だけ
      const quePr = queDiscardProblem(s, ev.seat, ev.tile);
      if (quePr) throw new Error(quePr);
      const que = s.que.slice();
      const queHeld = s.queHeld.slice();
      const queHeldSuit = s.queHeldSuit.slice();
      if (queOn(s.rules) && s.que[ev.seat] === null) {
        if (ev.que === undefined || ![0, 1, 2].includes(ev.que)) throw new Error('最初の打牌で捨てる色を宣言していない（缺一門）');
        if (s.queHeldSuit[ev.seat] !== HIDDEN && ev.que !== s.queHeldSuit[ev.seat]) throw new Error('宣言した色が、伏せたときに決めた色と違う');
        que[ev.seat] = ev.que;
        queHeld[ev.seat] = null;
        queHeldSuit[ev.seat] = null;
      } else if (ev.que !== undefined) throw new Error('捨てる色を宣言できるのは最初の打牌だけ');
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
      // 血戦到底で抜けた人は返事をしない（切った本人と同じ扱い）
      const replies: Claim['replies'] = s.cnOut.map((o) => (o ? 'self' : null));
      replies[ev.seat] = 'self';
      const claim: Claim = { kind: 'discard', from: ev.seat, tile: ev.tile, replies, rons: [], calls: [], afterKan: s.rinshanDraw };
      // 香港の跟張：自分が切った牌の種類（自分が引くまで覚える）
      const cnFollowKinds = s.rules?.family === 'cn' && s.rules.values.baopai === 'on' ? addFollow(s.cnFollowKinds, ev.seat, kindOf(ev.tile)) : s.cnFollowKinds;
      const after: GameState = { ...s, phase: 'claim', hands, discards, drawn, riichi, riichiAt, ippatsu, missedTurn, claim, rinshanDraw: false, kanChain: 0, kuikaeBan: [], que, queHeld, queHeldSuit, cnFollowKinds };
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
      const cnv = s.rules?.family === 'cn' ? s.rules.values : null;
      // 加槓の「引いてすぐ」の印：引いた牌が見える端末では本当か確かめる（中国式だけ。日本式は付けない）
      const fresh = ev.kan === 'kakan' && !!ev.fresh;
      if (ev.fresh !== undefined && (!cnv || ev.kan !== 'kakan')) throw new Error('「引いてすぐ」の印は中国式の加槓だけ');
      if (cnv && ev.kan === 'kakan' && s.drawn[ev.seat] !== HIDDEN && fresh !== (s.drawn[ev.seat] === ev.tiles[0])) throw new Error('加槓の「引いてすぐ」の印が違う');
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
        kanChain: s.rinshanDraw ? s.kanChain + 1 : 1,
        rinshanDraw: false,
        ippatsu: clearIppatsu ? [false, false, false, false] : s.ippatsu,
        anyCall: s.anyCall || ev.kan === 'kakan' || v?.tenhouAnkan === 'lost',
        pendingDora: s.pendingDora + (kanDora ? 1 : 0),
        deferDora: kanDora && ev.kan === 'kakan' && v?.kandoraWhen === 'split',
      };
      // 加槓は槍槓、暗槓は（ルールが許せば）国士無双のロンを待つ。中国式は加槓で、ルールの chankan が「あり」のときだけ待つ
      // 中国式の暗槓は、ルールの kokushi13（十三么の暗槓ロン）が「あり」で字牌のあるルールだけ待つ（香港の清章規則）
      const waitRob = cnv
        ? (ev.kan === 'kakan' && cnv.chankan === 'on') || (ev.kan === 'ankan' && cnv.kokushi13 === 'on' && cnv.honors === 'on')
        : ev.kan === 'kakan' || v?.kokushiAnkan === 'on';
      if (waitRob) {
        const replies: Claim['replies'] = s.cnOut.map((o) => (o ? 'self' : null));
        replies[ev.seat] = 'self';
        return { ...next, phase: 'claim', claim: { kind: ev.kan, from: ev.seat, tile: ev.tiles[0], replies, rons: [], calls: [], ...(fresh ? { fresh } : {}) } };
      }
      // 中国式の刮风下雨：暗槓はその場で、加槓（槍槓を待たないルール）もその場で受け取る
      const paid = cnv ? cnKanIncome(next, ev.seat, ev.kan, fresh, null) : next;
      return { ...paid, phase: 'draw', rinshanDue: true };
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
      const cnFollowKinds = couldCall(s, ev.seat) ? addFollow(s.cnFollowKinds, ev.seat, kindOf(c.tile)) : s.cnFollowKinds;
      return settleClaim({ ...s, missedTurn, missedRiichi, ...cnMissAfter(s, ev.seat), cnFollowKinds, claim: { ...c, replies } });
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
      return settleClaim({ ...s, missedTurn, missedRiichi, ...cnMissAfter(s, ev.seat), claim: { ...c, replies, calls } });
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
      if (s.rules?.family === 'cn') {
        if (ev.ura.length !== 0) throw new Error('中国式に裏ドラは無い');
        const visible = !known.includes(HIDDEN);
        // 捨てる色が残っているかは手牌が見える局面だけで確かめる（点は開けた手牌から出す＝どの端末でも同じ）
        const score = visible ? cnScoreRon(s, ev.seat, ev.hand, c.tile) : cnScoreOf(s, ev.seat, [...ev.hand, c.tile], 'ron');
        if (!score || (s.rules.values.ron !== 'ok')) throw new Error('アガリの形でない（または捨てる色が残っている）のにロンした');
        if (visible && cnRonBlocked(s, ev.seat, score)) throw new Error('見逃したあと、自分が引く前に同じ点以下でロンした');
        const hands = s.hands.map((h) => h.slice());
        hands[ev.seat] = ev.hand.slice();
        const replies = c.replies.slice();
        replies[ev.seat] = 'ron';
        const opened = s.opened.slice();
        opened[ev.seat] = true;
        return settleClaim({ ...s, hands, opened, claim: { ...c, replies, cnRons: [...(c.cnRons ?? []), { seat: ev.seat, score }] } });
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
      if (s.rules?.family === 'cn') {
        if (ev.ura.length !== 0) throw new Error('中国式に裏ドラは無い');
        const visible = !known.includes(HIDDEN);
        const score = visible ? cnScoreTsumo(s, ev.seat, ev.hand) : cnScoreOf(s, ev.seat, ev.hand, 'tsumo');
        if (!score) throw new Error('アガリの形でない（または捨てる色が残っている）のにツモアガリした');
        hands[ev.seat] = ev.hand.slice();
        const opened = s.opened.slice();
        opened[ev.seat] = true;
        const win: CnWin = { seat: ev.seat, from: null, winTile: ev.winTile, score, pays: cnTsumoPays(s, ev.seat, score) };
        if (bloodBattle(s.rules)) return cnLeave({ ...s, hands, opened }, [win], ev.seat);
        return finish({ ...s, hands, opened }, { type: 'cnWin', wins: [win] }, win.pays);
      }
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
      // 中国式の流局の精算（查叫・花豬・カンの収入を返す）があるルールなら、アガっていない人が親から順に手牌を開けて宣言する
      if (cnDrawSettles(s.rules)) return { ...s, phase: 'declare', turn: s.cnOut[s.dealer] ? nextActive(s, s.dealer) : s.dealer, drawn: [null, null, null, null] };
      // 精算の無いルール：アガった人かカンの収入があれば、それを入れた結果にする（点はもう動いている）
      if (s.rules?.family === 'cn' && (s.cnWins.length > 0 || s.cnKans.length > 0)) return cnFinish({ ...s, drawn: [null, null, null, null] }, true);
      if (s.rules?.family === 'cn') return finish({ ...s, drawn: [null, null, null, null] }, { type: 'exhaust', tenpai: [false, false, false, false], payments: [0, 0, 0, 0] }, [0, 0, 0, 0]);
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
      if (s.rules?.family === 'cn') return cnDeclare(s, ev);
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
  if ((c.cnRons?.length ?? 0) > 0) return settleCnRon(s0, c);
  // リーチの宣言牌が通った（ロンされなかった）ら、リーチ棒を出す
  const declaredNow = c.kind === 'discard' && s0.riichi[c.from] !== 'none' && s0.riichiAt[c.from] === s0.discards[c.from].length - 1 && !s0.riichiStick[c.from];
  const s = declaredNow && ronCount(c) === 0 ? depositRiichi(s0, c.from) : s0;
  if (c.rons.length === 0 && c.kind !== 'discard' && s.rules?.family === 'cn') {
    // 中国式：加槓を誰もロンしなかった＝カンが成り立つ（刮风下雨の 1 点は引いてすぐのときだけ）
    const paid = c.kind === 'kakan' ? cnKanIncome(s, c.from, 'kakan', !!c.fresh, null) : s;
    return { ...paid, phase: 'draw', turn: c.from, claim: null, rinshanDue: true };
  }
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
      return { ...s, phase: 'draw', turn: nextActive(s, c.from), claim: null };
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
  // 槍槓された加槓は無効の印（見た目はポンの形）
  const marked = c.kind === 'kakan' ? markRobbed(s, c.from, c.tile) : s;
  const result: RoundResult = { type: 'ron', from: c.from, winTile: c.tile, wins, ...robbed };
  return finish({ ...marked, claim: null }, result, ronSettlement(s, c.from, wins));
}

/**
 * 中国式の見逃し：ロンできた牌を見送った（鳴いた）ら覚える。
 * ルールの miss が nextDraw（四川）＝そのときの基本点／sameTile（香港）＝その牌の種類。
 * 手牌が見える局面でだけ分かる（本人の端末と全体の局面）
 */
function cnMissAfter(s: GameState, seat: Seat): Pick<GameState, 'cnMissed' | 'cnMissedKinds'> {
  const out = { cnMissed: s.cnMissed, cnMissedKinds: s.cnMissedKinds };
  const c = s.claim;
  const miss = s.rules?.family === 'cn' ? s.rules.values.miss : 'none';
  if (!c || (miss !== 'nextDraw' && miss !== 'sameTile')) return out;
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN)) return out;
  const score = cnScoreRon(s, seat, hand, c.tile);
  if (!score) return out;
  if (miss === 'nextDraw') {
    const cnMissed = s.cnMissed.slice();
    cnMissed[seat] = Math.max(cnMissed[seat] ?? 0, score.points);
    return { ...out, cnMissed };
  }
  const k = kindOf(c.tile);
  return { ...out, cnMissedKinds: s.cnMissedKinds.map((x, i) => (i === seat && !x.includes(k) ? [...x, k] : x)) };
}

/** 中国式のロンの決着：同じ牌で何人でもアガる（ルールの multiWin が all）／頭ハネ（atama＝切った人の下家に近い 1 人） */
function settleCnRon(s: GameState, c: Claim): GameState {
  const order = (seat: Seat) => (seat - c.from + 4) % 4;
  const rons = (c.cnRons ?? []).slice().sort((a, b) => order(a.seat) - order(b.seat));
  const v = s.rules?.family === 'cn' ? s.rules.values : null;
  const winners = v?.multiWin === 'atama' ? rons.slice(0, 1) : rons;
  const wins: CnWin[] = winners.map((r) => ({ seat: r.seat, from: c.from, winTile: c.tile, score: r.score, pays: cnRonPays(s, c, r.seat, r.score), ...(c.kind !== 'discard' ? { rob: true as const } : {}) }));
  // 杠上炮（MIL §8-4）：カンした人が直後の打牌で放銃したら、そのカン（最後のカン）の収入を返す
  if (c.kind === 'discard' && c.afterKan) {
    const i = s.cnKans.map((k) => k.seat).lastIndexOf(c.from);
    if (i >= 0) s = cnReturnKan(s, i);
  }
  // 抢杠（§10-8）：加槓の牌でロンされたカンは無効＝嶺上牌は引かない
  if (c.kind === 'kakan') s = { ...markRobbed(s, c.from, c.tile), robbedKans: s.robbedKans + 1 };
  // 血戦到底：次の番は、切った人から見て一番遠いアガった人の下家（間の人は飛ばされる）
  if (bloodBattle(s.rules)) return cnLeave({ ...s, claim: null }, wins, wins[wins.length - 1].seat);
  return finish({ ...s, claim: null }, { type: 'cnWin', wins }, sumPays(wins));
}

/**
 * 血戦到底（MIL §3-3）：アガった人は点を受け取って抜け、残りの人で続ける。点はその場で持ち点に足す。
 * 残りが 1 人になったら局を終える。続けるときは last（ツモはアガった人・ロンは切った人から一番遠いアガった人）の次の、抜けていない人がツモる
 */
function cnLeave(s: GameState, wins: readonly CnWin[], last: Seat): GameState {
  const pays = sumPays(wins);
  const scores = s.scores.map((p, i) => p + pays[i]);
  const cnOut = s.cnOut.slice();
  for (const w of wins) cnOut[w.seat] = true;
  const drawn = s.drawn.slice();
  for (const w of wins) drawn[w.seat] = null;
  const next: GameState = { ...s, scores, cnOut, drawn, cnWins: [...s.cnWins, ...wins], claim: null, rinshanDraw: false };
  if (cnOut.filter((o) => !o).length <= 1) return cnFinish(next, false);
  return { ...next, phase: 'draw', turn: nextActive(next, last) };
}

/** 血戦到底の局の終わり：この局のアガリを全部結果に入れる（点はアガったときに足してある＝ここでは足さない）。
 *  draw＝流局の精算（点は cnSettleDraw で足してある。点の動きには查叫と花豬の罰も入れる） */
function cnFinish(s: GameState, exhausted: boolean, draw?: CnDraw): GameState {
  const kans = [0, 1, 2, 3].map((i) => s.cnKans.reduce((a, k) => a + (k.returned ? 0 : k.pays[i]), 0));
  const settlement = sumPays(s.cnWins).map((n, i) => n + kans[i] + (draw ? draw.chajiao[i] + draw.pig[i] : 0));
  return { ...s, phase: 'ended', claim: null, result: { type: 'cnWin', wins: s.cnWins, ...(exhausted ? { exhausted } : {}), ...(draw ? { draw } : {}) }, settlement };
}

/** 中国式の流局で精算するルールか（查叫・花豬・カンの収入〔ノーテンなら返す＝§8-5〕のどれかがある） */
export function cnDrawSettles(rules: Rules | null): boolean {
  if (rules?.family !== 'cn') return false;
  const v = rules.values;
  return v.chajiao === 'on' || (v.huazhu === 'on' && queOn(rules)) || v.kanPay === 'on';
}

/**
 * 中国式の流局の宣言：手牌を必ず開ける（状態は開けた手牌から決まる＝どの端末でも同じ）。tenpai はテンパイか（開けた手牌と合わなければ止める）。
 * アガっていない人が全員言い終わったら精算する
 */
function cnDeclare(s: GameState, ev: Extract<GameEvent, { type: 'declare' }>): GameState {
  if (s.cnOut[ev.seat]) throw new Error('アガって抜けた人が流局の宣言をした');
  if (!ev.hand) throw new Error('中国式の流局で手牌を開けていない');
  const known = s.hands[ev.seat];
  if (!known.includes(HIDDEN) && !sameTiles(known, ev.hand)) throw new Error('開けた手牌が持っている牌と違う');
  if (known.length !== ev.hand.length) throw new Error('開けた手牌の枚数が違う');
  const hands = s.hands.map((h) => h.slice());
  hands[ev.seat] = ev.hand.slice();
  const opened = s.opened.slice();
  opened[ev.seat] = true;
  const next: GameState = { ...s, hands, opened };
  if ((cnDrawStateOf(next, ev.seat, ev.hand) === 'ready') !== ev.tenpai) throw new Error('開けた手牌と宣言（テンパイ・ノーテン）が合わない');
  const declared = s.declared.slice();
  declared[ev.seat] = ev.tenpai;
  const done = SEATS_.every((p) => s.cnOut[p] || declared[p] !== null);
  if (!done) return { ...next, declared, turn: nextActive(s, ev.seat) };
  return cnSettleDraw({ ...next, declared });
}

/** 流局のときの状態（開けた手牌から決まる）。捨てる色の牌が残っていれば花豬（huazhu が「なし」ならノーテン） */
export function cnDrawStateOf(s: GameState, seat: Seat, hand: readonly TileId[]): CnDrawState {
  if (queLeft(s, seat, hand)) return s.rules?.family === 'cn' && s.rules.values.huazhu === 'on' ? 'pig' : 'noten';
  return cnMaxPoints(s, seat, hand) !== null ? 'ready' : 'noten';
}

/**
 * 查叫の「理論上の最大点」（MIL §11-3・ルールの chajiaoPts）：待ちの牌ごとにアガったときの点を出し、一番高いもの。テンパイでなければ null。
 * ron＝ロンの基本点／tsumo＝ツモで各人が払う点（基本点＋1）。山が尽きたあとの判定なので、海底・杠上开花などの場面の番は数えない。
 * 自分の手と面子で 4 枚使っている牌は待ちに数えない（5 枚目は無い）
 */
export function cnMaxPoints(s: GameState, seat: Seat, hand: readonly TileId[]): number | null {
  if (!s.rules || s.rules.family !== 'cn' || queLeft(s, seat, hand)) return null;
  const counts = kindCounts(hand);
  const used = kindCounts([...hand, ...meldTiles(s, seat)]);
  const melds = s.melds[seat].map((m) => ({ kind: kindOf(m.tiles[0]), size: meldSize(m) }));
  const q = queOn(s.rules) ? (s.que[seat] ?? s.queHeldSuit[seat]) : null;
  const last = s.rules.values.honors === 'on' ? 34 : 27;
  let best: number | null = null;
  for (let k = 0; k < last; k++) {
    if (used[k] >= 4 || (q !== null && k < 27 && Math.floor(k / 9) === q)) continue;
    const concealed = counts.slice();
    concealed[k]++;
    const score = sichuanScore({ concealed, melds, haidi: false }, s.rules);
    if (!score) continue;
    const pts = s.rules.values.chajiaoPts === 'tsumo' ? score.points + 1 : score.points;
    if (best === null || pts > best) best = pts;
  }
  return best;
}

/**
 * 中国式の流局の精算（MIL §8-5・§11）。アガっていない人の状態ごとに：
 *  ① テンパイでない人（ノーテン・花豬）は、この局のカンの収入を全部返す（ルールの kanPay）
 *  ② 查叫：ノーテンの人がテンパイの人それぞれへ最大点を払う（ルールの chajiao。全員同じ状態なら誰も払わない＝§11-4）
 *  ③ 花豬：48 点を払い、誰も受け取らない（ルールの huazhu。全員花豬でも払う＝利用者 Q3=A）
 */
function cnSettleDraw(s0: GameState): GameState {
  if (s0.rules?.family !== 'cn') throw new Error('中国式でないのに流局の精算をした');
  const v = s0.rules.values;
  const states: (CnDrawState | null)[] = SEATS_.map((p) => (s0.cnOut[p] ? null : cnDrawStateOf(s0, p, s0.hands[p])));
  const maxPoints = SEATS_.map((p) => (states[p] === 'ready' ? cnMaxPoints(s0, p, s0.hands[p]) : null));
  let s = s0;
  const before = s.scores.slice();
  s0.cnKans.forEach((k, i) => {
    if (states[k.seat] === 'noten' || states[k.seat] === 'pig') s = cnReturnKan(s, i, true);
  });
  const kanReturn = s.scores.map((x, i) => x - before[i]);
  const chajiao = [0, 0, 0, 0];
  if (v.chajiao === 'on') {
    for (const n of SEATS_) {
      if (states[n] !== 'noten') continue;
      for (const r of SEATS_) {
        if (states[r] !== 'ready') continue;
        chajiao[n] -= maxPoints[r]!;
        chajiao[r] += maxPoints[r]!;
      }
    }
  }
  const pig = states.map((x) => (x === 'pig' && v.huazhu === 'on' ? -PIG_PENALTY : 0));
  const burned = -pig.reduce((a, b) => a + b, 0);
  const scores = s.scores.map((x, i) => x + chajiao[i] + pig[i]);
  const draw: CnDraw = { states, maxPoints, chajiao, pig, kanReturn };
  return cnFinish({ ...s, scores, cnBurned: s.cnBurned + burned }, true, draw);
}

/**
 * 刮风下雨（ルールの kanPay・MIL §8）：大明槓＝放銃者から 2 点／暗槓＝まだ抜けていない各人から 2 点／
 * 加槓＝まだ抜けていない各人から 1 点（4 枚目を引いてすぐカンしたときだけ）。点はその場で持ち点に足して、記録に残す
 */
function cnKanIncome(s: GameState, seat: Seat, kind: CnKan['kind'], fresh: boolean, from: Seat | null): GameState {
  if (s.rules?.family !== 'cn' || s.rules.values.kanPay !== 'on') return s;
  if (kind === 'kakan' && !fresh) return s;
  const pays = [0, 0, 0, 0];
  const take = (p: Seat, n: number) => {
    pays[p] -= n;
    pays[seat] += n;
  };
  if (kind === 'minkan' && from !== null) take(from, 2);
  else for (const p of SEATS_) if (p !== seat && !s.cnOut[p]) take(p, kind === 'ankan' ? 2 : 1);
  return { ...s, scores: s.scores.map((x, i) => x + pays[i]), cnKans: [...s.cnKans, { seat, kind, pays }] };
}

/** カンの収入を返す（記録に returned を付け、持ち点から戻す）。atDraw＝流局でテンパイでなかったから */
function cnReturnKan(s: GameState, i: number, atDraw = false): GameState {
  const k = s.cnKans[i];
  if (!k || k.returned) return s;
  const cnKans = s.cnKans.slice();
  cnKans[i] = { ...k, returned: true, ...(atDraw ? { atDraw } : {}) };
  return { ...s, cnKans, scores: s.scores.map((x, j) => x - k.pays[j]) };
}

/** 局を終える：結果を置き、点の動きを持ち点に足す。供託は、アガった人に渡した分（settlement に入れた分）だけ卓から消える */
function finish(s: GameState, result: RoundResult, settlement: number[]): GameState {
  const scores = s.scores.map((p, i) => p + settlement[i]);
  const taken = result.type === 'tsumo' || result.type === 'ron' ? s.kyotaku : 0;
  // 続けてアガった回数：アガった人の中に続けている人がいれば +1、いなければ最初にアガった人から数え直す。流局・途中流局で途切れる
  const winners = result.type === 'tsumo' ? [result.seat] : result.type === 'ron' ? result.wins.map((w) => w.seat) : [];
  const winStreak = winners.length === 0 ? null : s.winStreak && winners.includes(s.winStreak.seat) ? { seat: s.winStreak.seat, n: s.winStreak.n + 1 } : { seat: winners[0], n: 1 };
  return { ...s, phase: 'ended', result, settlement, scores, kyotaku: s.kyotaku - taken, winStreak };
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
  const cn = s.rules?.family === 'cn' ? s.rules.values : null;
  // 最後の捨て牌（河底）は鳴けない＝次のツモが無い（中国式はルールの lastTile が「できる」なら鳴ける）
  if (liveWallLeft(s) <= 0 && cn?.lastTile !== 'ok') return '山が尽きたあとの捨て牌は鳴けない';
  // カンは補充の牌（嶺上牌）が要る＝山が尽きたあとはできない（最後の 1 枚で鳴けるルールでもポンだけ）
  if (liveWallLeft(s) <= 0 && meld === 'kan') return '山が尽きたあとはカンできない';
  if (cn && meld === 'chi' && cn.chi !== 'on') return 'このルールではチーできない';
  // 缺一門で伏せておいた牌は、最初の打牌で切るまで使えない
  const held = s.queHeld[seat];
  if (held !== null && held !== HIDDEN && tiles.includes(held)) return '伏せておいた牌（缺一門）は鳴きに使えない';
  // 捨てる色の牌は鳴けない（鳴くとその局はアガれなくなる＝利用者 2026-10-12 Q1=B。原典に条文なし）。伏せた色は本人の端末でだけ分かる
  if (queOn(s.rules)) {
    const q = s.que[seat] ?? s.queHeldSuit[seat];
    if (q !== null && q !== HIDDEN && suitOf(c.tile) === q) return '捨てる色の牌は鳴けない（缺一門）';
  }
  if (meld === 'kan' && !cn && s.kans >= MAX_KANS) return 'カンは 1 局 4 回まで';
  const need = meld === 'kan' ? 3 : 2;
  if (tiles.length !== need) return `${meld === 'kan' ? 'カン' : '鳴く'}には手牌から ${need} 枚出す`;
  if (new Set(tiles).size !== tiles.length) return '同じ牌を 2 回出した';
  const hand = s.hands[seat];
  if (!hand.includes(HIDDEN) && !tiles.every((t) => hand.includes(t))) return '持っていない牌で鳴こうとした';
  const k = kindOf(c.tile);
  const ks = tiles.map(kindOf);
  if (meld === 'kan') return ks.every((x) => x === k) ? followProblem(s, seat, meld, tiles) : 'カンは同じ牌 4 枚';
  if (meld === 'pon') {
    if (!ks.every((x) => x === k)) return 'ポンは同じ牌 3 枚';
  } else {
    if (seat !== nextSeat(c.from)) return 'チーは上家の捨て牌だけ';
    const all = [k, ...ks].sort((a, b) => a - b);
    const suit = Math.floor(all[0] / 9);
    if (all[0] >= 27 || Math.floor(all[2] / 9) !== suit || all[1] !== all[0] + 1 || all[2] !== all[0] + 2) return 'チーは同じ色の続いた 3 枚';
  }
  // 喰い替え禁止のルールで、鳴いたあと切れる牌が 1 枚も無いなら鳴けない
  if (kuikaeNg(s.rules) && !hand.includes(HIDDEN)) {
    const ban = kuikaeKinds(meld, c.tile, tiles);
    const rest = hand.filter((t) => !tiles.includes(t));
    if (rest.every((t) => ban.includes(kindOf(t)))) return '鳴いたあと切れる牌が無い（喰い替え禁止）';
  }
  return followProblem(s, seat, meld, tiles);
}

/** 香港の鳴牌禁例：見送った牌・自分が切った牌と同じ種類（跟張）を、自分が引く前に鳴いて包牌が生じるなら鳴けない */
function followProblem(s: GameState, seat: Seat, meld: 'chi' | 'pon' | 'kan', tiles: readonly TileId[]): string | null {
  const c = s.claim;
  if (!c || s.rules?.family !== 'cn' || s.rules.values.baopai !== 'on' || !s.cnFollowKinds[seat].includes(kindOf(c.tile))) return null;
  const after: OpenMeld[] = [...s.melds[seat], { type: meld === 'kan' ? 'minkan' : meld, tiles: [...tiles, c.tile], called: c.tile, from: c.from }];
  return paoFromCall(s, after, c.from) ? '包牌が生じる跟張は鳴けない（鳴牌禁例）' : null;
}

/** 跟張の種類を足す（香港の包牌のルールだけ） */
function addFollow(list: readonly number[][], seat: Seat, k: number): number[][] {
  return list.map((x, i) => (i === seat && !x.includes(k) ? [...x, k] : x));
}

/** 切られた牌をポン・チーできたか（包牌の有無・跟張の縛りは見ない）。香港の包牌のルールで、手牌が見える局面だけ */
function couldCall(s: GameState, seat: Seat): boolean {
  const c = s.claim;
  const cn = s.rules?.family === 'cn' ? s.rules.values : null;
  if (!c || c.kind !== 'discard' || cn?.baopai !== 'on') return false;
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN)) return false;
  const k = kindOf(c.tile);
  const n = (x: number) => hand.filter((t) => kindOf(t) === x).length;
  if (n(k) >= 2) return true;
  if (cn.chi !== 'on' || seat !== nextSeat(c.from) || k >= 27) return false;
  const p = k % 9;
  return (p >= 2 && n(k - 2) > 0 && n(k - 1) > 0) || (p >= 1 && p <= 7 && n(k - 1) > 0 && n(k + 1) > 0) || (p <= 6 && n(k + 1) > 0 && n(k + 2) > 0);
}

/**
 * 自分の番のカン（暗槓・加槓）がおかしければ理由を返す（無ければ null）。手牌が見える局面では持っている牌かも確かめる。
 * リーチのあとの暗槓は、ルールが許し、ツモった牌を使い、待ちが変わらない（条件が「刻子としか読めない形」ならそれも）ときだけ
 */
export function kanProblem(s: GameState, seat: Seat, kan: 'ankan' | 'kakan', tiles: readonly TileId[]): string | null {
  if (s.rules?.family === 'jp' && s.kans >= MAX_KANS) return 'カンは 1 局 4 回まで';
  // 中国式：伏せた牌（缺一門）は使えない・捨てる色の牌はカンできない（鳴きと同じ＝利用者 2026-10-12 Q1=B の考え方）
  if (s.rules?.family === 'cn') {
    const held = s.queHeld[seat];
    if (held !== null && held !== HIDDEN && tiles.includes(held)) return '伏せておいた牌（缺一門）はカンに使えない';
    const q = s.que[seat] ?? s.queHeldSuit[seat];
    if (queOn(s.rules) && q !== null && q !== HIDDEN && tiles.length > 0 && suitOf(tiles[0]) === q) return '捨てる色の牌はカンできない（缺一門）';
  }
  // 最後のツモ（海底）のあとはカンできない＝嶺上牌を引いたあとの山が無い
  if (liveWallLeft(s) <= 0) return '山が尽きたあとはカンできない';
  if (tiles.length === 0) return 'カンに出す牌が無い';
  if (new Set(tiles).size !== tiles.length) return '同じ牌を 2 回出した';
  // チー・ポンの直後（ツモっていない＝drawn が null）は、1 枚切るまでカンできない（利用者 2026-10-11 Q3=A）
  if (s.phase === 'discard' && s.turn === seat && s.drawn[seat] === null) return '鳴いた直後は、切る前にカンできない';
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
/** 喰い替え禁止のルールか（日本式の kuikae・中国式の kuikae＝香港の「食換」。2026-10-13 利用者 Q2=A で中国式にも項目を足した） */
export const kuikaeNg = (rules: Rules | null): boolean => rules?.values.kuikae === 'ng';

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
  // 日本式は最初に決まった包が残る。香港は後から成立したほうだけ（包後不包先＝原典 得分授受法 3）
  if (p && (!pao[call.seat] || s.rules?.family === 'cn')) pao[call.seat] = p;
  const calledAway = s.calledAway.map((x) => x.slice());
  calledAway[c.from].push(s.discards[c.from].length - 1);
  const v = s.rules?.family === 'jp' ? s.rules.values : null;
  const kanDora = kan && v?.kandora === 'on';
  // 刮风下雨：大明槓は放銃者から 2 点（ポン・チーでは動かない）
  const base: GameState = kan ? cnKanIncome(s, call.seat, 'minkan', false, c.from) : s;
  return {
    ...base,
    kuikaeBan: !kan && call.meld !== 'kan' && kuikaeNg(s.rules) ? kuikaeKinds(call.meld, c.tile, call.tiles) : [],
    phase: kan ? 'draw' : 'discard',
    rinshanDue: kan,
    kanChain: kan ? 1 : 0,
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
export function paoFromCall(s: GameState, melds: readonly OpenMeld[], from: Seat): Pao | null {
  // 香港の包牌（ルールの baopai）：大三元包＝3 組目の三元牌の刻子・槓子を鳴かせた人／十二章包＝4 組目の面子を鳴かせた人
  // （4 組目・3 組目が暗槓なら包なし＝暗槓は鳴きでないのでここを通らない。原典 得分授受法 2）
  const cv = s.rules?.family === 'cn' ? s.rules.values : null;
  if (cv) {
    if (cv.baopai !== 'on') return null;
    const last = melds[melds.length - 1];
    const dragon = (m: OpenMeld) => m.type !== 'chi' && kindOf(m.tiles[0]) >= 31;
    if (dragon(last) && melds.filter(dragon).length === 3) return { seat: from, yaku: 'dragons' };
    if (melds.length === 4) return { seat: from, yaku: 'twelve' };
    return null;
  }
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
/** サイコロの目の合計を、振った人＝1 として下家の向きへ数える（5・9 は振った人、2・6・10 は下家、3・7・11 は対面、4・8・12 は上家） */
export const dealerByDice = (by: Seat, dice: readonly [number, number]): Seat => ((by + dice[0] + dice[1] - 1) % 4) as Seat;

export const seatWindOf = (s: GameState, seat: Seat): number => 27 + ((seat - s.dealer + 4) % 4);
/** 場風。東場の 4 局のあとが南場（局の進め方は段階4で決める） */
export const roundWindOf = (s: GameState): number => 27 + (Math.floor(Math.max(0, s.roundIndex) / 4) % 4);

/**
 * 後付けが「なし」＝片アガリ禁止（Q34＝A・2026-10-11）：鳴いている手（暗槓だけは門前のまま）は、
 * 待ちのどの牌でアガっても役が付くときだけアガれる。ほかの待ちも同じ状況（ツモかロンか・海底など）で数える
 */
const katagariBanned = (s: GameState, seat: Seat) =>
  s.rules?.family === 'jp' && s.rules.values.atozuke === 'off' && s.melds[seat].some((m) => m.type !== 'ankan');

/** アガった牌以外の待ちにも、全部役が付くか（hand＝アガリ牌を除いた手の中の牌。待ちの牌は種類の 1 枚目の背番号で試す） */
function everyWaitHasYaku(hand: readonly TileId[], winTile: TileId, hasYaku: (w: TileId) => boolean): boolean {
  return waitKinds(hand).every((k) => k === kindOf(winTile) || hasYaku(k * 4));
}

/** このアガリで、同じ人が続けてアガった回数（このアガリを含む） */
const streakOf = (s: GameState, seat: Seat) => (s.winStreak?.seat === seat ? s.winStreak.n : 0) + 1;

/**
 * ツモアガリしたときの点数（ツモって切る前の局面で呼ぶ）。役が無ければ null。
 * 見える局面からでも全体の局面からでも同じ答えになるよう、手牌と ura は引数で受け取る。
 */
export function scoreTsumo(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
  const r = tsumoScore(s, seat, hand, winTile, ura);
  if (!r || !katagariBanned(s, seat)) return r;
  const i = hand.indexOf(winTile);
  const rest = hand.filter((_, j) => j !== i);
  return everyWaitHasYaku(rest, winTile, (w) => tsumoScore(s, seat, [...rest, w], w) !== null) ? r : null;
}

function tsumoScore(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
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
      streak: streakOf(s, seat),
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
  const r = ronScore(s, seat, hand, winTile, ura);
  if (!r || !katagariBanned(s, seat)) return r;
  return everyWaitHasYaku(hand, winTile, (w) => ronScore(s, seat, hand, w) !== null) ? r : null;
}

function ronScore(s: GameState, seat: Seat, hand: readonly TileId[], winTile: TileId, ura: readonly TileId[] = []): ScoreResult | null {
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
      // 人和：子が最初のツモの前（自分の河が空・鳴きが無い）にロン
      jinho: seat !== s.dealer && s.discards[seat].length === 0 && !s.anyCall,
      // 燕返し：切った人のリーチ宣言牌
      tsubame: kind === 'discard' && s.claim !== null && s.riichi[s.claim.from] !== 'none' && s.riichiAt[s.claim.from] === s.discards[s.claim.from].length - 1,
      kanburi: kind === 'discard' && !!s.claim?.afterKan,
      streak: streakOf(s, seat),
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

// ---- 中国式のアガリ（段階9の手順2） ----

/** 缺一門で、捨てる色の牌がまだ手・面子に残っているか（手牌が見えない局面・捨てる色の分からない局面では false） */
function queLeft(s: GameState, seat: Seat, tiles: readonly TileId[]): boolean {
  if (!queOn(s.rules)) return false;
  const q = s.que[seat] ?? s.queHeldSuit[seat];
  if (q === null || q === HIDDEN) return false;
  return [...tiles, ...meldTiles(s, seat)].some((t) => suitOf(t) === q);
}

/**
 * 中国式のアガリの点（形と番だけ。全員に見えるものから出す＝どの端末でも同じ）。アガリの形でなければ null。
 * 番の数え方はルールの scoring（四川＝sichuan.ts／香港＝hongkong.ts）。番がルールの minFan に届かなければアガれない（香港の三番起糊）
 */
function cnScoreOf(s: GameState, seat: Seat, tiles: readonly TileId[], how: 'tsumo' | 'ron'): CnScore | null {
  if (!s.rules || s.rules.family !== 'cn') return null;
  const v = s.rules.values;
  const kind = s.claim?.kind ?? 'discard';
  const last = liveWallLeft(s) === 0;
  let score: CnScore | null;
  if (v.scoring === 'hk') {
    const winTile = how === 'tsumo' ? s.drawn[seat] : (s.claim?.tile ?? null);
    const quiet = s.melds.every((m) => m.length === 0);
    score = hongkongScore(
      {
        concealed: kindCounts(tiles),
        melds: s.melds[seat].map((m) => ({
          kind: Math.min(...m.tiles.map(kindOf)),
          // 槍槓で無効になった加槓はポンに数える
          type: m.type === 'chi' ? 'chi' : m.type === 'pon' || m.robbed ? 'pon' : 'kan',
          concealed: m.type === 'ankan',
        })),
        winTile: winTile === null || winTile === HIDDEN ? -1 : kindOf(winTile),
        tsumo: how === 'tsumo',
        seatWind: 27 + ((seat - s.dealer + 4) % 4),
        roundWind: 27 + (Math.floor(Math.max(0, s.roundIndex) / 4) % 4),
        // 海底：最後の 1 枚のツモ（ルールの haitei が both なら最後の捨て牌へのロンも）
        haidi: last && (how === 'tsumo' || (v.haitei === 'both' && kind === 'discard')),
        gangkai: how === 'tsumo' && s.rinshanDraw,
        kanChain: s.kanChain,
        qianggang: how === 'ron' && (kind === 'kakan' || kind === 'ankan'),
        // 天糊：親が配牌のままツモ（暗槓のあとは数えない）／地糊：子が配牌の 13 枚のまま、親の最初の捨て牌でロン（親が暗槓していたら数えない）
        tianhu: how === 'tsumo' && seat === s.dealer && quiet && s.discards.every((d) => d.length === 0),
        dihu: how === 'ron' && seat !== s.dealer && kind === 'discard' && s.claim?.from === s.dealer && quiet && s.discards.every((d, i) => d.length === (i === s.dealer ? 1 : 0)),
      },
      s.rules,
    );
  } else {
    const melds = s.melds[seat].map((m) => ({ kind: kindOf(m.tiles[0]), size: meldSize(m) }));
    score = sichuanScore(
      {
        concealed: kindCounts(tiles),
        melds,
        // 海底：最後の 1 枚のツモ・最後の捨て牌でのロン（加槓の牌へのロンは捨て牌でない）
        haidi: last && (how === 'tsumo' || kind === 'discard'),
        gangkai: how === 'tsumo' && s.rinshanDraw,
        gangpao: how === 'ron' && kind === 'discard' && !!s.claim?.afterKan,
        qianggang: how === 'ron' && kind === 'kakan',
      },
      s.rules,
    );
  }
  if (score && score.fan < Number(v.minFan)) return null;
  return score;
}

/** 中国式のツモアガリ（ツモって切る前の局面）。アガれなければ null。捨てる色が残っていればアガれない（手牌が見える局面で確かめる） */
export function cnScoreTsumo(s: GameState, seat: Seat, hand: readonly TileId[]): CnScore | null {
  if (queLeft(s, seat, hand)) return null;
  return cnScoreOf(s, seat, hand, 'tsumo');
}

/** 中国式のロン（切られた牌に返事をしている局面）。hand は 13 枚。ルールがツモだけならロンできない。見逃しの縛りは cnRonBlocked */
export function cnScoreRon(s: GameState, seat: Seat, hand: readonly TileId[], tile: TileId): CnScore | null {
  if (!s.rules || s.rules.family !== 'cn' || s.rules.values.ron !== 'ok') return null;
  // 加槓の牌へのロン（抢杠）はルールの chankan が「あり」のときだけ。暗槓の牌へのロンは十三么九だけ（ルールの kokushi13）
  if (s.claim?.kind === 'ankan' && s.rules.values.kokushi13 !== 'on') return null;
  if (s.claim?.kind === 'kakan' && s.rules.values.chankan !== 'on') return null;
  const tiles = [...hand, tile];
  if (queLeft(s, seat, tiles)) return null;
  const score = cnScoreOf(s, seat, tiles, 'ron');
  if (score && s.claim?.kind === 'ankan' && !isThirteenOrphans(kindCounts(tiles))) return null;
  return score;
}

/**
 * 見逃しの縛り：nextDraw（四川）＝見送ったときより点が上がらなければロンできない（MIL §3-4）／
 * sameTile（香港）＝見送った牌と同じ種類ではロンできない（食糊 6「同巡內不能食跟張牌」）。どちらも自分が引けば解ける
 */
export function cnRonBlocked(s: GameState, seat: Seat, score: CnScore): boolean {
  const missed = s.cnMissed[seat];
  if (missed !== null && score.points <= missed) return true;
  const tile = s.claim?.tile;
  return tile !== undefined && tile !== HIDDEN && s.cnMissedKinds[seat].includes(kindOf(tile));
}

/**
 * 中国式のツモの払い（ルールの pay）。
 * 四川：まだアガっていない人がそれぞれ（基本点＋1）／香港：3 人が出銃の点の半分ずつ（得分授受法）。香港の包牌が成立していれば包の人が 3 人分
 */
function cnTsumoPays(s: GameState, seat: Seat, score: CnScore): number[] {
  const out = [0, 0, 0, 0];
  const hk = s.rules?.family === 'cn' && s.rules.values.pay === 'hk';
  const each = hk ? score.points / 2 : score.points + 1;
  // 香港の包牌：包の人が 3 人分を 1 人で払う
  const bao = hk ? s.pao[seat] : null;
  if (bao) {
    out[bao.seat] -= each * 3;
    out[seat] += each * 3;
    return out;
  }
  for (const p of SEATS_) {
    if (p === seat || s.cnOut[p]) continue;
    out[p] -= each;
    out[seat] += each;
  }
  return out;
}

/**
 * 中国式のロンの払い：放銃者が払う（四川＝基本点／香港＝出銃の点＝全銃）。
 * 香港の搶槓（加槓・十三么九の暗槓へのロン）はツモと同じ額（3 人分）をカンした人が 1 人で払う（搶槓當自摸）
 */
function cnRonPays(s: GameState, c: Claim, seat: Seat, score: CnScore): number[] {
  const out = [0, 0, 0, 0];
  const hk = s.rules?.family === 'cn' && s.rules.values.pay === 'hk';
  const amount = hk && c.kind !== 'discard' ? (score.points / 2) * 3 : score.points;
  out[c.from] -= amount;
  out[seat] += amount;
  return out;
}

const sumPays = (wins: readonly CnWin[]) => [0, 1, 2, 3].map((i) => wins.reduce((a, w) => a + w.pays[i], 0));

export function replay(log: readonly Envelope[]): GameState {
  return log.reduce(apply, initialState());
}

/** その席から見える局面（他の人の手牌・山の並びは伏せたまま） */
export function viewFor(log: readonly Envelope[], viewer: Seat): GameState {
  return replay(log.map((e) => mask(e, viewer)));
}

export const isHidden = (t: TileId) => t === HIDDEN;
