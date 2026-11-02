// 履歴逆再生ソルバー（設計 06 §3）：完成から今までの手を逆にたどる。必ずそろうが、最短ではない
// 返す前に、隣り合う同じ層の手をまとめる（R R → R2、R R' → 消える。06 §3 の冗長手の除去）
import { inverse, makeMove } from '../core/move';
import type { Move } from '../core/types';

/** history（完成から今までに適用した手）を打ち消す手順 */
export function historySolution(history: readonly Move[]): Move[] {
  return simplify([...history].reverse().map(inverse));
}

/** 隣り合う同じ軸・同じ層の手を 1 手にまとめる。打ち消し合えば消し、前の手ともう一度比べる */
export function simplify(moves: readonly Move[]): Move[] {
  const out: Move[] = [];
  for (const m of moves) {
    const last = out[out.length - 1];
    if (!last || last.n !== m.n || last.axis !== m.axis || last.slices !== m.slices) {
      out.push(m);
      continue;
    }
    out.pop();
    const q = (((last.turns + m.turns) % 4) + 4) % 4;
    if (q === 0) continue;
    // 半回転は、まとめる前の 2 手と同じ向きに回す（記法の R2 は向きを持つ。01 §2.1）
    const turns = q === 2 ? (m.turns > 0 ? 2 : -2) : q === 3 ? -1 : 1;
    out.push(makeMove(m.n, m.axis, m.slices, turns));
  }
  return out;
}
