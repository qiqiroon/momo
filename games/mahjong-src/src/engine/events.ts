// 出来事（イベント）の型。対局は「出来事の列」で持ち、局面は列の頭から順に当てはめて作る。
// 同じ列からは、誰の端末でも必ず同じ局面ができる（オンライン・牌譜の再生・復帰がこの1本に乗る）。
//
// 出来事には「誰に見えるか」を付ける。見えない人には、中身を伏せた形（HIDDEN）で渡す。
// 伏せても列から抜かない＝通し番号が飛ばないので、取りこぼしに気づける（仕様書 §9.2）。

import type { GameEndReason } from './game';
import type { Rules } from './rules';
import type { TileId } from './tiles';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** 中身の分からない牌。他の人の手牌・まだ引いていない山の牌 */
export const HIDDEN = -1;

/** 換三張で渡す向き（next 下家へ／prev 上家へ／across 対面へ） */
export type Huan3Dir = 'next' | 'prev' | 'across';

/** 'all'＝全員／配列＝その席だけ（空の配列＝誰の画面にも出さない。山の種など、全部を持つ端末だけが知る） */
export type Visibility = 'all' | readonly Seat[];

export type GameEvent =
  | { type: 'gameStart'; rules: Rules }
  /** 親決め（訂正26100917）：仮親 by がサイコロを 2 つ振り、目の合計を仮親＝1 として下家の向きへ数えた人が起家 dealer */
  | { type: 'dealerDice'; by: Seat; dice: [number, number]; dealer: Seat }
  /** 局の始まり。honba＝この局の本場の数（局の進め方が決める・段階4の 2） */
  | { type: 'roundStart'; roundIndex: number; dealer: Seat; honba?: number }
  /** 山の種。局の終わりまで誰にも見せない */
  | { type: 'wallSeed'; seed: string | null }
  /** 配牌。本人だけに見える */
  | { type: 'deal'; seat: Seat; tiles: readonly TileId[] }
  /** ドラ表示牌をめくる。全員に見える（配り終えたとき・カンのあと。めくる時機はルールの kandoraWhen） */
  | { type: 'doraReveal'; tile: TileId }
  /** ツモ。本人だけに見える。rinshan＝カンのあとの補充（王牌の嶺上牌から引く） */
  | { type: 'draw'; seat: Seat; tile: TileId; rinshan?: boolean; flower?: boolean }
  /** 花牌を表にして脇に置く（中国式・ルールの flower）。全員に見える。このあと同じ席が補充の牌を引く（draw の flower）。
   *  配り終えたあと（局面が deal）は親から順に、局の途中は引いた牌が花牌だったとき。国標 第五条二十・第六条五(六) */
  | { type: 'flower'; seat: Seat; tile: TileId }
  /** 配り終えたあとの補花で、手に花牌がもう無い（親から順に 1 人ずつ。全員に見える）。オンラインでは本人しか手牌を知らないので本人が出す */
  | { type: 'buhuaDone'; seat: Seat }
  /** 打牌。全員に見える。tsumogiri＝引いた牌をそのまま切った。riichi＝この牌でリーチを宣言した（横に曲げて置く）。
   *  que＝缺一門の宣言（その人の最初の打牌だけ。伏せておいた牌を切り、捨てる色 0 萬・1 筒・2 索を全員に明かす） */
  | { type: 'discard'; seat: Seat; tile: TileId; tsumogiri: boolean; riichi?: boolean; que?: number }
  /** 缺一門（中国式・四川）：捨てる色の牌を 1 枚伏せて置く。本人だけに見える（ほかの人には「伏せた」ことだけ）。
   *  suit＝捨てる色（ふつうは伏せた牌の色。手牌にその色が 1 枚も無い色なら、伏せた牌と違う色でもよい＝MIL §5） */
  | { type: 'queHold'; seat: Seat; tile: TileId; suit: number }
  /** 換三張（中国式・ルールの huan3＝MOMO の設定）：同じ色の牌 3 枚を伏せて出す。本人だけに見える（ほかの人には「出した」ことだけ） */
  | { type: 'huan3Pass'; seat: Seat; tiles: readonly TileId[] }
  /** 換三張：4 人とも出したら、サイコロ 2 つで渡す向きを決める。全員に見える。dir＝next 下家へ／prev 上家へ／across 対面へ */
  | { type: 'huan3Swap'; dice: [number, number]; dir: Huan3Dir }
  /** 換三張：受け取る 3 枚。本人だけに見える */
  | { type: 'huan3Take'; seat: Seat; tiles: readonly TileId[] }
  /** ツモアガリ。全員に見える。手牌（14 枚）とアガリ牌（ツモった牌）を開ける。
   *  ura＝めくった裏ドラ表示牌（リーチでアガったときだけ。ドラ表示牌の真下を同じ枚数） */
  | { type: 'tsumo'; seat: Seat; hand: readonly TileId[]; winTile: TileId; ura: readonly TileId[] }
  /** 切られた牌への返事「見送る」。全員に見える（オンラインでは、ロンできない人の端末も自動でこれを返す＝誰が迷ったか漏れない） */
  | { type: 'pass'; seat: Seat }
  /** 切られた牌への返事「チー」「ポン」「カン（大明槓）」。全員に見える。tiles＝手牌から出す 2 枚（カンは 3 枚。切られた牌と合わせて面子になる）。
   *  返事がそろったとき、ロンが無く、優先順位（ポン・カン＞チー）で勝てば鳴ける */
  | { type: 'call'; seat: Seat; meld: 'chi' | 'pon' | 'kan'; tiles: readonly TileId[] }
  /** 自分の番のカン。全員に見える。ankan＝暗槓（手牌から 4 枚）／kakan＝加槓（ポンした面子に手牌から 1 枚足す）。
   *  加槓は、ほかの 3 人の返事（槍槓のロン・見送る）を待ってから嶺上牌を引く。暗槓も国士無双のロンがあり得るルールなら待つ。
   *  fresh＝中国式の加槓で、4 枚目を引いてすぐカンした（刮风下雨の 1 点はそのときだけ。引いた牌は本人にしか見えないので印で渡す） */
  | { type: 'kan'; seat: Seat; kan: 'ankan' | 'kakan'; tiles: readonly TileId[]; fresh?: boolean }
  /** 切られた牌への返事「ロン」。全員に見える。手牌（13 枚）を開ける。ura＝めくった裏ドラ表示牌（リーチしているときだけ） */
  | { type: 'ron'; seat: Seat; hand: readonly TileId[]; ura: readonly TileId[] }
  /** 九種九牌で流す。全員に見える。手牌（14 枚）を開ける */
  | { type: 'kyushu'; seat: Seat; hand: readonly TileId[] }
  /** 山が尽きて流局。全員に見える。このあと親から順にテンパイかノーテンかを宣言する */
  | { type: 'exhaust' }
  /** オーラスでトップの親が、やめるか（stop）続けるかを選んだ。全員に見える（ルールが「本人が選ぶ」のとき） */
  | { type: 'yame'; seat: Seat; stop: boolean }
  /** 対局の終わり。全員に見える。reason は局の進め方（game.ts の nextStep）と同じでなければ止める */
  | { type: 'gameEnd'; reason: GameEndReason }
  /** 流局したときの宣言。全員に見える。テンパイなら手牌（13 枚）を開ける（ノーテンなら null） */
  | { type: 'declare'; seat: Seat; tenpai: boolean; hand: readonly TileId[] | null };

export interface Envelope {
  /** 通し番号（0 から） */
  seq: number;
  to: Visibility;
  ev: GameEvent;
}

export function canSee(to: Visibility, viewer: Seat): boolean {
  return to === 'all' || to.includes(viewer);
}

/** 見えない人に渡すときの、中身を伏せた形 */
export function mask(env: Envelope, viewer: Seat): Envelope {
  if (canSee(env.to, viewer)) return env;
  const ev = env.ev;
  switch (ev.type) {
    case 'wallSeed':
      return { ...env, ev: { ...ev, seed: null } };
    case 'deal':
      return { ...env, ev: { ...ev, tiles: ev.tiles.map(() => HIDDEN) } };
    case 'draw':
      return { ...env, ev: { ...ev, tile: HIDDEN } };
    case 'queHold':
      return { ...env, ev: { ...ev, tile: HIDDEN, suit: HIDDEN } };
    case 'huan3Pass':
    case 'huan3Take':
      return { ...env, ev: { ...ev, tiles: ev.tiles.map(() => HIDDEN) } };
    default:
      return env;
  }
}
