// 画面の言葉。画面に言葉を直接書かず、必ずここを通す（工程表の原則5）。
// 出来事の列には言葉を入れない＝同じ列を、見る人それぞれの言葉で表示できる（「言葉の違う卓」の土台）。
//
// 表示言語の判定・保存・アプリ間の引き継ぎは共通ライブラリ momo-lang の役目（ここでは呼ぶだけ）。
// 中国語は簡体字 1 種（2026-10-05 決定）。

import '@momo-lib/momo-lang/momo-lang.js';

export type Lang = 'ja' | 'en' | 'zh';

const ja = {
  subtitle: 'Any Rule, Any Table',
  trial: '段階1の試作：ツモって切るだけです（役・鳴き・点数はまだありません）',
  start: 'CPU と対局する',
  again: 'もう一局',
  you: 'あなた',
  cpu: 'CPU {n}',
  winds: '東,南,西,北',
  roundWinds: '東,南,西,北',
  round: '{wind}{n}局',
  wallLeft: '残り {n}',
  tsumo: 'ツモ',
  tapAgain: 'もう一度タップで切ります',
  resultTsumo: '{name}のツモアガリ',
  resultExhaust: '流局',
  turnOf: '{name}の番',
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
  winds: 'E,S,W,N',
  roundWinds: 'East,South,West,North',
  round: '{wind} {n}',
  wallLeft: '{n} left',
  tsumo: 'Tsumo',
  tapAgain: 'Tap again to discard',
  resultTsumo: '{name} won by self-draw',
  resultExhaust: 'Exhaustive draw',
  turnOf: "{name}'s turn",
};

const zh: Dict = {
  subtitle: '百般规则，随心成局',
  trial: '第1阶段试作：只能摸牌和打牌（还没有番种、吃碰杠和计分）',
  start: '与电脑对局',
  again: '再来一局',
  you: '你',
  cpu: '电脑 {n}',
  winds: '东,南,西,北',
  roundWinds: '东,南,西,北',
  round: '{wind}{n}局',
  wallLeft: '余 {n}',
  tsumo: '自摸',
  tapAgain: '再点一次即可打出',
  resultTsumo: '{name}自摸和牌',
  resultExhaust: '流局',
  turnOf: '轮到{name}',
};

const DICTS: Record<Lang, Dict> = { ja, en, zh };

interface MomoLangApi {
  bind(appId: string, opts: { supportedLangs: readonly string[]; fallback?: string }): void;
  resolve(appId: string): string;
}
declare global {
  interface Window {
    MomoLang?: MomoLangApi;
  }
}

const APP_ID = 'mahjong';
const SUPPORTED: readonly Lang[] = ['ja', 'en', 'zh'];

function detectFallback(): Lang {
  for (const entry of navigator.languages?.length ? navigator.languages : [navigator.language || 'en']) {
    const l = entry.toLowerCase();
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('zh')) return 'zh';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}

/** 起動時に 1 回。他の MOMO アプリで選んだ言語に合わせる（猫語は momo-lang が元の言語に倒す） */
export function initLang(): Lang {
  const api = typeof window === 'undefined' ? undefined : window.MomoLang;
  if (!api) return detectFallback();
  api.bind(APP_ID, { supportedLangs: SUPPORTED, fallback: 'en' });
  const r = api.resolve(APP_ID);
  return (SUPPORTED as readonly string[]).includes(r) ? (r as Lang) : detectFallback();
}

export function translate(lang: Lang, key: MessageKey, vars: Record<string, string | number> = {}): string {
  return DICTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export const ALL_LANGS = SUPPORTED;
export const dictFor = (lang: Lang) => DICTS[lang];
