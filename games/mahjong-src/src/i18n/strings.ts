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
  trial: '段階3の試作：ロン・チー・ポン・カンまでできます（CPU は鳴きません）',
  start: 'CPU と対局する',
  again: 'もう一局',
  you: 'あなた',
  cpu: 'CPU {n}',
  wind0: '東',
  wind1: '南',
  wind2: '西',
  wind3: '北',
  roundWind0: '東',
  roundWind1: '南',
  roundWind2: '西',
  nextHand: '次の局へ',
  newGame: '新しい対局',
  yameStop: 'やめる（対局を終える）',
  yameGo: '続ける',
  yameHint: 'トップの親です。ここで対局を終えますか？',
  yameWait: '{name}がやめるか続けるかを選んでいます',
  gameOverTitle: '対局終了',
  finalRank: '{n}位',
  finalPoints: '持ち点',
  finalBase: '素点',
  finalUma: 'ウマ',
  finalOka: 'オカ',
  finalTotal: '最終得点',
  noMoney: '点数・順位に金銭的な価値はありません。',
  gameEnd_last: '予定の局をすべて打ち終えました',
  gameEnd_tobi: '持ち点が 0 点を下回った人がいるため終わりました（飛び）',
  gameEnd_yame: 'トップの親がやめたため終わりました',
  gameEnd_extension: '延長（西入）が終わりました',
  round: '{wind}{n}局',
  wallLeft: '残り {n}',
  tsumo: 'ツモ',
  tapAgain: 'もう一度タップで切ります',
  resultTsumo: '{name}のツモアガリ',
  resultExhaust: '流局',
  resultRon: '{name}のロンアガリ（{from}から）',
  resultTripleRon: '3人が同時にロン＝流局',
  honbaKyotaku: '{h}本場・供託{k}',
  resultNagashi: '{name}の流し満貫',
  resultAbort_kyushu: '{name}が九種九牌で流局',
  resultAbort_sufon: '四風連打で流局',
  resultAbort_suricchi: '四家立直で流局',
  resultAbort_sukan: '四開槓で流局',
  turnOf: '{name}の番',
  settings: '設定',
  layoutSwitch: '画面切替',
  language: '言語',
  yaku_riichi: '立直',
  yaku_doubleRiichi: 'ダブル立直',
  yaku_ippatsu: '一発',
  yaku_menzenTsumo: '門前清自摸和',
  yaku_tanyao: '断么九',
  yaku_pinfu: '平和',
  yaku_iipeikou: '一盃口',
  yaku_haku: '役牌 白',
  yaku_hatsu: '役牌 發',
  yaku_chun: '役牌 中',
  yaku_roundWind: '場風 {wind}',
  yaku_seatWind: '自風 {wind}',
  yaku_rinshan: '嶺上開花',
  yaku_chankan: '槍槓',
  yaku_haitei: '海底摸月',
  yaku_houtei: '河底撈魚',
  yaku_chiitoitsu: '七対子',
  yaku_sanshoku: '三色同順',
  yaku_ittsu: '一気通貫',
  yaku_chanta: '混全帯么九',
  yaku_toitoi: '対々和',
  yaku_sanankou: '三暗刻',
  yaku_sanshokuDoukou: '三色同刻',
  yaku_sankantsu: '三槓子',
  yaku_shousangen: '小三元',
  yaku_honroutou: '混老頭',
  yaku_ryanpeikou: '二盃口',
  yaku_honitsu: '混一色',
  yaku_junchan: '純全帯么九',
  yaku_chinitsu: '清一色',
  yaku_tenhou: '天和',
  yaku_chiihou: '地和',
  yaku_kokushi: '国士無双',
  yaku_suuankou: '四暗刻',
  yaku_daisangen: '大三元',
  yaku_tsuuiisou: '字一色',
  yaku_ryuuiisou: '緑一色',
  yaku_chinroutou: '清老頭',
  yaku_shousuushii: '小四喜',
  yaku_daisuushii: '大四喜',
  yaku_suukantsu: '四槓子',
  yaku_chuuren: '九蓮宝燈',
  doraIndicator: 'ドラ表示',
  yakuDora: 'ドラ',
  yakuAka: '赤ドラ',
  yakuUra: '裏ドラ',
  hanN: '{n}翻',
  hanFu: '{han}翻 {fu}符',
  limit_mangan: '満貫',
  limit_haneman: '跳満',
  limit_baiman: '倍満',
  limit_sanbaiman: '三倍満',
  limit_kazoe: '数え役満',
  limit_yakuman: '役満',
  yakuman2: 'ダブル役満',
  yakuman3: 'トリプル役満',
  yakumanN: '{n}倍役満',
  payTsumoChild: '子 {others}点・親 {dealer}点',
  payTsumoDealer: '3人とも {each}点',
  payRon: '{amount}点',
  totalPoints: '合計 {n}点',
  riichi: 'リーチ',
  riichiPick: 'リーチで切る牌を選んでください',
  riichiCancel: 'やめる',
  furiten: 'フリテン',
  ron: 'ロン',
  chi: 'チー',
  pon: 'ポン',
  kan: 'カン',
  callHint: '鳴けます。鳴きますか？',
  pass: '見送る',
  ronHint: '切られた牌でアガれます。ロンしますか？',
  uraIndicator: '裏ドラ表示',
  declareTenpai: 'テンパイ',
  declareNoten: 'ノーテン',
  kyushu: '九種九牌で流す',
  kyushuHint: '么九牌が9種類あります。流すこともできます',
  declareHint: '流局です。テンパイを宣言しますか？（ノーテンと言うと手牌は見せません）',
} as const;

export type MessageKey = keyof typeof ja;
type Dict = Record<MessageKey, string>;

const en: Dict = {
  subtitle: 'Any Rule, Any Table',
  trial: 'Stage 3 prototype: ron, chi, pon and kan (the CPUs do not call)',
  start: 'Play vs CPU',
  again: 'Play again',
  you: 'You',
  cpu: 'CPU {n}',
  wind0: 'E',
  wind1: 'S',
  wind2: 'W',
  wind3: 'N',
  roundWind0: 'East',
  roundWind1: 'South',
  roundWind2: 'West',
  nextHand: 'Next hand',
  newGame: 'New game',
  yameStop: 'Stop (end the game)',
  yameGo: 'Continue',
  yameHint: 'You are the leading dealer. End the game here?',
  yameWait: '{name} is deciding whether to stop',
  gameOverTitle: 'Game over',
  finalRank: '#{n}',
  finalPoints: 'Points',
  finalBase: 'Base',
  finalUma: 'Uma',
  finalOka: 'Oka',
  finalTotal: 'Final',
  noMoney: 'Scores and rankings have no monetary value.',
  gameEnd_last: 'All scheduled hands have been played',
  gameEnd_tobi: 'A player went below zero points',
  gameEnd_yame: 'The leading dealer chose to stop',
  gameEnd_extension: 'The extension (West round) is over',
  round: '{wind} {n}',
  wallLeft: '{n} left',
  tsumo: 'Tsumo',
  tapAgain: 'Tap again to discard',
  resultTsumo: '{name} won by self-draw',
  resultExhaust: 'Exhaustive draw',
  resultRon: '{name} won by ron from {from}',
  resultTripleRon: 'Triple ron: abortive draw',
  honbaKyotaku: '{h} honba · {k} riichi stick(s)',
  resultNagashi: '{name}: Nagashi Mangan',
  resultAbort_kyushu: '{name} declared nine terminals: abortive draw',
  resultAbort_sufon: 'Four winds: abortive draw',
  resultAbort_suricchi: 'Four riichi: abortive draw',
  resultAbort_sukan: 'Four kans: abortive draw',
  turnOf: "{name}'s turn",
  settings: 'Settings',
  layoutSwitch: 'Layout',
  language: 'Language',
  yaku_riichi: 'Riichi',
  yaku_doubleRiichi: 'Double Riichi',
  yaku_ippatsu: 'Ippatsu',
  yaku_menzenTsumo: 'Menzen Tsumo',
  yaku_tanyao: 'Tanyao',
  yaku_pinfu: 'Pinfu',
  yaku_iipeikou: 'Iipeikou',
  yaku_haku: 'Yakuhai: White',
  yaku_hatsu: 'Yakuhai: Green',
  yaku_chun: 'Yakuhai: Red',
  yaku_roundWind: 'Round wind ({wind})',
  yaku_seatWind: 'Seat wind ({wind})',
  yaku_rinshan: 'Rinshan Kaihou',
  yaku_chankan: 'Chankan',
  yaku_haitei: 'Haitei Raoyue',
  yaku_houtei: 'Houtei Raoyui',
  yaku_chiitoitsu: 'Chiitoitsu',
  yaku_sanshoku: 'Sanshoku Doujun',
  yaku_ittsu: 'Ittsu',
  yaku_chanta: 'Chanta',
  yaku_toitoi: 'Toitoi',
  yaku_sanankou: 'Sanankou',
  yaku_sanshokuDoukou: 'Sanshoku Doukou',
  yaku_sankantsu: 'Sankantsu',
  yaku_shousangen: 'Shousangen',
  yaku_honroutou: 'Honroutou',
  yaku_ryanpeikou: 'Ryanpeikou',
  yaku_honitsu: 'Honitsu',
  yaku_junchan: 'Junchan',
  yaku_chinitsu: 'Chinitsu',
  yaku_tenhou: 'Tenhou',
  yaku_chiihou: 'Chiihou',
  yaku_kokushi: 'Kokushi Musou',
  yaku_suuankou: 'Suuankou',
  yaku_daisangen: 'Daisangen',
  yaku_tsuuiisou: 'Tsuuiisou',
  yaku_ryuuiisou: 'Ryuuiisou',
  yaku_chinroutou: 'Chinroutou',
  yaku_shousuushii: 'Shousuushii',
  yaku_daisuushii: 'Daisuushii',
  yaku_suukantsu: 'Suukantsu',
  yaku_chuuren: 'Chuuren Poutou',
  doraIndicator: 'Dora indicator',
  yakuDora: 'Dora',
  yakuAka: 'Red five',
  yakuUra: 'Ura dora',
  hanN: '{n} han',
  hanFu: '{han} han {fu} fu',
  limit_mangan: 'Mangan',
  limit_haneman: 'Haneman',
  limit_baiman: 'Baiman',
  limit_sanbaiman: 'Sanbaiman',
  limit_kazoe: 'Kazoe Yakuman',
  limit_yakuman: 'Yakuman',
  yakuman2: 'Double Yakuman',
  yakuman3: 'Triple Yakuman',
  yakumanN: '{n}x Yakuman',
  payTsumoChild: 'Non-dealers {others} each, dealer {dealer}',
  payTsumoDealer: '{each} from each player',
  payRon: '{amount}',
  totalPoints: 'Total {n}',
  riichi: 'Riichi',
  riichiPick: 'Choose the tile to discard for riichi',
  riichiCancel: 'Cancel',
  furiten: 'Furiten',
  ron: 'Ron',
  chi: 'Chi',
  pon: 'Pon',
  kan: 'Kan',
  callHint: 'You can call this discard.',
  pass: 'Pass',
  ronHint: 'You can win on this discard. Call ron?',
  uraIndicator: 'Ura indicator',
  declareTenpai: 'Tenpai',
  declareNoten: 'No-ten',
  kyushu: 'Abort (nine terminals)',
  kyushuHint: 'You hold nine kinds of terminals and honors. You may abort the hand',
  declareHint: 'Exhaustive draw. Declare tenpai? (No-ten keeps your hand hidden)',
};

const zh: Dict = {
  subtitle: '百般规则，随心成局',
  trial: '第3阶段试作：可以荣和、吃、碰、杠（电脑不鸣牌）',
  start: '与电脑对局',
  again: '再来一局',
  you: '你',
  cpu: '电脑 {n}',
  wind0: '东',
  wind1: '南',
  wind2: '西',
  wind3: '北',
  roundWind0: '东',
  roundWind1: '南',
  roundWind2: '西',
  nextHand: '下一局',
  newGame: '新的对局',
  yameStop: '结束对局',
  yameGo: '继续',
  yameHint: '你是领先的庄家。要在这里结束对局吗？',
  yameWait: '{name}正在选择是否结束',
  gameOverTitle: '对局结束',
  finalRank: '第{n}名',
  finalPoints: '点数',
  finalBase: '素点',
  finalUma: '马',
  finalOka: '冈',
  finalTotal: '最终得分',
  noMoney: '分数与名次不具有任何金钱价值。',
  gameEnd_last: '预定的局已全部打完',
  gameEnd_tobi: '有人的点数低于 0，对局结束',
  gameEnd_yame: '领先的庄家选择结束',
  gameEnd_extension: '延长（西入）结束',
  round: '{wind}{n}局',
  wallLeft: '余 {n}',
  tsumo: '自摸',
  tapAgain: '再点一次即可打出',
  resultTsumo: '{name}自摸和牌',
  resultExhaust: '流局',
  resultRon: '{name}荣和（{from}放铳）',
  resultTripleRon: '三家和，流局',
  honbaKyotaku: '{h}本场・供托{k}',
  resultNagashi: '{name}流局满贯',
  resultAbort_kyushu: '{name}九种九牌，流局',
  resultAbort_sufon: '四风连打，流局',
  resultAbort_suricchi: '四家立直，流局',
  resultAbort_sukan: '四杠散了，流局',
  turnOf: '轮到{name}',
  settings: '设置',
  layoutSwitch: '切换画面',
  language: '语言',
  yaku_riichi: '立直',
  yaku_doubleRiichi: '两立直',
  yaku_ippatsu: '一发',
  yaku_menzenTsumo: '门前清自摸和',
  yaku_tanyao: '断幺九',
  yaku_pinfu: '平和',
  yaku_iipeikou: '一杯口',
  yaku_haku: '役牌 白',
  yaku_hatsu: '役牌 发',
  yaku_chun: '役牌 中',
  yaku_roundWind: '场风 {wind}',
  yaku_seatWind: '自风 {wind}',
  yaku_rinshan: '岭上开花',
  yaku_chankan: '抢杠',
  yaku_haitei: '海底摸月',
  yaku_houtei: '河底捞鱼',
  yaku_chiitoitsu: '七对子',
  yaku_sanshoku: '三色同顺',
  yaku_ittsu: '一气通贯',
  yaku_chanta: '混全带幺九',
  yaku_toitoi: '对对和',
  yaku_sanankou: '三暗刻',
  yaku_sanshokuDoukou: '三色同刻',
  yaku_sankantsu: '三杠子',
  yaku_shousangen: '小三元',
  yaku_honroutou: '混老头',
  yaku_ryanpeikou: '两杯口',
  yaku_honitsu: '混一色',
  yaku_junchan: '纯全带幺九',
  yaku_chinitsu: '清一色',
  yaku_tenhou: '天和',
  yaku_chiihou: '地和',
  yaku_kokushi: '国士无双',
  yaku_suuankou: '四暗刻',
  yaku_daisangen: '大三元',
  yaku_tsuuiisou: '字一色',
  yaku_ryuuiisou: '绿一色',
  yaku_chinroutou: '清老头',
  yaku_shousuushii: '小四喜',
  yaku_daisuushii: '大四喜',
  yaku_suukantsu: '四杠子',
  yaku_chuuren: '九莲宝灯',
  doraIndicator: '宝牌指示牌',
  yakuDora: '宝牌',
  yakuAka: '赤宝牌',
  yakuUra: '里宝牌',
  hanN: '{n}番',
  hanFu: '{han}番 {fu}符',
  limit_mangan: '满贯',
  limit_haneman: '跳满',
  limit_baiman: '倍满',
  limit_sanbaiman: '三倍满',
  limit_kazoe: '累计役满',
  limit_yakuman: '役满',
  yakuman2: '双倍役满',
  yakuman3: '三倍役满',
  yakumanN: '{n}倍役满',
  payTsumoChild: '闲家各 {others}点・庄家 {dealer}点',
  payTsumoDealer: '三家各 {each}点',
  payRon: '{amount}点',
  totalPoints: '合计 {n}点',
  riichi: '立直',
  riichiPick: '请选择立直时打出的牌',
  riichiCancel: '取消',
  furiten: '振听',
  ron: '荣和',
  chi: '吃',
  pon: '碰',
  kan: '杠',
  callHint: '可以鸣牌。要鸣牌吗？',
  pass: '过',
  ronHint: '可以用这张牌和牌。要荣和吗？',
  uraIndicator: '里宝牌指示牌',
  declareTenpai: '听牌',
  declareNoten: '未听牌',
  kyushu: '九种九牌流局',
  kyushuHint: '有九种幺九牌，可以流局',
  declareHint: '流局。要宣告听牌吗？（宣告未听牌则不亮牌）',
};

const DICTS: Record<BaseLang, Dict> = { ja, en, zh };

// ---- 猫語 ----

/** 猫語にしないキー（猫語のときも、猫語を選ぶ直前の言語のまま出す）。利用者指示 2026-10-07：
 *  - サブタイトル（全アプリ共通で猫語にしない）
 *  - 利用規約・免責・賭博禁止・公平性の説明など、意味が伝わらないと困るもの（段階4で足す） */
const NO_CAT_KEYS: ReadonlySet<MessageKey> = new Set(['subtitle']);

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
  if (lang === 'cat' && !NO_CAT_KEYS.has(key)) return catSpeak(key);
  if (lang === 'cat') return translate(catBase, key, vars);
  return DICTS[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}

export const ALL_LANGS = SUPPORTED;
export const dictFor = (lang: BaseLang) => DICTS[lang];
