/**
 * 駒得の評価 (Phase 3・親 §7.3.1 第1段階)。
 *
 * 「いまの盤面は手番側にとってどれくらい良いか」を 1 つの数にする。中身は駒の値打ちの
 * 足し算 (自分の駒 − 相手の駒) で、これが第1段階の本体。
 *
 * **既存の駒の強さの表 (core/engine/piece-strength.ts) は使わない**。あちらは持ち駒台の
 * 並べ替え用で「数値の絶対値は他で参照しないこと」と明記されているため、評価用の値打ちは
 * ここに別に持つ。
 *
 * 値は歩を 100 とした将棋の一般的な目安。持ち駒は盤上より少し高く見る (どこへでも打てる
 * ぶん働きが良いため)。
 *
 * 量子モードでは駒の正体が決まっていないので、見えている駒種 (初期の駒種) で数える近似に
 * なる。第1段階の割り切りで、候補集合を使った本来の見積り (情報集合サンプリング) は
 * 親 §7.3 の汎用 MCTS 側の仕事。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Player } from '../../core/engine/mgf/types';
import type { Position } from '../../core/engine/position/types';

/** 駒の値打ち (歩 = 100)。未知の駒種は UNKNOWN_VALUE。 */
export const PIECE_VALUE: Record<string, number> = {
  fu: 100,
  kyo: 430,
  kei: 450,
  gin: 640,
  kin: 690,
  kaku: 890,
  hi: 1040,
  to: 600,
  narikyo: 600,
  narikei: 600,
  narigin: 600,
  uma: 1150,
  ryu: 1300,
  ou: 20000,
  gyoku: 20000,
};

/** 表に無い駒種 (カスタムルールの独自駒) の暫定値。 */
export const UNKNOWN_VALUE = 400;

/** 持ち駒の割増し (打てるぶん働きが良い)。 */
const HAND_BONUS = 1.1;

/** 詰みの値。深さで差を付けるので実際の上限より十分小さく取る。 */
export const MATE_VALUE = 900000;

export function valueOf(kind: string): number {
  return PIECE_VALUE[kind] ?? UNKNOWN_VALUE;
}

/**
 * 前進の微加点。駒得だけだと序盤はどの手も同点になり、指し手が意味なく揺れる。
 * **勝ち負けを決める要素ではなく同点崩し**なので、歩 1 枚の 1/10 以下に収める。
 */
function advanceBonus(owner: Player, row: number, height: number, kind: string): number {
  if (kind === 'ou' || kind === 'gyoku') return 0;
  // player1 は上 (row 小) が敵陣。進んだぶんだけ小さく加点する。
  const advanced = owner === 'player1' ? height - 1 - row : row;
  return advanced * 3;
}

/**
 * 局面の評価。**手番側から見た点数**を返す (大きいほど手番側が良い)。
 */
export function evaluate(mgf: Mgf, position: Position): number {
  void mgf;
  let p1 = 0;
  let p2 = 0;
  const height = position.height;

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const piece = position.board[row][col];
      if (!piece) continue;
      const v = valueOf(piece.kind) + advanceBonus(piece.owner, row, height, piece.kind);
      if (piece.owner === 'player1') p1 += v;
      else p2 += v;
    }
  }

  for (const piece of position.hands.player1) {
    p1 += valueOf(piece.kind) * HAND_BONUS;
  }
  for (const piece of position.hands.player2) {
    p2 += valueOf(piece.kind) * HAND_BONUS;
  }

  const diff = p1 - p2;
  return position.sideToMove === 'player1' ? diff : -diff;
}
