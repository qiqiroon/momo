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
