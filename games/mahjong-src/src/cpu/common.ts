// CPU の段階どうしで共通に使う下ごしらえ（段階7）。見える局面だけを使う。

import { kindCounts } from '../engine/agari';
import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import { queOn, type GameState } from '../engine/state';
import { isSuit, kindOf, type KindId, type TileId } from '../engine/tiles';
import { acceptance, shanten } from './shanten';

// ---- 缺一門（段階9 手順7） ----
// 捨てる色の牌はアガリに使えない＝手の良し悪しを測るときは「手に無いもの」として数える。
// こうすると、捨てる色の牌を引くことも受け入れに入らない（足しても面子・塔子にならない）

/** 缺一門で捨てる色（0 萬・1 筒・2 索）。缺一門の無いルール・まだ決めていないなら null */
export function queSuitOf(view: GameState, seat: Seat): number | null {
  if (!queOn(view.rules)) return null;
  return view.que[seat] ?? view.queHeldSuit[seat];
}

const suitOfKind = (k: KindId) => (k < 27 ? Math.floor(k / 9) : -1);

// ---- 香港の 3 番（段階9 香港の手順7） ----
// 3 番に届かないとアガれない。いちばん作りやすい 3 番は混一色（1 色＋字牌）なので、手の牌が 1 色＋字牌に寄っていれば
// ほかの 2 色を「手に無いもの」として測る（缺一門と同じ仕組み）＝ほかの色から先に切り、その色と字牌で鳴く。
/**
 * 混一色を狙うと決める目安：狙う色と字牌が手牌と面子で何枚以上あるか。強さの段で違う（早く決めるほど強い）：
 * Easy 10・Hard 9・Apocalypse 8（2026-10-13 香港で打ち比べ。同じ目安だと Easy と Hard は互角だった）。
 * 打ち手が考え始めるときに setFlushMin で決める（考えている間だけ使う。打ち手はどれも同期で 1 手ずつ）
 */
export const FLUSH_MIN = { easy: 10, hard: 9, apocalypse: 8 } as const;
let flushMin: number = FLUSH_MIN.hard;
export function setFlushMin(n: number): void {
  flushMin = n;
}

/** 混一色の狙い（狙う色 0〜2）。最低の番が 3 以上の中国式で、字牌のあるルールだけ。面子が 2 色にまたがれば狙えない */
export function flushPlan(view: GameState, seat: Seat): number | null {
  const v = view.rules?.family === 'cn' ? view.rules.values : null;
  if (!v || Number(v.minFan) < 3 || v.honors !== 'on' || queOn(view.rules)) return null;
  const tiles = [...view.hands[seat], ...view.melds[seat].flatMap((m) => m.tiles)];
  const bySuit = [0, 0, 0];
  let honors = 0;
  for (const t of tiles) {
    const k = kindOf(t);
    if (k >= 27) honors++;
    else if (k >= 0) bySuit[suitOfKind(k)]++;
  }
  const meldSuits = new Set(view.melds[seat].map((m) => suitOfKind(kindOf(m.tiles[0]))).filter((x) => x >= 0));
  if (meldSuits.size > 1) return null;
  const best = meldSuits.size === 1 ? [...meldSuits][0] : bySuit.indexOf(Math.max(...bySuit));
  return bySuit[best] + honors >= flushMin ? best : null;
}

/** 混一色の狙いの牌か（狙う色か字牌） */
export const inPlan = (tile: TileId, plan: number): boolean => kindOf(tile) >= 27 || suitOfKind(kindOf(tile)) === plan;

/** 手を測るときに無いものとする色（缺一門の捨てる色・混一色で狙わない 2 色） */
export function deadSuits(view: GameState, seat: Seat): number[] {
  const q = queSuitOf(view, seat);
  if (q !== null) return [q];
  const f = flushPlan(view, seat);
  return f === null ? [] : [0, 1, 2].filter((x) => x !== f);
}

/** 手を測るための種類ごとの枚数：捨てる色（缺一門）・狙わない色（混一色）の牌は数えない */
export function handCounts(view: GameState, seat: Seat, tiles: readonly TileId[] = view.hands[seat]): number[] {
  const counts = kindCounts(tiles);
  for (const d of deadSuits(view, seat)) for (let k = d * 9; k < d * 9 + 9; k++) counts[k] = 0;
  return counts;
}

/** 役を気にせず鳴けるルールか（中国式で最低の番が「なし」＝四川。日本式は役が要る） */
export function freeCalls(view: GameState): boolean {
  return view.rules?.family === 'cn' && view.rules.values.minFan === '0';
}

/** 手を測る枚数に入っていない牌か（捨てる色・狙わない色＝切っても手は変わらない） */
export function isQueTile(view: GameState, seat: Seat, tile: TileId): boolean {
  return deadSuits(view, seat).includes(suitOfKind(kindOf(tile)));
}

/** 役牌の種類：三元牌と、場風・自風（鳴いて刻子にすれば役が付く） */
export function yakuhaiKinds(view: GameState, seat: Seat): Set<KindId> {
  const round = 27 + (Math.floor(view.roundIndex / 4) % 4);
  const own = 27 + ((seat - view.dealer + 4) % 4);
  return new Set([31, 32, 33, round, own]);
}

/** 鳴いた面子の数（暗槓も面子の数には入る＝手牌の枚数が減る） */
export const meldCount = (view: GameState, seat: Seat) => view.melds[seat].length;

/** すでに役牌を鳴いているか（鳴いた手に役が付いている） */
export function hasOpenYakuhai(view: GameState, seat: Seat): boolean {
  const y = yakuhaiKinds(view, seat);
  return view.melds[seat].some((m) => m.type !== 'chi' && y.has(kindOf(m.tiles[0])));
}

/** 牌が手の中でどれだけ他とつながっているか（同じ種類・隣・1 つ飛び）。小さいほど孤立している */
export function connection(tile: TileId, counts: readonly number[]): number {
  const k = kindOf(tile);
  let score = (counts[k] - 1) * 3;
  if (isSuit(k)) {
    const n = k % 9;
    for (const [d, w] of [[-2, 1], [-1, 2], [1, 2], [2, 1]] as const) {
      if (n + d >= 0 && n + d <= 8 && counts[k + d] > 0) score += w;
    }
  }
  return score;
}

/** 切ったあとの向聴数。同じ種類の牌は同じ答えなので種類ごとに覚える */
export function shantenAfterDiscard(view: GameState, seat: Seat): (tile: TileId) => number {
  const counts = handCounts(view, seat);
  const open = meldCount(view, seat);
  const memo = new Map<KindId, number>();
  return (tile) => {
    const k = kindOf(tile);
    let s = memo.get(k);
    if (s === undefined) {
      // 捨てる色の牌は数えていない＝切っても手は変わらない
      const que = isQueTile(view, seat, tile);
      if (!que) counts[k]--;
      s = shanten(counts, open);
      if (!que) counts[k]++;
      memo.set(k, s);
    }
    return s;
  };
}

/** 鳴いたあと（手牌から tiles を出した残り）、いちばんうまく 1 枚切ったときの向聴数 */
export function shantenAfterCall(view: GameState, seat: Seat, tiles: readonly TileId[]): number {
  const rest = view.hands[seat].slice();
  for (const t of tiles) rest.splice(rest.indexOf(t), 1);
  const counts = handCounts(view, seat, rest);
  const open = meldCount(view, seat) + 1;
  let best = 99;
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    counts[k]--;
    best = Math.min(best, shanten(counts, open));
    counts[k]++;
  }
  return best;
}

/**
 * 缺一門の捨てる色と伏せる牌を決める（段階9 手順7）。
 * 色ごとに「その色を捨てたあとの手」を測り、一番よい色を捨てる：
 *   1. 残りの手の向聴数が小さい（アガリに近い）
 *   2. 捨てる色の牌が少ない（捨て終えるまでの手数が少ない）
 *   3. 残りの手の受け入れが多い
 * 伏せる牌は、その色の中で一番孤立した牌。手に 1 枚も無い色を捨てる色にするときは、伏せた牌が最初の打牌になるので、
 * 伏せても残りの手の向聴数が一番下がらない数牌（同じなら一番孤立した牌）を伏せる
 */
export function chooseQue(view: GameState, seat: Seat, legal: readonly Action[]): Action {
  const all = kindCounts(view.hands[seat]);
  const open = meldCount(view, seat);
  // 候補ごとの残りの手（伏せる牌の種類と色が同じなら同じ手＝1 回だけ測る）
  type Cand = { a: Extract<Action, { type: 'que' }>; left: number[]; key: number[] };
  const memo = new Map<string, number>();
  const cands: Cand[] = [];
  for (const a of legal) {
    if (a.type !== 'que') continue;
    const k = kindOf(a.tile);
    const left = all.slice();
    for (let x = a.suit * 9; x < a.suit * 9 + 9; x++) left[x] = 0;
    // 手に無い色を捨てる色にするなら、伏せた牌は残りの手から抜ける
    if (suitOfKind(k) !== a.suit) left[k]--;
    const id = `${a.suit}:${suitOfKind(k) === a.suit ? '' : k}`;
    let sh = memo.get(id);
    if (sh === undefined) memo.set(id, (sh = shanten(left, open)));
    const inSuit = all.slice(a.suit * 9, a.suit * 9 + 9).reduce((m, n) => m + n, 0);
    cands.push({ a, left, key: [sh, inSuit] });
  }
  if (!cands.length) return legal[0];
  // 1・2 で一番よいものだけ、受け入れを数えて比べる（受け入れは重い＝候補を絞ってから）
  const top = cands.filter((c) => !cands.some((o) => lexLess(o.key, c.key)));
  const accMemo = new Map<string, number>();
  let best = top[0];
  let bestKey: number[] | null = null;
  for (const c of top) {
    const id = c.left.join(',');
    let acc = accMemo.get(id);
    if (acc === undefined) accMemo.set(id, (acc = acceptance(c.left, open).tiles));
    const key = [-acc, connection(c.a.tile, all), c.a.tile];
    if (!bestKey || lexLess(key, bestKey)) [best, bestKey] = [c, key];
  }
  return best.a;
}

/** 前から順に比べて a が小さいか */
function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** 選べることの中から、決まった種類のものを探す */
export const pick = <T extends Action['type']>(legal: readonly Action[], type: T) =>
  legal.find((a): a is Extract<Action, { type: T }> => a.type === type);
