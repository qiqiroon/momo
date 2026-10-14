// ルールブックの役の一覧（日本式）。役ごとに、まとまり・翻・説明（日英中）・牌の並びの例を持つ。
// 翻の値は表示のためにここにも書くが、正本はルール部分の yaku.ts。例の手を yaku.ts に通して、
// 書いた役と翻が本当に付くことを検査で確かめる（jpYaku.test.ts）。説明は規則文の転載をせず MOMO の言葉で書く。
// 名前だけが違う同じ形の役は 1 行にまとめ、例は代表の 1 つだけ（利用者 Q6・Q7=C 2026-10-14）：
// 三元牌（白・發・中）／風牌（場風・自風）／海底・河底／大車輪・大竹林・大数隣／一筒摸月・九筒撈魚。

import type { YakuId } from '../engine/yaku';
import type { BaseLang, MessageKey } from '../i18n/strings';

export type JpSection = 'han1' | 'han2' | 'han3' | 'han6' | 'yakuman' | 'local';

export const JP_SECTIONS: readonly JpSection[] = ['han1', 'han2', 'han3', 'han6', 'yakuman', 'local'];

/** ローカル役（ルールの項目名が役の id と同じ。ルールで「なし」なら付かない） */
export const LOCAL_YAKU = ['tsubame', 'kanburi', 'shiiaru', 'uumen', 'sanrenko', 'isshoku3', 'ipin', 'chupin', 'daisharin', 'daichikurin', 'daisuurin', 'ishinoue', 'surenko', 'parenchan', 'daichisei'] as const;
export type LocalYaku = (typeof LOCAL_YAKU)[number];
export const isLocalYaku = (id: YakuId): id is LocalYaku => (LOCAL_YAKU as readonly string[]).includes(id);

/**
 * 牌の並びの例。hand＝手の中の牌を面子ごとに（アガリ牌を含めて 14 枚から鳴いた分を引いた枚数）。
 * melds＝鳴いた面子（'chi:123m'・'pon:555z'・'kan:1111p'＝明槓・'ankan:1111p'＝暗槓）。win＝アガリ牌。
 * 字牌は z の 1〜7＝東南西北白發中。
 * key＝役に関わる面子の番号（hand の順に 0 から、続けて melds）。省略＝全部（手全体や状況で決まる役）
 */
export interface YakuExample {
  hand: readonly string[];
  melds?: readonly string[];
  win: string;
  tsumo?: boolean;
  key?: readonly number[];
  /** アガったときの状況（リーチ・海底など）。風は 1〜4＝東南西北（省略は東場の東家） */
  ctx?: {
    riichi?: 'riichi' | 'double';
    ippatsu?: boolean;
    haitei?: boolean;
    houtei?: boolean;
    rinshan?: boolean;
    chankan?: boolean;
    tenhou?: boolean;
    chiihou?: boolean;
    jinho?: boolean;
    tsubame?: boolean;
    kanburi?: boolean;
    seatWind?: 1 | 2 | 3 | 4;
    roundWind?: 1 | 2 | 3 | 4;
    // 中国式（cnFan.ts）の場面：海底・嶺上でツモ・カンの直後の捨て牌でロン・搶槓・続けてカンした回数・天糊・地糊
    haidi?: boolean;
    gangkai?: boolean;
    gangpao?: boolean;
    qianggang?: boolean;
    kanChain?: number;
    tianhu?: boolean;
    dihu?: boolean;
    // 国標（mcrFan.ts）：最後の 1 枚をツモ・最後の捨て牌でロン・アガリ牌の 3 枚が見えている
    lastDraw?: boolean;
    lastClaim?: boolean;
    juezhang?: boolean;
  };
  /** 表にした花牌（国標の花牌の番。14 枚とは別に、最後に並べる） */
  flowers?: string;
}

export interface JpYakuEntry {
  /** 代表の役（例はこの役で確かめる） */
  id: YakuId;
  /** 同じ行にまとめた仲間の役 */
  also?: readonly YakuId[];
  /** まとめた行の名前（省略＝役の名前を並べる） */
  nameKey?: MessageKey;
  section: JpSection;
  /** 門前の翻（役満は 0） */
  han: number;
  /** 鳴いたときの翻（省略＝同じ・0＝門前だけ） */
  openHan?: number;
  /** 役満の倍数（ふつうの役は省略） */
  yakuman?: number;
  text: Record<BaseLang, string>;
  ex: YakuExample;
}

/** 行にまとめた役を全部（代表＋仲間） */
export const membersOf = (e: JpYakuEntry): YakuId[] => [e.id, ...(e.also ?? [])];

export const JP_YAKU: readonly JpYakuEntry[] = [
  // ── 1翻 ──
  {
    id: 'riichi',
    section: 'han1',
    han: 1,
    openHan: 0,
    text: {
      ja: '鳴かずにテンパイしたら、1000点を出して宣言する。宣言のあとは手を変えられず、引いた牌をそのまま切る',
      en: 'Declare when your closed hand is one tile from winning, putting up 1000 points. After that you cannot change your hand and discard every tile you draw',
      zh: '门清听牌时支付1000点宣告立直。宣告后不能改变手牌，摸到的牌直接打出',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', ctx: { riichi: 'riichi' } },
  },
  {
    id: 'ippatsu',
    section: 'han1',
    han: 1,
    openHan: 0,
    text: {
      ja: 'リーチしてから一巡のうちにアガる（その間に誰かが鳴くと消える）',
      en: 'Win within one go-around after declaring riichi (cancelled if anyone calls in between)',
      zh: '立直后一巡之内和牌（期间有人鸣牌则失效）',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', ctx: { riichi: 'riichi', ippatsu: true } },
  },
  {
    id: 'menzenTsumo',
    section: 'han1',
    han: 1,
    openHan: 0,
    text: {
      ja: '鳴かずに、自分で引いた牌でアガる',
      en: 'Win on your own draw with a closed hand',
      zh: '门清状态下自摸和牌',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', tsumo: true },
  },
  {
    id: 'tanyao',
    section: 'han1',
    han: 1,
    text: {
      ja: '2〜8の数牌だけで作る（1・9の数牌と字牌を使わない）',
      en: 'Use only number tiles 2 to 8 (no terminals or honors)',
      zh: '只用2到8的数牌（不含一九牌与字牌）',
    },
    ex: { hand: ['234m', '456p', '678s', '345s', '88p'], win: '5s' },
  },
  {
    id: 'pinfu',
    section: 'han1',
    han: 1,
    openHan: 0,
    text: {
      ja: '鳴かずに、4つとも順子・雀頭は点の付かない牌・待ちは両面',
      en: 'Closed hand of four sequences, a pair that scores no fu, and a two-sided wait',
      zh: '门清，四组都是顺子，雀头不是役牌，听两面',
    },
    ex: { hand: ['123m', '456p', '678s', '234s', '99m'], win: '4s' },
  },
  {
    id: 'iipeikou',
    section: 'han1',
    han: 1,
    openHan: 0,
    text: {
      ja: '鳴かずに、同じ色・同じ数の順子を2つ作る',
      en: 'Closed hand with two identical sequences',
      zh: '门清，有两组完全相同的顺子',
    },
    ex: { hand: ['234m', '234m', '567p', '789s', '55s'], win: '9s', key: [0, 1] },
  },
  {
    id: 'haku',
    also: ['hatsu', 'chun'],
    nameKey: 'rbName_dragons',
    section: 'han1',
    han: 1,
    text: {
      ja: '白・發・中のどれかを3枚そろえる（鳴いてもよい・1種類ごとに1翻）。例は白',
      en: 'A set of three White, Green or Red Dragons (may be called; 1 han for each). The example uses White',
      zh: '白、发、中任一种三张成刻（可以鸣牌，每种1番）。例为白板',
    },
    ex: { hand: ['123m', '456p', '789s', '99s'], melds: ['pon:555z'], win: '9s', key: [4] },
  },
  {
    id: 'roundWind',
    also: ['seatWind'],
    nameKey: 'rbName_winds',
    section: 'han1',
    han: 1,
    text: {
      ja: '場風か自分の風の牌を3枚そろえる（鳴いてもよい）。場風と自風が同じ牌なら2翻。例は東場の東家の東',
      en: 'A set of three of the round wind or your seat wind (may be called). 2 han if they are the same wind. The example is East for the East seat in the East round',
      zh: '场风或自风牌三张成刻（可以鸣牌）。场风与自风相同时为2番。例为东场东家的东',
    },
    ex: { hand: ['123m', '456p', '789s', '99s'], melds: ['pon:111z'], win: '9s', key: [4] },
  },
  {
    id: 'rinshan',
    section: 'han1',
    han: 1,
    text: {
      ja: 'カンしたあとに引く補充の牌でアガる',
      en: 'Win on the replacement tile drawn after a kan',
      zh: '开杠后摸的补牌和牌',
    },
    ex: { hand: ['123m', '456p', '789s', '55s'], melds: ['ankan:1111z'], win: '5s', tsumo: true, ctx: { rinshan: true } },
  },
  {
    id: 'chankan',
    section: 'han1',
    han: 1,
    text: {
      ja: 'ほかの人がポンした面子に4枚目を足してカンしたとき、その牌でロンする',
      en: 'Win on the tile another player adds to their called pon to make a kan',
      zh: '他家加杠时，荣和他加上的那张牌',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '3s', ctx: { chankan: true } },
  },
  {
    id: 'haitei',
    also: ['houtei'],
    section: 'han1',
    han: 1,
    text: {
      ja: '山の最後の1枚を引いてアガる（海底摸月）か、最後の捨て牌でロンする（河底撈魚）。例は海底摸月',
      en: 'Win on the very last tile drawn from the wall (Haitei), or on the last discard (Houtei). The example is Haitei',
      zh: '摸到牌山最后一张和牌（海底摸月），或荣和最后一张打出的牌（河底捞鱼）。例为海底摸月',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '4s', tsumo: true, ctx: { haitei: true } },
  },
  // ── 2翻 ──
  {
    id: 'doubleRiichi',
    section: 'han2',
    han: 2,
    openHan: 0,
    text: {
      ja: '最初の自分の番でリーチする（それまでに誰も鳴いていないこと）',
      en: 'Declare riichi on your very first turn (no calls before it)',
      zh: '第一巡就宣告立直（此前无人鸣牌）',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', ctx: { riichi: 'double' } },
  },
  {
    id: 'chiitoitsu',
    section: 'han2',
    han: 2,
    openHan: 0,
    text: {
      ja: '鳴かずに、違う種類の対子を7つ作る（4つの面子と雀頭でない特別な形）',
      en: 'Closed hand of seven different pairs (a special shape, not four sets and a pair)',
      zh: '门清，七组不同的对子（不是四组面子加雀头的特殊牌型）',
    },
    ex: { hand: ['11m', '44m', '77p', '22s', '55s', '33z', '66z'], win: '6z' },
  },
  {
    id: 'sanshoku',
    section: 'han2',
    han: 2,
    openHan: 1,
    text: {
      ja: '萬子・筒子・索子で、同じ数の順子をそろえる',
      en: 'The same sequence in characters, dots and bamboo',
      zh: '万、筒、索三种花色各有一组相同数字的顺子',
    },
    ex: { hand: ['234m', '234p', '234s', '678m', '55s'], win: '8m', key: [0, 1, 2] },
  },
  {
    id: 'ittsu',
    section: 'han2',
    han: 2,
    openHan: 1,
    text: {
      ja: '同じ色で 123・456・789 の順子をそろえる',
      en: 'The sequences 123, 456 and 789 in one suit',
      zh: '同一花色的123、456、789三组顺子',
    },
    ex: { hand: ['123p', '456p', '789p', '234s', '55m'], win: '9p', key: [0, 1, 2] },
  },
  {
    id: 'chanta',
    section: 'han2',
    han: 2,
    openHan: 1,
    text: {
      ja: '4つの面子と雀頭のどれにも、1・9の数牌か字牌が入っている（字牌も使う・順子も1つは要る）',
      en: 'Every set and the pair includes a terminal or honor (with at least one honor and one sequence)',
      zh: '四组面子和雀头都含有一九牌或字牌（要用到字牌，且至少有一组顺子）',
    },
    ex: { hand: ['123m', '789p', '111z', '789s', '99m'], win: '9s' },
  },
  {
    id: 'toitoi',
    section: 'han2',
    han: 2,
    text: {
      ja: '4つの面子をすべて刻子（同じ牌3枚）か槓子にする',
      en: 'All four sets are triplets or quads',
      zh: '四组面子都是刻子或杠子',
    },
    ex: { hand: ['555p', '99m'], melds: ['pon:222m', 'pon:888s', 'pon:444s'], win: '9m' },
  },
  {
    id: 'sanankou',
    section: 'han2',
    han: 2,
    text: {
      ja: '鳴かずにそろえた刻子（暗刻）を3つ作る。ロンで仕上がった刻子は数えない',
      en: 'Three concealed triplets. A triplet completed by ron does not count',
      zh: '有三组暗刻（不是靠鸣牌做成的刻子）。靠荣和完成的刻子不算',
    },
    ex: { hand: ['222m', '555p', '777s', '345s', '99p'], win: '4s', key: [0, 1, 2] },
  },
  {
    id: 'sanshokuDoukou',
    section: 'han2',
    han: 2,
    text: {
      ja: '萬子・筒子・索子で、同じ数の刻子をそろえる',
      en: 'Triplets of the same number in characters, dots and bamboo',
      zh: '万、筒、索三种花色各有一组相同数字的刻子',
    },
    ex: { hand: ['333m', '333p', '333s', '456m', '77s'], win: '7s', key: [0, 1, 2] },
  },
  {
    id: 'sankantsu',
    section: 'han2',
    han: 2,
    text: {
      ja: 'カンを3回する（鳴いたカンでもよい）',
      en: 'Make three kans (called kans count)',
      zh: '开杠三次（明杠也算）',
    },
    ex: { hand: ['456m', '77s'], melds: ['kan:2222p', 'ankan:5555s', 'kan:9999m'], win: '7s', key: [2, 3, 4] },
  },
  {
    id: 'shousangen',
    section: 'han2',
    han: 2,
    text: {
      ja: '白・發・中のうち2種類を刻子、残りの1種類を雀頭にする（役牌の2翻も付く）',
      en: 'Triplets of two dragons and a pair of the third (the two dragon yakuhai also count)',
      zh: '三元牌中两种成刻、另一种作雀头（另计两个役牌）',
    },
    ex: { hand: ['555z', '666z', '77z', '123m', '456m'], win: '3m', key: [0, 1, 2] },
  },
  {
    id: 'honroutou',
    section: 'han2',
    han: 2,
    text: {
      ja: '1・9の数牌と字牌だけで作る（対々和か七対子と一緒になる）',
      en: 'Use only terminals and honors (comes with Toitoi or Chiitoitsu)',
      zh: '只用一九牌和字牌（必然同时成立对对和或七对子）',
    },
    ex: { hand: ['111m', '999p', '111z', '22z'], melds: ['pon:999s'], win: '2z' },
  },
  // ── 3翻 ──
  {
    id: 'ryanpeikou',
    section: 'han3',
    han: 3,
    openHan: 0,
    text: {
      ja: '鳴かずに、一盃口を2組作る（七対子とは数えない）',
      en: 'Closed hand with two pairs of identical sequences (not counted as Chiitoitsu)',
      zh: '门清，有两组一杯口（不按七对子计）',
    },
    ex: { hand: ['234m', '234m', '678p', '678p', '55s'], win: '5s', key: [0, 1, 2, 3] },
  },
  {
    id: 'honitsu',
    section: 'han3',
    han: 3,
    openHan: 2,
    text: {
      ja: '1つの色の数牌と字牌だけで作る',
      en: 'Use only one suit plus honors',
      zh: '只用一种花色的数牌和字牌',
    },
    ex: { hand: ['123p', '345p', '777p', '111z', '55z'], win: '5z' },
  },
  {
    id: 'junchan',
    section: 'han3',
    han: 3,
    openHan: 2,
    text: {
      ja: '4つの面子と雀頭のどれにも1・9の数牌が入っている（字牌は使わない・順子も1つは要る）',
      en: 'Every set and the pair includes a terminal, with no honors (and at least one sequence)',
      zh: '四组面子和雀头都含有一九牌（不用字牌，且至少有一组顺子）',
    },
    ex: { hand: ['123m', '789m', '123p', '999s', '11s'], win: '1s' },
  },
  // ── 6翻 ──
  {
    id: 'chinitsu',
    section: 'han6',
    han: 6,
    openHan: 5,
    text: {
      ja: '1つの色の数牌だけで作る（字牌も使わない）',
      en: 'Use only one suit, with no honors',
      zh: '只用一种花色的数牌（不用字牌）',
    },
    ex: { hand: ['123s', '345s', '567s', '789s', '99s'], win: '6s' },
  },
  // ── 役満 ──
  {
    id: 'tenhou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '親が、配られた14枚でもうアガっている',
      en: 'The dealer’s starting 14 tiles are already a winning hand',
      zh: '庄家发牌后的14张已经和牌',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '5z', tsumo: true, ctx: { tenhou: true } },
  },
  {
    id: 'chiihou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '子が、最初に引いた牌でアガる（それまでに誰も鳴いていないこと）',
      en: 'A non-dealer wins on their very first draw (no calls before it)',
      zh: '闲家第一次摸牌就自摸和牌（此前无人鸣牌）',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '5z', tsumo: true, ctx: { chiihou: true, seatWind: 2 } },
  },
  {
    id: 'jinho',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '子が、自分の最初の番が来る前にロンする（それまでに誰も鳴いていないこと）。ルールで役満か満貫かを決める',
      en: 'A non-dealer wins by ron before their first turn (no calls before it). The rules set it as yakuman or mangan',
      zh: '闲家在自己第一次摸牌前荣和（此前无人鸣牌）。由规则决定算役满还是满贯',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '5z', ctx: { jinho: true, seatWind: 2 } },
  },
  {
    id: 'kokushi',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '1・9の数牌と字牌の13種類を1枚ずつ、どれか1種類だけ2枚（鳴けない）。ダブル役満のルールなら、13種類のどれでもアガれる待ちは2倍',
      en: 'One each of all 13 terminals and honors, plus one more of any (closed only). With double yakuman on, the 13-sided wait counts double',
      zh: '一九牌与字牌共13种各一张，其中一种再多一张（不能鸣牌）。若采用双倍役满，十三面听为两倍',
    },
    ex: { hand: ['19m', '19p', '19s', '1234567z', '1m'], win: '7z' },
  },
  {
    id: 'suuankou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '鳴かずにそろえた刻子を4つ作る（ロンで仕上がった刻子は数えない）。ダブル役満のルールなら、雀頭の単騎待ちは2倍',
      en: 'Four concealed triplets (a triplet completed by ron does not count). With double yakuman on, the single-wait version counts double',
      zh: '四组暗刻（靠荣和完成的刻子不算）。若采用双倍役满，单骑听为两倍',
    },
    ex: { hand: ['222m', '555p', '777s', '999s', '11z'], win: '9s', tsumo: true },
  },
  {
    id: 'daisangen',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '白・發・中を3種類とも刻子にする',
      en: 'Triplets of all three dragons',
      zh: '白、发、中三种都成刻',
    },
    ex: { hand: ['555z', '666z', '777z', '234m', '99p'], win: '9p', key: [0, 1, 2] },
  },
  {
    id: 'shousuushii',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '東南西北のうち3種類を刻子、残りの1種類を雀頭にする',
      en: 'Triplets of three winds and a pair of the fourth',
      zh: '东南西北中三种成刻、另一种作雀头',
    },
    ex: { hand: ['111z', '222z', '333z', '44z', '567m'], win: '7m', key: [0, 1, 2, 3] },
  },
  {
    id: 'daisuushii',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '東南西北を4種類とも刻子にする。ダブル役満のルールなら2倍',
      en: 'Triplets of all four winds. Counts double with double yakuman on',
      zh: '东南西北四种都成刻。若采用双倍役满则为两倍',
    },
    ex: { hand: ['333z', '444z', '55m'], melds: ['pon:111z', 'pon:222z'], win: '5m', key: [0, 1, 3, 4] },
  },
  {
    id: 'tsuuiisou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '字牌だけで作る',
      en: 'Use only honor tiles',
      zh: '只用字牌',
    },
    ex: { hand: ['111z', '222z', '555z', '77z'], melds: ['pon:333z'], win: '7z' },
  },
  {
    id: 'ryuuiisou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '2・3・4・6・8の索子と發だけで作る（緑だけの牌）',
      en: 'Use only the all-green tiles: bamboo 2, 3, 4, 6, 8 and Green Dragon',
      zh: '只用索子的2、3、4、6、8和发（全是绿色的牌）',
    },
    ex: { hand: ['234s', '234s', '666s', '888s', '66z'], win: '6z' },
  },
  {
    id: 'chinroutou',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '1・9の数牌だけで作る',
      en: 'Use only terminals (1s and 9s)',
      zh: '只用一九数牌',
    },
    ex: { hand: ['111m', '999m', '111p', '99s'], melds: ['pon:999p'], win: '9s' },
  },
  {
    id: 'suukantsu',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: 'カンを4回する（鳴いたカンでもよい）',
      en: 'Make four kans (called kans count)',
      zh: '开杠四次（明杠也算）',
    },
    ex: { hand: ['55m'], melds: ['kan:1111p', 'kan:2222s', 'ankan:7777m', 'kan:4444z'], win: '5m', key: [1, 2, 3, 4] },
  },
  {
    id: 'chuuren',
    section: 'yakuman',
    han: 0,
    yakuman: 1,
    text: {
      ja: '鳴かずに、1つの色で 1112345678999 ＋その色のどれか1枚。ダブル役満のルールなら、9種類のどれでもアガれる待ちは2倍',
      en: 'Closed hand of 1112345678999 in one suit plus any one more of that suit. With double yakuman on, the nine-sided wait counts double',
      zh: '门清，同一花色的1112345678999再加该花色任意一张。若采用双倍役满，九面听为两倍',
    },
    ex: { hand: ['111m', '2345678m', '999m', '5m'], win: '5m' },
  },
  // ── ローカル役 ──
  {
    id: 'tsubame',
    section: 'local',
    han: 1,
    text: {
      ja: 'ほかの人のリーチの宣言牌でロンする',
      en: 'Win on the tile another player discards to declare riichi',
      zh: '荣和他家宣告立直时打出的牌',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '4s', ctx: { tsubame: true } },
  },
  {
    id: 'kanburi',
    section: 'local',
    han: 1,
    text: {
      ja: 'カンした人が補充の牌を引いたあとに切った牌でロンする',
      en: 'Win on the tile discarded by a player right after they drew a kan replacement tile',
      zh: '荣和他家开杠摸补牌后打出的牌',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '4s', ctx: { kanburi: true } },
  },
  {
    id: 'shiiaru',
    section: 'local',
    han: 1,
    text: {
      ja: '4回鳴いて（暗槓を除く）1枚だけ残し、その1枚の待ちでロンする',
      en: 'Make four calls (concealed kans excluded) and win by ron on your last single tile',
      zh: '鸣牌四次（暗杠除外）只剩一张，单骑荣和',
    },
    ex: { hand: ['55p'], melds: ['chi:234m', 'pon:777s', 'chi:678p', 'pon:111z'], win: '5p' },
  },
  {
    id: 'uumen',
    section: 'local',
    han: 2,
    text: {
      ja: '萬子・筒子・索子・風牌・三元牌の5種類を全部使う（鳴いてもよい・七対子でもよい）',
      en: 'Use all five groups: characters, dots, bamboo, winds and dragons (calls and Chiitoitsu allowed)',
      zh: '万、筒、索、风牌、三元牌五类都用到（可以鸣牌，七对子也可）',
    },
    ex: { hand: ['123m', '456p', '789s', '111z', '55z'], win: '5z' },
  },
  {
    id: 'sanrenko',
    section: 'local',
    han: 2,
    text: {
      ja: '同じ色で、数が1つずつ続く刻子を3つ作る（例：222・333・444）',
      en: 'Three triplets of consecutive numbers in one suit (e.g. 222, 333, 444)',
      zh: '同一花色、数字相连的三组刻子（如222、333、444）',
    },
    ex: { hand: ['222m', '333m', '444m', '678p', '99s'], win: '9s', key: [0, 1, 2] },
  },
  {
    id: 'isshoku3',
    section: 'local',
    han: 3,
    openHan: 2,
    text: {
      ja: '同じ色・同じ数の順子を3つ作る（一盃口とは重ねない）',
      en: 'Three identical sequences (not combined with Iipeikou)',
      zh: '三组完全相同的顺子（不与一杯口复合）',
    },
    ex: { hand: ['234p', '234p', '234p', '678s', '11z'], win: '1z', key: [0, 1, 2] },
  },
  {
    id: 'ipin',
    also: ['chupin'],
    section: 'local',
    han: 5,
    text: {
      ja: '海底で1筒を引いてアガる（一筒摸月）か、河底の9筒でロンする（九筒撈魚）。5翻としてほかの役・ドラと足す。例は一筒摸月',
      en: 'Win on the last wall tile being 1-dot (Ipin Raoyue), or by ron on the last discard being 9-dot (Chupin Raoyui). Adds 5 han to the other yaku and dora. The example is Ipin Raoyue',
      zh: '海底摸到一筒和牌（一筒摸月），或荣和河底的九筒（九筒捞鱼）。按5番与其他役、宝牌相加。例为一筒摸月',
    },
    ex: { hand: ['123m', '456s', '789s', '234p', '11p'], win: '1p', tsumo: true, ctx: { haitei: true } },
  },
  {
    id: 'daisharin',
    also: ['daichikurin', 'daisuurin'],
    section: 'local',
    han: 0,
    yakuman: 1,
    text: {
      ja: '鳴かずに、1つの色の2〜8を2枚ずつ（筒子＝大車輪・索子＝大竹林・萬子＝大数隣）。例は大車輪',
      en: 'Closed hand of two each of 2 to 8 in one suit (dots: Daisharin, bamboo: Daichikurin, characters: Daisuurin). The example is Daisharin',
      zh: '门清，同一花色的2到8各两张（筒子为大车轮、索子为大竹林、万子为大数邻）。例为大车轮',
    },
    ex: { hand: ['22p', '33p', '44p', '55p', '66p', '77p', '88p'], win: '8p' },
  },
  {
    id: 'ishinoue',
    section: 'local',
    han: 0,
    yakuman: 1,
    text: {
      ja: 'ダブル立直をして、山の最後の1枚か最後の捨て牌でアガる',
      en: 'After a double riichi, win on the last wall tile or the last discard',
      zh: '双立直后，以牌山最后一张或最后一张打出的牌和牌',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', tsumo: true, ctx: { riichi: 'double', haitei: true } },
  },
  {
    id: 'surenko',
    section: 'local',
    han: 0,
    yakuman: 1,
    text: {
      ja: '同じ色で、数が1つずつ続く刻子を4つ作る（例：222・333・444・555）',
      en: 'Four triplets of consecutive numbers in one suit (e.g. 222, 333, 444, 555)',
      zh: '同一花色、数字相连的四组刻子（如222、333、444、555）',
    },
    ex: { hand: ['222s', '333s', '444s', '555s', '99m'], win: '9m', key: [0, 1, 2, 3] },
  },
  {
    id: 'parenchan',
    section: 'local',
    han: 0,
    yakuman: 1,
    text: {
      ja: '同じ人が8回続けてアガる（流局をはさむと数え直し・9回目以降も）。役には数えないので、ほかに役が要る。例は8回目のアガリの手',
      en: 'The same player wins eight times in a row (an exhaustive draw resets the count; also applies from the ninth on). It is not a yaku by itself, so another yaku is needed. The example shows an eighth winning hand',
      zh: '同一人连续和牌8次（中间流局则重新计数，第9次以后也算）。本身不算役，需要另有役。例为第8次和牌的手牌',
    },
    ex: { hand: ['234m', '567p', '345s', '678s', '22p'], win: '5s', tsumo: true },
  },
  {
    id: 'daichisei',
    section: 'local',
    han: 0,
    yakuman: 2,
    text: {
      ja: '字牌7種類の七対子（字一色とは足さない）。ダブル役満のルールのときだけ',
      en: 'Chiitoitsu of all seven honor tiles (not added to Tsuuiisou). Only when double yakuman is on',
      zh: '七种字牌组成的七对子（不与字一色相加）。仅在采用双倍役满时',
    },
    ex: { hand: ['11z', '22z', '33z', '44z', '55z', '66z', '77z'], win: '7z' },
  },
];
