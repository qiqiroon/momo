// ルールセットを選ぶ・個別に変える（段階6の6a）。動きは見本 settings.html と同じ：
//  - セットを選ぶと、そのセットの値（条文なしは MOMO が補った値）が全項目に入る
//  - 個別に変えて、同じ種類（日本式）のどのセットとも全項目が一致しなければ「カスタム」
//  - 押せない理由は「別の項目の値と矛盾する」ことだけ
// 表そのものは ruleTable.ts（見本から写したもの）。

import { FAMILY, JP_ITEMS, ORDER, SUPP, TIERS, type RuleItem } from './ruleTable';
import { JP_RULE_KEYS, type JpRuleKey, type Rules } from './rules';

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

/** セットの表示名（日本語・見本のまま） */
export function setNameJa(set: string): string {
  for (const t of TIERS) for (const s of t.sets) if (s[0] === set) return s[1];
  return set;
}

export const familyOf = (set: string): 'jp' | 'cn' => FAMILY[set] ?? 'jp';
