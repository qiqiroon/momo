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
 * ## v1.49 (ユーザー判断 2026-08-18): 量子モードは候補から値打ちを引く
 *
 * v1.48 まではここも `piece.kind` (**対局開始時にそのマスに置かれていた駒種**＝名札) で
 * 値打ちを引いていた。名札は正体ではないので、量子モードでは **盤上の駒も持ち駒も全部**
 * 実態と違う値で数えていた。**名札は正体が判明しても書き換わらない**ので、候補が 1 つに
 * 絞れて「この駒は桂だ」と確定した後も金として数え続けていた (2026-08-18 実測)。
 * 「見えている駒種で数える近似」と書かれていたが、**名札は画面に出ていない** (盤に出るのは
 * 候補の顔) ので、近似としても成り立っていなかった。
 *
 * **候補のうちいちばん強いものを、その駒の値打ちとする** (ユーザー判断)。
 *
 * **ただし王は候補から外す**。対局開始時は 20 枚すべてが 8 駒種すべてを候補に持つ
 * (2026-08-18 実測) ので、王を混ぜて最強を採ると **どの駒も 20000 点**になり、
 * 両者同点のまま駒の損得が一切見えなくなる。王は両者 1 枚ずつで取られることも無く、
 * 足しても引いても打ち消し合うだけなので、**量子モードでは材料に数えない**。
 * 通常将棋モードは従来どおり (王 20000 のまま・両者で打ち消し合う) ＝縮退互換。
 *
 * **強さを求めるための評価方法そのもの (候補の広さをどう見るか等) は別途議論する**
 * ＝引き継ぎ資料の申し送り。本版は「名札をやめる」ところまで。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Player } from '../../core/engine/mgf/types';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { buildInitialKindMap } from '../../core/engine/candidate-kinds';

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

function isKing(kind: string): boolean {
  return kind === 'ou' || kind === 'gyoku';
}

/** 材料に数えない駒 (王) の印。 */
const NOT_COUNTED = -1;

/**
 * 候補 1 個ぶんの値打ちの早見表 (v1.49)。
 *
 * 候補は「対局開始時の駒の身元」の集合なので、**候補 1 個の値打ちは身元と、その駒が
 * 成っているかどうかだけで決まる**＝局面によらない。読みの入口で 1 度作れば、あとは
 * 引くだけで済む。
 *
 * これを作らずに毎回引くと、**評価 1 回につき駒 40 枚ぶんの並べ替えとルール定義の
 * 線形探索**が走る。実測で深さ 2 が 0.58 秒 → 11.7 秒になった (2026-08-18)。
 */
export interface ValueBook {
  /** 成っていないときの値打ち。王は NOT_COUNTED。 */
  plain: Map<PieceId, number>;
  /** 成っているときの値打ち。成った姿を持たない駒種 (金・王) は NOT_COUNTED。 */
  promoted: Map<PieceId, number>;
}

export function buildValueBook(mgf: Mgf, position: Position): ValueBook {
  const plain = new Map<PieceId, number>();
  const promoted = new Map<PieceId, number>();
  for (const [pieceId, kind] of buildInitialKindMap(position)) {
    plain.set(pieceId, isKing(kind) ? NOT_COUNTED : valueOf(kind));
    const def = mgf.pieces.find((p) => p.id === kind);
    promoted.set(pieceId, def?.promoted_id ? valueOf(def.promoted_id) : NOT_COUNTED);
  }
  return { plain, promoted };
}

/**
 * その駒の値打ち (v1.49)。
 *
 * - 通常将棋モード (候補を持たない) は `piece.kind` がそのまま正体なので従来どおり。
 * - 量子モードは**候補のうちいちばん強いもの** (ユーザー判断)。王は材料に数えないので
 *   候補から外す (冒頭の注記＝混ぜると開始局面で全駒 20000 になり損得が見えなくなる)。
 *   **王だけが候補＝王と確定した駒**は 0 点。
 *
 * 取れる駒の大きさを見積もる並べ替え (search.ts) からも呼ぶので export する。
 */
export function pieceValue(piece: PieceInstance, book: ValueBook): number {
  if (piece.candidates === undefined) return valueOf(piece.kind);
  const table = piece.promoted ? book.promoted : book.plain;
  let best = 0;
  for (const pieceId of piece.candidates) {
    const v = table.get(pieceId);
    if (v !== undefined && v > best) best = v;
  }
  return best;
}

/**
 * 前進の微加点。駒得だけだと序盤はどの手も同点になり、指し手が意味なく揺れる。
 * **勝ち負けを決める要素ではなく同点崩し**なので、歩 1 枚の 1/10 以下に収める。
 */
function advanceBonus(owner: Player, row: number, height: number): number {
  // player1 は上 (row 小) が敵陣。進んだぶんだけ小さく加点する。
  const advanced = owner === 'player1' ? height - 1 - row : row;
  return advanced * 3;
}

/** 前進の加点を付けない駒か (通常将棋の王・量子で王と確定した駒＝値打ち 0)。 */
function skipsAdvanceBonus(piece: PieceInstance, value: number): boolean {
  if (piece.candidates === undefined) return isKing(piece.kind);
  return value === 0;
}

/**
 * 局面の評価。**手番側から見た点数**を返す (大きいほど手番側が良い)。
 *
 * `book` は候補 1 個ぶんの値打ちの早見表。**局面によらない**ので、探索の入口で 1 度だけ
 * 作って読みの間じゅう使い回す。渡さなければその場で作る＝渡し忘れても答えは変わらず
 * 遅くなるだけ。
 */
export function evaluate(
  mgf: Mgf,
  position: Position,
  book: ValueBook = buildValueBook(mgf, position),
): number {
  let p1 = 0;
  let p2 = 0;
  const height = position.height;

  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const piece = position.board[row][col];
      if (!piece) continue;
      let v = pieceValue(piece, book);
      if (!skipsAdvanceBonus(piece, v)) v += advanceBonus(piece.owner, row, height);
      if (piece.owner === 'player1') p1 += v;
      else p2 += v;
    }
  }

  for (const piece of position.hands.player1) {
    p1 += pieceValue(piece, book) * HAND_BONUS;
  }
  for (const piece of position.hands.player2) {
    p2 += pieceValue(piece, book) * HAND_BONUS;
  }

  const diff = p1 - p2;
  return position.sideToMove === 'player1' ? diff : -diff;
}
