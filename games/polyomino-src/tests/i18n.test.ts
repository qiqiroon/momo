import { afterEach, describe, expect, it } from 'vitest';
import { catStrings, S, setLang } from '../src/ui/strings';

/** 表の中の文字をすべて取り出す（関数は代わりの引数で呼ぶ） */
function texts(table: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'function') out.push(String((v as (...a: unknown[]) => unknown)(4, 2, 40)));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(table);
  return out;
}
const KANA = /[぀-ヿ]/;

afterEach(() => setLang('ja'));

describe('言語', () => {
  it('英語と中国語の表に、日本語のかなが残っていない', () => {
    for (const lang of ['en', 'zh'] as const) {
      setLang(lang);
      expect(texts(S).filter((t) => KANA.test(t)), lang).toEqual([]);
    }
  });

  it('説明文には、どの言語でも昔のプラスチックのパズルを指す一文が入っている（仕様書 §9.6）', () => {
    setLang('ja');
    expect(S.footDesc).toContain('昭和生まれならわかる');
    expect(S.footDesc).toContain('プラスチックのピース');
    setLang('en');
    expect(S.footDesc).toMatch(/'70s or '80s/);
    expect(S.footDesc).toContain('plastic pieces');
    setLang('zh');
    expect(S.footDesc).toContain('70后、80后');
    expect(S.footDesc).toContain('塑料');
    // 猫語でも説明文は鳴き声にしない
    expect(catStrings('ja').footDesc).toContain('昭和生まれならわかる');
    expect(catStrings('en').footDesc).toContain('plastic pieces');
  });

  it('画面の文言にメーカー名を出さない（仕様書 §2.6）', () => {
    for (const lang of ['ja', 'en', 'zh'] as const) {
      setLang(lang);
      expect(texts(S).filter((t) => /テンヨー|Tenyo|天洋|プラパズル/i.test(t)), lang).toEqual([]);
    }
  });

  it('猫語：名前と LEVEL の書式はそのまま、ほかは鳴き声', () => {
    const cat = catStrings('en', () => 0);
    expect(cat.title).toBe('MOMO Polyomino');
    expect(cat.levelLabel(4)).toBe('LEVEL 4');
    expect(cat.selectLevel).toBe('MEOW');
    expect(cat.variant.legacy).toBe('MEOW');
  });
});
