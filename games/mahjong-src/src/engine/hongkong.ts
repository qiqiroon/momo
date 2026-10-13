// 香港麻雀のアガリと番（段階9 香港の手順2）。原典：香港麻雀協會『十三張清張麻雀規則』2023-05-17（作業側 docs\原典）
// 「分數計算」「番種一覧表」「分數換算表」。
//
// アガリの形：4 面子 1 雀頭か十三么九（和牌形 1〜3。七対子は無い）。3 番に届かなければアガれない（三番起糊＝ルールの minFan）。
// 番は全部足す（完全複合原則）。上限 10 番・例牌は一律 10 番（ルールの cap）。読み方が 2 つ以上あれば番の高いほう（食糊的計分 5）。
//   1 番：平糊（4 組とも順子）・門前清（鳴いた面子が無い。暗槓も明章に数える）・自摸・三元牌（刻子 1 組ごと）・
//         風牌（自風・場風の刻子。重なれば 2）・花么（么九牌と字牌だけ。對對糊も付く）・搶槓・槓上自摸・海底撈月（最後の 1 枚をツモ）
//   3 番：混一色・對對糊・小三元（三元牌の刻子 2 組と雀頭。三元牌の 2 番も付いて 5 番）
//   5 番：大三元（三元牌の刻子 3 組。三元牌の 3 番も付いて 8 番）　7 番：清一色
//   例牌（10 番）：全番子（字一色）・小四喜・大四喜・坎坎糊（暗刻 4 つ・カンなし。ロンは単騎だけ＝シャンポンはツモ）・
//         十八羅漢（カン 4 つ）・清么九（么九の数牌だけ）・天糊・地糊・十三么九・槓上槓自摸（続けて 2 回カンしてツモ）・
//         九子連環（門前で 1112345678999＋同じ色 1 枚。ロンは 9 面待ちのときだけ）
// 点（分數換算表・100 底半辣上）：出銃（ロン）の点。自摸は 3 人がその半分ずつ（払い方は手順3）。

import { decompose } from './yaku';
import { isThirteenOrphans } from './agari';
import type { Rules } from './rules';
import type { KindId } from './tiles';

export const HK_FAN_IDS = [
  'pinghu', 'menqing', 'zimo', 'dragon', 'wind', 'huayao', 'qianggangHk', 'gangkaiHk', 'haidiHk',
  'hunyise', 'duidui', 'xiaosanyuan', 'dasanyuan', 'qingyiseHk',
  'ziyise', 'xiaosixi', 'dasixi', 'kankan', 'shibaluohan', 'qingyaojiu', 'tianhu', 'dihu', 'shisanyao', 'ganggang', 'jiulian',
] as const;
export type HkFanId = (typeof HK_FAN_IDS)[number];

/** 例牌（10 番）の番 */
export const HK_LIMIT_IDS: readonly HkFanId[] = ['ziyise', 'xiaosixi', 'dasixi', 'kankan', 'shibaluohan', 'qingyaojiu', 'tianhu', 'dihu', 'shisanyao', 'ganggang', 'jiulian'];

/** 分數換算表：番 → 出銃（ロン）の点。自摸は 3 人がその半分ずつ */
export const HK_POINTS: Readonly<Record<number, number>> = { 3: 32, 4: 64, 5: 96, 6: 128, 7: 192, 8: 256, 9: 384, 10: 512 };

/** 香港のアガリの場面（全員に見えることだけ） */
export interface HkWinContext {
  /** 手の中の牌（アガリ牌を含む・鳴いた面子は含まない）の種類ごとの枚数 */
  concealed: readonly number[];
  /** 鳴いた面子と暗槓。kind＝チーは一番小さい牌・ほかはその牌 */
  melds: readonly { kind: KindId; type: 'chi' | 'pon' | 'kan'; concealed: boolean }[];
  /** アガリ牌の種類 */
  winTile: KindId;
  tsumo: boolean;
  /** 自風・場風（27 東〜30 北） */
  seatWind: KindId;
  roundWind: KindId;
  /** 最後の 1 枚をツモ（海底撈月） */
  haidi: boolean;
  /** 嶺上牌でツモ（槓上自摸）。kanChain＝そのツモの前に続けてカンした回数（2 以上で槓上槓自摸） */
  gangkai: boolean;
  kanChain: number;
  /** 加槓の牌でロン（搶槓）・暗槓の牌でロン（十三么九だけ） */
  qianggang: boolean;
  tianhu: boolean;
  dihu: boolean;
}

export interface HkScore {
  fans: { id: HkFanId; fan: number }[];
  /** 例牌（10 番）か */
  limit?: boolean;
  /** 番の合計（上限で切る前） */
  fan: number;
  capped: boolean;
  /** 出銃（ロン）の点（上限で切ったあとの番を換算表で）。3 番未満は 0 */
  points: number;
}

const DRAGONS: readonly KindId[] = [31, 32, 33];
const WINDS: readonly KindId[] = [27, 28, 29, 30];
const isHonor = (k: KindId) => k >= 27;
const isTerminal = (k: KindId) => k < 27 && (k % 9 === 0 || k % 9 === 8);
const suitOf = (k: KindId) => (k < 27 ? Math.floor(k / 9) : -1);

type Group = { type: 'seq' | 'tri'; first: KindId; kan: boolean; concealed: boolean };

/** 番の合計から出銃の点（上限で切ったあと）。3 番未満は 0 */
export function hkPoints(fan: number, rules: Rules): { points: number; capped: boolean } {
  const cap = rules.family === 'cn' && rules.values.cap !== 'none' ? Number(rules.values.cap) : Infinity;
  const used = Math.min(fan, cap);
  // 換算表は 10 番まで。上限なしのルールで 10 番を超えたら、表の刻み（2 番ごとに倍）で伸ばす
  let points = HK_POINTS[used] ?? 0;
  if (used > 10) points = HK_POINTS[10 - (used % 2)] * 2 ** Math.floor((used - 10 + (used % 2)) / 2);
  return { points, capped: used < fan };
}

/** 香港の番と点。アガリの形でなければ null（3 番起糊は呼ぶ側＝ルールの minFan で確かめる） */
export function hongkongScore(ctx: HkWinContext, rules: Rules): HkScore | null {
  if (rules.family !== 'cn' || rules.values.scoring !== 'hk') return null;
  const v = rules.values;
  const c = ctx.concealed.slice(0, 34);
  if (c.reduce((a, b) => a + b, 0) + 3 * ctx.melds.length !== 14) return null;
  const all = c.slice();
  for (const m of ctx.melds) {
    if (m.type === 'chi') for (let i = 0; i < 3; i++) all[m.kind + i]++;
    else all[m.kind] += m.type === 'kan' ? 4 : 3;
  }
  const kinds = all.flatMap((n, k) => (n > 0 ? [k] : []));
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  const hasHonor = kinds.some(isHonor);
  const kans = ctx.melds.filter((m) => m.type === 'kan').length;

  // 場面と牌の顔ぶれで決まる例牌（形の読み方に関わらない）
  const limits: HkFanId[] = [];
  if (ctx.tianhu && v.tenhou === 'on') limits.push('tianhu');
  if (ctx.dihu && v.tenhou === 'on') limits.push('dihu');
  if (ctx.gangkai && ctx.kanChain >= 2 && v.rinshan === 'on') limits.push('ganggang');
  if (kinds.every(isHonor)) limits.push('ziyise');
  if (kinds.every(isTerminal)) limits.push('qingyaojiu');
  if (kans === 4) limits.push('shibaluohan');

  // 十三么九（字牌のあるルールだけ）
  if (v.honors === 'on' && ctx.melds.length === 0 && isThirteenOrphans(c)) return limitScore(['shisanyao', ...limits], rules);

  const candidates: HkScore['fans'][] = [];
  for (const d of decompose(c)) {
    const reads = winPlacements(d, ctx);
    for (const inner of reads) {
      const groups: Group[] = [...inner, ...ctx.melds.map((m): Group => ({ type: m.type === 'chi' ? 'seq' : 'tri', first: m.kind, kan: m.type === 'kan', concealed: m.concealed }))];
      const lim = limits.slice();
      const tri = groups.filter((g) => g.type === 'tri');
      const dragonTri = tri.filter((g) => DRAGONS.includes(g.first)).length;
      const windTri = tri.filter((g) => WINDS.includes(g.first)).length;
      if (windTri === 4) lim.push('dasixi');
      else if (windTri === 3 && WINDS.includes(d.pair)) lim.push('xiaosixi');
      if (tri.length === 4 && kans === 0 && tri.every((g) => g.concealed)) lim.push('kankan');
      if (jiulian(ctx, all, c)) lim.push('jiulian');
      if (lim.length) {
        candidates.push(lim.map((id) => ({ id, fan: 10 })));
        continue;
      }
      const fans: HkScore['fans'] = [];
      if (groups.every((g) => g.type === 'seq')) fans.push({ id: 'pinghu', fan: 1 });
      if (ctx.melds.length === 0) fans.push({ id: 'menqing', fan: 1 });
      if (ctx.tsumo) fans.push({ id: 'zimo', fan: 1 });
      if (dragonTri) fans.push({ id: 'dragon', fan: dragonTri });
      const wind = tri.filter((g) => g.first === ctx.seatWind).length + tri.filter((g) => g.first === ctx.roundWind).length;
      if (wind) fans.push({ id: 'wind', fan: wind });
      if (hasHonor && kinds.every((k) => isHonor(k) || isTerminal(k))) fans.push({ id: 'huayao', fan: 1 });
      if (ctx.qianggang && v.chankan === 'on') fans.push({ id: 'qianggangHk', fan: 1 });
      if (ctx.gangkai && v.rinshan === 'on') fans.push({ id: 'gangkaiHk', fan: 1 });
      if (ctx.haidi) fans.push({ id: 'haidiHk', fan: 1 });
      if (suits.size === 1 && hasHonor) fans.push({ id: 'hunyise', fan: 3 });
      if (tri.length === 4) fans.push({ id: 'duidui', fan: 3 });
      if (dragonTri === 2 && DRAGONS.includes(d.pair)) fans.push({ id: 'xiaosanyuan', fan: 3 });
      if (dragonTri === 3) fans.push({ id: 'dasanyuan', fan: 5 });
      if (suits.size === 1 && !hasHonor) fans.push({ id: 'qingyiseHk', fan: 7 });
      candidates.push(fans);
    }
  }
  if (candidates.length === 0) return null;
  const sum = (fs: HkScore['fans']) => fs.reduce((a, f) => a + f.fan, 0);
  const best = candidates.reduce((a, b) => (sum(b) > sum(a) ? b : a));
  if (best.some((f) => HK_LIMIT_IDS.includes(f.id))) return limitScore(best.map((f) => f.id), rules);
  const fan = sum(best);
  return { fans: best, fan, ...hkPoints(fan, rules) };
}

/** 例牌：一律 10 番（2 つ重なっても 10 番＝「例牌一律算10番」） */
function limitScore(ids: readonly HkFanId[], rules: Rules): HkScore {
  const uniq = [...new Set(ids)];
  return { fans: uniq.map((id) => ({ id, fan: 10 })), fan: 10, limit: true, ...hkPoints(10, rules) };
}

/**
 * アガリ牌がどの面子に入ったかの読み方。ロンでアガリ牌が刻子に入ったら、その刻子は暗刻でない（坎坎糊の「對碰必須自摸」）。
 * 雀頭に入る読み（単騎）・順子に入る読みがあれば、その刻子は暗刻のまま
 */
function winPlacements(d: { pair: KindId; sets: { type: 'seq' | 'tri'; first: KindId }[] }, ctx: HkWinContext): Group[][] {
  const base = d.sets.map((s): Group => ({ type: s.type, first: s.first, kan: false, concealed: true }));
  if (ctx.tsumo) return [base];
  const w = ctx.winTile;
  const out: Group[][] = [];
  if (d.pair === w) out.push(base);
  d.sets.forEach((s, i) => {
    if (s.type === 'seq' && w >= s.first && w <= s.first + 2) out.push(base);
    if (s.type === 'tri' && s.first === w) out.push(base.map((g, j) => (j === i ? { ...g, concealed: false } : g)));
  });
  return out.length ? out : [base];
}

/** 九子連環：門前で同じ色の 1112345678999＋1 枚。ロンは 9 面待ち（アガリ牌を抜いた 13 枚がちょうど 1112345678999）のときだけ */
function jiulian(ctx: HkWinContext, all: readonly number[], c: readonly number[]): boolean {
  if (ctx.melds.length) return false;
  const suit = suitOf(ctx.winTile);
  if (suit < 0) return false;
  const base = suit * 9;
  const nine = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  for (let k = 0; k < 34; k++) if ((k < base || k >= base + 9) && all[k]) return false;
  if (!nine.every((n, i) => c[base + i] >= n)) return false;
  if (ctx.tsumo) return true;
  const before = c.slice();
  before[ctx.winTile]--;
  return nine.every((n, i) => before[base + i] === n);
}
