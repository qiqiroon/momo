// ── i18n ストア（zustand）＋ momo-lang 連携
//   モード（auto/ja/en/zh/cat）は MOMO 共通ライブラリ momo-lang が管理し、アプリ間で引き継ぐ。

import { create } from 'zustand';
import '@momo-lib/momo-lang/momo-lang.js';
import { translate, resetCatCache, type CatBase, type Lang } from './dict';

const APP_ID = 'kjcards';

export type LangMode = 'auto' | 'ja' | 'en' | 'zh' | 'cat';

interface MomoLangApi {
  bind: (appId: string, opts: { supportedLangs?: string[] }) => void;
  getMode: (appId: string) => string;
  getCatBase: (appId: string) => string;
  resolve: (appId: string) => string;
  setMode: (appId: string, mode: string) => string;
}

declare global {
  interface Window {
    MomoLang: MomoLangApi;
  }
}

window.MomoLang.bind(APP_ID, { supportedLangs: ['ja', 'en', 'zh', 'cat'] });

function safeCatBase(v: string): CatBase {
  return v === 'en' || v === 'zh' ? v : 'ja';
}
function safeLang(v: string): Lang {
  return v === 'en' || v === 'zh' || v === 'cat' ? (v as Lang) : 'ja';
}

interface I18nState {
  mode: LangMode;
  locale: Lang;
  catBase: CatBase;
  setMode: (mode: LangMode) => void;
  t: (key: string) => string;
}

export const useI18n = create<I18nState>((set, get) => ({
  mode: (window.MomoLang.getMode(APP_ID) as LangMode) || 'auto',
  locale: safeLang(window.MomoLang.resolve(APP_ID)),
  catBase: safeCatBase(window.MomoLang.getCatBase(APP_ID)),
  setMode: (mode) => {
    const resolved = safeLang(window.MomoLang.setMode(APP_ID, mode));
    resetCatCache();
    set({ mode, locale: resolved, catBase: safeCatBase(window.MomoLang.getCatBase(APP_ID)) });
  },
  t: (key) => {
    const s = get();
    return translate(key, s.locale, s.catBase);
  },
}));

/** コンポーネントで使う翻訳フック。locale/catBase が変わると再レンダリングされる。 */
export function useT(): (key: string) => string {
  const locale = useI18n((s) => s.locale);
  const catBase = useI18n((s) => s.catBase);
  return (key: string) => translate(key, locale, catBase);
}
