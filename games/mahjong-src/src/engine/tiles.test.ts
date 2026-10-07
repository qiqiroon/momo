import { GENERAL_RULES, CN_RULE_KEYS, type CnRuleKey, type Rules } from './rules';
import { KIND_CODES, MAX_TILES, codeOf, isRed, kindOf, tileSetFor } from './tiles';

/** 中国式のルールを、指定した項目だけ変えて作る（中国式の既定セットは段階9で入る） */
function cnRules(over: Partial<Record<CnRuleKey, string>>): Rules {
  const values = Object.fromEntries(CN_RULE_KEYS.map((k) => [k, ''])) as Record<CnRuleKey, string>;
  return { family: 'cn', values: { ...values, ...over } };
}

describe('牌の背番号と表', () => {
  it('背番号は最大の 144 枚ぶん・種類は 42', () => {
    expect(MAX_TILES).toBe(144);
    expect(KIND_CODES).toHaveLength(42);
  });

  it('数牌・字牌は各 4 枚、花牌は各 1 枚', () => {
    const count = new Map<number, number>();
    for (let id = 0; id < MAX_TILES; id++) count.set(kindOf(id), (count.get(kindOf(id)) ?? 0) + 1);
    for (let k = 0; k < 34; k++) expect(count.get(k)).toBe(4);
    for (let k = 34; k < 42; k++) expect(count.get(k)).toBe(1);
  });

  it('名前の例', () => {
    expect(codeOf(0)).toBe('1m');
    expect(codeOf(4 * 4)).toBe('5m');
    expect(codeOf(27 * 4)).toBe('1z');
    expect(codeOf(135)).toBe('7z');
    expect(codeOf(136)).toBe('f1');
    expect(codeOf(143)).toBe('f8');
  });

  it('範囲外の背番号は受け付けない', () => {
    expect(() => kindOf(-1)).toThrow();
    expect(() => kindOf(144)).toThrow();
    expect(() => kindOf(1.5)).toThrow();
  });

  it('使う牌の数：日本式 136・四川 108・国標 144・香港 136', () => {
    expect(tileSetFor(GENERAL_RULES)).toHaveLength(136);
    expect(tileSetFor(cnRules({ honors: 'off', flower: 'off' }))).toHaveLength(108);
    expect(tileSetFor(cnRules({ honors: 'on', flower: 'on' }))).toHaveLength(144);
    expect(tileSetFor(cnRules({ honors: 'on', flower: 'off' }))).toHaveLength(136);
  });

  it('赤5は日本式で赤ありのときだけ、5萬・5筒・5索の 1 枚ずつ', () => {
    const reds = tileSetFor(GENERAL_RULES).filter((id) => isRed(id, GENERAL_RULES));
    expect(reds.map(codeOf)).toEqual(['5m', '5p', '5s']);
    const noAka: Rules = { family: 'jp', values: { ...(GENERAL_RULES.values as Record<string, string>), aka: 'off' } } as Rules;
    expect(tileSetFor(noAka).filter((id) => isRed(id, noAka))).toHaveLength(0);
    const cn = cnRules({ honors: 'on', flower: 'on' });
    expect(tileSetFor(cn).filter((id) => isRed(id, cn))).toHaveLength(0);
  });
});
