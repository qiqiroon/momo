/**
 * MOMO 共通 言語ルーチン（`lib/momo-lang`）への橋渡し（実装指示書 段階6）
 *
 * 言語モード（auto / ja / en / zh / cat）の判定・保存・アプリ間の引き継ぎは共通ライブラリの役目である。
 * ここはその呼び出し側であり、**共通ライブラリ本体は改変しない**（実装指示書 B-9）。
 *
 * 解決した表示言語と猫語の語彙元は `i18n/locale.ts` へ渡す。
 * 共通ライブラリを読めない環境（file:// など）でも画面が壊れないよう、最小限の代替判定を持つ。
 */

import '@momo-lib/momo-lang/momo-lang.js';
import type { LocaleCode } from '../data/types';
import { setCatBase, setLocale, type CatBase } from '../i18n/locale';

/** 言語セレクタが扱う値。`auto` は「端末の設定に従う」 */
export type LocaleMode = 'auto' | LocaleCode;

export const LOCALE_MODES: readonly LocaleMode[] = ['auto', 'ja', 'en', 'zh', 'cat'];

const APP_ID = 'sudoku';
const SUPPORTED: readonly LocaleCode[] = ['ja', 'en', 'zh', 'cat'];

interface MomoLangApi {
  VERSION: string;
  bind(appId: string, opts: { supportedLangs?: readonly LocaleCode[] }): void;
  getMode(appId: string): string;
  getCatBase(appId: string): string;
  resolve(appId: string): string;
  setMode(appId: string, mode: string): string;
}

declare global {
  interface Window {
    MomoLang?: MomoLangApi;
  }
}

function api(): MomoLangApi | null {
  return typeof window === 'undefined' ? null : window.MomoLang ?? null;
}

/** 共通ライブラリが使えないときの代替判定（readme 手順3 と同じ順序） */
function detectFallback(): LocaleCode {
  try {
    const list =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language || 'en'];
    for (const entry of list) {
      const lang = (entry || '').toLowerCase();
      if (lang.startsWith('ja')) return 'ja';
      if (lang.startsWith('zh')) return 'zh';
      if (lang.startsWith('en')) return 'en';
    }
    return 'en';
  } catch {
    return 'ja';
  }
}

function asLocale(value: string): LocaleCode {
  return (SUPPORTED as readonly string[]).includes(value) ? (value as LocaleCode) : detectFallback();
}

/** 猫語の語彙元は ja / en / zh のいずれかへ丸める（別の値が返った場合の防御） */
function asCatBase(value: string): CatBase {
  return value === 'en' || value === 'zh' ? value : 'ja';
}

export function currentMode(): LocaleMode {
  const lang = api();
  if (!lang) return 'auto';
  const mode = lang.getMode(APP_ID);
  return (LOCALE_MODES as readonly string[]).includes(mode) ? (mode as LocaleMode) : 'auto';
}

/**
 * 起動時に1回呼ぶ。共通ライブラリへ自分の言語セットを宣言し、
 * 解決した表示言語を返す。
 */
export function initLocale(): LocaleCode {
  const lang = api();
  if (!lang) {
    const resolved = detectFallback();
    void setLocale(resolved);
    return resolved;
  }

  lang.bind(APP_ID, { supportedLangs: SUPPORTED });
  setCatBase(asCatBase(lang.getCatBase(APP_ID)));
  const resolved = asLocale(lang.resolve(APP_ID));
  void setLocale(resolved);
  return resolved;
}

/**
 * 言語モードを変更する。共通の保存キーへ書かれるため、他アプリも同じ言語に揃う。
 * 解決した表示言語を返す。
 */
export function changeMode(mode: LocaleMode): LocaleCode {
  const lang = api();
  if (!lang) {
    const resolved = mode === 'auto' ? detectFallback() : mode;
    void setLocale(resolved);
    return resolved;
  }

  const resolved = asLocale(lang.setMode(APP_ID, mode));
  // 猫語を選んだ瞬間に語彙元が決まるため、表示言語より先に反映する
  setCatBase(asCatBase(lang.getCatBase(APP_ID)));
  void setLocale(resolved);
  return resolved;
}
