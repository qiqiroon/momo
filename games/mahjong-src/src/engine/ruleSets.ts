// ルールセットを選ぶ・個別に変える（段階6の6a）。動きは見本 settings.html と同じ：
//  - セットを選ぶと、そのセットの値（条文なしは MOMO が補った値）が全項目に入る
//  - 個別に変えて、同じ種類（日本式）のどのセットとも全項目が一致しなければ「カスタム」
//  - 押せない理由は「別の項目の値と矛盾する」ことだけ
// 表そのものは ruleTable.ts（見本から写したもの）。

import { CN_ITEMS, FAMILY, JP_ITEMS, ORDER, ORDER_CN, SUPP, SUPP_CN, TIERS, type RuleItem } from './ruleTable';
import { CN_RULE_KEYS, JP_RULE_KEYS, type CnRuleKey, type JpRuleKey, type Rules } from './rules';

export type SetId = (typeof ORDER)[number];
export const JP_SETS: readonly SetId[] = ORDER;

/** 日本式の設定項目（見出しの行を除く） */
export const JP_RULE_ITEMS: readonly (RuleItem & { k: JpRuleKey; name: string; opts: NonNullable<RuleItem['opts']>; v: NonNullable<RuleItem['v']> })[] =
  JP_ITEMS.filter((x): x is RuleItem & { k: JpRuleKey; name: string; opts: NonNullable<RuleItem['opts']>; v: NonNullable<RuleItem['v']> } => !!x.k);

/** セットの、その項目の値（条文が無ければ MOMO が補った値） */
export function presetValue(set: SetId, k: JpRuleKey): string {
  const it = JP_RULE_ITEMS.find((x) => x.k === k);
  if (!it) throw new Error(`知らない項目: ${k}`);
  const v = it.v[ORDER.indexOf(set)];
  const filled = v ?? SUPP[set]?.[k] ?? null;
  if (filled === null) throw new Error(`値が決まっていない: ${set} の ${k}`);
  return filled;
}

/** その値が「条文なし→MOMO が補った値」か */
export function isSupplied(set: SetId, k: JpRuleKey): boolean {
  const it = JP_RULE_ITEMS.find((x) => x.k === k);
  return !!it && it.v[ORDER.indexOf(set)] === null && SUPP[set]?.[k] !== undefined;
}

/** セットのルール（全 72 項目） */
export function rulesOfSet(set: SetId): Rules {
  const values = {} as Record<JpRuleKey, string>;
  for (const k of JP_RULE_KEYS) values[k] = presetValue(set, k);
  return { family: 'jp', values };
}

/** いまの値が、どのセットと全項目一致するか（基にしたセットを先に見る）。どれとも違えば 'custom' */
export function labelOf(values: Readonly<Record<JpRuleKey, string>>, base: SetId): SetId | 'custom' {
  const match = (set: SetId) => JP_RULE_KEYS.every((k) => values[k] === presetValue(set, k));
  if (match(base)) return base;
  return JP_SETS.find(match) ?? 'custom';
}

/** 押せない理由（別の項目の値と矛盾するときだけ）。押せるなら null。dep は [項目, 値, ('not')] */
export function blockedBy(values: Readonly<Record<JpRuleKey, string>>, k: JpRuleKey): { k: JpRuleKey; value: string } | null {
  const it = JP_RULE_ITEMS.find((x) => x.k === k);
  const dep = it?.dep;
  if (!dep) return null;
  const other = dep[0] as JpRuleKey;
  const ok = dep[2] === 'not' ? values[other] !== dep[1] : values[other] === dep[1];
  return ok ? null : { k: other, value: values[other] };
}

/** 選んだルール：基にしたセットと全項目の値（CPU 対局の設定・オンラインでホストが配るもの） */
export interface RuleChoice {
  base: SetId;
  values: Record<JpRuleKey, string>;
  /** 中国式のセットを選んだとき（段階9。いまは CPU と対局の四川だけ・個別設定はまだ無い）。日本式の値は前のまま持っておく */
  cn?: CnSetId;
}

/** 一般ルールを選んだ状態 */
export function generalChoice(): RuleChoice {
  const g = rulesOfSet('general');
  return { base: 'general', values: { ...(g.values as Record<JpRuleKey, string>) } };
}

/** 届いたもの（オンラインでホストから）を確かめて、選んだルールにする。全項目がそろい、どれも選択肢のどれかでなければ null */
export function ruleChoiceOf(raw: unknown): RuleChoice | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { base?: unknown; values?: unknown };
  if (typeof r.base !== 'string' || !(JP_SETS as readonly string[]).includes(r.base)) return null;
  if (!r.values || typeof r.values !== 'object') return null;
  const src = r.values as Record<string, unknown>;
  const values = {} as Record<JpRuleKey, string>;
  for (const it of JP_RULE_ITEMS) {
    const v = src[it.k];
    if (typeof v !== 'string' || !it.opts.some((o) => o[0] === v)) return null;
    values[it.k] = v;
  }
  return { base: r.base as SetId, values };
}

/**
 * マイルールのリンク（段階6の6c）：「基にしたセット.項目_値.項目_値…」（変えた項目だけ。例 tenhou.ippatsu_off）。
 * 項目の名前で書くので、あとで項目が増えたり並びが変わったりしても古いリンクを読める
 */
export function encodeRuleLink(c: RuleChoice): string {
  const diffs = JP_RULE_ITEMS.filter((it) => c.values[it.k] !== presetValue(c.base, it.k)).map((it) => `${it.k}_${c.values[it.k]}`);
  return [c.base, ...diffs].join('.');
}

/** リンクを読む。知らないセット・知っている項目の知らない値なら null。知らない項目（あとで消した項目）は飛ばす */
export function decodeRuleLink(code: string): RuleChoice | null {
  const [base, ...parts] = code.split('.');
  if (!(JP_SETS as readonly string[]).includes(base)) return null;
  const r = rulesOfSet(base as SetId);
  const values = { ...(r.values as Record<JpRuleKey, string>) };
  for (const part of parts) {
    const i = part.indexOf('_');
    if (i <= 0) return null;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    const it = JP_RULE_ITEMS.find((x) => x.k === k);
    if (!it) continue;
    if (!it.opts.some((o) => o[0] === v)) return null;
    values[it.k] = v;
  }
  return { base: base as SetId, values };
}

/**
 * ルールの全項目の値（「項目_値.項目_値…」）。牌譜と同じ山で勝負のリンクに使う。
 * セットとの差だけを書くマイルールのリンクと違い、あとでセットの値が変わっても、遊んだときのルールのまま読める
 */
export function encodeRuleValues(values: Readonly<Record<JpRuleKey, string>>): string {
  return JP_RULE_ITEMS.map((it) => `${it.k}_${values[it.k]}`).join('.');
}

/** 全項目の値を読む。書いていない項目（あとで足した項目）は一般ルールの値。知っている項目の知らない値なら null */
export function decodeRuleValues(code: string): Record<JpRuleKey, string> | null {
  const values = { ...(rulesOfSet('general').values as Record<JpRuleKey, string>) };
  for (const part of code.split('.')) {
    const i = part.indexOf('_');
    if (i <= 0) return null;
    const it = JP_RULE_ITEMS.find((x) => x.k === part.slice(0, i));
    if (!it) continue;
    const v = part.slice(i + 1);
    if (!it.opts.some((o) => o[0] === v)) return null;
    values[it.k] = v;
  }
  return values;
}

export type CnSetId = (typeof ORDER_CN)[number];

/** 中国式のセットのルール（全 36 項目。条文が無ければ MOMO が補った値）。段階9 で画面につなぐ */
export function rulesOfCnSet(set: CnSetId): Rules {
  const values = {} as Record<CnRuleKey, string>;
  for (const k of CN_RULE_KEYS) {
    const it = CN_ITEMS.find((x) => x.k === k);
    if (!it?.v) throw new Error(`知らない項目: ${k}`);
    const v = it.v[ORDER_CN.indexOf(set)] ?? SUPP_CN[set]?.[k] ?? null;
    if (v === null) throw new Error(`値が決まっていない: ${set} の ${k}`);
    values[k] = v;
  }
  return { family: 'cn', values };
}

/** セットの表示名（日本語・見本のまま） */
export function setNameJa(set: string): string {
  for (const t of TIERS) for (const s of t.sets) if (s[0] === set) return s[1];
  return set;
}

export const familyOf = (set: string): 'jp' | 'cn' => FAMILY[set] ?? 'jp';
