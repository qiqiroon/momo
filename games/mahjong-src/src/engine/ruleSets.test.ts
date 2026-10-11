import { describe, expect, it } from 'vitest';
import doc from './ruleTable.doc.json';
import { JP_RULE_ITEMS, JP_SETS, blockedBy, decodeRuleLink, encodeRuleLink, labelOf, rulesOfSet } from './ruleSets';
import { GENERAL_RULES, JP_RULE_KEYS, type JpRuleKey } from './rules';
import { runGames } from '../selfplay/run';

const valuesOf = (set: (typeof JP_SETS)[number]) => {
  const r = rulesOfSet(set);
  if (r.family !== 'jp') throw new Error('日本式でない');
  return { ...r.values } as Record<JpRuleKey, string>;
};

describe('ルールセット（段階6の6a）', () => {
  it('★セットを選んだ値が、ルール設定 v0.03 の表と全項目一致する（11 セット×72 項目）', () => {
    const sets = (doc as { sets: Record<string, Record<string, string>> }).sets;
    expect(Object.keys(sets).sort()).toEqual([...JP_SETS].sort());
    for (const set of JP_SETS) expect(valuesOf(set), set).toEqual(sets[set]);
    expect(JP_RULE_KEYS.length).toBe(72);
  });

  it('一般ルールの値は、これまで動かしてきた一般ルール（GENERAL_RULES）と同じ', () => {
    expect(rulesOfSet('general')).toEqual(GENERAL_RULES);
  });

  it('どのセットの値も、その項目の選択肢のどれか', () => {
    for (const set of JP_SETS) for (const it of JP_RULE_ITEMS) expect(it.opts.map((o) => o[0]), `${set} ${it.k}`).toContain(valuesOf(set)[it.k]);
  });

  it('個別に変えると「カスタム」、別のセットと全部同じになればそのセット', () => {
    const v = valuesOf('general');
    expect(labelOf(v, 'general')).toBe('general');
    expect(labelOf({ ...v, kuitan: 'off' }, 'general')).toBe('custom');
    expect(labelOf(valuesOf('tenhou'), 'general')).toBe('tenhou');
  });

  it('押せない理由は別の項目の値と矛盾するときだけ（返し点なしのときオカは選べない）', () => {
    const v = valuesOf('general');
    expect(blockedBy(v, 'oka')).toBeNull();
    expect(blockedBy({ ...v, kaeshi: 'none' }, 'oka')).toEqual({ k: 'kaeshi', value: 'none' });
    expect(blockedBy(v, 'kuitan')).toBeNull();
  });

  it('マイルールのリンク：変えた項目だけを書き、読み直すと同じルールになる（11 セット×全項目を 1 つずつ変えて往復）', () => {
    expect(encodeRuleLink({ base: 'tenhou', values: valuesOf('tenhou') })).toBe('tenhou');
    expect(encodeRuleLink({ base: 'tenhou', values: { ...valuesOf('tenhou'), ippatsu: 'off' } })).toBe('tenhou.ippatsu_off');
    let n = 0;
    for (const set of JP_SETS) {
      for (const it of JP_RULE_ITEMS) {
        for (const [v] of it.opts) {
          const c = { base: set, values: { ...valuesOf(set), [it.k]: v } };
          expect(decodeRuleLink(encodeRuleLink(c)), `${set} ${it.k}=${v}`).toEqual(c);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(11 * 72);
  });

  it('マイルールのリンク：知らないセット・知らない値・形の崩れは読まない。あとで消えた項目は飛ばす', () => {
    expect(decodeRuleLink('nope')).toBeNull();
    expect(decodeRuleLink('tenhou.ippatsu_maybe')).toBeNull();
    expect(decodeRuleLink('tenhou.ippatsu')).toBeNull();
    expect(decodeRuleLink('tenhou.gone_on')).toEqual({ base: 'tenhou', values: valuesOf('tenhou') });
    expect(decodeRuleLink('general.uma_5-15')?.values.uma).toBe('5-15');
  });

  it('★どのセットの値でも、半荘を最後まで打てる（各セット 6 対局・失敗 0）', () => {
    for (const set of JP_SETS) {
      const r = runGames(6, `set-${set}`, rulesOfSet(set));
      expect(r.failures, set).toEqual([]);
      expect(r.games).toBe(6);
    }
  }, 120_000);
});
