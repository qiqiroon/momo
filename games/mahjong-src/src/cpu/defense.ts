// 守り（段階7の3）：リーチした人に対して、その牌がどれだけ危ないか。見える局面だけで決める。
// 中国式（段階9 手順7）：リーチが無いので、テンパイしていそうな人を目安で選ぶ。相手の捨てる色（缺一門）の牌は通る。
// 数字は「危なさの目安」（0＝通る牌）。Hard は現物・筋・字牌の見えた枚数だけを見る。
// Apocalypse は fine を立てて、壁（4 枚見えた牌の外側）とリーチ後に通った牌も見る。

import type { Seat } from '../engine/events';
import type { GameState } from '../engine/state';
import { kindOf, type KindId } from '../engine/tiles';

/** 筋が無い数牌の危なさ（1〜9）。真ん中ほど待ちに絡みやすい */
const NO_SUJI = [6, 9, 10, 12, 12, 12, 10, 9, 6];

/**
 * 守る相手。日本式＝自分以外でリーチしている人。
 * 中国式（リーチが無い）＝まだ抜けていない人のうち、テンパイしていそうな人（目安：鳴いた面子 2 つ以上・捨て牌 10 枚以上・1 つ鳴いて捨て牌 7 枚以上）
 */
export function threats(view: GameState, seat: Seat): Seat[] {
  const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== seat);
  if (view.rules?.family === 'cn') return others.filter((s) => !view.cnOut[s] && looksReady(view, s));
  return others.filter((s) => view.riichi[s] !== 'none');
}

/** 中国式：テンパイしていそうか（手牌は見えないので、鳴きと巡目の目安） */
function looksReady(view: GameState, s: Seat): boolean {
  const melds = view.melds[s].length;
  const turns = view.discards[s].length;
  return melds >= 2 || turns >= 10 || (melds >= 1 && turns >= 7);
}

/** その人に対して通る種類（現物）。fine なら、リーチのあとに他の人が切って通った牌も入れる */
function safeKinds(view: GameState, t: Seat, fine: boolean): Set<KindId> {
  const safe = new Set(view.discards[t].map(kindOf));
  if (fine) {
    // リーチのあと、ほかの人が切った牌＝リーチした人が見送った牌（同巡フリテンでロンされない）。
    // 河の長さから、リーチ宣言のあとの打牌を目安に取る（鳴きで順番がずれるのは目安として許す）
    const at = view.riichiAt[t];
    if (at !== null) {
      for (let s = 0; s < 4; s++) {
        if (s === t) continue;
        const d = view.discards[s];
        const from = Math.min(d.length, at + (s > t ? 0 : 1));
        for (let i = from; i < d.length; i++) safe.add(kindOf(d[i]));
      }
    }
  }
  return safe;
}

/**
 * 種類 k を切ったときの危なさ（相手全員のうち一番危ない値）。visible＝その席から見えている枚数。
 */
export function dangerOf(view: GameState, seat: Seat, k: KindId, visible: readonly number[], fine = false): number {
  let worst = 0;
  for (const t of threats(view, seat)) {
    const safe = safeKinds(view, t, fine);
    const cn = view.rules?.family === 'cn';
    let d: number;
    // 缺一門：相手の捨てる色の牌ではアガれない＝通る
    if (cn && view.que[t] !== null && k < 27 && Math.floor(k / 9) === view.que[t]) d = 0;
    // 中国式に捨て牌のフリテンは無い（自分の捨てた牌でもロンできる）＝現物でも「やや安全」まで
    else if (safe.has(k)) d = cn ? 2 : 0;
    else if (k >= 27) {
      // 字牌：見えている枚数が多いほど単騎・シャンポンでしか当たらない
      const v = visible[k];
      d = v >= 3 ? 1 : v === 2 ? 3 : 6;
    } else {
      const n = k % 9;
      const base = k - n;
      const low = n - 3 >= 0 && safe.has(base + n - 3);
      const high = n + 3 <= 8 && safe.has(base + n + 3);
      const edge = n <= 2 ? high : n >= 6 ? low : low && high;
      d = edge ? Math.ceil(NO_SUJI[n] / 2) : (low || high) ? Math.ceil(NO_SUJI[n] * 0.75) : NO_SUJI[n];
      if (fine) {
        // 壁：隣の牌が 4 枚見えていれば、その向こう側の両面待ちは無い
        const wallBelow = n >= 1 && visible[k - 1] >= 4;
        const wallAbove = n <= 7 && visible[k + 1] >= 4;
        if ((n <= 1 && wallAbove) || (n >= 7 && wallBelow)) d = Math.min(d, 3);
      }
    }
    worst = Math.max(worst, d);
  }
  return worst;
}
