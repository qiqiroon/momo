// 見張り役。出来事を1つ当てはめるたびに、どの段階でも崩れてはいけない決まりを確かめる。
// 段階が進んで出来事が増えたら、ここに決まりを足していく。
// 段階1：ツモったあとは番の人 14 枚・ほかは 13 枚（最後の1枚を配り忘れても、並びの決まりでは気づけないため）
//
// 全部を知る局面（全体）と、4つの席から見た局面を並べて持ち、同じ出来事を当てはめていく。
// 席から見た局面には、その席に渡す形（mask 済み）だけを当てはめる＝実際に渡すものと同じ。

import { HIDDEN, SEATS, mask, type Envelope, type Seat } from './events';
import { isWinningHand } from './agari';
import { doraIndicatorAt } from './dora';
import { apply, initialState, type GameState } from './state';
import { tileSetFor } from './tiles';

export class Watcher {
  full: GameState = initialState();
  views: GameState[] = SEATS.map(() => initialState());
  /** 見張った出来事の数 */
  checked = 0;

  /** 出来事を当てはめて決まりを確かめる。崩れていたら理由を返す（無ければ空） */
  push(env: Envelope): string[] {
    // 列としてあり得ない出来事は、局面を作る側が例外で止める。それも見張りの結果として返す
    try {
      this.full = apply(this.full, env);
    } catch (e) {
      return [`全体の局面に当てはめられない：${(e as Error).message}`];
    }
    try {
      this.views = this.views.map((v, seat) => apply(v, mask(env, seat as Seat)));
    } catch (e) {
      return [`席から見た局面に当てはめられない：${(e as Error).message}`];
    }
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
  const inRivers = full.discards.reduce((n, d) => n + d.length, 0);
  if (inHands + inRivers + full.wallLeft !== set.length) {
    bad.push(`牌の数が合わない：手牌 ${inHands}＋河 ${inRivers}＋山 ${full.wallLeft} ≠ ${set.length}`);
  }

  // 手牌の枚数：ツモったあと（切る前）は番の人 14 枚・ほかは 13 枚、ツモる前は全員 13 枚
  // （鳴きが入る段階3で「鳴いた面子 1 組につき 3 枚減る」を足す）
  if (full.phase === 'draw' || full.phase === 'discard') {
    full.hands.forEach((h, seat) => {
      const want = full.phase === 'discard' && seat === full.turn ? 14 : 13;
      if (h.length !== want) bad.push(`手牌の枚数が違う（席 ${seat}：${h.length} 枚・正しくは ${want} 枚）`);
    });
  }

  // ツモアガリは本当にアガリの形
  if (full.result?.type === 'tsumo' && !isWinningHand(full.hands[full.result.seat])) {
    bad.push(`アガリの形でないのにツモアガリした（席 ${full.result.seat}）`);
  }

  // ドラ表示牌は王牌の決まった場所の牌（1 枚目は配り終えたとき、2 枚目からはカンのたび＝段階3）
  if (full.wall) {
    full.doraIndicators.forEach((t, i) => {
      if (t !== doraIndicatorAt(full.wall!, i)) bad.push(`ドラ表示牌が王牌の決まった場所の牌でない（${i + 1} 枚目）`);
    });
  }
  if (full.rules.family === 'jp' && (full.phase === 'draw' || full.phase === 'discard') && full.doraIndicators.length === 0) {
    bad.push('配り終えたのにドラ表示牌がめくられていない');
  }
  // ツモアガリには点数が付いている（役が無いアガリは局面を作る側が止める）
  if (full.result?.type === 'tsumo' && !(full.result.score.total > 0)) bad.push('ツモアガリの点数が 0');

  // 同じ背番号の牌が2か所にない・使わない牌が混ざっていない・全体には伏せた牌が無い
  const allowed = new Set(set);
  const seen = new Set<number>();
  const places = [...full.hands.map((h, seat) => ({ where: `席 ${seat} の手牌`, tiles: h })), ...full.discards.map((d, seat) => ({ where: `席 ${seat} の河`, tiles: d }))];
  for (const { where, tiles } of places) {
    for (const t of tiles) {
      if (t === HIDDEN) bad.push(`全体の局面に伏せた牌がある（${where}）`);
      else if (!allowed.has(t)) bad.push(`このルールで使わない牌がある（${where}・背番号 ${t}）`);
      else if (seen.has(t)) bad.push(`同じ牌が2か所にある（背番号 ${t}）`);
      seen.add(t);
    }
  }

  // 山の並びを知っているなら、配った牌・ツモった牌は山の先頭から順に取られている
  // （手牌と山の残りが一緒にずれると「数」では気づけないので、並びで確かめる）
  if (full.wall) {
    const used = full.wall.slice(0, set.length - full.wallLeft);
    const handSet = new Set([...full.hands.flat(), ...full.discards.flat()]);
    if (used.length !== handSet.size || used.some((t) => !handSet.has(t))) {
      bad.push('配った牌が山の先頭から順に取られていない');
    }
  }

  // 各席から見た局面が、全体と食い違っていない
  views.forEach((v, viewer) => {
    if (v.nextSeq !== full.nextSeq) bad.push(`席 ${viewer}：通し番号が全体とずれている`);
    if (v.wallLeft !== full.wallLeft) bad.push(`席 ${viewer}：山の残りが全体と違う`);
    if (v.wall !== null) bad.push(`席 ${viewer}：山の並びが見えている`);
    if (v.doraIndicators.join() !== full.doraIndicators.join()) bad.push(`席 ${viewer}：ドラ表示牌が全体と違う`);
    // ツモアガリの点数は、見える局面からも全体と同じに出る（どの端末でも同じ点数）
    if (full.result?.type === 'tsumo' && JSON.stringify(v.result) !== JSON.stringify(full.result)) bad.push(`席 ${viewer}：アガリの点数が全体と違う`);
    if (v.phase !== full.phase || v.turn !== full.turn) bad.push(`席 ${viewer}：進み具合（番・段取り）が全体と違う`);
    full.discards.forEach((d, seat) => {
      const vd = v.discards[seat];
      if (vd.length !== d.length || vd.some((t, i) => t !== d[i])) bad.push(`席 ${viewer}：席 ${seat} の河が全体と違う`);
    });
    full.drawn.forEach((t, seat) => {
      const want = t === null ? null : seat === viewer ? t : HIDDEN;
      if (v.drawn[seat] !== want) bad.push(`席 ${viewer}：席 ${seat} のツモ牌の見え方が違う`);
    });
    full.hands.forEach((h, seat) => {
      const vh = v.hands[seat];
      if (vh.length !== h.length) bad.push(`席 ${viewer}：席 ${seat} の手牌の枚数が全体と違う`);
      else if (seat === viewer) {
        if (vh.some((t, i) => t !== h[i])) bad.push(`席 ${viewer}：自分の手牌が全体と違う`);
      } else if (full.phase === 'ended' && full.result?.type === 'tsumo' && full.result.seat === seat) {
        // ツモアガリした人の手牌は全員に開けている
        if (vh.some((t, i) => t !== h[i])) bad.push(`席 ${viewer}：開けた席 ${seat} の手牌が全体と違う`);
      } else if (vh.some((t) => t !== HIDDEN)) {
        bad.push(`席 ${viewer}：席 ${seat} の手牌が見えている`);
      }
    });
  });
  return bad;
}
