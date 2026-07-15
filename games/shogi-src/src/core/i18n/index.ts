import type { LocaleCode, LocaleData } from './types';
import { ja } from './translations/ja';
import { en } from './translations/en';
import { zh } from './translations/zh';
import { get as pluginGet } from '../plugin/registry';
import { useI18nStore } from '../store/i18n-store';

const builtInLocales: Record<LocaleCode, LocaleData> = {
  ja,
  en,
  zh,
};

/** v0.64: cat モードで t() から呼ぶ動的生成器 (catSpeak) 用の型。
 *  features/cat-lang が起動時にプラグイン登録 (`i18n:cat-speak`) する。 */
type CatSpeaker = (key: string, base: 'ja' | 'en' | 'zh') => string;

export function t(key: string, locale: LocaleCode): string {
  // v0.64: 猫語モードは辞書ではなく動的ランダム生成 (cat-lang-spec.txt 準拠)。
  // features/cat-lang が登録した speaker がいれば呼び、無ければ ja 辞書にフォールバック。
  if (locale === 'cat') {
    const speaker = pluginGet<CatSpeaker>('i18n:cat-speak');
    if (speaker) {
      const base = useI18nStore.getState().catBase;
      return speaker(key, base);
    }
  }
  const data = resolveLocaleData(locale);
  if (data && key in data.translations) return data.translations[key];
  const fallback = builtInLocales.ja;
  return fallback.translations[key] ?? key;
}

export function availableLocales(): LocaleCode[] {
  const codes = new Set<LocaleCode>(Object.keys(builtInLocales));
  const cat = pluginGet<LocaleData>('i18n:cat');
  if (cat) codes.add(cat.code);
  return Array.from(codes);
}

function resolveLocaleData(code: LocaleCode): LocaleData | undefined {
  if (code in builtInLocales) return builtInLocales[code];
  return pluginGet<LocaleData>(`i18n:${code}`);
}
