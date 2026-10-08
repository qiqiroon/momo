// 点数の計算（日本式）。役（yaku.ts）とドラ（dora.ts）から、符・翻・点数を出す。
//
// 手の読み方が何通りもあるときは、全部の読み方で点数を出して一番高いものを採る（同点なら翻・符の大きいほう）。
// 符の数え方は変えられない決まり（ルール設定 v0.03 §4）。値で変わるのは：
//   縛り（shibari）／切り上げ満貫（kiriage）／数え役満（kazoe）／連風牌の雀頭の符（renpu）／ドラの各項目（dora.ts）
// 積み棒・供託は段階4で足す。

import { countDora, type DoraCount } from './dora';
import type { Rules } from './rules';
import { isHonor, isSuit, type KindId, type TileId } from './tiles';
import { judgeAll, type HandReading, type WinContext, type YakuHit, type YakuResult } from './yaku';

/** 点数の段階。none＝符と翻で数える */
export type Limit = 'none' | 'mangan' | 'haneman' | 'baiman' | 'sanbaiman' | 'kazoe' | 'yakuman';

/** 支払い。ツモ＝親が払う分と子が払う分（親のアガリなら子 3 人が同じ額）／ロン＝放銃者 1 人 */
export type Payment =
  | { type: 'tsumo'; fromDealer: number; fromOthers: number }
  | { type: 'ron'; amount: number };

export interface ScoreResult {
  reading: HandReading;
  yaku: YakuHit[];
  dora: DoraCount;
  /** 役とドラを合わせた翻（役満のときは 0） */
  han: number;
  /** 符（役満のときは 0） */
  fu: number;
  /** 役満の倍数（数え役満は 1） */
  yakuman: number;
  limit: Limit;
  /** 基本点（符 × 2^(翻+2)、満貫以上は段階の値） */
  base: number;
  payment: Payment;
  /** アガった人が受け取る合計 */
  total: number;
  /** 場風・自風（表示で「場風 東」のように出すため） */
  winds: { roundWind: KindId; seatWind: KindId };
}

export interface WinInput {
  ctx: WinContext;
  /** アガった手の全部の背番号（鳴いた面子の牌も含む）。赤ドラとドラを数える */
  tiles: readonly TileId[];
  /** めくられたドラ表示牌 */
  indicators: readonly TileId[];
  /** めくった裏ドラ表示牌（リーチでアガったときだけ） */
  ura: readonly TileId[];
  /** アガった人が親か */
  dealer: boolean;
}

const isTermOrHonor = (k: KindId) => isHonor(k) || (isSuit(k) && (k % 9 === 0 || k % 9 === 8));
const DRAGONS: readonly KindId[] = [31, 32, 33];
const ceil100 = (n: number) => Math.ceil(n / 100) * 100;

/** 符。七対子は 25 符。平和のツモは 20 符。鳴いて 20 符にしかならない手は 30 符 */
export function fuOf(ctx: WinContext, r: HandReading, pinfu: boolean): number {
  if (r.form === 'chiitoitsu') return 25;
  if (r.form === 'kokushi') return 0;
  if (pinfu && ctx.tsumo) return 20;
  const menzen = ctx.melds.every((m) => !m.open);
  let fu = 20;
  if (menzen && !ctx.tsumo) fu += 10;
  if (ctx.tsumo) fu += 2;
  // 雀頭
  if (DRAGONS.includes(r.pair)) fu += 2;
  const seat = r.pair === ctx.seatWind;
  const round = r.pair === ctx.roundWind;
  if (seat && round) {
    fu += ctx.rules.family === 'jp' && ctx.rules.values.renpu === '4' ? 4 : 2;
  } else if (seat || round) {
    fu += 2;
  }
  // 待ち
  if (r.wait === 'kanchan' || r.wait === 'penchan' || r.wait === 'tanki') fu += 2;
  // 刻子・槓子：中張牌の明刻 2・暗刻 4、么九牌は 2 倍、槓子はさらに 4 倍
  for (const g of r.groups) {
    if (g.type !== 'tri') continue;
    let n = isTermOrHonor(g.first) ? 4 : 2;
    if (!g.open) n *= 2;
    if (g.kan) n *= 4;
    fu += n;
  }
  fu = Math.ceil(fu / 10) * 10;
  if (!menzen && fu === 20) fu = 30;
  return fu;
}

/** 縛り：役だけ（ドラは入れない）で何翻あればアガれるか。「5本場から2翻」は積み棒が入る段階4で本場数を渡す */
export function minHan(rules: Rules, honba = 0): number {
  if (rules.family !== 'jp') return 1;
  const s = rules.values.shibari;
  if (s === '2') return 2;
  if (s === '5h2') return honba >= 5 ? 2 : 1;
  return 1;
}

/** 翻と符から、点数の段階と基本点 */
export function baseOf(han: number, fu: number, rules: Rules): { limit: Limit; base: number } {
  const v = rules.family === 'jp' ? rules.values : null;
  if (han >= 13) return v?.kazoe === 'on' ? { limit: 'kazoe', base: 8000 } : { limit: 'sanbaiman', base: 6000 };
  if (han >= 11) return { limit: 'sanbaiman', base: 6000 };
  if (han >= 8) return { limit: 'baiman', base: 4000 };
  if (han >= 6) return { limit: 'haneman', base: 3000 };
  if (han >= 5) return { limit: 'mangan', base: 2000 };
  const base = fu * 2 ** (han + 2);
  if (base >= 2000) return { limit: 'mangan', base: 2000 };
  // 切り上げ満貫：30 符 4 翻・60 符 3 翻（どちらも基本点 1920）
  if (v?.kiriage === 'on' && base === 1920) return { limit: 'mangan', base: 2000 };
  return { limit: 'none', base };
}

/** 基本点から支払い */
export function paymentOf(base: number, dealer: boolean, tsumo: boolean): { payment: Payment; total: number } {
  if (!tsumo) {
    const amount = ceil100(base * (dealer ? 6 : 4));
    return { payment: { type: 'ron', amount }, total: amount };
  }
  if (dealer) {
    const each = ceil100(base * 2);
    return { payment: { type: 'tsumo', fromDealer: 0, fromOthers: each }, total: each * 3 };
  }
  const fromDealer = ceil100(base * 2);
  const fromOthers = ceil100(base);
  return { payment: { type: 'tsumo', fromDealer, fromOthers }, total: fromDealer + fromOthers * 2 };
}

const windsOf = (ctx: WinContext) => ({ roundWind: ctx.roundWind, seatWind: ctx.seatWind });

function scoreReading(input: WinInput, y: YakuResult, dora: DoraCount): ScoreResult | null {
  const { ctx } = input;
  if (y.yakuman > 0) {
    const base = 8000 * y.yakuman;
    return { reading: y.reading, yaku: y.yaku, dora: { dora: 0, aka: 0, ura: 0 }, han: 0, fu: 0, yakuman: y.yakuman, limit: 'yakuman', base, ...paymentOf(base, input.dealer, ctx.tsumo), winds: windsOf(ctx) };
  }
  if (y.han < minHan(ctx.rules, ctx.honba ?? 0)) return null;
  const pinfu = y.yaku.some((h) => h.id === 'pinfu');
  const fu = fuOf(ctx, y.reading, pinfu);
  const han = y.han + dora.dora + dora.aka + dora.ura;
  const { limit, base } = baseOf(han, fu, ctx.rules);
  return { reading: y.reading, yaku: y.yaku, dora, han, fu, yakuman: limit === 'kazoe' ? 1 : 0, limit, base, ...paymentOf(base, input.dealer, ctx.tsumo), winds: windsOf(ctx) };
}

/** アガリの点数。役が無い（縛りに届かない）・アガリの形でないなら null */
export function scoreWin(input: WinInput): ScoreResult | null {
  const dora = countDora(input.tiles, input.indicators, input.ura, input.ctx.rules);
  let best: ScoreResult | null = null;
  for (const y of judgeAll(input.ctx)) {
    const r = scoreReading(input, y, dora);
    if (!r) continue;
    if (!best || r.total > best.total || (r.total === best.total && (r.han > best.han || (r.han === best.han && r.fu > best.fu)))) best = r;
  }
  return best;
}
