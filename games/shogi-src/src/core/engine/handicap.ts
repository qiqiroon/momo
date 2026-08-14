/**
 * 手合い (駒落ち) — 親仕様 §3.12.1 (v1.27 新設)。
 *
 * ルール定義 (MGF) は「上手側から何を落とすか」の一覧だけを持ち、
 * **どちらが上手かは対局設定側** (この HandicapSetting) で決める。
 * 同じ定義を「相手が落とす」「自分が落とす」の両方に使えるようにするため。
 *
 * 対応可否を表す専用の真偽値は置かない。**一覧を持っていれば対応、無ければ平手のみ**。
 */

import type { Mgf, MgfHandicapType, Player } from './mgf/types';
import type { PieceInstance } from './position/types';

/** 対局設定側の手合い指定。giver = 駒を落とす側 (＝上手)。 */
export interface HandicapSetting {
  typeId: string;
  giver: Player;
}

/**
 * 画面で選ぶときの「落とす席」(親 v1.28 §3.12.1)。
 *
 * ルール選択画面 (S02) の時点では先後がまだ決まっていない — 先後は手合いから
 * 決まるので、陣営 (player1/player2) で書くと堂々巡りになる。そこで**席**で持ち、
 * 対局を始めるところで「その席が先手 (＝上手＝player1)」になるよう割り当てる。
 *
 * self = この設定を決めた人の席。対AI なら「あなた」、ネット対戦なら「部屋を作る人」、
 * 人どうしのオフライン対局なら「手前側」。呼び名は画面ごとに変えるが意味は同じ。
 */
export type HandicapSeat = 'self' | 'opponent';

/** ルール設定側が持つ手合い (両方平手なら null)。 */
export interface HandicapChoice {
  typeId: string;
  giver: HandicapSeat;
}

/**
 * 席で選んだ手合いを、対局を始めるときの指定に読み替える。
 *
 * **上手＝先手＝`player1` に固定**し、人・AI・ホスト/ゲストのどちらがその席を持つかは
 * 席の割り当て (aiSide / 先後の確定値 / 盤の向き) の側で表す。こうすると
 * 「先手は player1」という呼び名がどの経路でも崩れない。
 */
export function handicapSettingFor(choice: HandicapChoice | null | undefined): HandicapSetting | null {
  return choice ? { typeId: choice.typeId, giver: 'player1' } : null;
}

/** 手合いを 1 本の文字列にする (ルール同期の照合用・見えるまま並べる)。 */
export function handicapKey(h: HandicapChoice | null | undefined): string {
  return h ? `${h.giver}:${h.typeId}` : '-';
}

/** そのルールで指せる手合いの一覧 (無ければ空＝平手のみ)。 */
export function listHandicaps(mgf: Mgf): MgfHandicapType[] {
  return mgf.handicap?.types ?? [];
}

/** そのルールが駒落ちに対応しているか (一覧を持っているか)。 */
export function supportsHandicap(mgf: Mgf): boolean {
  return listHandicaps(mgf).length > 0;
}

export function findHandicap(mgf: Mgf, typeId: string): MgfHandicapType | undefined {
  return listHandicaps(mgf).find((h) => h.id === typeId);
}

/**
 * 手合いを指定した対局の先手 = **駒を落とした側 (上手)**。将棋の作法どおり
 * (親 §3.12.1)。初期配置の手番指定より本規則が優先する。
 */
export function firstMoverWithHandicap(handicap: HandicapSetting): Player {
  return handicap.giver;
}

/**
 * 落とす駒を選ぶ。
 *
 * `pick` の左右は**上手から見た向き**。先手 (盤の下側) から見た左は 9 筋側＝
 * 列番号の小さい側、後手 (盤の上側) から見た左はその逆になる。
 * `any` は左からと同じ扱い (決定的に選べればよい＝両者が同じ結果になる必要がある)。
 */
export function selectRemovedPieces(
  giverPieces: PieceInstance[],
  type: MgfHandicapType,
  giver: Player,
): PieceInstance[] {
  const removed: PieceInstance[] = [];
  for (const entry of type.remove) {
    const count = entry.count ?? 1;
    const candidates = giverPieces.filter(
      (p) => p.initialKind === entry.piece && !removed.includes(p),
    );
    if (candidates.length < count) {
      throw new Error(
        `handicap "${type.id}": ${entry.piece} が ${count} 枚必要ですが ${candidates.length} 枚しかありません`,
      );
    }
    // 上手から見て左が先に来る順に並べる
    const leftFirst = [...candidates].sort((a, b) =>
      giver === 'player1'
        ? a.initialSquare.col - b.initialSquare.col
        : b.initialSquare.col - a.initialSquare.col,
    );
    const ordered = entry.pick === 'right' ? [...leftFirst].reverse() : leftFirst;
    removed.push(...ordered.slice(0, count));
  }
  return removed;
}
