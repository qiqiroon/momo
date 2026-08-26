/**
 * 引き分けの主張（親 v1.65 §3.10.0 `claim`・チェス §5.5.5・第 9 段 9-4d）。
 *
 * **主張は「引分の申し出」とは別物**である。申し出は**相手の同意が要り**、断られたら
 * 対局は続く。主張は**相手の同意が要らない**——決まりを満たしていること自体が根拠で、
 * 押した時点で引き分けになる。**だからこそ、条件を満たしているときしか出さない**。
 *
 * チェスで主張が要る理由は**負けている側は同意しないから**である。同じ形を 3 回
 * 繰り返しても、50 手動きが無くても、相手が「まだ勝てる」と思えば申し出は断られる。
 *
 * **どちらの側からでも主張できる**（条件は盤の側にあって、どちらか一方の持ち物では
 * ない）。**上限（5 回・75 手）に届いたら主張を待たずに自動で成立する**のは別の道で、
 * そちらは着手のたびに見ている（game-store）。
 */

import type { Mgf } from '../mgf/types';
import type { Position } from '../position/types';
import { positionHash } from '../position/hash';
import { countSamePositions } from './repetition';
import { canClaimMoveLimit, countNoProgressPlies } from './no-progress';

/** 主張の根拠。**終局の言葉もこれで決まる**（同じ形の繰り返し／無進展手数）。 */
export type DrawClaimReason = 'repetition' | 'move_limit';

/**
 * いま引き分けを主張できるか（できないなら null）。
 *
 * **主張できる回数・手数を書いていないルールでは常に null**＝将棋は従来どおり
 * 自動成立だけで、主張という手立てが現れない。
 *
 * `counts` は局面の印ごとの出現回数（粗い印）。**まず粗い印で絞ってから、
 * 届いていたときだけ遡って権利まで確かめる**（§4.2.1）。
 */
export function drawClaimAvailable(
  mgf: Mgf,
  past: Position[],
  position: Position,
  counts: Record<string, number>,
): DrawClaimReason | null {
  const claimAt = mgf.repetition?.claim_threshold;
  if (claimAt !== undefined) {
    const seen = counts[positionHash(position)] ?? 0;
    if (seen >= claimAt && countSamePositions(mgf, past, position) >= claimAt) {
      return 'repetition';
    }
  }
  if (canClaimMoveLimit(mgf, countNoProgressPlies(mgf, past, position))) return 'move_limit';
  return null;
}
