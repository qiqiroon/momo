/**
 * ★v1.99 ルールブックの文章を読み込む (画面機能 v0.59 §4.1 M08)。
 *
 * 文章はアプリと一緒に配る別のファイル (`public/rulebook/quantum.{ja,en,zh}.md`)。
 * 画面の言葉の表 (i18n) に入れないのは、何十段落もある文章を 1 つの言葉として持つと
 * 直すのも訳すのも扱いにくく、猫語のときに鳴き声 1 語になってしまうため。
 *
 * 一度読んだ言語は覚えておく (開くたびに取りに行かない)。
 */

export type RulebookLang = 'ja' | 'en' | 'zh';

/** いまアプリにあるルールブックは 1 冊。増えたらここに並べる (一覧の並びもこの順)。 */
export const RULEBOOKS = ['quantum'] as const;
export type RulebookId = (typeof RULEBOOKS)[number];

const cache = new Map<string, string>();

export function rulebookUrl(id: RulebookId, lang: RulebookLang, base: string = import.meta.env.BASE_URL): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return `${b}rulebook/${id}.${lang}.md`;
}

export async function loadRulebook(id: RulebookId, lang: RulebookLang): Promise<string> {
  const key = `${id}.${lang}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const res = await fetch(rulebookUrl(id, lang));
  if (!res.ok) throw new Error(`rulebook ${key}: HTTP ${res.status}`);
  const text = await res.text();
  cache.set(key, text);
  return text;
}

/** 検査用。 */
export function clearRulebookCache(): void {
  cache.clear();
}
