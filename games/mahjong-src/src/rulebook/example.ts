// 役の例（YakuExample）を、ルール部分の役の判定（日本式・四川・香港）にそのまま渡せる形にする。検査と画面の両方で使う。

import { HIDDEN } from '../engine/events';
import type { Rules } from '../engine/rules';
import type { KindId, TileId } from '../engine/tiles';
import type { Meld, WinContext } from '../engine/yaku';
import type { HkWinContext } from '../engine/hongkong';
import type { CnWinContext } from '../engine/sichuan';
import type { McrWinContext } from '../engine/mcr';
import type { YakuExample } from './jpYaku';
import { idOfKind, parseKinds } from './notation';

type MeldKind = 'chi' | 'pon' | 'kan' | 'ankan';

function parseMeld(s: string): { kind: MeldKind; kinds: KindId[] } {
  const m = /^(chi|pon|kan|ankan):(.+)$/.exec(s);
  if (!m) throw new Error(`鳴いた面子が読めない: ${s}`);
  return { kind: m[1] as MeldKind, kinds: parseKinds(m[2]) };
}

const windKind = (n: 1 | 2 | 3 | 4 | undefined) => 26 + (n ?? 1);

/** 例を役の判定の入力にする（ルールは呼ぶ側が渡す） */
export function contextOf(ex: YakuExample, rules: Rules): WinContext {
  const concealed = new Array<number>(34).fill(0);
  for (const g of ex.hand) for (const k of parseKinds(g)) concealed[k]++;
  const melds: Meld[] = (ex.melds ?? []).map((s) => {
    const { kind, kinds } = parseMeld(s);
    return { type: kind === 'ankan' ? 'kan' : kind, first: Math.min(...kinds), open: kind !== 'ankan' };
  });
  const c = ex.ctx ?? {};
  return {
    concealed,
    melds,
    winTile: parseKinds(ex.win)[0],
    tsumo: !!ex.tsumo,
    seatWind: windKind(c.seatWind),
    roundWind: windKind(c.roundWind),
    riichi: c.riichi ?? 'none',
    ippatsu: c.ippatsu,
    haitei: c.haitei,
    houtei: c.houtei,
    rinshan: c.rinshan,
    chankan: c.chankan,
    tenhou: c.tenhou,
    chiihou: c.chiihou,
    jinho: c.jinho,
    tsubame: c.tsubame,
    kanburi: c.kanburi,
    rules,
  };
}

/** 画面に並べる 1 枚。called＝鳴いた牌（横に倒す）・win＝アガリ牌の印 */
export interface ShownTile {
  id: TileId;
  called?: boolean;
  win?: boolean;
}

/** 画面に並べる面子のまとまり。key＝役に関わる（明るいまま） */
export interface ShownGroup {
  tiles: ShownTile[];
  meld: boolean;
  key: boolean;
}

/** 例を画面に並べる形にする。アガリ牌の印は、手の中でその牌を含む最後の面子の最後の 1 枚に付ける */
export function shownGroups(ex: YakuExample): ShownGroup[] {
  const isKey = (i: number) => !ex.key || ex.key.includes(i);
  const win = parseKinds(ex.win)[0];
  const groups: ShownGroup[] = ex.hand.map((g, i) => ({ tiles: parseKinds(g).map((k) => ({ id: idOfKind(k) })), meld: false, key: isKey(i) }));
  for (let i = groups.length - 1; i >= 0; i--) {
    const ts = groups[i].tiles;
    const j = ts.map((x) => x.id).lastIndexOf(idOfKind(win));
    if (j >= 0) {
      ts[j] = { ...ts[j], win: true };
      break;
    }
  }
  (ex.melds ?? []).forEach((s, n) => {
    const { kind, kinds } = parseMeld(s);
    const tiles: ShownTile[] =
      kind === 'ankan'
        ? kinds.map((k, j) => ({ id: j === 0 || j === 3 ? HIDDEN : idOfKind(k) }))
        : kinds.map((k, j) => ({ id: idOfKind(k), called: j === 0 }));
    groups.push({ tiles, meld: true, key: isKey(ex.hand.length + n) });
  });
  // 表にした花牌（国標）は最後に別のまとまりで。役に関わるかは key に花牌の番号（面子の続き）で書く
  if (ex.flowers) groups.push({ tiles: parseKinds(ex.flowers).map((k) => ({ id: idOfKind(k) })), meld: true, key: isKey(ex.hand.length + (ex.melds?.length ?? 0)) });
  return groups;
}

/** 例を国標の番の入力にする（七対はアガリの形に入れる） */
export function mcrContextOf(ex: YakuExample): McrWinContext {
  const h = hkContextOf(ex);
  const c = ex.ctx ?? {};
  return {
    concealed: h.concealed,
    melds: h.melds,
    winTile: h.winTile,
    tsumo: h.tsumo,
    seatWind: h.seatWind,
    roundWind: h.roundWind,
    flowers: ex.flowers ? parseKinds(ex.flowers).length : 0,
    lastDraw: !!c.lastDraw,
    lastClaim: !!c.lastClaim,
    gangkai: !!c.gangkai,
    qianggang: !!c.qianggang,
    juezhang: !!c.juezhang,
    qidui: true,
  };
}

/** 例を四川の番の入力にする */
export function sichuanContextOf(ex: YakuExample): CnWinContext {
  const concealed = new Array<number>(34).fill(0);
  for (const g of ex.hand) for (const k of parseKinds(g)) concealed[k]++;
  const c = ex.ctx ?? {};
  return {
    concealed,
    melds: (ex.melds ?? []).map((s) => {
      const { kind, kinds } = parseMeld(s);
      return { kind: Math.min(...kinds), size: kinds.length === 4 ? 4 : 3, ...(kind === 'chi' ? { chi: true } : {}) };
    }),
    haidi: !!c.haidi,
    gangkai: c.gangkai,
    gangpao: c.gangpao,
    qianggang: c.qianggang,
  };
}

/** 例を香港の番の入力にする */
export function hkContextOf(ex: YakuExample): HkWinContext {
  const concealed = new Array<number>(34).fill(0);
  for (const g of ex.hand) for (const k of parseKinds(g)) concealed[k]++;
  const c = ex.ctx ?? {};
  return {
    concealed,
    melds: (ex.melds ?? []).map((s) => {
      const { kind, kinds } = parseMeld(s);
      return { kind: Math.min(...kinds), type: kind === 'ankan' ? 'kan' : kind, concealed: kind === 'ankan' };
    }),
    winTile: parseKinds(ex.win)[0],
    tsumo: !!ex.tsumo,
    seatWind: windKind(c.seatWind),
    roundWind: windKind(c.roundWind),
    haidi: !!c.haidi,
    gangkai: !!c.gangkai,
    kanChain: c.kanChain ?? 0,
    qianggang: !!c.qianggang,
    tianhu: !!c.tianhu,
    dihu: !!c.dihu,
  };
}
