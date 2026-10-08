// 終局（日本式・段階4の 3）。対局が終わった局面から、順位と最終得点を出す。
// 全員に見えること（持ち点・卓に残った供託・ルール）だけで決まる＝どの端末でも同じ答えになる。
//
// 手順（ルール設定 v0.03 §4 下「終局の細目」）：
// 1. 順位：持ち点の多い順。同点は、ルールの tie が「起家に近い人が上」なら席順（起家＝席 0 から）、「順位点を分け合う」なら同じ順位
// 2. 卓に残った供託：ルールの kyotaku が「トップが取る」ならトップの持ち点に足す（トップが同点で分け合うルールなら等分）
// 3. 素点の端数：ルールの hasu（丸めない／五捨六入／四捨五入／切り捨て）。千点未満を丸める。マイナスは「0 に近い方へ」＝絶対値で丸める
//    （2026-10-08 利用者決定 Q2=A。丸めるのは素点＝ウィキペディア「麻雀の点」の例）。丸めた差はトップが受け持つ
//    （トップ以外を先に出し、合計が丸める前と同じになるようトップを決める＝ネマタ氏の解説）
// 4. 最終得点＝（素点−返し点）÷1000＋ウマ（＋トップはオカ）。返し点「なし」なら素点÷1000＋ウマ
// 5. 同点で分け合うときは、その順位のウマ・オカを等分する。0.1 未満の端数は起家に近い人へ（Mリーグの条文）

import type { Seat } from './events';
import { RETURN_POINTS } from './game';
import { RIICHI_STICK, startPoints, type GameState } from './state';

export interface FinalRow {
  seat: Seat;
  /** 順位（1〜4。分け合う同点は同じ数） */
  rank: number;
  /** 終わったときの持ち点（供託を足す前） */
  points: number;
  /** 卓に残った供託から受け取った点 */
  kyotaku: number;
  /** 素点の部分（返し点を引き、端数を丸めたあと・千点＝1） */
  base: number;
  /** ウマ */
  uma: number;
  /** オカ */
  oka: number;
  /** 最終得点 */
  total: number;
}

/** ウマの表（1 位〜4 位・千点＝1）。浮きウマは浮いている人数で決まる（日本プロ麻雀連盟の別表） */
const UMA: Record<string, number[]> = {
  '10-20': [20, 10, -10, -20],
  '10-30': [30, 10, -10, -30],
  '5-15': [15, 5, -5, -15],
  '4-12': [12, 4, -4, -12],
  none: [0, 0, 0, 0],
};
const FLOAT_UMA: Record<number, number[]> = {
  1: [12, -1, -3, -8],
  2: [8, 4, -4, -8],
  3: [8, 3, 1, -12],
};

/** 千点未満を丸める（千点単位の数を返す）。マイナスは絶対値で丸める */
export function roundThousands(points: number, how: string): number {
  if (how === 'none') return points / 1000;
  const sign = points < 0 ? -1 : 1;
  const abs = Math.abs(points);
  const k = Math.floor(abs / 1000);
  const rest = abs - k * 1000;
  const up = how === 'gosha' ? rest >= 600 : how === 'shisha' ? rest >= 500 : false;
  return sign * (k + (up ? 1 : 0));
}

/** 0.1 単位で等分する。割り切れない分は前の人（起家に近い人）から 0.1 ずつ */
function splitTenths(total: number, n: number): number[] {
  const tenths = Math.round(total * 10);
  const each = Math.floor(tenths / n);
  const rest = tenths - each * n;
  return Array.from({ length: n }, (_, i) => (each + (i < rest ? 1 : 0)) / 10);
}

export function finalResult(s: GameState): FinalRow[] {
  if (!s.rules || s.rules.family !== 'jp') throw new Error('日本式の終局');
  const v = s.rules.values;
  const kaeshi = v.kaeshi === 'none' ? null : RETURN_POINTS;
  const seats: Seat[] = [0, 1, 2, 3];
  // 1. 順位（同点は席順で並べておき、分け合うルールなら同じ順位にする）
  const order = seats.slice().sort((a, b) => s.scores[b] - s.scores[a] || a - b);
  const split = v.tie === 'split';
  const groups: Seat[][] = [];
  for (const seat of order) {
    const last = groups[groups.length - 1];
    if (split && last && s.scores[last[0]] === s.scores[seat]) last.push(seat);
    else groups.push([seat]);
  }
  const rankOf = new Map<Seat, number>();
  let place = 1;
  for (const g of groups) {
    for (const seat of g) rankOf.set(seat, place);
    place += g.length;
  }
  // 2. 卓に残った供託（トップが取る。分け合う同点のトップなら等分＝Mリーグの条文「同点は均等割り」）
  const kyotakuOf = new Map<Seat, number>(seats.map((x) => [x, 0]));
  if (v.kyotaku === 'top' && s.kyotaku > 0) {
    const tops = groups[0];
    tops.forEach((seat) => kyotakuOf.set(seat, (s.kyotaku * RIICHI_STICK) / tops.length));
  }
  const raw = (seat: Seat) => s.scores[seat] + kyotakuOf.get(seat)!;
  // 3・4. 素点の部分：トップ以外を丸め、トップは丸める前の合計に合わせる
  const exact = (seat: Seat) => (raw(seat) - (kaeshi ?? 0)) / 1000;
  const top = order[0];
  const baseOf = new Map<Seat, number>();
  for (const seat of order.slice(1)) baseOf.set(seat, roundThousands(raw(seat), v.hasu) - (kaeshi ?? 0) / 1000);
  const exactSum = seats.reduce<number>((a, x) => a + exact(x), 0);
  const othersSum = order.slice(1).reduce<number>((a, x) => a + baseOf.get(x)!, 0);
  baseOf.set(top, kaeshi === null ? roundThousands(raw(top), v.hasu) : round1(exactSum - othersSum));
  // ウマ・オカ（順位ごと）
  const umaTable = v.uma === 'float' ? FLOAT_UMA[s.scores.filter((p) => p >= RETURN_POINTS).length] ?? [0, 0, 0, 0] : (UMA[v.uma] ?? UMA.none);
  const oka = v.oka === 'on' && kaeshi !== null ? ((kaeshi - startPoints(s.rules)) * 4) / 1000 : 0;
  const umaOf = new Map<Seat, number>();
  const okaOf = new Map<Seat, number>();
  let at = 0;
  for (const g of groups) {
    const umaShares = splitTenths(g.reduce<number>((a, _, i) => a + umaTable[at + i], 0), g.length);
    const okaShares = splitTenths(at === 0 ? oka : 0, g.length);
    g.forEach((seat, i) => {
      umaOf.set(seat, umaShares[i]);
      okaOf.set(seat, okaShares[i]);
    });
    at += g.length;
  }
  return order.map((seat) => ({
    seat,
    rank: rankOf.get(seat)!,
    points: s.scores[seat],
    kyotaku: kyotakuOf.get(seat)!,
    base: baseOf.get(seat)!,
    uma: umaOf.get(seat)!,
    oka: okaOf.get(seat)!,
    total: round1(baseOf.get(seat)! + umaOf.get(seat)! + okaOf.get(seat)!),
  }));
}

/** 0.1 単位にそろえる（小数の足し算のずれを消す） */
const round1 = (n: number) => Math.round(n * 10) / 10;
