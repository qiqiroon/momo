import { describe, expect, it } from 'vitest';
import doc from './ruleTable.doc.json';
import { CN_RULE_ITEMS, CN_SETS, JP_RULE_ITEMS, JP_SETS, blockedBy, cnBlockedBy, cnConsistent, cnLabelOf, cnOptionBlockedBy, decodeRuleLink, encodeRuleLink, labelOf, rulesOfCnSet, rulesOfSet } from './ruleSets';
import { CN_RULE_KEYS, GENERAL_RULES, JP_RULE_KEYS, type CnRuleKey, type JpRuleKey } from './rules';
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

const cnValuesOf = (set: (typeof CN_SETS)[number]) => {
  const r = rulesOfCnSet(set);
  if (r.family !== 'cn') throw new Error('中国式でない');
  return { ...r.values } as Record<CnRuleKey, string>;
};

describe('中国式のルールセットと個別設定（2026-10-13 第16）', () => {
  it('どのセットの値も選択肢のどれかで、同時に成り立ってはいけない組み合わせを含まず、選んだ値はどれも押せる', () => {
    expect(CN_RULE_KEYS.length).toBe(37);
    for (const set of CN_SETS) {
      const v = cnValuesOf(set);
      expect(cnConsistent(v), set).toBe(true);
      expect(cnLabelOf(v, set)).toBe(set);
      for (const it of CN_RULE_ITEMS) {
        expect(it.opts.map((o) => o[0]), `${set} ${it.k}`).toContain(v[it.k]);
        expect(cnOptionBlockedBy(v, it.k, v[it.k]), `${set} ${it.k}`).toBeNull();
      }
    }
  });

  it('個別に変えると「カスタム」、別のセットと全部同じになればそのセット', () => {
    const v = cnValuesOf('sichuan');
    expect(cnLabelOf({ ...v, tobi: 'on' }, 'sichuan')).toBe('custom');
    expect(cnLabelOf(cnValuesOf('hk'), 'sichuan')).toBe('hk');
  });

  it('数え方によって意味のない項目は、項目ごと押せない（理由は点数の数え方・払い方）', () => {
    const mcr = cnValuesOf('mcr');
    for (const k of ['cap', 'rinshan', 'haitei', 'tenhou', 'baopai'] as const) expect(cnBlockedBy(mcr, k)?.k, k).toBe(k === 'baopai' ? 'pay' : 'scoring');
    expect(cnBlockedBy(mcr, 'qidui')).toBeNull();
    const hk = cnValuesOf('hk');
    expect(cnBlockedBy(hk, 'qidui')).toEqual({ k: 'scoring', value: 'hk' });
    for (const k of ['cap', 'rinshan', 'haitei', 'tenhou', 'baopai'] as const) expect(cnBlockedBy(hk, k), k).toBeNull();
  });

  it('選択肢ごとの矛盾：香港式の払いは香港の番だけ・香港の番は最低の番「なし」と組めない・上限 3 番と最低 8 番は組めない（国標の番を除く）', () => {
    const sc = cnValuesOf('sichuan');
    expect(cnOptionBlockedBy(sc, 'pay', 'hk')).toEqual([{ k: 'scoring', value: 'sichuan' }]);
    expect(cnOptionBlockedBy(sc, 'scoring', 'hk')).toEqual([{ k: 'minFan', value: '0' }]);
    expect(cnOptionBlockedBy(sc, 'minFan', '8')).toEqual([
      { k: 'cap', value: '3' },
      { k: 'scoring', value: 'sichuan' },
    ]);
    expect(cnOptionBlockedBy(sc, 'scoring', 'mcr')).toBeNull();
    const hk = cnValuesOf('hk');
    expect(cnOptionBlockedBy(hk, 'scoring', 'mcr')).toEqual([{ k: 'pay', value: 'hk' }]);
    expect(cnOptionBlockedBy(hk, 'minFan', '0')).toEqual([{ k: 'scoring', value: 'hk' }]);
    const mcr = cnValuesOf('mcr');
    expect(cnOptionBlockedBy({ ...mcr, cap: '3' }, 'minFan', '8')).toBeNull();
    expect(cnOptionBlockedBy({ ...mcr, cap: '3' }, 'scoring', 'sichuan')).toEqual([
      { k: 'minFan', value: '8' },
      { k: 'cap', value: '3' },
    ]);
  });

  it('★押せる選択肢だけを押していくと、矛盾しない組み合わせのすべてに 3 つのセットから届き、矛盾した組み合わせには入れない', () => {
    const keys: CnRuleKey[] = ['scoring', 'pay', 'minFan', 'cap'];
    const key = (v: Record<CnRuleKey, string>) => keys.map((k) => v[k]).join('|');
    const seen = new Map<string, Record<CnRuleKey, string>>();
    for (const set of CN_SETS) {
      const q = [cnValuesOf(set)];
      seen.set(key(q[0]), q[0]);
      while (q.length) {
        const cur = q.shift()!;
        expect(cnConsistent(cur), key(cur)).toBe(true);
        for (const it of CN_RULE_ITEMS.filter((x) => keys.includes(x.k))) {
          if (cnBlockedBy(cur, it.k)) continue;
          for (const [o] of it.opts) {
            if (cnOptionBlockedBy(cur, it.k, o)) continue;
            const next = { ...cur, [it.k]: o };
            if (!seen.has(key(next))) {
              seen.set(key(next), next);
              q.push(next);
            }
          }
        }
      }
    }
    const opts = (k: CnRuleKey) => CN_RULE_ITEMS.find((x) => x.k === k)!.opts.map((o) => o[0]);
    let all = 0;
    for (const a of opts('scoring')) for (const b of opts('pay')) for (const c of opts('minFan')) for (const d of opts('cap')) {
      const v = { ...cnValuesOf('sichuan'), scoring: a, pay: b, minFan: c, cap: d };
      if (!cnConsistent(v)) continue;
      all++;
      expect(seen.has(key(v)), key(v)).toBe(true);
    }
    expect(all).toBe(49);
    expect(seen.size).toBe(49);
  });
});
