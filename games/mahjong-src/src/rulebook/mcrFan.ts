// ルールブックの番の一覧（国標＝MCR）。番数ごとに並べる（利用者 Q8=A＝公式の表と同じ並び）。
// 番の値の正本はルール部分の mcr.ts。例の手を mcrScore に通して、書いた番と点数が付くことを検査で確かめる（mcrFan.test.ts）。
// 同じ形で数字や場面だけが違う番は 1 行にまとめ、例は代表の 1 つ（Q7=C）：
// 全大・全中・全小／大于五・小于五／妙手回春・海底捞月／圈风刻・门风刻／边张・坎张・单钓将。

import type { McrFanId } from '../engine/mcr';
import type { BaseLang } from '../i18n/strings';
import type { YakuExample } from './jpYaku';

export interface McrFanEntry {
  id: McrFanId;
  also?: readonly McrFanId[];
  /** 点数（花牌は 1 枚ごと） */
  fan: number;
  each?: boolean;
  text: Record<BaseLang, string>;
  ex: YakuExample;
}

const f = (id: McrFanId, fan: number, ja: string, en: string, zh: string, ex: YakuExample, more: Partial<McrFanEntry> = {}): McrFanEntry => ({ id, fan, text: { ja, en, zh }, ex, ...more });

/** よく使う、特に番の無い手（場面の番の例に使う） */
const PLAIN: YakuExample = { hand: ['123m', '456p', '789s', '234s', '55z'], win: '3s' };

export const MCR_FAN_LIST: readonly McrFanEntry[] = [
  // ── 88 ──
  f('dasixiG', 88, '東南西北を4種類とも刻子にする', 'Pungs of all four winds', '东南西北四种都成刻', { hand: ['333z', '444z', '55m'], melds: ['pon:111z', 'pon:222z'], win: '5m', key: [0, 1, 3, 4] }),
  f('dasanyuanG', 88, '白・發・中を3種類とも刻子にする', 'Pungs of all three dragons', '中发白三种都成刻', { hand: ['555z', '666z', '777z', '234m', '99p'], win: '9p', key: [0, 1, 2] }),
  f('lvyise', 88, '2・3・4・6・8の索子と發だけで作る', 'Use only bamboo 2, 3, 4, 6, 8 and Green Dragon', '只用条子的2、3、4、6、8和发', { hand: ['234s', '234s', '666s', '888s', '66z'], win: '6z' }),
  f('jiulianG', 88, '鳴かずに、1つの色の 1112345678999 で、その色のどれでもアガれる形', 'Closed 1112345678999 in one suit, waiting on any tile of that suit', '门清，同一花色1112345678999，听该花色任何一张', { hand: ['111m', '2345678m', '999m', '5m'], win: '5m' }),
  f('sigang', 88, 'カンを4回する', 'Four kongs', '开杠四次', { hand: ['55m'], melds: ['kan:1111p', 'kan:2222s', 'ankan:7777m', 'kan:4444z'], win: '5m', key: [1, 2, 3, 4] }),
  f('lianqidui', 88, '1つの色で、数が続く7種類の対子', 'Seven pairs of consecutive numbers in one suit', '同一花色、数字相连的七组对子', { hand: ['11p', '22p', '33p', '44p', '55p', '66p', '77p'], win: '7p' }),
  f('shisanyaoG', 88, '1・9の数牌と字牌の13種類を1枚ずつ、どれか1種類だけ2枚', 'One each of the 13 terminals and honors, plus one more of any', '一九牌与字牌13种各一张，其中一种再多一张', { hand: ['19m', '19p', '19s', '1234567z', '1m'], win: '7z' }),
  // ── 64 ──
  f('qingyaojiuG', 64, '1・9の数牌だけで作る', 'Use only terminals', '只用一九数牌', { hand: ['111m', '999m', '111p', '99s'], melds: ['pon:999p'], win: '9s' }),
  f('xiaosixiG', 64, '東南西北のうち3種類を刻子、残りの1種類を雀頭にする', 'Pungs of three winds and a pair of the fourth', '东南西北三种成刻、另一种作将', { hand: ['111z', '222z', '333z', '44z', '567m'], win: '7m', key: [0, 1, 2, 3] }),
  f('xiaosanyuanG', 64, '白・發・中のうち2種類を刻子、残りの1種類を雀頭にする', 'Pungs of two dragons and a pair of the third', '中发白两种成刻、另一种作将', { hand: ['555z', '666z', '77z', '123m', '456m'], win: '3m', key: [0, 1, 2] }),
  f('ziyiseG', 64, '字牌だけで作る', 'Use only honor tiles', '只用字牌', { hand: ['111z', '222z', '555z', '77z'], melds: ['pon:333z'], win: '7z' }),
  f('sianke', 64, '鳴かずにそろえた刻子（暗刻）を4つ作る', 'Four concealed pungs', '四组暗刻', { hand: ['222m', '555p', '777s', '999s', '11z'], win: '9s', tsumo: true, key: [0, 1, 2, 3] }),
  f('yiseshuanglong', 64, '1つの色で 123 を2つ・789 を2つ・5の雀頭', 'In one suit: two 123s, two 789s and a pair of 5s', '同一花色两组123、两组789、5作将', { hand: ['123m', '123m', '789m', '789m', '55m'], win: '5m' }),
  // ── 48 ──
  f('yisesitongshun', 48, '同じ色・同じ数の順子を4つ', 'Four identical chows in one suit', '同一花色四组相同的顺子', { hand: ['234p', '234p', '234p', '234p', '99s'], win: '9s', key: [0, 1, 2, 3] }),
  f('yisesijiegao', 48, '1つの色で、数が1つずつ続く刻子を4つ', 'Four pungs of consecutive numbers in one suit', '同一花色、数字依次递增一的四组刻子', { hand: ['555p', '99s'], melds: ['pon:222p', 'pon:333p', 'pon:444p'], win: '9s', key: [0, 2, 3, 4] }),
  // ── 32 ──
  f('yisesibugao', 32, '1つの色で、1つか2つずつずれた順子を4つ', 'Four chows in one suit, each shifted up by one (or each by two)', '同一花色四组依次递增一位或两位数的顺子', { hand: ['123p', '234p', '345p', '456p', '99s'], win: '9s', key: [0, 1, 2, 3] }),
  f('sangang', 32, 'カンを3回する', 'Three kongs', '开杠三次', { hand: ['456m', '77s'], melds: ['kan:2222p', 'ankan:5555s', 'kan:9999m'], win: '7s', key: [2, 3, 4] }),
  f('hunyaojiu', 32, '1・9の数牌と字牌だけで作る', 'Use only terminals and honors', '只用一九牌和字牌', { hand: ['111m', '999p', '111z', '22z'], melds: ['pon:999s'], win: '2z' }),
  // ── 24 ──
  f('qiduiG', 24, '対子を7つ作る（鳴けない）', 'Seven pairs (closed only)', '七组对子（门清）', { hand: ['11m', '44m', '77p', '22s', '55s', '33z', '66z'], win: '6z' }),
  f('qixingbukao', 24, '字牌7種類を1枚ずつと、147・258・369 を色ごとに割り当てた数牌から7枚。どの牌も1枚ずつ', 'All 7 honors singly, plus 7 tiles from a knitted 147/258/369 set (no duplicates)', '7种字牌各一张，加上147、258、369分属三种花色的数牌中7张，每张都不同', { hand: ['147m', '25p', '36s', '1234567z'], win: '7z' }),
  f('quanshuangke', 24, '4つの刻子と雀頭が、どれも2・4・6・8の数牌', 'All four pungs and the pair are even-numbered tiles', '四组刻子和将都是2、4、6、8的数牌', { hand: ['888m', '22s'], melds: ['pon:222m', 'pon:444p', 'pon:666s'], win: '2s' }),
  f('qingyiseG', 24, '1つの色の数牌だけで作る', 'Use only one suit', '只用一种花色的数牌', { hand: ['123s', '345s', '567s', '789s', '99s'], win: '6s' }),
  f('yisesantongshun', 24, '同じ色・同じ数の順子を3つ', 'Three identical chows in one suit', '同一花色三组相同的顺子', { hand: ['234p', '678s', '11z'], melds: ['chi:234p', 'chi:234p'], win: '1z', key: [0, 3, 4] }),
  f('yisesanjiegao', 24, '1つの色で、数が1つずつ続く刻子を3つ', 'Three pungs of consecutive numbers in one suit', '同一花色、数字依次递增一的三组刻子', { hand: ['678s', '11z'], melds: ['pon:222p', 'pon:333p', 'pon:444p'], win: '1z', key: [2, 3, 4] }),
  f('quanda', 24, '7・8・9の数牌だけで作る（全大）。4・5・6だけなら全中、1・2・3だけなら全小。例は全大', 'Use only 7, 8, 9 (Upper Tiles). Only 4–6 is Middle Tiles, only 1–3 is Lower Tiles. The example is Upper Tiles', '只用7、8、9的数牌（全大）。只用4到6为全中，只用1到3为全小。例为全大', { hand: ['789m', '789p', '789s', '888m', '99p'], win: '9p' }, { also: ['quanzhong', 'quanxiao'] }),
  // ── 16 ──
  f('qinglong', 16, '同じ色で 123・456・789 の順子', 'The chows 123, 456 and 789 in one suit', '同一花色123、456、789三组顺子', { hand: ['123p', '456p', '789p', '234s', '55m'], win: '9p', key: [0, 1, 2] }),
  f('sanseshuanglong', 16, '2つの色で 123 と 789、残りの色の5が雀頭', 'In two suits, 123 and 789 each, with a pair of 5s in the third suit', '两种花色各有123和789，第三种花色的5作将', { hand: ['123m', '789m', '123p', '789p', '55s'], win: '5s' }),
  f('yisesanbugao', 16, '1つの色で、1つか2つずつずれた順子を3つ', 'Three chows in one suit, each shifted up by one (or each by two)', '同一花色三组依次递增一位或两位数的顺子', { hand: ['123p', '234p', '345p', '678s', '11z'], win: '1z', key: [0, 1, 2] }),
  f('quandaiwu', 16, '4つの面子と雀頭のどれにも5の牌が入っている', 'Every set and the pair contains a 5', '每组面子和将都含有5', { hand: ['345m', '456p', '567s', '555s', '55p'], win: '5p' }),
  f('santongke', 16, '萬子・筒子・索子で、同じ数の刻子', 'Pungs of the same number in all three suits', '三种花色相同数字的刻子', { hand: ['333m', '333p', '333s', '456m', '77s'], win: '7s', key: [0, 1, 2] }),
  f('sananke', 16, '鳴かずにそろえた刻子（暗刻）を3つ', 'Three concealed pungs', '三组暗刻', { hand: ['222m', '555p', '777s', '345s', '99p'], win: '4s', key: [0, 1, 2] }),
  // ── 12 ──
  f('quanbukao', 12, '字牌と、147・258・369 を色ごとに割り当てた数牌から、どれも違う14枚（面子を作らない）', '14 different tiles from honors and a knitted 147/258/369 set (no sets)', '由字牌和147、258、369分属三种花色的数牌组成，14张各不相同（不成面子）', { hand: ['147m', '258p', '36s', '123456z'], win: '6z' }),
  f('zuhelong', 12, '147・258・369 を色ごとに割り当てた9枚と、面子1つ・雀頭', 'A knitted 147/258/369 set across the three suits, plus one set and a pair', '147、258、369分属三种花色的9张，加一组面子和将', { hand: ['147m', '258p', '369s', '123m', '55z'], win: '5z', key: [0, 1, 2] }),
  f('dayuwu', 12, '6〜9の数牌だけで作る（大于五）。1〜4だけなら小于五。例は大于五', 'Use only 6 to 9 (Upper Four). Only 1 to 4 is Lower Four. The example is Upper Four', '只用6到9的数牌（大于五）。只用1到4为小于五。例为大于五', { hand: ['678m', '789p', '678s', '999s', '66m'], win: '6m' }, { also: ['xiaoyuwu'] }),
  f('sanfengke', 12, '風牌の刻子を3つ', 'Three wind pungs', '三组风刻', { hand: ['111z', '222z', '333z', '567m', '99p'], win: '9p', key: [0, 1, 2] }),
  // ── 8 ──
  f('hualong', 8, '3つの色に分けて 123・456・789 の順子', 'The chows 123, 456 and 789, each in a different suit', '三种花色分别组成123、456、789', { hand: ['123m', '456p', '789s', '234s', '55z'], win: '5z', key: [0, 1, 2] }),
  f('tuibudao', 8, '上下を逆さにしても同じ絵の牌だけで作る（1234589筒・245689索・白）', 'Use only tiles that look the same upside down (dots 1234589, bamboo 245689, White)', '只用上下颠倒图案不变的牌（1234589筒、245689条、白板）', { hand: ['123p', '345p', '888p', '55z', '456s'], win: '6s' }),
  f('sansesantongshun', 8, '萬子・筒子・索子で、同じ数の順子', 'The same chow in all three suits', '三种花色相同数字的顺子', { hand: ['234m', '234p', '234s', '678m', '55s'], win: '8m', key: [0, 1, 2] }),
  f('sansesanjiegao', 8, '3つの色に分けて、数が1つずつ続く刻子', 'Pungs of three consecutive numbers, each in a different suit', '三种花色、数字依次递增一的三组刻子', { hand: ['678s', '11z'], melds: ['pon:222m', 'pon:333p', 'pon:444s'], win: '1z', key: [2, 3, 4] }),
  f('wufanhe', 8, 'ほかに番が1つも無い手（花牌を除く）', 'A hand with no other fan (flowers excluded)', '除花牌外没有任何番', { hand: ['345s', '22z'], melds: ['chi:234m', 'chi:567p', 'pon:888s'], win: '5s' }),
  f('miaoshou', 8, '山の最後の1枚を引いてアガる（妙手回春）か、最後の捨て牌でロンする（海底撈月）。例は妙手回春', 'Win on the last wall tile (Last Tile Draw) or by ron on the last discard (Last Tile Claim). The example is Last Tile Draw', '摸牌墙最后一张和牌（妙手回春），或和最后一张打出的牌（海底捞月）。例为妙手回春', { ...PLAIN, tsumo: true, ctx: { lastDraw: true } }, { also: ['haidilaoyue'] }),
  f('gangkaiG', 8, 'カンしたあとに引く補充の牌でアガる', 'Win on the replacement tile after a kong', '开杠后摸的补牌和牌', { hand: ['123m', '456p', '789s', '55s'], melds: ['ankan:1111z'], win: '5s', tsumo: true, ctx: { gangkai: true } }),
  f('qiangganghe', 8, 'ほかの人が加槓した牌でロンする', 'Win on the tile another player adds to make a kong', '和他家加杠的那张牌', { ...PLAIN, ctx: { qianggang: true } }),
  f('shuangangang', 8, '暗槓を2つ', 'Two concealed kongs', '两组暗杠', { hand: ['123m', '456p', '55s'], melds: ['ankan:2222s', 'ankan:7777p'], win: '5s', key: [3, 4] }),
  // ── 6 ──
  f('pengpenghe', 6, '4つの面子をすべて刻子か槓子にする', 'All four sets are pungs or kongs', '四组面子都是刻子或杠子', { hand: ['555p', '99m'], melds: ['pon:222m', 'pon:888s', 'pon:444s'], win: '9m' }),
  f('hunyiseG', 6, '1つの色の数牌と字牌だけで作る', 'Use only one suit plus honors', '只用一种花色的数牌和字牌', { hand: ['123p', '345p', '777p', '111z', '55z'], win: '5z' }),
  f('sansesanbugao', 6, '3つの色に分けて、数が1つずつずれた順子', 'Three chows shifted up by one, each in a different suit', '三种花色依次递增一位数的顺子', { hand: ['234m', '345p', '456s', '789s', '11z'], win: '1z', key: [0, 1, 2] }),
  f('wumenqi', 6, '萬子・筒子・索子・風牌・三元牌の5種類を全部使う', 'Use all five groups: characters, dots, bamboo, winds and dragons', '万、筒、条、风、箭五门齐全', { hand: ['123m', '456p', '789s', '111z', '55z'], win: '5z' }),
  f('quanqiuren', 6, '4回鳴いて1枚だけ残し、その1枚の待ちでロンする', 'Call four times and win by ron on your single remaining tile', '鸣牌四次只剩一张，单钓和别人打出的牌', { hand: ['55p'], melds: ['chi:234m', 'pon:777s', 'chi:678p', 'pon:111z'], win: '5p' }),
  f('shuangjianke', 6, '三元牌の刻子を2つ', 'Two dragon pungs', '两组箭刻', { hand: ['555z', '666z', '123m', '456p', '99s'], win: '9s', key: [0, 1] }),
  // ── 5 ──
  f('mingangang', 5, '暗槓1つと明槓1つ', 'One concealed and one melded kong', '一组明杠和一组暗杠', { hand: ['123m', '456p', '55s'], melds: ['ankan:2222s', 'kan:7777p'], win: '5s', key: [3, 4] }),
  // ── 4 ──
  f('quandaiyao', 4, '4つの面子と雀頭のどれにも1・9の数牌か字牌が入っている', 'Every set and the pair includes a terminal or honor', '每组面子和将都含有一九牌或字牌', { hand: ['123m', '789p', '111z', '789s', '99m'], win: '9s' }),
  f('buqiuren', 4, '鳴かずに自分で引いてアガる', 'Win by self-draw with no calls', '门清自摸和牌', { ...PLAIN, tsumo: true }),
  f('shuangminggang', 4, '明槓を2つ', 'Two melded kongs', '两组明杠', { hand: ['123m', '456p', '55s'], melds: ['kan:2222s', 'kan:7777p'], win: '5s', key: [3, 4] }),
  f('hejuezhang', 4, '場に3枚見えている牌の、最後の1枚でアガる', 'Win on the last copy of a tile when the other three are visible', '和场上已亮明三张的那张牌的最后一张', { ...PLAIN, ctx: { juezhang: true } }),
  // ── 2 ──
  f('jianke', 2, '三元牌の刻子', 'A dragon pung', '一组箭刻', { hand: ['123m', '456p', '789s', '99s'], melds: ['pon:555z'], win: '9s', key: [4] }),
  f('quanfengke', 2, '場風の刻子（圏風刻）か、自風の刻子（門風刻）。例は東場の南家の東＝圏風刻', 'A pung of the round wind (Prevalent Wind) or your seat wind (Seat Wind). The example is East in the East round for the South seat', '圈风的刻子（圈风刻）或门风的刻子（门风刻）。例为东圈南家的东＝圈风刻', { hand: ['123m', '456p', '789s', '99s'], melds: ['pon:111z'], win: '9s', key: [4], ctx: { seatWind: 2 } }, { also: ['menfengke'] }),
  f('menqianqing', 2, '鳴かずに、ほかの人の捨て牌でアガる', 'Win on a discard with no calls', '门清和别人打出的牌', PLAIN),
  f('pinghe', 2, '4つとも順子で、雀頭は数牌', 'Four chows and a pair of number tiles', '四组顺子，数牌作将', { hand: ['123m', '456p', '678s', '234s', '99m'], win: '4s' }),
  f('siguiyi', 2, '同じ牌4枚を、カンせずに手の中で使う', 'All four of a tile used in the hand without making a kong', '四张相同的牌不开杠，用在手里', { hand: ['222m', '234m', '567p', '789p', '55p'], win: '5p', key: [0, 1] }),
  f('shuangtongke', 2, '2つの色で、同じ数の刻子', 'Pungs of the same number in two suits', '两种花色相同数字的刻子', { hand: ['333m', '333p', '456s', '789s', '55z'], win: '5z', key: [0, 1] }),
  f('shuanganke', 2, '鳴かずにそろえた刻子（暗刻）を2つ', 'Two concealed pungs', '两组暗刻', { hand: ['222m', '555p', '345s', '678s', '99p'], win: '4s', key: [0, 1] }),
  f('angang', 2, '暗槓を1つ', 'One concealed kong', '一组暗杠', { hand: ['123m', '456p', '789s', '55s'], melds: ['ankan:2222s'], win: '5s', key: [4] }),
  f('duanyao', 2, '2〜8の数牌だけで作る', 'Use only number tiles 2 to 8', '只用2到8的数牌', { hand: ['234m', '456p', '678s', '345s', '88p'], win: '5s' }),
  // ── 1 ──
  f('yibangao', 1, '同じ色・同じ数の順子を2つ', 'Two identical chows in one suit', '同一花色两组相同的顺子', { hand: ['234m', '234m', '567p', '789s', '55s'], win: '9s', key: [0, 1] }),
  f('xixiangfeng', 1, '2つの色で、同じ数の順子', 'The same chow in two suits', '两种花色相同数字的顺子', { hand: ['234m', '234p', '567s', '789s', '11z'], win: '1z', key: [0, 1] }),
  f('lianliu', 1, '同じ色で、6つ続く数の順子2つ（例：123と456）', 'Two chows in one suit making six consecutive numbers (e.g. 123 and 456)', '同一花色六张相连的两组顺子（如123和456）', { hand: ['123m', '456m', '789p', '234s', '55z'], win: '5z', key: [0, 1] }),
  f('laoshaofu', 1, '同じ色で、123 と 789 の順子', 'The chows 123 and 789 in one suit', '同一花色123和789两组顺子', { hand: ['123m', '789m', '456p', '234s', '55z'], win: '5z', key: [0, 1] }),
  f('yaojiuke', 1, '1・9の数牌か、場風・自風でない風牌の刻子', 'A pung of terminals, or of a wind that is neither the round nor your seat wind', '一九数牌或非圈风、非门风的风牌的刻子', { hand: ['111m', '456p', '789s', '234s', '55z'], win: '5z', key: [0] }),
  f('minggang', 1, '明槓を1つ', 'One melded kong', '一组明杠', { hand: ['123m', '456p', '789s', '55z'], melds: ['kan:2222s'], win: '5z', key: [4] }),
  f('queyimen', 1, '数牌が2つの色だけ（1つの色が欠ける）', 'Number tiles from only two suits (one suit missing)', '数牌只有两种花色（缺一种）', { hand: ['123m', '456m', '789p', '234p', '55z'], win: '5z' }),
  f('wuzi', 1, '字牌を使わない', 'No honor tiles', '不用字牌', { hand: ['111m', '456p', '789s', '234s', '55s'], win: '5s' }),
  f('bianzhang', 1, '待ちが1種類だけで、12 の 3 待ち・89 の 7 待ち（辺張）、真ん中の待ち（嵌張）、雀頭の待ち（単釣将）。例は辺張', 'A single-tile wait: edge (3 with 12, 7 with 89), closed (middle), or pair wait. The example is an edge wait', '只听一张：边张（12听3、89听7）、坎张（听中间）、单钓将。例为边张', { hand: ['123m', '456p', '789s', '234s', '55z'], win: '3m', key: [0] }, { also: ['kanzhang', 'dandiao'] }),
  f('zimoG', 1, '自分で引いてアガる（鳴いていても付く）', 'Win by self-draw (even with calls)', '自摸和牌（鸣牌后也算）', { hand: ['456p', '789s', '234s', '55z'], melds: ['chi:234m'], win: '5z', tsumo: true }),
  f('huapai', 1, '表にした花牌1枚ごとに1点（8点の起和には数えない）', '1 point per flower revealed (does not count toward the 8-point minimum)', '每张花牌1分（不计入8分起和）', { ...PLAIN, flowers: '12f', key: [5] }, { each: true }),
];

export const mcrMembersOf = (e: McrFanEntry): McrFanId[] => [e.id, ...(e.also ?? [])];
