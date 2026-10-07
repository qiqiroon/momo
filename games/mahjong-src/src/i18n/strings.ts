// 画面の言葉。画面に言葉を直接書かず、必ずここを通す（工程表の原則5）。
// 出来事の列には言葉を入れない＝同じ列を、見る人それぞれの言葉で表示できる（「言葉の違う卓」の土台）。
//
// 表示言語の判定・保存・アプリ間の引き継ぎは共通ライブラリ momo-lang の役目（ここでは呼ぶだけ）。
// 中国語は簡体字 1 種（2026-10-05 決定）。
// 猫語（CAT）は MOMO Works 共通の仕様（works/docs/多言語対応/cat-lang-spec.docx）どおり辞書を持たず、
// キーの性質に応じた鳴き声を返す。語彙は猫語を選ぶ直前の言語（catBase＝momo-lang の共有値）で決まる。

import '@momo-lib/momo-lang/momo-lang.js';

/** 辞書を持つ言語 */
export type BaseLang = 'ja' | 'en' | 'zh';
/** 表示言語（猫語を含む） */
export type Lang = BaseLang | 'cat';

const ja = {
  subtitle: 'Any Rule, Any Table',
  trial: '段階1の試作：ツモって切るだけです（役・鳴き・点数はまだありません）',
  start: 'CPU と対局する',
  again: 'もう一局',
  you: 'あなた',
  cpu: 'CPU {n}',
  wind0: '東',
  wind1: '南',
  wind2: '西',
  wind3: '北',
  roundWind0: '東',
  round: '{wind}{n}局',
  wallLeft: '残り {n}',
  tsumo: 'ツモ',
  tapAgain: 'もう一度タップで切ります',
  resultTsumo: '{name}のツモアガリ',
  resultExhaust: '流局',
  turnOf: '{name}の番',
  settings: '設定',
  language: '言語',
} as const;

export type MessageKey = keyof typeof ja;
type Dict = Record<MessageKey, string>;

const en: Dict = {
  subtitle: 'Any Rule, Any Table',
  trial: 'Stage 1 prototype: draw and discard only (no yaku, calls or scoring yet)',
  start: 'Play vs CPU',
  again: 'Play again',
  you: 'You',
  cpu: 'CPU {n}',
  wind0: 'E',
  wind1: 'S',
  wind2: 'W',
  wind3: 'N',
  roundWind0: 'East',
  round: '{wind} {n}',
  wallLeft: '{n} left',
  tsumo: 'Tsumo',
  tapAgain: 'Tap again to discard',
  resultTsumo: '{name} won by self-draw',
  resultExhaust: 'Exhaustive draw',
  turnOf: "{name}'s turn",
  settings: 'Settings',
  language: 'Language',
};

const zh: Dict = {
  subtitle: '百般规则，随心成局',
  trial: '第1阶段试作：只能摸牌和打牌（还没有番种、吃碰杠和计分）',
  start: '与电脑对局',
  again: '再来一局',
  you: '你',
  cpu: '电脑 {n}',
  wind0: '东',
  wind1: '南',
  wind2: '西',
  wind3: '北',
  roundWind0: '东',
  round: '{wind}{n}局',
  wallLeft: '余 {n}',
  tsumo: '自摸',
  tapAgain: '再点一次即可打出',
  resultTsumo: '{name}自摸和牌',
  resultExhaust: '流局',
  turnOf: '轮到{name}',
  settings: '设置',
  language: '语言',
};

const DICTS: Record<BaseLang, Dict> = { ja, en, zh };

// ---- 猫語 ----

/** 攻撃的な鳴き声を返すキー（失敗・エラーの通知）。いまは無い（オンラインの段階で足す） */
const ERROR_KEYS: ReadonlySet<MessageKey> = new Set([]);
/** 穏やかな鳴き声を返すキー（待ちの通知）。いまは無い */
const CALM_KEYS: ReadonlySet<MessageKey> = new Set([]);

const CAT_VOCAB: Record<BaseLang, { error: string[]; calm: string[]; normal: string[] }> = {
  ja: {
    error: ['シャー！', 'フーッ！', 'シャシャシャ！'],
    calm: ['ごろごろ…', 'にゃ…', 'ぐるぐる…'],
    normal: ['にゃあ', 'にゃ', 'にゃーん', 'みゃお', 'ニャ！'],
  },
  en: {
    error: ['HISS!', 'SPIT!', 'FSSST!'],
    calm: ['purrrr...', 'mrrr...', 'prrr...'],
    normal: ['MEOW', 'meow', 'mrrrow', 'mew', 'NYA!'],
  },
  zh: {
    error: ['嘶！', '哈！', '嘶嘶！'],
    calm: ['咕噜…', '喵…', '噜噜…'],
    normal: ['喵', '喵呜', '咪', '喵！'],
  },
};

/** 同じキーには同じ鳴き声を返す覚え書き（無いと、画面を描き直すたびに全部の言葉が引き直されて読めない）。
 *  語彙の元の言語が変わったら作り直す */
const catCache = new Map<MessageKey, string>();
let cacheBase: BaseLang | null = null;
let catBase: BaseLang = 'ja';

function catSpeak(key: MessageKey): string {
  if (cacheBase !== catBase) {
    catCache.clear();
    cacheBase = catBase;
  }
  const hit = catCache.get(key);
  if (hit) return hit;
  const v = CAT_VOCAB[catBase];
  const list = ERROR_KEYS.has(key) ? v.error : CALM_KEYS.has(key) ? v.calm : v.normal;
  const word = list[Math.floor(Math.random() * list.length)];
  catCache.set(key, word);
  return word;
}

/** 猫語の語彙の元の言語（html の lang や中国語用の字形に使う） */
export const baseOf = (lang: Lang): BaseLang => (lang === 'cat' ? catBase : lang);

interface MomoLangApi {
  bind(appId: string, opts: { supportedLangs: readonly string[]; fallback?: string }): void;
  resolve(appId: string): string;
  getMode(appId: string): string;
  setMode(appId: string, mode: string): string;
  getCatBase(appId: string): string;
}

/** 言語選択の値。auto＝端末の設定に従う */
export type LangMode = 'auto' | Lang;
export const LANG_MODES: readonly { mode: LangMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'ja', label: '日本語' },
  { mode: 'en', label: 'EN' },
  { mode: 'zh', label: '中文' },
  { mode: 'cat', label: 'CAT' },
];
declare global {
  interface Window {
    MomoLang?: MomoLangApi;
  }
}

const APP_ID = 'mahjong';
const SUPPORTED: readonly Lang[] = ['ja', 'en', 'zh', 'cat'];

function detectFallback(): BaseLang {
  for (const entry of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const l = entry.toLowerCase();
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

const api = () => (typeof window === 'undefined' ? undefined : window.MomoLang);

function asLang(r: string): Lang {
  return (SUPPORTED as readonly string[]).includes(r) ? (r as Lang) : detectFallback();
}

/** 猫語の語彙の元の言語を momo-lang から読む（アプリ間で にゃあ/meow/喵 がそろう） */
function syncCatBase(): void {
  const b = api()?.getCatBase(APP_ID);
  catBase = b === 'en' || b === 'zh' ? b : 'ja';
}

/** 起動時に 1 回。他の MOMO アプリで選んだ言語に合わせる */
export function initLang(): Lang {
  const a = api();
  if (!a) return detectFallback();
  a.bind(APP_ID, { supportedLangs: SUPPORTED, fallback: 'en' });
  syncCatBase();
  return asLang(a.resolve(APP_ID));
}

export function currentMode(): LangMode {
  const m = api()?.getMode(APP_ID) ?? 'auto';
  return LANG_MODES.some((o) => o.mode === m) ? (m as LangMode) : 'auto';
}

/** 言語を選ぶ。共通の保存先へ書かれ、他の MOMO アプリも同じ言語になる。表示する言語を返す */
export function changeMode(mode: LangMode): Lang {
  const a = api();
  if (!a) return mode === 'auto' ? detectFallback() : mode;
  // 猫語を選んだ瞬間に語彙の元の言語が決まる（momo-lang の setMode が共有値へ書く）
  const r = a.setMode(APP_ID, mode);
  syncCatBase();
  return asLang(r);
}

export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  if (lang === 'cat') return catSpeak(key);
  return DICTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export const ALL_LANGS = SUPPORTED;
export const dictFor = (lang: BaseLang) => DICTS[lang];
