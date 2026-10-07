// 出来事（イベント）の型。対局は「出来事の列」で持ち、局面は列の頭から順に当てはめて作る。
// 同じ列からは、誰の端末でも必ず同じ局面ができる（オンライン・牌譜の再生・復帰がこの1本に乗る）。
//
// 出来事には「誰に見えるか」を付ける。見えない人には、中身を伏せた形（HIDDEN）で渡す。
// 伏せても列から抜かない＝通し番号が飛ばないので、取りこぼしに気づける（仕様書 §9.2）。

import type { Rules } from './rules';
import type { TileId } from './tiles';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

/** 中身の分からない牌。他の人の手牌・まだ引いていない山の牌 */
export const HIDDEN = -1;

/** 'all'＝全員／配列＝その席だけ（空の配列＝誰の画面にも出さない。山の種など、全部を持つ端末だけが知る） */
export type Visibility = 'all' | readonly Seat[];

export type GameEvent =
  | { type: 'gameStart'; rules: Rules }
  | { type: 'roundStart'; roundIndex: number; dealer: Seat }
  /** 山の種。局の終わりまで誰にも見せない */
  | { type: 'wallSeed'; seed: string | null }
  /** 配牌。本人だけに見える */
  | { type: 'deal'; seat: Seat; tiles: readonly TileId[] }
  /** ドラ表示牌をめくる。全員に見える（配り終えたとき。段階3でカンのたびにも） */
  | { type: 'doraReveal'; tile: TileId }
  /** ツモ。本人だけに見える */
  | { type: 'draw'; seat: Seat; tile: TileId }
  /** 打牌。全員に見える。tsumogiri＝引いた牌をそのまま切った。riichi＝この牌でリーチを宣言した（横に曲げて置く） */
  | { type: 'discard'; seat: Seat; tile: TileId; tsumogiri: boolean; riichi?: boolean }
  /** ツモアガリ。全員に見える。手牌（14 枚）とアガリ牌（ツモった牌）を開ける。
   *  ura＝めくった裏ドラ表示牌（リーチでアガったときだけ。ドラ表示牌の真下を同じ枚数） */
  | { type: 'tsumo'; seat: Seat; hand: readonly TileId[]; winTile: TileId; ura: readonly TileId[] }
  /** 山が尽きて流局。全員に見える。このあと親から順にテンパイかノーテンかを宣言する */
  | { type: 'exhaust' }
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
    default:
      return env;
  }
}
