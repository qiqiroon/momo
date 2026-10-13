// 国標麻将（MCR）のアガリと番（段階9 国標の手順2）。正本は作業側 docs\国標_番の数え方_v0.01.md
// （原典＝国家体育総局 1998・WMO 2006 EMA 版・MIL 补充细则 2023。優先は MIL ＞ 98 ＞ EMA）。
//
// 形：4 面子 1 雀頭／七対（ルールの qidui）／十三幺／全不靠・七星不靠／组合龙＋1 面子＋雀頭。
// 読み方を全部試して一番高いもの（就高不就低）。番は足し算・上限なし。花牌は 1 枚 1 点で、8 点の起和に数えない。
// 「数えない番」（不重复）は MCR_EXCLUDE の表。面子どうしの番（般逢老连・同刻・節高）と槓・暗刻の番は MIL 4・5・11 の数え方。

import { decompose } from './yaku';
import { isThirteenOrphans } from './agari';
import type { KindId } from './tiles';

/** 番の一覧（点の高い順）。id は画面の言葉 cnFan_<id> と同じ */
export const MCR_FANS = [
  ['dasixiG', 88], ['dasanyuanG', 88], ['lvyise', 88], ['jiulianG', 88], ['sigang', 88], ['lianqidui', 88], ['shisanyaoG', 88],
  ['qingyaojiuG', 64], ['xiaosixiG', 64], ['xiaosanyuanG', 64], ['ziyiseG', 64], ['sianke', 64], ['yiseshuanglong', 64],
  ['yisesitongshun', 48], ['yisesijiegao', 48],
  ['yisesibugao', 32], ['sangang', 32], ['hunyaojiu', 32],
  ['qiduiG', 24], ['qixingbukao', 24], ['quanshuangke', 24], ['qingyiseG', 24], ['yisesantongshun', 24], ['yisesanjiegao', 24], ['quanda', 24], ['quanzhong', 24], ['quanxiao', 24],
  ['qinglong', 16], ['sanseshuanglong', 16], ['yisesanbugao', 16], ['quandaiwu', 16], ['santongke', 16], ['sananke', 16],
  ['quanbukao', 12], ['zuhelong', 12], ['dayuwu', 12], ['xiaoyuwu', 12], ['sanfengke', 12],
  ['hualong', 8], ['tuibudao', 8], ['sansesantongshun', 8], ['sansesanjiegao', 8], ['wufanhe', 8], ['miaoshou', 8], ['haidilaoyue', 8], ['gangkaiG', 8], ['qiangganghe', 8], ['shuangangang', 8],
  ['pengpenghe', 6], ['hunyiseG', 6], ['sansesanbugao', 6], ['wumenqi', 6], ['quanqiuren', 6], ['shuangjianke', 6],
  ['mingangang', 5],
  ['quandaiyao', 4], ['buqiuren', 4], ['shuangminggang', 4], ['hejuezhang', 4],
  ['jianke', 2], ['quanfengke', 2], ['menfengke', 2], ['menqianqing', 2], ['pinghe', 2], ['siguiyi', 2], ['shuangtongke', 2], ['shuanganke', 2], ['angang', 2], ['duanyao', 2],
  ['yibangao', 1], ['xixiangfeng', 1], ['lianliu', 1], ['laoshaofu', 1], ['yaojiuke', 1], ['minggang', 1], ['queyimen', 1], ['wuzi', 1], ['bianzhang', 1], ['kanzhang', 1], ['dandiao', 1], ['zimoG', 1],
  ['huapai', 1],
] as const;
export type McrFanId = (typeof MCR_FANS)[number][0];
export const MCR_FAN_IDS: readonly McrFanId[] = MCR_FANS.map((f) => f[0]);
const PTS = new Map<McrFanId, number>(MCR_FANS.map(([id, p]) => [id, p]));

const KANG: readonly McrFanId[] = ['sigang', 'sangang', 'shuangangang', 'mingangang', 'shuangminggang', 'angang', 'minggang'];

/** 数えない番（不重复）。出どころは文書の表（98・EMA・MIL・原則） */
export const MCR_EXCLUDE: Partial<Record<McrFanId, readonly McrFanId[]>> = {
  dasixiG: ['sanfengke', 'quanfengke', 'menfengke', 'pengpenghe', 'yaojiuke'],
  dasanyuanG: ['shuangjianke', 'jianke'],
  lvyise: ['hunyiseG'],
  jiulianG: ['qingyiseG', 'menqianqing', 'buqiuren', 'wuzi'],
  sigang: ['pengpenghe', 'dandiao', ...KANG.filter((k) => k !== 'sigang')],
  lianqidui: ['qingyiseG', 'qiduiG', 'menqianqing', 'buqiuren', 'dandiao', 'pinghe', 'wuzi'],
  shisanyaoG: ['wumenqi', 'menqianqing', 'buqiuren', 'dandiao'],
  qingyaojiuG: ['pengpenghe', 'hunyaojiu', 'shuangtongke', 'wuzi', 'yaojiuke', 'quandaiyao'],
  xiaosixiG: ['sanfengke', 'yaojiuke'],
  xiaosanyuanG: ['jianke', 'shuangjianke'],
  ziyiseG: ['pengpenghe', 'quandaiyao', 'yaojiuke'],
  sianke: ['menqianqing', 'pengpenghe', 'buqiuren', 'sananke', 'shuanganke'],
  yiseshuanglong: ['laoshaofu', 'yibangao', 'qingyiseG', 'pinghe', 'queyimen', 'qiduiG', 'wuzi'],
  yisesitongshun: ['yisesanjiegao', 'yibangao', 'siguiyi', 'yisesantongshun'],
  yisesijiegao: ['yisesantongshun', 'pengpenghe', 'yisesanjiegao'],
  yisesibugao: ['yisesanbugao'],
  sangang: KANG.filter((k) => k !== 'sangang'),
  hunyaojiu: ['pengpenghe', 'yaojiuke', 'quandaiyao'],
  qiduiG: ['menqianqing', 'buqiuren', 'dandiao'],
  qixingbukao: ['wumenqi', 'buqiuren', 'dandiao', 'menqianqing', 'quanbukao'],
  quanshuangke: ['pengpenghe', 'duanyao', 'wuzi'],
  qingyiseG: ['wuzi'],
  yisesantongshun: ['yisesanjiegao', 'yibangao'],
  yisesanjiegao: ['yisesantongshun'],
  quanda: ['dayuwu', 'wuzi'],
  quanzhong: ['duanyao', 'wuzi'],
  quanxiao: ['xiaoyuwu', 'wuzi'],
  sanseshuanglong: ['xixiangfeng', 'laoshaofu', 'pinghe', 'wuzi', 'yibangao'],
  quandaiwu: ['duanyao', 'wuzi'],
  santongke: ['shuangtongke'],
  sananke: ['shuanganke'],
  quanbukao: ['wumenqi', 'buqiuren', 'dandiao', 'menqianqing'],
  dayuwu: ['wuzi'],
  xiaoyuwu: ['wuzi'],
  sanfengke: ['yaojiuke'],
  tuibudao: ['queyimen'],
  sansesantongshun: ['xixiangfeng'],
  miaoshou: ['zimoG'],
  gangkaiG: ['zimoG'],
  qiangganghe: ['hejuezhang'],
  shuangangang: [...KANG.filter((k) => k !== 'shuangangang'), 'shuanganke'],
  quanqiuren: ['dandiao'],
  shuangjianke: ['jianke'],
  mingangang: KANG.filter((k) => k !== 'mingangang'),
  buqiuren: ['menqianqing', 'zimoG'],
  shuangminggang: KANG.filter((k) => k !== 'shuangminggang'),
  pinghe: ['wuzi'],
  duanyao: ['wuzi'],
  angang: ['minggang'],
  shuanganke: [],
};

/** 国標のアガリの場面（全員に見えることだけ） */
export interface McrWinContext {
  /** 手の中の牌（アガリ牌を含む・鳴いた面子と花牌は含まない）の種類ごとの枚数 */
  concealed: readonly number[];
  /** 鳴いた面子と暗槓。kind＝チーは一番小さい牌 */
  melds: readonly { kind: KindId; type: 'chi' | 'pon' | 'kan'; concealed: boolean }[];
  winTile: KindId;
  tsumo: boolean;
  seatWind: KindId;
  roundWind: KindId;
  /** 表にした花牌の枚数 */
  flowers: number;
  /** 最後の 1 枚をツモ（妙手回春）・最後の捨て牌でロン（海底捞月）・槓の補充でツモ（杠上开花）・加槓の牌でロン（抢杠和） */
  lastDraw: boolean;
  lastClaim: boolean;
  gangkai: boolean;
  qianggang: boolean;
  /** アガリ牌の 3 枚が場（河・鳴いた面子）に見えている（和绝张） */
  juezhang: boolean;
  /** 七対をアガリの形に入れるか（ルールの qidui） */
  qidui: boolean;
}

export interface McrScore {
  fans: { id: McrFanId; fan: number }[];
  /** 番の合計（花牌を除く＝起和の 8 点と比べる値） */
  fan: number;
  capped: false;
  /** 花牌を含めた合計（払いに使う） */
  points: number;
}

const isHonor = (k: KindId) => k >= 27;
const suitOf = (k: KindId) => (k < 27 ? Math.floor(k / 9) : -1);
const num = (k: KindId) => (k % 9) + 1;
const isTerm = (k: KindId) => k < 27 && (k % 9 === 0 || k % 9 === 8);
const isYao = (k: KindId) => isHonor(k) || isTerm(k);
const WINDS = [27, 28, 29, 30];
const DRAGONS = [31, 32, 33];
const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2348 6 索・發
const REVERSIBLE = new Set([9, 10, 11, 12, 13, 16, 17, 19, 21, 22, 23, 25, 26, 31]); // 1234589 筒・245689 索・白

type Group = { type: 'seq' | 'tri'; first: KindId; kan: boolean; concealed: boolean; melded: boolean };

/** 組合龍の 6 通り（147/258/369 をどの色に割り当てるか）。返すのは 9 種類 */
function knittedSets(): KindId[][] {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  return perms.map((p) => p.flatMap((start, suit) => [0, 3, 6].map((d) => suit * 9 + start + d)));
}
const KNITTED = knittedSets();

/** 国標の番と点。アガリの形でなければ null（起和の 8 点は呼ぶ側＝ルールの minFan で確かめる） */
export function mcrScore(ctx: McrWinContext): McrScore | null {
  const c = ctx.concealed.slice(0, 34);
  if (c.reduce((a, b) => a + b, 0) + 3 * ctx.melds.length !== 14) return null;
  const candidates: Map<McrFanId, number>[] = [];
  const onlyOne = waitsOf(ctx).length === 1;

  if (ctx.melds.length === 0) {
    if (isThirteenOrphans(c)) candidates.push(special(ctx, ['shisanyaoG']));
    if (ctx.qidui && sevenPairs(c)) candidates.push(sevenPairsFans(ctx, c));
    const kb = knittedBukao(c);
    if (kb) candidates.push(special(ctx, kb));
  }
  // 组合龙＋1 面子＋雀頭（手の中に 147/258/369 の 9 枚）
  for (const ks of KNITTED) {
    if (!ks.every((k) => c[k] > 0)) continue;
    const rest = c.slice();
    for (const k of ks) rest[k]--;
    for (const d of decompose(rest)) {
      const groups = [...d.sets.map((s): Group => ({ type: s.type, first: s.first, kan: false, concealed: true, melded: false })), ...meldGroups(ctx)];
      if (groups.length !== 1) continue;
      // 組合龍の形の待ち（边张・坎张・单钓将）は数えない（MIL 9 は数えてよいとするが、組合龍の部分と取り分ける読み方は作っていない＝MOMO の簡略）
      candidates.push(standardFans(ctx, c, groups, d.pair, null, true));
    }
  }
  for (const d of decompose(c)) {
    for (const inner of placements(d, ctx)) {
      const groups = [...inner.groups, ...meldGroups(ctx)];
      candidates.push(standardFans(ctx, c, groups, d.pair, onlyOne && inner.wait !== null ? inner.wait : null, false));
    }
  }
  if (candidates.length === 0) return null;
  const total = (m: Map<McrFanId, number>) => [...m].reduce((a, [id, n]) => a + (id === 'huapai' ? 0 : n * PTS.get(id)!), 0);
  const best = candidates.reduce((a, b) => (total(b) > total(a) ? b : a));
  let fan = total(best);
  if (fan === 0) {
    best.set('wufanhe', 1);
    fan = 8;
  }
  if (ctx.flowers > 0) best.set('huapai', ctx.flowers);
  const order = new Map(MCR_FAN_IDS.map((id, i) => [id, i]));
  const fans = [...best].filter(([, n]) => n > 0).sort((a, b) => order.get(a[0])! - order.get(b[0])!).map(([id, n]) => ({ id, fan: n * PTS.get(id)! }));
  return { fans, fan, capped: false, points: fan + ctx.flowers };
}

function meldGroups(ctx: McrWinContext): Group[] {
  return ctx.melds.map((m) => ({ type: m.type === 'chi' ? 'seq' : 'tri', first: m.kind, kan: m.type === 'kan', concealed: m.concealed, melded: !m.concealed }));
}

/** 13 枚のときの待ちの種類（4 枚とも使った牌も数える＝MIL 10） */
function waitsOf(ctx: McrWinContext): KindId[] {
  const before = ctx.concealed.slice(0, 34);
  before[ctx.winTile]--;
  const out: KindId[] = [];
  for (let k = 0; k < 34; k++) {
    const c = before.slice();
    c[k]++;
    const std = decompose(c).length > 0;
    const ok = std || (ctx.melds.length === 0 && (isThirteenOrphans(c) || (ctx.qidui && sevenPairs(c)) || knittedBukao(c) !== null)) || knittedStd(c, ctx.melds.length);
    if (ok) out.push(k);
  }
  return out;
}

function knittedStd(c: readonly number[], melds: number): boolean {
  for (const ks of KNITTED) {
    if (!ks.every((k) => c[k] > 0)) continue;
    const rest = c.slice();
    for (const k of ks) rest[k]--;
    if (decompose(rest).some((d) => d.sets.length + melds === 1)) return true;
  }
  return false;
}

/** アガリ牌の入り方。ロンで刻子に入れば暗刻でない。待ちの形（单钓・坎张・边张）は 1 種類待ちのときだけ使う */
function placements(d: { pair: KindId; sets: { type: 'seq' | 'tri'; first: KindId }[] }, ctx: McrWinContext): { groups: Group[]; wait: 'dandiao' | 'kanzhang' | 'bianzhang' | null }[] {
  const base = d.sets.map((s): Group => ({ type: s.type, first: s.first, kan: false, concealed: true, melded: false }));
  const w = ctx.winTile;
  const out: { groups: Group[]; wait: 'dandiao' | 'kanzhang' | 'bianzhang' | null }[] = [];
  if (d.pair === w) out.push({ groups: base, wait: 'dandiao' });
  d.sets.forEach((s, i) => {
    if (s.type === 'seq' && w >= s.first && w <= s.first + 2) {
      const pos = w - s.first;
      const edge = (pos === 2 && num(s.first) === 1) || (pos === 0 && num(s.first) === 7);
      out.push({ groups: base, wait: pos === 1 ? 'kanzhang' : edge ? 'bianzhang' : null });
    }
    if (s.type === 'tri' && s.first === w) out.push({ groups: base.map((g, j) => (j === i && !ctx.tsumo ? { ...g, concealed: false } : g)), wait: null });
  });
  return out.length ? out : [{ groups: base, wait: null }];
}

function sevenPairs(c: readonly number[]): boolean {
  let pairs = 0;
  for (let k = 0; k < 34; k++) {
    if (c[k] % 2) return false;
    pairs += c[k] / 2;
  }
  return pairs === 7;
}

/** 全不靠・七星不靠（14 枚とも違う牌で、数牌は 1 つの組合龙の割り当てに収まる）。組合龙の 9 枚がそろえば组合龙も */
function knittedBukao(c: readonly number[]): McrFanId[] | null {
  if (c.some((n) => n > 1) || c.reduce((a, b) => a + b, 0) !== 14) return null;
  for (const ks of KNITTED) {
    const set = new Set(ks);
    let ok = true;
    for (let k = 0; k < 27; k++) if (c[k] && !set.has(k)) ok = false;
    if (!ok) continue;
    const honors = c.slice(27).reduce((a, b) => a + b, 0);
    const fans: McrFanId[] = [honors === 7 ? 'qixingbukao' : 'quanbukao'];
    if (ks.every((k) => c[k] === 1)) fans.push('zuhelong');
    return fans;
  }
  return null;
}

/** 特別な形（十三幺・全不靠）の番：形の番＋場面の番 */
function special(ctx: McrWinContext, main: readonly McrFanId[]): Map<McrFanId, number> {
  const m = new Map<McrFanId, number>(main.map((id) => [id, 1]));
  situational(ctx, m);
  if (ctx.tsumo) m.set('zimoG', 1);
  return exclude(m);
}

/** 七対（MIL 2：重ねられる番は決まっている） */
function sevenPairsFans(ctx: McrWinContext, c: readonly number[]): Map<McrFanId, number> {
  const m = new Map<McrFanId, number>();
  const kinds = c.flatMap((n, k) => (n > 0 ? [k] : []));
  const suit = suitOf(kinds[0]);
  const lian = kinds.length === 7 && kinds.every((k) => suitOf(k) === suit && suit >= 0) && kinds[6] - kinds[0] === 6;
  m.set(lian ? 'lianqidui' : 'qiduiG', 1);
  handWide(ctx, c, m, { allowed: SEVEN_PAIRS_OK });
  for (let k = 0; k < 34; k++) if (c[k] === 4) m.set('siguiyi', (m.get('siguiyi') ?? 0) + 1);
  situational(ctx, m);
  if (ctx.tsumo) m.set('zimoG', 1);
  return exclude(m);
}
const SEVEN_PAIRS_OK = new Set<McrFanId>(['lvyise', 'qingyaojiuG', 'ziyiseG', 'hunyaojiu', 'qingyiseG', 'quanda', 'quanzhong', 'quanxiao', 'dayuwu', 'xiaoyuwu', 'tuibudao', 'hunyiseG', 'wumenqi', 'duanyao', 'queyimen', 'wuzi']);

/** 場面の番 */
function situational(ctx: McrWinContext, m: Map<McrFanId, number>): void {
  if (ctx.lastDraw) m.set('miaoshou', 1);
  if (ctx.lastClaim) m.set('haidilaoyue', 1);
  if (ctx.gangkai) m.set('gangkaiG', 1);
  if (ctx.qianggang) m.set('qiangganghe', 1);
  if (ctx.juezhang) m.set('hejuezhang', 1);
}

/** 牌の顔ぶれだけで決まる手全体の番 */
function handWide(ctx: McrWinContext, c: readonly number[], m: Map<McrFanId, number>, opt: { allowed?: ReadonlySet<McrFanId> } = {}): void {
  const all = c.slice();
  for (const g of meldGroups(ctx)) {
    if (g.type === 'seq') for (let i = 0; i < 3; i++) all[g.first + i]++;
    else all[g.first] += 3;
  }
  const kinds = all.flatMap((n, k) => (n > 0 ? [k] : []));
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const honors = kinds.some(isHonor);
  const add = (id: McrFanId) => {
    if (!opt.allowed || opt.allowed.has(id)) m.set(id, 1);
  };
  if (kinds.every((k) => GREEN.has(k))) add('lvyise');
  if (kinds.every(isHonor)) add('ziyiseG');
  if (kinds.every(isTerm)) add('qingyaojiuG');
  else if (kinds.every(isYao) && honors) add('hunyaojiu');
  if (suits.size === 1 && !honors) add('qingyiseG');
  if (suits.size === 1 && honors) add('hunyiseG');
  if (suits.size === 2) add('queyimen');
  if (!honors) add('wuzi');
  if (!honors && kinds.every((k) => num(k) >= 7)) add('quanda');
  if (!honors && kinds.every((k) => num(k) >= 4 && num(k) <= 6)) add('quanzhong');
  if (!honors && kinds.every((k) => num(k) <= 3)) add('quanxiao');
  if (!honors && kinds.every((k) => num(k) >= 6)) add('dayuwu');
  if (!honors && kinds.every((k) => num(k) <= 4)) add('xiaoyuwu');
  if (kinds.every((k) => REVERSIBLE.has(k))) add('tuibudao');
  if (suits.size === 3 && kinds.some((k) => WINDS.includes(k)) && kinds.some((k) => DRAGONS.includes(k))) add('wumenqi');
  if (!kinds.some(isYao)) add('duanyao');
}

/** 4 面子 1 雀頭（組合龙の形なら knitted＝組合龙の 9 枚で順子 3 つ分） */
function standardFans(ctx: McrWinContext, c: readonly number[], groups: Group[], pair: KindId, wait: 'dandiao' | 'kanzhang' | 'bianzhang' | null, knitted: boolean): Map<McrFanId, number> {
  const m = new Map<McrFanId, number>();
  const inc = (id: McrFanId, n = 1) => n > 0 && m.set(id, (m.get(id) ?? 0) + n);
  handWide(ctx, c, m);
  situational(ctx, m);
  if (knitted) inc('zuhelong');
  const seqs = groups.filter((g) => g.type === 'seq');
  const tris = groups.filter((g) => g.type === 'tri');
  const all = c.slice();
  for (const g of meldGroups(ctx)) {
    if (g.type === 'seq') for (let i = 0; i < 3; i++) all[g.first + i]++;
    else all[g.first] += g.kan ? 4 : 3;
  }
  // 面子と雀頭ごとの条件
  const elems: { tiles: KindId[] }[] = [...groups.map((g) => ({ tiles: g.type === 'seq' ? [g.first, g.first + 1, g.first + 2] : [g.first] })), { tiles: [pair] }];
  if (!knitted && elems.every((e) => e.tiles.some(isYao))) inc('quandaiyao');
  if (!knitted && elems.every((e) => e.tiles.some((k) => !isHonor(k) && num(k) === 5))) inc('quandaiwu');
  if (tris.length === 4) inc('pengpenghe');
  if (tris.length === 4 && [...tris.map((g) => g.first), pair].every((k) => !isHonor(k) && num(k) % 2 === 0)) inc('quanshuangke');
  if (tris.length === 0 && !isHonor(pair) && (seqs.length === 4 || (knitted && seqs.length === 1))) inc('pinghe');
  // 三元牌・風牌
  const dragonTri = tris.filter((g) => DRAGONS.includes(g.first)).length;
  const windTri = tris.filter((g) => WINDS.includes(g.first));
  if (dragonTri === 3) inc('dasanyuanG');
  else if (dragonTri === 2 && DRAGONS.includes(pair)) inc('xiaosanyuanG');
  else if (dragonTri === 2) inc('shuangjianke');
  inc('jianke', dragonTri);
  if (windTri.length === 4) inc('dasixiG');
  else if (windTri.length === 3 && WINDS.includes(pair)) inc('xiaosixiG');
  else if (windTri.length === 3) inc('sanfengke');
  const roundTri = windTri.some((g) => g.first === ctx.roundWind);
  const seatTri = windTri.some((g) => g.first === ctx.seatWind);
  if (roundTri) inc('quanfengke');
  if (seatTri) inc('menfengke');
  // 幺九刻：一九の数牌と風牌の刻子（風牌の大きな番・圈风刻・门风刻に使った刻子は数えない＝MIL 8）
  const bigWind = windTri.length >= 3;
  for (const g of tris) {
    if (isTerm(g.first)) inc('yaojiuke');
    else if (WINDS.includes(g.first) && !bigWind && g.first !== ctx.roundWind && g.first !== ctx.seatWind) inc('yaojiuke');
  }
  // 九莲宝灯（門前で 9 面待ち＝13 枚がちょうど 1112345678999）。幺九刻は 258 でアガれば 1 つ（MIL 12）
  if (ctx.melds.length === 0 && jiulian(c, ctx.winTile)) {
    inc('jiulianG');
    m.delete('yaojiuke');
    if ([2, 5, 8].includes(num(ctx.winTile))) m.set('yaojiuke', 1);
  }
  // 四归一：槓でない同じ牌 4 枚（1 種類ごと）
  for (let k = 0; k < 34; k++) if (all[k] === 4 && !groups.some((g) => g.kan && g.first === k)) inc('siguiyi');
  // 順子どうし・刻子どうし
  for (const [id, n] of chowFans(seqs.map((g) => g.first), pair)) inc(id, n);
  for (const [id, n] of pungFans(tris.map((g) => g.first).filter((k) => !isHonor(k)))) inc(id, n);
  // 槓と暗刻（MIL 4・5：それぞれ最多 1 つ）
  const kans = groups.filter((g) => g.kan);
  const anKan = kans.filter((g) => g.concealed).length;
  const minKan = kans.length - anKan;
  const kang: McrFanId | null =
    kans.length === 4 ? 'sigang' : kans.length === 3 ? 'sangang' : anKan === 2 ? 'shuangangang' : anKan === 1 && minKan === 1 ? 'mingangang' : minKan === 2 ? 'shuangminggang' : anKan === 1 ? 'angang' : minKan === 1 ? 'minggang' : null;
  if (kang) inc(kang);
  const anke = tris.filter((g) => g.concealed).length;
  const ankeFan: McrFanId | null = anke === 4 ? 'sianke' : anke === 3 ? 'sananke' : anke === 2 ? 'shuanganke' : null;
  if (ankeFan) inc(ankeFan);
  // 鳴きとアガり方
  const open = ctx.melds.some((x) => !x.concealed);
  if (!open && !ctx.tsumo) inc('menqianqing');
  if (!open && ctx.tsumo) inc('buqiuren');
  if (ctx.melds.length === 4 && ctx.melds.every((x) => !x.concealed) && !ctx.tsumo && pair === ctx.winTile) inc('quanqiuren');
  if (ctx.tsumo) inc('zimoG');
  if (wait) inc(wait === 'dandiao' ? 'dandiao' : wait);
  // 必然门清の番（MIL 1）：门前清・不求人を数えない（自摸だけ）
  if (m.has('sianke') || m.has('jiulianG')) {
    m.delete('menqianqing');
    m.delete('buqiuren');
    if (ctx.tsumo) m.set('zimoG', 1);
  }
  // 一色双龙会・三色双龙会（順子 4 つの番は chowFans で数える）
  return exclude(m);
}

function jiulian(c: readonly number[], win: KindId): boolean {
  const suit = suitOf(win);
  if (suit < 0) return false;
  const before = c.slice();
  before[win]--;
  const nine = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let k = 0; k < 34; k++) if (suitOf(k) !== suit && before[k]) return false;
  return nine.every((n, i) => before[suit * 9 + i] === n);
}

/**
 * 順子どうしの番（MIL 11）。4 順子の番＞3 順子の番＋般逢老连 1 つ＞般逢老连だけ（最多 3・順子 3 つなら 2）
 */
function chowFans(seqs: readonly KindId[], pair: KindId): [McrFanId, number][] {
  const n = seqs.length;
  if (n === 4) {
    const four = fourChow(seqs, pair);
    if (four) return [[four, 1]];
  }
  let best: [McrFanId, number][] = [];
  let bestPts = -1;
  const score = (fs: [McrFanId, number][]) => fs.reduce((a, [id, k]) => a + PTS.get(id)! * k, 0);
  if (n >= 3) {
    for (const tri of combos(n, 3)) {
      const t = threeChow(tri.map((i) => seqs[i]));
      if (!t) continue;
      const fs: [McrFanId, number][] = [[t, 1]];
      // 残りの順子と、3 順子の番に使った順子 1 つで般逢老连を 1 つ（套算一次）
      const rest = [0, 1, 2, 3].filter((i) => i < n && !tri.includes(i));
      let add: McrFanId | null = null;
      for (const r of rest) for (const i of tri) {
        const rel = relation(seqs[r], seqs[i]);
        if (rel && !(MCR_EXCLUDE[t] ?? []).includes(rel) && (!add || PTS.get(rel)! > PTS.get(add)!)) add = rel;
      }
      if (add) fs.push([add, 1]);
      if (score(fs) > bestPts) [best, bestPts] = [fs, score(fs)];
    }
    if (bestPts > 0) return best;
  }
  // 般逢老连だけ：同じ番を同じ順子で 2 回作らない・新しい組はまだ使っていない順子を含む（森＝辺は n−1 まで）
  const edges: { a: number; b: number; rel: McrFanId }[] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const rel = relation(seqs[a], seqs[b]);
    if (rel) edges.push({ a, b, rel });
  }
  let bestSet: typeof edges = [];
  for (let mask = 1; mask < 1 << edges.length; mask++) {
    const pick = edges.filter((_, i) => mask & (1 << i));
    if (pick.length > n - 1 || pick.length <= bestSet.length) continue;
    if (!isForest(n, pick)) continue;
    if (pick.some((e, i) => pick.some((f, j) => i < j && e.rel === f.rel && (e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b)))) continue;
    bestSet = pick;
  }
  const out = new Map<McrFanId, number>();
  for (const e of bestSet) out.set(e.rel, (out.get(e.rel) ?? 0) + 1);
  return [...out];
}

function isForest(n: number, es: readonly { a: number; b: number }[]): boolean {
  const p = Array.from({ length: n }, (_, i) => i);
  const f = (x: number): number => (p[x] === x ? x : (p[x] = f(p[x])));
  for (const e of es) {
    const a = f(e.a);
    const b = f(e.b);
    if (a === b) return false;
    p[a] = b;
  }
  return true;
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, cur: number[]) => {
    if (cur.length === k) return void out.push(cur.slice());
    for (let i = start; i < n; i++) rec(i + 1, [...cur, i]);
  };
  rec(0, []);
  return out;
}

/** 順子 2 つの関係（般逢老连）。同じ組に 2 つは付かない */
function relation(a: KindId, b: KindId): McrFanId | null {
  if (a === b) return 'yibangao';
  if (suitOf(a) !== suitOf(b)) return num(a) === num(b) ? 'xixiangfeng' : null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  if (hi - lo === 3) return 'lianliu';
  if (num(lo) === 1 && num(hi) === 7) return 'laoshaofu';
  return null;
}

function threeChow(s: readonly KindId[]): McrFanId | null {
  const sorted = s.slice().sort((a, b) => a - b);
  const suits = sorted.map(suitOf);
  const same = suits.every((x) => x === suits[0]);
  const diff = new Set(suits).size === 3;
  const nums = sorted.map(num);
  if (same) {
    if (sorted[0] === sorted[2]) return 'yisesantongshun';
    if (nums[0] === 1 && nums[1] === 4 && nums[2] === 7) return 'qinglong';
    const d1 = nums[1] - nums[0];
    if ((d1 === 1 || d1 === 2) && nums[2] - nums[1] === d1) return 'yisesanbugao';
    return null;
  }
  if (diff) {
    const byNum = s.map(num).sort((a, b) => a - b);
    if (byNum[0] === 1 && byNum[1] === 4 && byNum[2] === 7) return 'hualong';
    if (byNum[0] === byNum[2]) return 'sansesantongshun';
    if (byNum[1] - byNum[0] === 1 && byNum[2] - byNum[1] === 1) return 'sansesanbugao';
  }
  return null;
}

function fourChow(s: readonly KindId[], pair: KindId): McrFanId | null {
  const sorted = s.slice().sort((a, b) => a - b);
  const suits = new Set(sorted.map(suitOf));
  const nums = sorted.map(num);
  if (suits.size === 1) {
    const suit = suitOf(sorted[0]);
    if (nums.join() === '1,1,7,7' && pair === suit * 9 + 4) return 'yiseshuanglong';
    if (sorted[0] === sorted[3]) return 'yisesitongshun';
    const d = nums[1] - nums[0];
    if ((d === 1 || d === 2) && nums[2] - nums[1] === d && nums[3] - nums[2] === d) return 'yisesibugao';
  }
  if (suits.size === 2 && !isHonor(pair)) {
    const ps = suitOf(pair);
    const ok = [...suits].every((x) => sorted.filter((k) => suitOf(k) === x).map(num).join() === '1,7');
    if (ok && !suits.has(ps) && num(pair) === 5) return 'sanseshuanglong';
  }
  return null;
}

/** 刻子どうしの番（数牌の刻子・槓）：一色四节高＞一色三节高・三同刻・三色三节高＞双同刻 */
function pungFans(ks: readonly KindId[]): [McrFanId, number][] {
  const s = ks.slice().sort((a, b) => a - b);
  const out: [McrFanId, number][] = [];
  if (s.length === 4 && s.every((k) => suitOf(k) === suitOf(s[0])) && s[3] - s[0] === 3 && new Set(s).size === 4) return [['yisesijiegao', 1]];
  let used: KindId[] = [];
  for (const tri of combos(s.length, 3)) {
    const t = tri.map((i) => s[i]);
    const suits = t.map(suitOf);
    const nums = t.map(num).sort((a, b) => a - b);
    let id: McrFanId | null = null;
    if (suits.every((x) => x === suits[0]) && t[1] - t[0] === 1 && t[2] - t[1] === 1) id = 'yisesanjiegao';
    else if (new Set(suits).size === 3 && nums[0] === nums[2]) id = 'santongke';
    else if (new Set(suits).size === 3 && nums[1] - nums[0] === 1 && nums[2] - nums[1] === 1) id = 'sansesanjiegao';
    if (id && (!out.length || PTS.get(id)! > PTS.get(out[0][0])!)) {
      out.splice(0, out.length, [id, 1]);
      used = t;
    }
  }
  // 双同刻：数の同じ数牌の刻子の組（三同刻に使った刻子どうしでは数えない）
  const byNum = new Map<number, KindId[]>();
  for (const k of s) byNum.set(num(k), [...(byNum.get(num(k)) ?? []), k]);
  let dbl = 0;
  for (const [, g] of byNum) {
    if (g.length === 2 && !(out[0]?.[0] === 'santongke' && g.every((k) => used.includes(k)))) dbl++;
  }
  if (dbl) out.push(['shuangtongke', dbl]);
  return out;
}

/** 数えない番を外す（ある番が成り立てば、その表の番は数えない。外された番の表も当てはめる） */
function exclude(m: Map<McrFanId, number>): Map<McrFanId, number> {
  const present = [...m.keys()];
  const drop = new Set<McrFanId>();
  for (const id of present) for (const x of MCR_EXCLUDE[id] ?? []) drop.add(x);
  for (const x of drop) m.delete(x);
  return m;
}
