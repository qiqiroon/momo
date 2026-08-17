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

/** 盤の駒を動かす／持ち駒を打つ、1 手ぶん。 */
export interface ReviewMovePayload {
  kind: 'move' | 'drop';
  pieceId: string;
  from?: { row: number; col: number };
  to: { row: number; col: number };
  promote?: boolean;
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
  | { kind: 'offer' }
  | { kind: 'reply'; accepted: boolean }
  | { kind: 'state'; kifu?: string; ply: number; branch: ReviewMovePayload[] }
  | { kind: 'move'; base: ReviewPoint; ply: number; branch: ReviewMovePayload[] }
  | { kind: 'seek'; base: ReviewPoint; ply: number }
  | { kind: 'undo'; base: ReviewPoint; ply: number; branch: ReviewMovePayload[] };
