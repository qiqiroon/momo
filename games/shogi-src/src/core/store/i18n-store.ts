import { create } from 'zustand';
import type { LocaleCode } from '../i18n/types';

export type LocaleMode = 'auto' | LocaleCode;

interface I18nState {
  mode: LocaleMode;
  locale: LocaleCode;
  setMode: (mode: LocaleMode) => void;
  setLocale: (locale: LocaleCode) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  mode: 'auto',
  locale: 'ja',
  setMode: (mode) => set({ mode }),
  setLocale: (locale) => set({ locale }),
}));
