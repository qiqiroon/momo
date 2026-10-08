// フリテン（日本式）。ロンできない状態かどうかと、その理由。
// 理由は 3 つ：
//   discard＝自分の河に待ち牌がある（手が変わって待ちから外れれば解ける）
//   turn  ＝同じ巡の見逃し（次の自分の打牌で解ける）
//   riichi＝リーチ後の見逃し（局の終わりまで解けない）
// 段階2はロンが無いので、見逃し（turn・riichi）は局面の置き場だけあって、立てる出来事がまだ無い。
// ロンの見送りで立てるのは段階3。鳴かれて河から消えた自分の牌も数える（一般則）のは、鳴きが入る段階3で足す。
// 判定に手牌を使うので、手牌が見えている本人の端末でしか分からない（他人の分は null）。

import { HIDDEN, type Seat } from './events';
import { waitKinds } from './agari';
import type { GameState } from './state';
import { kindOf, type KindId } from './tiles';

export type FuritenReason = 'discard' | 'turn' | 'riichi';

export interface Furiten {
  /** フリテンの理由（空ならフリテンでない） */
  reasons: FuritenReason[];
  /** 待ち牌の種類 */
  waits: KindId[];
  /** 自分の河のうち、待ち牌と同じ種類の牌の位置（理由 discard の元） */
  causes: number[];
}

export function furitenOf(s: GameState, seat: Seat): Furiten | null {
  if (!s.rules || s.rules.family !== 'jp' || s.rules.values.furiten === 'off') return null;
  const hand = s.hands[seat];
  if (hand.includes(HIDDEN)) return null;
  // 自分の番でツモったあとは、ツモる前の 13 枚で見る（切るまで表示が変わらないように）
  const drawn = s.drawn[seat];
  const before = drawn === null ? hand : hand.filter((t) => t !== drawn);
  if (before.length % 3 !== 1) return null;
  const waits = waitKinds(before);
  const causes = s.discards[seat].flatMap((t, i) => (waits.includes(kindOf(t)) ? [i] : []));
  const reasons: FuritenReason[] = [];
  if (causes.length > 0) reasons.push('discard');
  if (s.missedTurn[seat]) reasons.push('turn');
  if (s.missedRiichi[seat]) reasons.push('riichi');
  return { reasons, waits, causes };
}
