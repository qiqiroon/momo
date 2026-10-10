// あと 1 枚で付く役の手がかり（訂正26100917・利用者 Q8=B「簡潔に役の名前と期待する牌のみ」）。
// 画面は使わない。見える局面と自分の手牌だけで決まる（他の人の牌は使わない）。
//
// 1. テンパイ：待ちの牌ごとにアガったときの役を数え、「役 → その役が付く待ちの牌」にまとめる
//    （立直・一発・海底・嶺上など、牌でなく場面で付く役は出さない。ドラは役ではないので出さない）
// 2. テンパイでなくても、あと 1 枚そろえば付く役：役牌（三元牌・場風・自風の対子）・一気通貫・三色同順・三色同刻・大三元
//    （手牌と鳴いた面子にある牌の種類だけで数える。面子の形に組めるかまでは見ない＝手がかり）
// 3. アガれる牌が来ていてまだロン・ツモしていないときの、成り立つ役（establishedYaku）

import { waitKinds, kindCounts } from './agari';
import type { Seat } from './events';
import { roundWindOf, scoreRon, scoreTsumo, seatWindOf, type GameState } from './state';
import { kindOf, type TileId } from './tiles';
import type { YakuId } from './yaku';

export interface YakuHint {
  id: YakuId;
  /** その役が付くために来てほしい牌の種類（小さい順） */
  kinds: number[];
}

/** 牌でなく場面で付く役（どの牌で待っても同じなので手がかりにならない） */
const SITUATIONAL: ReadonlySet<YakuId> = new Set(['riichi', 'doubleRiichi', 'ippatsu', 'menzenTsumo', 'haitei', 'houtei', 'rinshan', 'chankan', 'tenhou', 'chiihou', 'jinho', 'tsubame', 'kanburi', 'ipin', 'chupin', 'ishinoue', 'parenchan']);

const DRAGON_YAKU: Record<number, YakuId> = { 31: 'haku', 32: 'hatsu', 33: 'chun' };

/** 自分の手牌（ツモった牌は除いた 13 枚の形）から、あと 1 枚で付く役 */
export function yakuHints(s: GameState, seat: Seat): YakuHint[] {
  if (!s.rules || s.rules.family !== 'jp') return [];
  const drawn = s.drawn[seat];
  const hand = drawn === null ? s.hands[seat] : s.hands[seat].filter((x) => x !== drawn);
  const found = new Map<YakuId, Set<number>>();
  const add = (id: YakuId, k: number) => {
    if (!found.has(id)) found.set(id, new Set());
    found.get(id)!.add(k);
  };

  // 1. テンパイ：待ちごとに役を数える（海底・河底が付かないよう、山が残っている局面として数える＝写しで数えるだけ）
  const probe: GameState = { ...s, wallLeft: s.wallLeft + 100, claim: null, drawn: [null, null, null, null], rinshanDraw: false };
  for (const k of waitKinds(hand)) {
    const t: TileId = k * 4 + 3;
    const r = scoreRon(probe, seat, hand, t) ?? scoreTsumo(probe, seat, [...hand, t], t);
    for (const y of r?.yaku ?? []) if (!SITUATIONAL.has(y.id)) add(y.id, k);
  }

  // 2. あと 1 枚そろえば付く役（牌の種類の数だけで見る）
  const concealed = kindCounts(hand);
  const all = concealed.slice();
  for (const m of s.melds[seat]) for (const t of m.tiles) all[kindOf(t)]++;
  const melded = new Set(s.melds[seat].filter((m) => m.type !== 'chi').map((m) => kindOf(m.tiles[0])));
  const has3 = (k: number) => all[k] >= 3 || melded.has(k);
  // 役牌：手の中に対子（鳴いた刻子はもう付いている）
  for (const k of [31, 32, 33]) if (concealed[k] === 2 && !melded.has(k)) add(DRAGON_YAKU[k], k);
  const rw = roundWindOf(s);
  const sw = seatWindOf(s, seat);
  if (concealed[rw] === 2 && !melded.has(rw)) add('roundWind', rw);
  if (concealed[sw] === 2 && !melded.has(sw)) add('seatWind', sw);
  // 一気通貫：同じ色の 1〜9 のうち 8 種類がある
  for (let suit = 0; suit < 3; suit++) {
    const miss = [...Array(9).keys()].map((i) => suit * 9 + i).filter((k) => all[k] === 0);
    if (miss.length === 1) add('ittsu', miss[0]);
  }
  // 三色同順：同じ数の並び（n・n+1・n+2）が 3 色で、9 種類のうち 8 種類がある
  for (let n = 0; n <= 6; n++) {
    const need = [0, 1, 2].flatMap((suit) => [0, 1, 2].map((d) => suit * 9 + n + d));
    const miss = need.filter((k) => all[k] === 0);
    if (miss.length === 1) add('sanshoku', miss[0]);
  }
  // 三色同刻：同じ数が 2 色で刻子、残り 1 色で対子
  for (let n = 0; n < 9; n++) {
    const ks = [n, 9 + n, 18 + n];
    const pairs = ks.filter((k) => !has3(k) && all[k] === 2);
    if (ks.filter(has3).length === 2 && pairs.length === 1) add('sanshokuDoukou', pairs[0]);
  }
  // 大三元：三元牌が 2 種類で刻子、残り 1 種類で対子
  const dragonPairs = [31, 32, 33].filter((k) => !has3(k) && all[k] === 2);
  if ([31, 32, 33].filter(has3).length === 2 && dragonPairs.length === 1) add('daisangen', dragonPairs[0]);

  return [...found].map(([id, ks]) => ({ id, kinds: [...ks].sort((a, b) => a - b) }));
}

/** アガれる牌が来ている（ロン・ツモできる）ときに成り立つ役。できなければ null */
export function establishedYaku(s: GameState, seat: Seat, how: 'ron' | 'tsumo'): YakuId[] | null {
  const hand = s.hands[seat];
  const r =
    how === 'ron' && s.claim
      ? scoreRon(s, seat, hand, s.claim.tile)
      : how === 'tsumo' && s.drawn[seat] !== null
        ? scoreTsumo(s, seat, hand, s.drawn[seat]!)
        : null;
  return r ? r.yaku.map((y) => y.id) : null;
}
