import { describe, expect, it } from 'vitest';
import { missingTranslations, optLabel, ruleName } from './ruleText';

describe('ルールの設定画面の言葉', () => {
  it('72 項目の名前・選択肢・注記・まとまりに、英語と中国語の訳が全部ある', () => {
    expect(missingTranslations()).toEqual([]);
  });

  it('日本語は見本の言葉のまま。数だけの選択肢は訳さない', () => {
    expect(ruleName('kuitan', 'ja')).toBe('喰いタン');
    expect(ruleName('kuitan', 'en')).toBe('Open tanyao (kuitan)');
    expect(optLabel('start', '25', 'en')).toBe('25000');
    expect(optLabel('kuitan', 'on', 'zh')).toBe('有');
  });
});
