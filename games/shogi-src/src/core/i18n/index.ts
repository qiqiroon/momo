import type { LocaleCode, LocaleData } from './types';
import { ja } from './translations/ja';
import { en } from './translations/en';
import { zh } from './translations/zh';
import { get as pluginGet } from '../plugin/registry';

const builtInLocales: Record<LocaleCode, LocaleData> = {
  ja,
  en,
  zh,
};

export function t(key: string, locale: LocaleCode): string {
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
