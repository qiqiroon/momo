// Apocalypse の先読み（段階7の4）。迷う場面（同じ近さの候補が並ぶ）だけで使う。
// 「2 歩先の受け入れ」：その候補を切ったあと、進む牌を 1 枚引き、一番よい 1 枚を切ったときに、
// 次に進む牌が何枚あるかを、引く牌の残り枚数の重みで全部足す（くじを使わず全部数える）。
// 同じ受け入れ枚数でも、進んだあとの形が良い（両面が残る・テンパイの待ちが広い）候補が上になる。
//
// ★最初はくじで作ったツモで試し打ちしたが、48 通りではぶれが大きく、Hard に負け越し（200 局で 2.56 対 2.44）、
//   時間も約 7 倍かかった（2026-10-11 実測）。全部数える形に替えた。

import type { KindId } from '../engine/tiles';
import { acceptance, shanten } from './shanten';

/** 13 枚形の手 counts（切ったあと）の 2 歩先の受け入れ。visible＝見えている枚数（自分の手牌を含む） */
export function twoStepAcceptance(counts: readonly number[], open: number, visible: readonly number[]): number {
  const c = counts.slice();
  const now = shanten(c, open);
  let total = 0;
  for (let k: KindId = 0; k < 34; k++) {
    const left = 4 - visible[k];
    if (left <= 0 || c[k] >= 4) continue;
    c[k]++;
    if (shanten(c, open) < now) {
      // 進む牌を引いた：一番よい 1 枚を切ったあとの受け入れ（引いた牌も見えた牌に数える）
      let best = 0;
      const seen = visible.slice();
      seen[k]++;
      for (let j = 0; j < 34; j++) {
        if (!c[j]) continue;
        c[j]--;
        if (shanten(c, open) < now) best = Math.max(best, acceptance(c, open, seen).tiles);
        c[j]++;
      }
      total += left * best;
    }
    c[k]--;
  }
  return total;
}
