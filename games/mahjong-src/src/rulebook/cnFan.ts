// ルールブックの番の一覧（中国式の四川・香港。国標は mcrFan.ts）。どれを出すかはルールの「点数の数え方」（scoring）で決める。
// 番の値の正本はルール部分（sichuan.ts・hongkong.ts）。例の手をそこへ通して、書いた番と番数が付くことを検査で確かめる（cnFan.test.ts）。
// 同じ形の番は 1 行にまとめ、例は代表の 1 つ（日本式と同じ・Q7=C）。四川の例は缺一門に合わせて 2 色だけで作る。

import type { HkFanId } from '../engine/hongkong';
import type { CnFanId } from '../engine/sichuan';
import type { BaseLang } from '../i18n/strings';
import type { YakuExample } from './jpYaku';

export type CnScoring = 'sichuan' | 'hk';

export interface CnFanEntry {
  id: CnFanId | HkFanId;
  also?: readonly (CnFanId | HkFanId)[];
  /** 番数。each＝1 組ごとにこの番数（根・三元牌・風牌）。limit＝例牌（香港の 10 番） */
  fan: number;
  each?: boolean;
  limit?: boolean;
  text: Record<BaseLang, string>;
  ex: YakuExample;
}

export const SICHUAN_FANS: readonly CnFanEntry[] = [
  {
    id: 'gen',
    fan: 1,
    each: true,
    text: {
      ja: '同じ牌を4枚使う（カンした4枚も、手の中にそろえた4枚も数える）',
      en: 'Four of the same tile in the hand (kans and four held tiles both count)',
      zh: '手中有四张相同的牌（杠出的四张和手里的四张都算）',
    },
    ex: { hand: ['222m', '234m', '567p', '789p', '55p'], win: '5p', key: [0, 1] },
  },
  {
    id: 'pengpeng',
    fan: 1,
    text: {
      ja: '4つの面子をすべて刻子（同じ牌3枚）か槓子にする',
      en: 'All four sets are pungs or kongs',
      zh: '四组面子都是刻子或杠子',
    },
    ex: { hand: ['222m', '555m', '777p', '999p', '33p'], win: '3p' },
  },
  {
    id: 'jingou',
    fan: 1,
    text: {
      ja: '4回鳴いて1枚だけ残し、その1枚の待ちでアガる（碰碰胡も付く）',
      en: 'Call four times, leaving a single tile, and win on its pair (All Pungs also counts)',
      zh: '鸣牌四次只剩一张，单骑和牌（另计碰碰胡）',
    },
    ex: { hand: ['55p'], melds: ['pon:222m', 'pon:777m', 'pon:333p', 'pon:888p'], win: '5p' },
  },
  {
    id: 'qingyise',
    fan: 2,
    text: {
      ja: '1つの色の牌だけで作る',
      en: 'Use tiles of only one suit',
      zh: '只用一种花色的牌',
    },
    ex: { hand: ['123m', '345m', '567m', '789m', '99m'], win: '6m' },
  },
  {
    id: 'qidui',
    fan: 2,
    text: {
      ja: '鳴かずに対子を7つ作る（同じ牌4枚は2つの対子に数える）',
      en: 'Seven pairs with no calls (four of a kind counts as two pairs)',
      zh: '门清七组对子（四张相同的牌算两对）',
    },
    ex: { hand: ['11m', '33m', '55m', '77p', '22p', '44p', '99p'], win: '9p' },
  },
  {
    id: 'haidi',
    fan: 1,
    text: {
      ja: '山の最後の1枚を引いてアガるか、最後の捨て牌でロンする。例はツモ',
      en: 'Win on the last tile of the wall, or by ron on the last discard. The example is a self-draw',
      zh: '摸牌山最后一张和牌，或荣和最后一张打出的牌。例为自摸',
    },
    ex: { hand: ['123m', '456m', '789p', '234p', '55p'], win: '5p', tsumo: true, ctx: { haidi: true } },
  },
  {
    id: 'gangkai',
    fan: 1,
    text: {
      ja: 'カンしたあとに引く補充の牌でアガる',
      en: 'Win on the replacement tile drawn after a kong',
      zh: '开杠后摸的补牌和牌',
    },
    ex: { hand: ['123m', '456m', '789p', '55p'], melds: ['ankan:2222p'], win: '5p', tsumo: true, ctx: { gangkai: true } },
  },
  {
    id: 'gangpao',
    fan: 1,
    text: {
      ja: 'ほかの人がカンして補充の牌を引いたあとに切った牌でロンする',
      en: 'Win by ron on the tile discarded right after another player’s kong replacement draw',
      zh: '荣和他家开杠摸补牌后打出的牌',
    },
    ex: { hand: ['123m', '456m', '789p', '234p', '55p'], win: '4p', ctx: { gangpao: true } },
  },
  {
    id: 'qianggang',
    fan: 1,
    text: {
      ja: 'ほかの人がポンした面子に4枚目を足してカンしたとき、その牌でロンする',
      en: 'Win on the tile another player adds to their pung to make a kong',
      zh: '他家加杠时，荣和他加上的那张牌',
    },
    ex: { hand: ['123m', '456m', '789p', '234p', '55p'], win: '3p', ctx: { qianggang: true } },
  },
];

export const HK_FANS: readonly CnFanEntry[] = [
  {
    id: 'pinghu',
    fan: 1,
    text: {
      ja: '4つの面子をすべて順子にする',
      en: 'All four sets are chows',
      zh: '四组面子都是顺子',
    },
    ex: { hand: ['123m', '456m', '789p', '234s', '55s'], win: '4s', key: [0, 1, 2, 3] },
  },
  {
    id: 'menqing',
    fan: 1,
    text: {
      ja: '鳴かずにアガる（暗槓をしていても付かない）',
      en: 'Win without calling (a concealed kong also breaks it)',
      zh: '不鸣牌和牌（暗杠也算破门清）',
    },
    ex: { hand: ['123m', '456m', '789p', '234s', '55s'], win: '4s' },
  },
  {
    id: 'zimo',
    fan: 1,
    text: {
      ja: '自分で引いた牌でアガる',
      en: 'Win on your own draw',
      zh: '自摸和牌',
    },
    ex: { hand: ['123m', '456m', '789p', '234s', '55s'], win: '4s', tsumo: true },
  },
  {
    id: 'dragon',
    fan: 1,
    each: true,
    text: {
      ja: '白・發・中のどれかを3枚そろえる（鳴いてもよい）。例は中',
      en: 'A pung of White, Green or Red Dragons (may be called). The example uses Red',
      zh: '白、发、中任一种三张成刻（可以碰）。例为红中',
    },
    ex: { hand: ['123m', '456m', '789p', '55s'], melds: ['pon:777z'], win: '5s', key: [4] },
  },
  {
    id: 'wind',
    fan: 1,
    each: true,
    text: {
      ja: '自風か場風の牌を3枚そろえる。両方に当たれば2番。例は南家の南',
      en: 'A pung of your seat wind or the round wind; 2 fan if it is both. The example is South for the South seat',
      zh: '自风或场风牌三张成刻；两者皆是则2番。例为南家的南',
    },
    ex: { hand: ['123m', '456m', '789p', '55s'], melds: ['pon:222z'], win: '5s', key: [4], ctx: { seatWind: 2 } },
  },
  {
    id: 'huayao',
    fan: 1,
    text: {
      ja: '1・9の数牌と字牌だけで作る（對對糊も付く）',
      en: 'Use only terminals and honors (All Pungs also counts)',
      zh: '只用一九牌和字牌（另计对对糊）',
    },
    ex: { hand: ['111m', '999p', '111z', '22z'], melds: ['pon:999s'], win: '2z' },
  },
  {
    id: 'qianggangHk',
    fan: 1,
    text: {
      ja: 'ほかの人がポンした面子に4枚目を足してカンしたとき、その牌でロンする',
      en: 'Win on the tile another player adds to their pung to make a kong',
      zh: '他家加杠时，荣和他加上的那张牌',
    },
    ex: { hand: ['123m', '456m', '789p', '234s', '55s'], win: '3s', ctx: { qianggang: true } },
  },
  {
    id: 'gangkaiHk',
    fan: 1,
    text: {
      ja: 'カンしたあとに引く補充の牌でアガる',
      en: 'Win on the replacement tile drawn after a kong',
      zh: '开杠后摸的补牌和牌',
    },
    ex: { hand: ['123m', '456m', '789p', '55s'], melds: ['kan:6666s'], win: '5s', tsumo: true, ctx: { gangkai: true, kanChain: 1 } },
  },
  {
    id: 'haidiHk',
    fan: 1,
    text: {
      ja: '山の最後の1枚を引いてアガる',
      en: 'Win on the last tile of the wall',
      zh: '摸牌山最后一张和牌',
    },
    ex: { hand: ['123m', '456m', '789p', '234s', '55s'], win: '5s', tsumo: true, ctx: { haidi: true } },
  },
  {
    id: 'hunyise',
    fan: 3,
    text: {
      ja: '1つの色の数牌と字牌だけで作る',
      en: 'Use only one suit plus honors',
      zh: '只用一种花色的数牌和字牌',
    },
    ex: { hand: ['123p', '345p', '777p', '111z', '55z'], win: '5z' },
  },
  {
    id: 'duidui',
    fan: 3,
    text: {
      ja: '4つの面子をすべて刻子か槓子にする',
      en: 'All four sets are pungs or kongs',
      zh: '四组面子都是刻子或杠子',
    },
    ex: { hand: ['555p', '99m'], melds: ['pon:222m', 'pon:888s', 'pon:444s'], win: '9m' },
  },
  {
    id: 'xiaosanyuan',
    fan: 3,
    text: {
      ja: '白・發・中のうち2種類を刻子、残りの1種類を雀頭にする（三元牌の2番も付いて5番）',
      en: 'Pungs of two dragons and a pair of the third (the two Dragon Pungs add 2, making 5 fan)',
      zh: '三元牌中两种成刻、另一种作雀头（另计三元牌2番，共5番）',
    },
    ex: { hand: ['555z', '666z', '77z', '123m', '456m'], win: '3m', key: [0, 1, 2] },
  },
  {
    id: 'dasanyuan',
    fan: 5,
    text: {
      ja: '白・發・中を3種類とも刻子にする（三元牌の3番も付いて8番）',
      en: 'Pungs of all three dragons (the three Dragon Pungs add 3, making 8 fan)',
      zh: '白、发、中三种都成刻（另计三元牌3番，共8番）',
    },
    ex: { hand: ['555z', '666z', '777z', '234m', '99p'], win: '9p', key: [0, 1, 2] },
  },
  {
    id: 'qingyiseHk',
    fan: 7,
    text: {
      ja: '1つの色の数牌だけで作る（字牌も使わない）',
      en: 'Use only one suit, with no honors',
      zh: '只用一种花色的数牌（不用字牌）',
    },
    ex: { hand: ['123s', '345s', '567s', '789s', '99s'], win: '6s' },
  },
  // ── 例牌（一律 10 番） ──
  {
    id: 'ziyise',
    fan: 10,
    limit: true,
    text: {
      ja: '字牌だけで作る',
      en: 'Use only honor tiles',
      zh: '只用字牌',
    },
    ex: { hand: ['111z', '222z', '555z', '77z'], melds: ['pon:333z'], win: '7z' },
  },
  {
    id: 'xiaosixi',
    fan: 10,
    limit: true,
    text: {
      ja: '東南西北のうち3種類を刻子、残りの1種類を雀頭にする',
      en: 'Pungs of three winds and a pair of the fourth',
      zh: '东南西北中三种成刻、另一种作雀头',
    },
    ex: { hand: ['111z', '222z', '333z', '44z', '567m'], win: '7m', key: [0, 1, 2, 3] },
  },
  {
    id: 'dasixi',
    fan: 10,
    limit: true,
    text: {
      ja: '東南西北を4種類とも刻子にする',
      en: 'Pungs of all four winds',
      zh: '东南西北四种都成刻',
    },
    ex: { hand: ['333z', '444z', '55m'], melds: ['pon:111z', 'pon:222z'], win: '5m', key: [0, 1, 3, 4] },
  },
  {
    id: 'kankan',
    fan: 10,
    limit: true,
    text: {
      ja: '鳴かずにそろえた刻子を4つ作る（カンなし）。ロンなら雀頭の単騎待ちのときだけ',
      en: 'Four concealed pungs, with no kongs. By ron, only on a pair wait',
      zh: '四组暗刻（不开杠）。荣和时只限单骑',
    },
    ex: { hand: ['222m', '555p', '777s', '999s', '11z'], win: '9s', tsumo: true },
  },
  {
    id: 'shibaluohan',
    fan: 10,
    limit: true,
    text: {
      ja: 'カンを4回する（鳴いたカンでもよい）',
      en: 'Make four kongs (called kongs count)',
      zh: '开杠四次（明杠也算）',
    },
    ex: { hand: ['55m'], melds: ['kan:1111p', 'kan:2222s', 'ankan:7777m', 'kan:4444z'], win: '5m', key: [1, 2, 3, 4] },
  },
  {
    id: 'qingyaojiu',
    fan: 10,
    limit: true,
    text: {
      ja: '1・9の数牌だけで作る',
      en: 'Use only terminals (1s and 9s)',
      zh: '只用一九数牌',
    },
    ex: { hand: ['111m', '999m', '111p', '99s'], melds: ['pon:999p'], win: '9s' },
  },
  {
    id: 'tianhu',
    also: ['dihu'],
    fan: 10,
    limit: true,
    text: {
      ja: '親が配られた14枚でもうアガっている（天糊）か、子が最初に引いた牌でアガる（地糊）。例は天糊',
      en: 'The dealer’s starting 14 tiles already win (Heavenly Hand), or a non-dealer wins on their first draw (Earthly Hand). The example is Heavenly Hand',
      zh: '庄家起手14张已和牌（天糊），或闲家第一次摸牌就和牌（地糊）。例为天糊',
    },
    ex: { hand: ['123m', '456p', '789s', '234s', '55z'], win: '5z', tsumo: true, ctx: { tianhu: true } },
  },
  {
    id: 'shisanyao',
    fan: 10,
    limit: true,
    text: {
      ja: '1・9の数牌と字牌の13種類を1枚ずつ、どれか1種類だけ2枚（鳴けない）',
      en: 'One each of all 13 terminals and honors, plus one more of any (no calls)',
      zh: '一九牌与字牌共13种各一张，其中一种再多一张（不能鸣牌）',
    },
    ex: { hand: ['19m', '19p', '19s', '1234567z', '1m'], win: '7z' },
  },
  {
    id: 'ganggang',
    fan: 10,
    limit: true,
    text: {
      ja: '続けて2回カンし、2回目の補充の牌でアガる',
      en: 'Make two kongs in a row and win on the second replacement tile',
      zh: '连续开杠两次，以第二张补牌和牌',
    },
    ex: { hand: ['123m', '55s'], melds: ['kan:6666s', 'ankan:2222p', 'pon:999p'], win: '5s', tsumo: true, ctx: { gangkai: true, kanChain: 2 }, key: [2, 3] },
  },
  {
    id: 'jiulian',
    fan: 10,
    limit: true,
    text: {
      ja: '鳴かずに、1つの色で 1112345678999 ＋その色のどれか1枚。ロンなら9種類のどれでもアガれる待ちのときだけ',
      en: 'Closed hand of 1112345678999 in one suit plus any one more of that suit. By ron, only on the nine-sided wait',
      zh: '门清，同一花色的1112345678999再加该花色任意一张。荣和时只限九面听',
    },
    ex: { hand: ['111m', '2345678m', '999m', '5m'], win: '5m' },
  },
];

/** その数え方の番の一覧 */
export const cnFansOf = (s: CnScoring): readonly CnFanEntry[] => (s === 'sichuan' ? SICHUAN_FANS : HK_FANS);
export const cnMembersOf = (e: CnFanEntry) => [e.id, ...(e.also ?? [])];
