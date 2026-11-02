import { afterEach, describe, expect, it } from 'vitest';
import { baseLang, catStrings, S, setLang, SUBTITLE } from '../src/ui/strings';

/** 表の中の文字をすべて取り出す（関数は代わりの引数で呼ぶ） */
function texts(table: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)('3', 'X', 'Y')));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(table);
  return out;
}
const KANA = /[぀-ヿ]/;

afterEach(() => setLang('ja'));

describe('言語（i18n-spec・cat-lang-spec）', () => {
  it('英語と中国語の表に、日本語のかなが残っていない', () => {
    for (const lang of ['en', 'zh'] as const) {
      setLang(lang);
      const bad = texts(S).filter((t) => KANA.test(t));
      expect(bad, lang).toEqual([]);
    }
  });

  it('猫語：文言はすべて鳴き声。名前と数の書式はそのまま。同じ文言は何度読んでも同じ鳴き声', () => {
    const cat = catStrings('en', () => 0);
    expect(cat.title).toBe('MOMO Cube');
    expect(cat.sizeOption(4)).toBe('4×4×4');
    expect(cat.scramble).toBe('MEOW');
    expect(cat.confirmReset).toBe('HISS!');
    expect(cat.timerWaiting).toBe('purrrr...');
    expect(cat.face.R).toBe('MEOW');
    expect(cat.hintMove('a', 'b')).toBe(cat.hintMove('c', null));
    const ja = catStrings('ja', () => 0.99);
    expect(ja.scramble).toBe('ニャ！');
    expect(texts(catStrings('zh')).filter((t) => KANA.test(t))).toEqual([]);
  });

  it('猫語のときも、サブタイトルは猫語を選ぶ前の言語', () => {
    setLang('cat', 'zh');
    expect(baseLang()).toBe('zh');
    expect(SUBTITLE[baseLang()]).toBe(SUBTITLE.zh);
    setLang('en');
    expect(baseLang()).toBe('en');
  });
});
