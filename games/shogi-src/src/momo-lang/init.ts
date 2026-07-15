import '@momo-lib/momo-lang/momo-lang.js';
import { useI18nStore, type LocaleMode, type CatBase } from '../core/store/i18n-store';
import type { LocaleCode } from '../core/i18n/types';

interface MomoLangBindOpts {
  supportedLangs?: LocaleCode[];
  detectMap?: [string, LocaleCode][];
  fallback?: LocaleCode;
}

interface MomoLangApi {
  VERSION: string;
  bind: (appId: string, opts: MomoLangBindOpts) => void;
  detect: (appId: string) => LocaleCode;
  getMode: (appId: string) => string;
  getCatBase: (appId: string) => LocaleCode;
  resolve: (appId: string) => LocaleCode;
  setMode: (appId: string, mode: string) => LocaleCode;
}

declare global {
  interface Window {
    MomoLang: MomoLangApi;
  }
}

const APP_ID = 'shogi';

window.MomoLang.bind(APP_ID, {
  supportedLangs: ['ja', 'en', 'zh', 'cat'],
});

// v0.64: catBase を安全に ja/en/zh に丸める (momo-lang が別の値を返した場合の防御)
function safeCatBase(v: string): CatBase {
  return v === 'en' || v === 'zh' ? v : 'ja';
}

useI18nStore.setState({
  mode: window.MomoLang.getMode(APP_ID) as LocaleMode,
  locale: window.MomoLang.resolve(APP_ID),
  catBase: safeCatBase(window.MomoLang.getCatBase(APP_ID)),
});

useI18nStore.subscribe((state, prev) => {
  if (state.mode !== prev.mode) {
    const resolved = window.MomoLang.setMode(APP_ID, state.mode);
    useI18nStore.getState().setLocale(resolved);
    // v0.64: mode 変更時に momo-lang 側の catBase (前回言語) も反映
    useI18nStore.getState().setCatBase(safeCatBase(window.MomoLang.getCatBase(APP_ID)));
  }
});
