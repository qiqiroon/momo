// 役の判定（日本式）。手の形と、アガったときの状況から、成り立つ役を数える。点数（符・翻から点）はここでは出さない。
//
// 手の読み方（面子の分け方・アガリ牌をどの面子に入れるか）が何通りもあるときは、全部の読み方で役を数えて候補にする。
// どの候補を採るかは点数で決まる（符まで見る）ので、最後に選ぶのは点数の計算の側。
// ここの `bestYaku` は「役満の数 → 翻」の順で選ぶ仮の選び方。
//
// 役の顔ぶれは変えられない決まり（ルール設定 v0.03 §4「日本式の変えられない決まり」）。
// 値で変わるのは：喰いタン／ダブル役満／役満どうしの複合。人和（ロンだけ）とローカル役は段階3以降。

import { isSevenPairs, isThirteenOrphans, TERMINAL_HONOR_KINDS } from './agari';
import type { Rules } from './rules';
import { isHonor, isSuit, type KindId } from './tiles';

/** 鳴いた面子・暗槓。first＝順子なら一番小さい牌、刻子・槓子ならその牌。open＝鳴いた（暗槓は false） */
export interface Meld {
  type: 'chi' | 'pon' | 'kan';
  first: KindId;
  open: boolean;
}

export interface WinContext {
  /** 手の中の牌（アガリ牌を含む・鳴いた面子は含まない）の種類ごとの枚数（長さ 34） */
  concealed: readonly number[];
  melds: readonly Meld[];
  winTile: KindId;
  tsumo: boolean;
  /** 自風・場風（27＝東 28＝南 29＝西 30＝北） */
  seatWind: KindId;
  roundWind: KindId;
  riichi?: 'none' | 'riichi' | 'double';
  ippatsu?: boolean;
  /** 最後の 1 枚のツモでアガった（嶺上を除く） */
  haitei?: boolean;
  /** 最後の捨て牌でロンした */
  houtei?: boolean;
  rinshan?: boolean;
  chankan?: boolean;
  /** 親の配牌でアガった */
  tenhou?: boolean;
  /** 子の最初のツモでアガった（それまでに鳴きが無い） */
  chiihou?: boolean;
  rules: Rules;
}

export type YakuId =
  | 'riichi' | 'doubleRiichi' | 'ippatsu' | 'menzenTsumo' | 'tanyao' | 'pinfu' | 'iipeikou'
  | 'haku' | 'hatsu' | 'chun' | 'roundWind' | 'seatWind'
  | 'rinshan' | 'chankan' | 'haitei' | 'houtei'
  | 'chiitoitsu' | 'sanshoku' | 'ittsu' | 'chanta' | 'toitoi' | 'sanankou' | 'sanshokuDoukou' | 'sankantsu'
  | 'shousangen' | 'honroutou'
  | 'ryanpeikou' | 'honitsu' | 'junchan'
  | 'chinitsu'
  | 'tenhou' | 'chiihou' | 'kokushi' | 'suuankou' | 'daisangen' | 'tsuuiisou' | 'ryuuiisou' | 'chinroutou'
  | 'shousuushii' | 'daisuushii' | 'suukantsu' | 'chuuren';

/** 成り立った役。han＝翻（役満のときは 0）。yakuman＝役満の倍数（ふつうの役は 0） */
export interface YakuHit {
  id: YakuId;
  han: number;
  yakuman: number;
}

/** 面子の読み方。fu の計算にも使う */
export type Group =
  | { type: 'seq'; first: KindId; open: boolean }
  | { type: 'tri'; first: KindId; open: boolean; kan: boolean };

export type WaitShape = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

export type HandReading =
  | { form: 'standard'; pair: KindId; groups: Group[]; wait: WaitShape }
  | { form: 'chiitoitsu' }
  | { form: 'kokushi' };

export interface YakuResult {
  reading: HandReading;
  yaku: YakuHit[];
  han: number;
  yakuman: number;
}

const DRAGONS: readonly KindId[] = [31, 32, 33];
const WINDS: readonly KindId[] = [27, 28, 29, 30];
/** 緑一色に使える牌＝2・3・4・6・8索と發 */
const GREEN: ReadonlySet<KindId> = new Set([19, 20, 21, 23, 25, 32]);

const isTerminal = (k: KindId) => isSuit(k) && (k % 9 === 0 || k % 9 === 8);
const isTermOrHonor = (k: KindId) => isTerminal(k) || isHonor(k);
const suitOf = (k: KindId) => Math.floor(k / 9);

/** 1 色（または字牌）の範囲を、面子だけに分ける読み方を全部返す */
function splitMelds(c: number[], from: KindId, to: KindId): { type: 'seq' | 'tri'; first: KindId }[][] {
  let i = from;
  while (i < to && c[i] === 0) i++;
  if (i >= to) return [[]];
  const out: { type: 'seq' | 'tri'; first: KindId }[][] = [];
  if (c[i] >= 3) {
    c[i] -= 3;
    for (const rest of splitMelds(c, i, to)) out.push([{ type: 'tri', first: i }, ...rest]);
    c[i] += 3;
  }
  if (isSuit(i) && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    for (const rest of splitMelds(c, i, to)) out.push([{ type: 'seq', first: i }, ...rest]);
    c[i]++; c[i + 1]++; c[i + 2]++;
  }
  return out;
}

/** 手の中の牌を「雀頭 1 つ＋面子」に分ける読み方を全部返す（重複なし） */
export function decompose(concealed: readonly number[]): { pair: KindId; sets: { type: 'seq' | 'tri'; first: KindId }[] }[] {
  const c = concealed.slice(0, 34);
  const out: { pair: KindId; sets: { type: 'seq' | 'tri'; first: KindId }[] }[] = [];
  for (let p = 0; p < 34; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const parts = [splitMelds(c, 0, 9), splitMelds(c, 9, 18), splitMelds(c, 18, 27)];
    const honorsOk = c.slice(27, 34).every((n) => n === 0 || n === 3);
    if (honorsOk && parts.every((x) => x.length > 0)) {
      const honors = Array.from({ length: 7 }, (_, i) => 27 + i)
        .filter((k) => c[k] === 3)
        .map((k) => ({ type: 'tri' as const, first: k }));
      for (const a of parts[0]) for (const b of parts[1]) for (const d of parts[2]) out.push({ pair: p, sets: [...a, ...b, ...d, ...honors] });
    }
    c[p] += 2;
  }
  return out;
}

/** 手の読み方を、アガリ牌の入り方ごとに全部返す */
export function readings(ctx: WinContext): HandReading[] {
  const out: HandReading[] = [];
  const meldGroups: Group[] = ctx.melds.map((m) =>
    m.type === 'chi'
      ? { type: 'seq', first: m.first, open: m.open }
      : { type: 'tri', first: m.first, open: m.open, kan: m.type === 'kan' },
  );
  for (const d of decompose(ctx.concealed)) {
    const w = ctx.winTile;
    const seen = new Set<string>();
    const push = (groups: Group[], wait: WaitShape) => {
      const key = wait + JSON.stringify(groups);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ form: 'standard', pair: d.pair, groups: [...groups, ...meldGroups], wait });
    };
    const closed = (ronIndex: number): Group[] =>
      d.sets.map((s, i) =>
        s.type === 'seq'
          ? { type: 'seq', first: s.first, open: false }
          // ロンで仕上がった刻子は鳴いた扱い（明刻）
          : { type: 'tri', first: s.first, open: i === ronIndex, kan: false },
      );
    if (d.pair === w) push(closed(-1), 'tanki');
    d.sets.forEach((s, i) => {
      if (s.type === 'tri' && s.first === w) push(closed(ctx.tsumo ? -1 : i), 'shanpon');
      if (s.type === 'seq' && w >= s.first && w <= s.first + 2) {
        const pos = w - s.first;
        const n = s.first % 9;
        const wait: WaitShape =
          pos === 1 ? 'kanchan' : (pos === 0 && n === 6) || (pos === 2 && n === 0) ? 'penchan' : 'ryanmen';
        push(closed(-1), wait);
      }
    });
  }
  if (ctx.melds.length === 0 && isSevenPairs(ctx.concealed)) out.push({ form: 'chiitoitsu' });
  if (ctx.melds.length === 0 && isThirteenOrphans(ctx.concealed)) out.push({ form: 'kokushi' });
  return out;
}

/** 手牌と鳴いた面子を合わせた、種類ごとの枚数 */
function allCounts(ctx: WinContext): number[] {
  const c = ctx.concealed.slice(0, 34);
  for (const m of ctx.melds) {
    if (m.type === 'chi') { c[m.first]++; c[m.first + 1]++; c[m.first + 2]++; }
    else c[m.first] += m.type === 'kan' ? 4 : 3;
  }
  return c;
}

function judgeReading(ctx: WinContext, r: HandReading): YakuResult {
  const v = ctx.rules.family === 'jp' ? ctx.rules.values : null;
  const doubleOn = v?.doubleYakuman === 'on';
  const menzen = ctx.melds.every((m) => !m.open);
  const all = allCounts(ctx);
  const used = all.map((n, k) => (n > 0 ? k : -1)).filter((k) => k >= 0);
  const hits: YakuHit[] = [];
  const yaku = (id: YakuId, closedHan: number, openHan = closedHan) => {
    const han = menzen ? closedHan : openHan;
    if (han > 0) hits.push({ id, han, yakuman: 0 });
  };
  const yakuman = (id: YakuId, times = 1) => hits.push({ id, han: 0, yakuman: times });

  // ── 役満 ──
  if (ctx.tenhou) yakuman('tenhou');
  if (ctx.chiihou) yakuman('chiihou');
  if (r.form === 'kokushi') {
    const before = ctx.concealed.slice(0, 34);
    before[ctx.winTile]--;
    const thirteenWait = TERMINAL_HONOR_KINDS.every((k) => before[k] === 1);
    yakuman('kokushi', thirteenWait && doubleOn ? 2 : 1);
  }
  if (used.every(isHonor)) yakuman('tsuuiisou');
  if (used.every((k) => GREEN.has(k))) yakuman('ryuuiisou');
  if (used.every(isTerminal)) yakuman('chinroutou');
  if (r.form === 'standard') {
    const tris = r.groups.filter((g) => g.type === 'tri');
    const triKinds = new Set(tris.map((g) => g.first));
    const closedTris = tris.filter((g) => !g.open).length;
    const kans = ctx.melds.filter((m) => m.type === 'kan').length;
    if (closedTris === 4) yakuman('suuankou', r.wait === 'tanki' && doubleOn ? 2 : 1);
    if (DRAGONS.every((k) => triKinds.has(k))) yakuman('daisangen');
    const windTris = WINDS.filter((k) => triKinds.has(k)).length;
    if (windTris === 4) yakuman('daisuushii', doubleOn ? 2 : 1);
    else if (windTris === 3 && WINDS.includes(r.pair)) yakuman('shousuushii');
    if (kans === 4) yakuman('suukantsu');
    // 九蓮宝燈：門前の清一色で 1112345678999＋1 枚
    const s = suitOf(used[0]);
    if (menzen && used.every((k) => isSuit(k) && suitOf(k) === s)) {
      const base = s * 9;
      const shape = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      if (shape.every((n, i) => all[base + i] >= n)) {
        const before = all.slice();
        before[ctx.winTile]--;
        const junsei = shape.every((n, i) => before[base + i] === n);
        yakuman('chuuren', junsei && doubleOn ? 2 : 1);
      }
    }
  }
  if (hits.length > 0) {
    // 役満どうしの複合が「なし」なら、いちばん大きい役満 1 つだけ
    if (v?.yakumanMix !== 'on') {
      const top = hits.reduce((a, b) => (b.yakuman > a.yakuman ? b : a));
      return { reading: r, yaku: [top], han: 0, yakuman: top.yakuman };
    }
    return { reading: r, yaku: hits, han: 0, yakuman: hits.reduce((a, b) => a + b.yakuman, 0) };
  }
  if (r.form === 'kokushi') return { reading: r, yaku: [], han: 0, yakuman: 0 };

  // ── 状況の役 ──
  if (ctx.riichi === 'double') yaku('doubleRiichi', 2, 0);
  else if (ctx.riichi === 'riichi') yaku('riichi', 1, 0);
  if (ctx.riichi && ctx.riichi !== 'none' && ctx.ippatsu && v?.ippatsu === 'on') yaku('ippatsu', 1, 0);
  if (ctx.tsumo && menzen) yaku('menzenTsumo', 1, 0);
  if (ctx.rinshan) yaku('rinshan', 1);
  if (ctx.chankan) yaku('chankan', 1);
  if (ctx.haitei && ctx.tsumo && !ctx.rinshan) yaku('haitei', 1);
  if (ctx.houtei && !ctx.tsumo) yaku('houtei', 1);

  // ── 牌の種類だけで決まる役 ──
  if (used.every((k) => !isTermOrHonor(k))) yaku('tanyao', 1, v?.kuitan === 'on' ? 1 : 0);
  const suits = new Set(used.filter(isSuit).map(suitOf));
  const hasHonor = used.some(isHonor);
  if (suits.size === 1 && !hasHonor) yaku('chinitsu', 6, 5);
  else if (suits.size === 1 && hasHonor) yaku('honitsu', 3, 2);
  if (used.every(isTermOrHonor) && hasHonor && used.some(isTerminal)) yaku('honroutou', 2);

  if (r.form === 'chiitoitsu') {
    yaku('chiitoitsu', 2, 0);
  } else if (r.form === 'standard') {
    const seqs = r.groups.filter((g) => g.type === 'seq');
    const tris = r.groups.filter((g): g is Extract<Group, { type: 'tri' }> => g.type === 'tri');
    const triKinds = new Set(tris.map((g) => g.first));
    const valuePair = DRAGONS.includes(r.pair) || r.pair === ctx.seatWind || r.pair === ctx.roundWind;

    if (menzen && seqs.length === 4 && !valuePair && r.wait === 'ryanmen') yaku('pinfu', 1, 0);

    // 一盃口・二盃口（門前だけ）
    if (menzen) {
      const seqCount = new Map<KindId, number>();
      for (const g of seqs) seqCount.set(g.first, (seqCount.get(g.first) ?? 0) + 1);
      const peiko = [...seqCount.values()].reduce((a, n) => a + Math.floor(n / 2), 0);
      if (peiko === 2) yaku('ryanpeikou', 3, 0);
      else if (peiko === 1) yaku('iipeikou', 1, 0);
    }

    // 役牌（刻子・槓子）
    if (triKinds.has(31)) yaku('haku', 1);
    if (triKinds.has(32)) yaku('hatsu', 1);
    if (triKinds.has(33)) yaku('chun', 1);
    if (triKinds.has(ctx.roundWind)) yaku('roundWind', 1);
    if (triKinds.has(ctx.seatWind)) yaku('seatWind', 1);

    // 三色同順・一気通貫・三色同刻
    const seqFirsts = new Set(seqs.map((g) => g.first));
    if ([0, 1, 2, 3, 4, 5, 6].some((n) => seqFirsts.has(n) && seqFirsts.has(n + 9) && seqFirsts.has(n + 18))) yaku('sanshoku', 2, 1);
    if ([0, 9, 18].some((b) => seqFirsts.has(b) && seqFirsts.has(b + 3) && seqFirsts.has(b + 6))) yaku('ittsu', 2, 1);
    if ([0, 1, 2, 3, 4, 5, 6, 7, 8].some((n) => triKinds.has(n) && triKinds.has(n + 9) && triKinds.has(n + 18))) yaku('sanshokuDoukou', 2);

    // 混全帯么九・純全帯么九（順子が 1 つは要る。全部が刻子なら混老頭・清老頭）
    const groupHasTerm = (g: Group) => (g.type === 'seq' ? g.first % 9 === 0 || g.first % 9 === 6 : isTermOrHonor(g.first));
    if (seqs.length > 0 && isTermOrHonor(r.pair) && r.groups.every(groupHasTerm)) {
      if (hasHonor) yaku('chanta', 2, 1);
      else yaku('junchan', 3, 2);
    }

    if (tris.length === 4) yaku('toitoi', 2);
    if (tris.filter((g) => !g.open).length === 3) yaku('sanankou', 2);
    if (ctx.melds.filter((m) => m.type === 'kan').length === 3) yaku('sankantsu', 2);
    if (DRAGONS.filter((k) => triKinds.has(k)).length === 2 && DRAGONS.includes(r.pair)) yaku('shousangen', 2);
  }

  return { reading: r, yaku: hits, han: hits.reduce((a, b) => a + b.han, 0), yakuman: 0 };
}

/** 読み方ごとに役を数えた候補を全部返す（アガリの形でなければ空） */
export function judgeAll(ctx: WinContext): YakuResult[] {
  return readings(ctx).map((r) => judgeReading(ctx, r));
}

/** 仮の選び方：役満の数 → 翻 の大きい候補。符まで見た選び方は点数の計算の側でする */
export function bestYaku(ctx: WinContext): YakuResult | null {
  let best: YakuResult | null = null;
  for (const r of judgeAll(ctx)) {
    if (!best || r.yakuman > best.yakuman || (r.yakuman === best.yakuman && r.han > best.han)) best = r;
  }
  return best;
}
