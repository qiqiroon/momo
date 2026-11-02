// MOMO 共通の言語ルーチン（lib/momo-lang）への橋渡し（lib/momo-lang/readme.md §3）
// 言語モード（auto / ja / en / zh / cat）の判定・保存・アプリ間の引き継ぎは共通ライブラリの役目。
// ここは呼ぶだけで、共通ライブラリ本体は変えない。読めない環境でも画面が壊れないよう、最小限の代わりの判定を持つ
import '@momo-lib/momo-lang/momo-lang.js';
import type { CatBase, Lang } from '../ui/strings';

/** 言語の選択欄が扱う値。auto は「端末の設定に従う」 */
export type LangMode = 'auto' | Lang;

export const LANG_MODES: readonly LangMode[] = ['auto', 'ja', 'en', 'zh', 'cat'];

const APP_ID = 'cube';
const SUPPORTED: readonly Lang[] = ['ja', 'en', 'zh', 'cat'];

interface MomoLangApi {
  VERSION: string;
  bind(appId: string, opts: { supportedLangs?: readonly Lang[] }): void;
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

export interface LangState {
  mode: LangMode;
  lang: Lang;
  /** 猫語の鳴き声の系統（にゃあ / meow / 喵） */
  catBase: CatBase;
}

const api = (): MomoLangApi | null => window.MomoLang ?? null;

/** 共通ライブラリが使えないときの判定（readme 手順3 と同じ順） */
function detectFallback(): Lang {
  try {
    const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
    for (const entry of list) {
      const l = (entry || '').toLowerCase();
      if (l.startsWith('ja')) return 'ja';
      if (l.startsWith('zh')) return 'zh';
      if (l.startsWith('en')) return 'en';
    }
    return 'en';
  } catch {
    return 'ja';
  }
}

const asLang = (v: string): Lang => ((SUPPORTED as readonly string[]).includes(v) ? (v as Lang) : detectFallback());
const asCatBase = (v: string): CatBase => (v === 'en' || v === 'zh' ? v : 'ja');
const asMode = (v: string): LangMode => ((LANG_MODES as readonly string[]).includes(v) ? (v as LangMode) : 'auto');

/** 起動時に 1 回。共通ライブラリへ自分の言語セットを宣言し、いまの言語を返す */
export function initLang(): LangState {
  const lang = api();
  if (!lang) return { mode: 'auto', lang: detectFallback(), catBase: 'ja' };
  lang.bind(APP_ID, { supportedLangs: SUPPORTED });
  return { mode: asMode(lang.getMode(APP_ID)), lang: asLang(lang.resolve(APP_ID)), catBase: asCatBase(lang.getCatBase(APP_ID)) };
}

/** 言語モードを変える。共通の保存先に書くので、ほかのアプリも同じ言語になる */
export function changeLangMode(mode: LangMode, before: LangState): LangState {
  const lang = api();
  if (!lang) {
    const resolved = mode === 'auto' ? detectFallback() : mode;
    // 猫語を選んだときは、選ぶ前の言語の鳴き声にする
    const catBase = mode === 'cat' && before.lang !== 'cat' ? before.lang : before.catBase;
    return { mode, lang: resolved, catBase };
  }
  const resolved = asLang(lang.setMode(APP_ID, mode));
  return { mode, lang: resolved, catBase: asCatBase(lang.getCatBase(APP_ID)) };
}
