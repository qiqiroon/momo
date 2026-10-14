// ルールブックの「遊び方」：どのセットでも 3 つの言葉がそろい、ルールの値で文が切り替わるか。
import { CN_SETS, JP_SETS, rulesOfCnSet, rulesOfSet } from '../engine/ruleSets';
import { GENERAL_RULES, type Rules } from '../engine/rules';
import { howtoOf } from './howto';

const text = (r: Rules, lang: 'ja' | 'en' | 'zh' = 'ja') => howtoOf(r).flatMap((s) => [s.title[lang], ...s.lines.map((l) => l[lang])]).join('\n');

describe('遊び方', () => {
  it('日本式・中国式の全部のセットで、3 つの言葉の文がそろい、書き損じ（undefined・${）が無い', () => {
    const all: Rules[] = [...JP_SETS.map(rulesOfSet), ...CN_SETS.map(rulesOfCnSet)];
    for (const r of all) {
      for (const sec of howtoOf(r)) {
        expect(sec.lines.length).toBeGreaterThan(0);
        for (const l of [sec.title, ...sec.lines]) {
          for (const lang of ['ja', 'en', 'zh'] as const) {
            expect(l[lang].length).toBeGreaterThan(0);
            expect(l[lang]).not.toMatch(/undefined|\$\{|false/);
          }
        }
      }
    }
  });

  it('日本式：喰いタン・飛び・西入などの値で文が切り替わる', () => {
    if (GENERAL_RULES.family !== 'jp') throw new Error('日本式のはず');
    const g = GENERAL_RULES.values;
    expect(text(GENERAL_RULES)).toContain('半荘戦');
    expect(text(GENERAL_RULES)).not.toContain('喰いタンなし');
    expect(text({ family: 'jp', values: { ...g, kuitan: 'off' } })).toContain('喰いタンなし');
    expect(text({ family: 'jp', values: { ...g, length: 'east' } })).toContain('東風戦');
    expect(text(GENERAL_RULES)).toContain('飛び');
    expect(text({ family: 'jp', values: { ...g, tobi: 'off' } })).not.toContain('飛び');
    // 西入は返し点が 30000 のときだけ効く（game.ts）
    expect(text(GENERAL_RULES)).toContain('西場');
    expect(text({ family: 'jp', values: { ...g, kaeshi: 'none' } })).not.toContain('西場');
  });

  it('中国式：四川は缺一門と血戦到底、国標は 8 番と花牌、香港は換算表', () => {
    expect(text(rulesOfCnSet('sichuan'))).toContain('缺一門');
    expect(text(rulesOfCnSet('sichuan'))).toContain('血戦到底');
    expect(text(rulesOfCnSet('mcr'))).toContain('8番以上');
    expect(text(rulesOfCnSet('mcr'))).toContain('補花');
    expect(text(rulesOfCnSet('hk'))).toContain('10→512');
    expect(text(rulesOfCnSet('sichuan'))).toContain('108枚');
    expect(text(rulesOfCnSet('mcr'))).toContain('144枚');
  });
});
