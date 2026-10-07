// 見張り役。出来事を1つ当てはめるたびに、どの段階でも崩れてはいけない決まりを確かめる。
// 段階が進んで出来事が増えたら、ここに決まりを足していく。
// 段階1で足す：最初のツモの時点で全員 13 枚（最後の1枚を配り忘れても、並びの決まりでは気づけないため）
//
// 全部を知る局面（全体）と、4つの席から見た局面を並べて持ち、同じ出来事を当てはめていく。
// 席から見た局面には、その席に渡す形（mask 済み）だけを当てはめる＝実際に渡すものと同じ。

import { HIDDEN, SEATS, mask, type Envelope, type Seat } from './events';
import { apply, initialState, type GameState } from './state';
import { tileSetFor } from './tiles';

export class Watcher {
  full: GameState = initialState();
  views: GameState[] = SEATS.map(() => initialState());
  /** 見張った出来事の数 */
  checked = 0;

  /** 出来事を当てはめて決まりを確かめる。崩れていたら理由を返す（無ければ空） */
  push(env: Envelope): string[] {
    this.full = apply(this.full, env);
    this.views = this.views.map((v, seat) => apply(v, mask(env, seat as Seat)));
    this.checked++;
    return checkState(this.full, this.views);
  }
}

export function checkState(full: GameState, views: readonly GameState[]): string[] {
  const bad: string[] = [];
  if (!full.rules || full.roundIndex < 0) return bad;

  // 牌の数が保たれている
  const set = tileSetFor(full.rules);
  const inHands = full.hands.reduce((n, h) => n + h.length, 0);
  if (inHands + full.wallLeft !== set.length) {
    bad.push(`牌の数が合わない：手牌 ${inHands}＋山 ${full.wallLeft} ≠ ${set.length}`);
  }

  // 同じ背番号の牌が2か所にない・使わない牌が混ざっていない・全体には伏せた牌が無い
  const allowed = new Set(set);
  const seen = new Set<number>();
  full.hands.forEach((h, seat) => {
    for (const t of h) {
      if (t === HIDDEN) bad.push(`全体の局面に伏せた牌がある（席 ${seat}）`);
      else if (!allowed.has(t)) bad.push(`このルールで使わない牌がある（席 ${seat}・背番号 ${t}）`);
      else if (seen.has(t)) bad.push(`同じ牌が2か所にある（背番号 ${t}）`);
      seen.add(t);
    }
  });

  // 山の並びを知っているなら、配った牌は山の先頭から順に取られている
  // （手牌と山の残りが一緒にずれると「数」では気づけないので、並びで確かめる）
  if (full.wall) {
    const used = full.wall.slice(0, set.length - full.wallLeft);
    const handSet = new Set(full.hands.flat());
    if (used.length !== handSet.size || used.some((t) => !handSet.has(t))) {
      bad.push('配った牌が山の先頭から順に取られていない');
    }
  }

  // 各席から見た局面が、全体と食い違っていない
  views.forEach((v, viewer) => {
    if (v.nextSeq !== full.nextSeq) bad.push(`席 ${viewer}：通し番号が全体とずれている`);
    if (v.wallLeft !== full.wallLeft) bad.push(`席 ${viewer}：山の残りが全体と違う`);
    if (v.wall !== null) bad.push(`席 ${viewer}：山の並びが見えている`);
    full.hands.forEach((h, seat) => {
      const vh = v.hands[seat];
      if (vh.length !== h.length) bad.push(`席 ${viewer}：席 ${seat} の手牌の枚数が全体と違う`);
      else if (seat === viewer) {
        if (vh.some((t, i) => t !== h[i])) bad.push(`席 ${viewer}：自分の手牌が全体と違う`);
      } else if (vh.some((t) => t !== HIDDEN)) {
        bad.push(`席 ${viewer}：席 ${seat} の手牌が見えている`);
      }
    });
  });
  return bad;
}
