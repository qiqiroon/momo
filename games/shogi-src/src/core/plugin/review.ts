import type { Mgf } from '../engine/mgf/types';

/**
 * 感想戦 (S11) を二人で行うときの伝言（意味論＝親 v1.42 §9.4.4・通信＝親 §6.3.6）。
 *
 * **対局用の部屋をそのまま使う**（新しい通信の仕組みを作らない）ので、ここで決めるのは
 * 「何を運ぶか」だけ。運ぶ手立ては通信機能 (features/matchmaking) が持ち、感想戦の画面
 * (features/kifu-replay) は core のこの口を通してやり取りする。**core は通信機能に
 * 直接ぶら下がらない**ので、型だけをここに置く。
 *
 * ★**運ぶのは差分ではなく「いまの居場所そのもの」**（何手目にいるか＋分岐で指した手の
 * 並び）。理由＝差分だと届く順や取りこぼしで両者がずれ、**ずれたことにも気づけない**。
 * 居場所を丸ごと運べば、受け取った側は毎回そこから組み立て直すので**ずれようがない**。
 * 量子でも同じ＝候補の減り方は手の並びから決まるので、並びが同じなら候補も同じになる。
 */

/**
 * 盤の駒を動かす／持ち駒を打つ、1 手ぶん。
 *
 * ★**v1.55: 盤を自由に組み替える手も、同じこの形で運ぶ**（親 v1.49 §9.4.2.1）＝
 * **行き先の種類が増えるだけ**で、伝言そのものは増えない。`kind: 'free'` のときは
 * `to` ではなく `dest` を見る（**マスの欄に別の意味を持たせない**）。
 */
export interface ReviewMovePayload {
  kind: 'move' | 'drop' | 'free';
  pieceId: string;
  from?: { row: number; col: number };
  /** `kind` が 'move' / 'drop' のときの行き先。 */
  to?: { row: number; col: number };
  promote?: boolean;
  /**
   * ★v1.55: `kind: 'free'` のときの行き先。
   * `square`＝盤のマスへ／`hand`＝どちらかの駒台へ／`discard`＝消す。
   */
  dest?:
    | { kind: 'square'; square: { row: number; col: number } }
    | { kind: 'hand'; owner: 'player1' | 'player2' }
    | { kind: 'discard' };
}

/**
 * 操作する前に送り手が居た場所。**受け取った側が「同じ場所から動いたか」を見るため**に
 * 添える（親 §6.3.6 の食い違い検出）。分岐は本数でなく**長さ**だけで足りる＝
 * 中身が違えば長さが同じでも組み立て直す材料（下の ply / branch）が届いている。
 */
export interface ReviewPoint {
  ply: number;
  branchLen: number;
}

/**
 * 感想戦の伝言（親 §6.3.6 の 5 種）。
 *
 * - `offer` / `reply` … 打診と諾否。**断られたら申し出た側はひとりで入る**
 * - `state` … 土台の配布。**ホストが棋譜そのものを送る**（相手が持っていることを当てにしない）。
 *   食い違いを直すときは棋譜を省いて居場所だけ送る（相手は既に棋譜を持っているため）
 * - `move` / `seek` / `undo` … 指す・再生する・戻す。**盤だけでなく再生操作も共有する**
 */
export type ReviewMessage =
  /**
   * ★v1.55: **打診する側がその部屋のホストなら、移る先の合言葉と部屋名を載せる**
   * （親 v1.49 §6.3.6 の移る手順・**往復を増やさない**）。ゲストが打診するときは
   * 付かず、ホストが返事に載せてくる。
   */
  | { kind: 'offer'; pass?: string; room?: string }
  /**
   * ★v1.55: 受けるときは**移る先の部屋の合言葉**も渡す（親 v1.49 §6.3.6 の移る手順）。
   * **往復を増やさない**ためここに載せる。断るときは付かない。
   */
  | { kind: 'reply'; accepted: boolean; pass?: string; room?: string }
  /**
   * ★v1.55: ハイライト（親 v1.49 §9.4.2.2）。**盤の 1 か所を指し示す印**。
   * `null`＝消えた。**これは手ではない**ので、受け取った側は**盤を組み立て直さない**。
   * **取りこぼしても害が無い**＝次に触れば上書きされ、盤が動けば両者とも消える。
   */
  | { kind: 'mark'; square: { row: number; col: number } | null }
  /**
   * ★段B②: 振り返る 1 局を丸ごと配る。
   *
   * `rule` ＝**その棋譜が参照しているカスタムルールの定義**。**公式一覧 (`rules/`) に
   * 無いルールのときだけ入れる**（ユーザー判断 2026-08-25）＝公式のものは受け取った側が
   * 自分で取りに行けるので線に乗せない。**棋譜は名前と版しか持たない**ので、
   * これが無いと受け取った側は自作ルールの盤を作れない（§9.2.6）。
   */
  | { kind: 'state'; kifu?: string; rule?: Mgf; ply: number; branch: ReviewMovePayload[] }
  | { kind: 'move'; base: ReviewPoint; ply: number; branch: ReviewMovePayload[] }
  | { kind: 'seek'; base: ReviewPoint; ply: number }
  | { kind: 'undo'; base: ReviewPoint; ply: number; branch: ReviewMovePayload[] };
