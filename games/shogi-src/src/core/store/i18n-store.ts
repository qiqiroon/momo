import { create } from 'zustand';
import type { LocaleCode } from '../i18n/types';

export type LocaleMode = 'auto' | LocaleCode;
/** 猫語モードの語彙選択に使う「直前の言語」。ja/en/zh のみ (auto は解決後の値)。 */
export type CatBase = 'ja' | 'en' | 'zh';

interface I18nState {
  mode: LocaleMode;
  locale: LocaleCode;
  /** v0.64: CAT モード選択直前の言語を保持し、catSpeak() の語彙選択に使う */
  catBase: CatBase;
  setMode: (mode: LocaleMode) => void;
  setLocale: (locale: LocaleCode) => void;
  setCatBase: (base: CatBase) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  mode: 'auto',
  locale: 'ja',
  catBase: 'ja',
  setMode: (mode) => set({ mode }),
  setLocale: (locale) => set({ locale }),
  setCatBase: (catBase) => set({ catBase }),
}));
