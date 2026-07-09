import '@momo-lib/momo-lang/momo-lang.js';
import { useI18nStore, type LocaleMode } from '../core/store/i18n-store';
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

useI18nStore.setState({
  mode: window.MomoLang.getMode(APP_ID) as LocaleMode,
  locale: window.MomoLang.resolve(APP_ID),
});

useI18nStore.subscribe((state, prev) => {
  if (state.mode !== prev.mode) {
    const resolved = window.MomoLang.setMode(APP_ID, state.mode);
    useI18nStore.getState().setLocale(resolved);
  }
});
