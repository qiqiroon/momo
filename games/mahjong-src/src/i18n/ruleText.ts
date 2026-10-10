// ルールの設定画面の言葉（段階6の6a-2）。日本語は見本から写した表（engine/ruleTable.ts）をそのまま使う。
// ここは英語・中国語の訳だけ。項目の名前・選択肢・注記・まとまりの名前。訳は Claude（2026-10-10）。
// 猫語は画面の言葉と同じく鳴き声にする（strings.ts の決まり）。

import { JP_RULE_ITEMS } from '../engine/ruleSets';
import { JP_ITEMS } from '../engine/ruleTable';
import type { BaseLang } from './strings';

type Tr = { en: string; zh: string };

const ON_OFF: Record<string, Tr> = { on: { en: 'Yes', zh: '有' }, off: { en: 'No', zh: '无' } };

/** 項目の名前 */
const NAMES: Record<string, Tr> = {
  length: { en: 'Game length', zh: '对局长度' },
  start: { en: 'Starting points', zh: '起始点数' },
  kaeshi: { en: 'Return points', zh: '返点' },
  oka: { en: 'Oka (top bonus)', zh: 'Oka（第一名奖励）' },
  uma: { en: 'Uma (placement points)', zh: 'Uma（顺位点）' },
  hasu: { en: 'Rounding of final score (under 1000)', zh: '最终得分的零头（不足1000点）' },
  tobi: { en: 'Bust (end below 0)', zh: '击飞（低于0点结束）' },
  west: { en: 'West round (extend if no one reaches return points)', zh: '西入（未达返点则延长）' },
  zero: { en: 'Bust threshold', zh: '击飞的界线' },
  westEnd: { en: 'How the west round ends', zh: '西入的结束方式' },
  agariyame: { en: 'Agari-yame in the last hand (leading dealer)', zh: '最终局和牌终止（领先的庄家）' },
  tenpaiyame: { en: 'Tenpai-yame in the last hand (leading dealer)', zh: '最终局听牌终止（领先的庄家）' },
  riichiUnder: { en: 'Riichi with under 1000 points', zh: '不足1000点时立直' },
  riichiNoDraw: { en: 'Riichi with no draws left', zh: '没有摸牌机会时立直' },
  aka: { en: 'Red fives (one each of 5m, 5p, 5s)', zh: '赤宝牌（5万・5筒・5索各1张）' },
  ippatsu: { en: 'Ippatsu', zh: '一发' },
  ura: { en: 'Ura-dora / kan ura-dora', zh: '里宝牌・杠里' },
  kandora: { en: 'Kan dora', zh: '杠宝牌' },
  kandoraWhen: { en: 'When kan dora is revealed', zh: '翻开杠宝牌的时机' },
  kuitan: { en: 'Open tanyao (kuitan)', zh: '副露断幺（食断）' },
  kuikae: { en: 'Swap-calling (kuikae)', zh: '食替' },
  shibari: { en: 'Minimum han (shibari)', zh: '番缚' },
  atozuke: { en: 'Atozuke (yaku completed later)', zh: '后付' },
  furiten: { en: 'Furiten', zh: '振听' },
  riichiAnkan: { en: 'Concealed kan after riichi (if the wait does not change)', zh: '立直后暗杠（听牌不变时）' },
  ankanCond: { en: 'Condition for concealed kan after riichi', zh: '立直后暗杠的条件' },
  double: { en: 'Two players ron at once', zh: '两人同时荣和' },
  triple: { en: 'Three players ron at once', zh: '三人同时荣和' },
  multiWinSticks: { en: 'Honba and riichi sticks when two or more win', zh: '两人以上和牌时的积棒与供托' },
  kyushu: { en: 'Abort on nine terminals (kyushu)', zh: '九种九牌流局' },
  kyushuHow: { en: 'How nine terminals aborts', zh: '九种九牌的流局方式' },
  sufon: { en: 'Abort on four winds', zh: '四风连打流局' },
  sukan: { en: 'Abort on four kans (by two or more players)', zh: '四开杠（两人以上共4杠）流局' },
  suricchi: { en: 'Abort on four riichi', zh: '四家立直流局' },
  suricchiWhen: { en: 'When four riichi takes effect', zh: '四家立直成立的时点' },
  keishiki: { en: 'Formal tenpai (counts without a yaku)', zh: '形式听牌（无役也算听牌）' },
  nagashi: { en: 'Nagashi mangan', zh: '流局满贯' },
  ippatsuChankan: { en: 'Ippatsu with robbing a kan', zh: '一发与抢杠复合' },
  ippatsuKakan: { en: 'When an added kan cancels ippatsu', zh: '加杠时一发消失的时点' },
  chankanDora: { en: 'Kan dora of a robbed kan', zh: '被抢杠的杠宝牌' },
  tenhouAnkan: { en: 'Tenhou/chiihou and concealed kan', zh: '天和・地和与暗杠' },
  kokushiAnkan: { en: 'Ron on a concealed kan with thirteen orphans', zh: '国士无双抢暗杠' },
  pao: { en: 'Liability (pao)', zh: '包牌（责任支付）' },
  paoMix: { en: 'Pao with combined yakuman', zh: '包牌与复合役满的支付' },
  paoHonba: { en: 'Honba under pao', zh: '包牌时的积棒' },
  tenpaiHide: { en: 'May declare "noten" while tenpai (non-riichi players)', zh: '听牌也可宣告“未听”（立直者除外）' },
  kyotaku: { en: 'Riichi sticks left at the end', zh: '终局时剩下的供托' },
  renchan: { en: 'Dealer repeat on a draw', zh: '流局时庄家连庄' },
  honba: { en: 'Honba (300 points each)', zh: '本场（积棒・每根300点）' },
  abortRenchan: { en: 'Dealer after an abortive draw', zh: '途中流局后的庄家' },
  kiriage: { en: 'Round up to mangan (30 fu 4 han, 60 fu 3 han)', zh: '切上满贯（30符4番・60符3番）' },
  kazoe: { en: 'Counted yakuman (13+ han)', zh: '累计役满（13番以上）' },
  renpu: { en: 'Fu for a pair of the double wind', zh: '连风牌雀头的符' },
  jinho: { en: 'Renhou', zh: '人和' },
  doubleYakuman: { en: 'Double yakuman (suuankou tanki, 13-wait kokushi, pure chuuren, daisuushii)', zh: '双倍役满（四暗刻单骑・国士十三面・纯正九莲・大四喜）' },
  tie: { en: 'Placement on tied scores', zh: '同分时的名次' },
  yakumanMix: { en: 'Combined yakuman (double, triple)', zh: '役满复合（2倍・3倍）' },
  tsubame: { en: 'Tsubame-gaeshi', zh: '燕返' },
  kanburi: { en: 'Kanburi', zh: '杠振' },
  shiiaru: { en: 'Shiiaruraotai', zh: '十二落抬' },
  uumen: { en: 'Uumensai', zh: '五门齐' },
  sanrenko: { en: 'Three consecutive triplets', zh: '三连刻' },
  isshoku3: { en: 'Pure triple chow', zh: '一色三顺' },
  ipin: { en: 'Iipin moyue', zh: '一筒摸月' },
  chupin: { en: 'Chuupin raoyui', zh: '九筒捞鱼' },
  daisharin: { en: 'Daisharin', zh: '大车轮' },
  daichikurin: { en: 'Daichikurin', zh: '大竹林' },
  daisuurin: { en: 'Daisuurin', zh: '大数邻' },
  ishinoue: { en: 'Ishi no ue ni mo sannen', zh: '石上三年' },
  surenko: { en: 'Four consecutive triplets', zh: '四连刻' },
  parenchan: { en: 'Paarenchan', zh: '八连庄' },
  daichisei: { en: 'Daichisei', zh: '大七星' },
};

/** 選択肢（項目ごと。あり／なしは ON_OFF） */
const OPTS: Record<string, Record<string, Tr>> = {
  length: { east: { en: 'East only', zh: '东风战' }, half: { en: 'Half game', zh: '半庄战' } },
  kaeshi: { none: { en: 'None (raw points)', zh: '无（保持原点）' } },
  uma: { float: { en: 'Floating uma', zh: '浮动Uma' }, none: { en: 'None', zh: '无' } },
  hasu: {
    none: { en: 'No rounding (keep decimals)', zh: '不取整（保留小数）' },
    gosha: { en: 'Round 600 up', zh: '五舍六入' },
    shisha: { en: 'Round 500 up', zh: '四舍五入' },
    kiri: { en: 'Round down', zh: '舍去' },
  },
  zero: { cont: { en: 'Exactly 0 continues', zh: '正好0点继续' }, end: { en: 'Ends at 0', zh: '0点即结束' } },
  westEnd: { sudden: { en: 'End once someone passes return points (up to West 4)', zh: '超过返点即结束（最多西4局）' }, full: { en: 'Play through West 4', zh: '打完西4局' } },
  agariyame: { off: { en: 'No', zh: '无' }, auto: { en: 'Ends automatically', zh: '自动结束' }, choose: { en: 'Dealer chooses', zh: '由本人选择' } },
  tenpaiyame: { off: { en: 'No', zh: '无' }, auto: { en: 'Ends automatically', zh: '自动结束' }, choose: { en: 'Dealer chooses', zh: '由本人选择' } },
  riichiUnder: { ok: { en: 'Allowed', zh: '可以' }, ng: { en: 'Not allowed', zh: '不可以' } },
  riichiNoDraw: { ok: { en: 'Allowed (1+ tile in the wall)', zh: '可以（牌山剩1张以上）' }, ng: { en: 'Not allowed (only with a draw left)', zh: '不可以（仅限还有摸牌机会）' } },
  kandoraWhen: { split: { en: 'Concealed kan at once, open kan on the discard', zh: '暗杠立即・明杠在打牌时' }, now: { en: 'Every kan at once', zh: '所有杠立即' } },
  kuikae: { ok: { en: 'Allowed', zh: '允许' }, ng: { en: 'Forbidden', zh: '禁止' } },
  shibari: { '1': { en: '1 han', zh: '1番' }, '2': { en: '2 han', zh: '2番' }, '5h2': { en: '2 han from 5 honba', zh: '5本场起2番' } },
  riichiAnkan: { ok: { en: 'Allowed', zh: '可以' }, ng: { en: 'Not allowed', zh: '不可以' } },
  ankanCond: { wait: { en: 'If the wait does not change (shape and yaku may change)', zh: '听牌不变即可（牌形・役的增减不论）' }, strict: { en: 'Only when it can only be a triplet', zh: '只有只能视为刻子的牌形' } },
  double: { atama: { en: 'Head bump (first only)', zh: '截和（只算上家）' }, double: { en: 'Double ron', zh: '双响' } },
  triple: { ryukyoku: { en: 'Abortive draw', zh: '流局' }, all: { en: 'All three win', zh: '三人都和' }, atama: { en: 'Head bump', zh: '截和' } },
  multiWinSticks: { first: { en: 'The first winner takes all', zh: '由上家一人全拿' }, each: { en: 'Honba to every winner, riichi sticks back to owners', zh: '积棒给所有和牌者・立直棒退还本人' } },
  kyushuHow: { choose: { en: 'Player chooses', zh: '由本人选择' }, must: { en: 'Must abort', zh: '必须流局' } },
  suricchiWhen: { pass: { en: 'When the 4th declaration tile passes', zh: '第4人的宣言牌通过时' }, declare: { en: 'When the 4th player declares', zh: '第4人宣言时' } },
  ippatsuChankan: { yes: { en: 'Combines', zh: '复合' }, no: { en: 'Does not combine', zh: '不复合' } },
  ippatsuKakan: { after: { en: 'After the robbing check', zh: '抢杠确认之后' }, at: { en: 'At the added kan', zh: '加杠的时点' } },
  chankanDora: { no: { en: 'Not revealed', zh: '不翻开' }, yes: { en: 'Revealed', zh: '翻开' } },
  tenhouAnkan: { lost: { en: 'Lost by a concealed kan', zh: '暗杠后消失' }, keep: { en: 'Kept', zh: '不消失' } },
  pao: { none: { en: 'None', zh: '无' }, '2': { en: 'Daisangen, daisuushii', zh: '大三元・大四喜' }, '3': { en: 'Daisangen, daisuushii, suukantsu', zh: '大三元・大四喜・四杠子' } },
  paoMix: { part: { en: 'Pao for that yakuman only', zh: '只包该役满部分' }, all: { en: 'Pao for the full amount', zh: '全额包牌' } },
  paoHonba: { pao: { en: 'The liable player', zh: '包牌者' }, deal: { en: 'The discarder', zh: '放铳者' } },
  tenpaiHide: { ok: { en: 'Allowed', zh: '可以' }, ng: { en: 'Not allowed', zh: '不可以' } },
  kyotaku: { top: { en: 'Top player takes them', zh: '第一名获得' }, none: { en: 'Nobody gets them', zh: '不给任何人' } },
  renchan: { tenpai: { en: 'Repeat if tenpai', zh: '听牌即连庄' }, agari: { en: 'Repeat only on a win', zh: '仅和牌时连庄' } },
  abortRenchan: { renchan: { en: 'Dealer repeats', zh: '连庄' }, pass: { en: 'Dealer passes', zh: '庄家轮换' } },
  renpu: { '2': { en: '2 fu', zh: '2符' }, '4': { en: '4 fu', zh: '4符' } },
  jinho: { none: { en: 'None', zh: '无' }, mangan: { en: 'Mangan', zh: '满贯' }, yakuman: { en: 'Yakuman', zh: '役满' } },
  tie: { seat: { en: 'Closer to the first dealer ranks higher', zh: '靠近起家者在上' }, split: { en: 'Split the placement points', zh: '平分顺位点' } },
};

/** ローカル役の注記 */
const NOTES: Record<string, Tr> = {
  tsubame: { en: '1 han: ron on another player’s riichi declaration tile (no limit)', zh: '1番：荣和别人的立直宣言牌（不限）' },
  kanburi: { en: '1 han: ron on the discard right after a kan', zh: '1番：荣和杠后立即打出的牌' },
  shiiaru: { en: '1 han: four calls and ron on a single wait (not on tsumo or with a concealed kan)', zh: '1番：四副露单骑荣和（自摸不成立・含暗杠不成立）' },
  uumen: { en: '2 han: uses characters, dots, bamboo, winds and dragons (also seven pairs)', zh: '2番：万・筒・索・风牌・三元牌齐全（七对子也成立）' },
  sanrenko: { en: '2 han: three triplets of consecutive numbers', zh: '2番：三副数字相连的刻子' },
  isshoku3: { en: '3 han (2 open): three identical runs in one suit (not combined with iipeikou)', zh: '3番（副露2番）：同花色同数字的顺子3副（不与一杯口复合）' },
  atozuke: { en: '"Off" forbids an open hand that has a yaku on only some of its waits', zh: '「无」时禁止副露后只有部分听牌有役的和牌（片和）' },
  jinho: { en: 'As mangan, it does not add other yaku or dora (if other yaku score higher, that is used)', zh: '满贯时不与其他役・宝牌相加（按其他役计算更高时取其高）' },
  ipin: { en: '5 han (adds to other yaku and dora): last draw is 1-pin', zh: '5番（与其他役・宝牌相加）：海底摸到一筒' },
  chupin: { en: '5 han (adds to other yaku and dora): ron on the last discard 9-pin', zh: '5番（与其他役・宝牌相加）：河底荣和九筒' },
  daisharin: { en: 'Yakuman: closed, two each of 2–8 pin', zh: '役满：门前、2〜8筒各2张' },
  daichikurin: { en: 'Yakuman: closed, two each of 2–8 sou', zh: '役满：门前、2〜8索各2张' },
  daisuurin: { en: 'Yakuman: closed, two each of 2–8 man', zh: '役满：门前、2〜8万各2张' },
  ishinoue: { en: 'Yakuman: double riichi and win on the last tile', zh: '役满：两立直后海底或河底和牌' },
  surenko: { en: 'Yakuman: four triplets of consecutive numbers', zh: '役满：四副数字相连的刻子' },
  parenchan: { en: 'Yakuman: anyone wins 8 times in a row (a draw resets the count; only with another yaku that meets the minimum han)', zh: '役满：任何人连续和牌8次（流局则重新计数・须另有满足起和番数的役）' },
  daichisei: { en: 'Double yakuman: seven pairs of all seven honors (not added to all honors)', zh: '双倍役满：七种字牌的七对子（不与字一色相加）' },
};

/** まとまりの名前 */
const GROUPS: Record<string, Tr> = {
  対局の形: { en: 'Game format', zh: '对局形式' },
  'ドラ・役': { en: 'Dora and yaku', zh: '宝牌・役' },
  'アガリ・流局': { en: 'Wins and draws', zh: '和牌・流局' },
  点数: { en: 'Scoring', zh: '点数' },
  ローカル役: { en: 'Local yaku', zh: '地方役' },
};

const item = (k: string) => JP_RULE_ITEMS.find((x) => x.k === k);

export function ruleName(k: string, lang: BaseLang): string {
  if (lang === 'ja') return item(k)?.name ?? k;
  return NAMES[k]?.[lang] ?? item(k)?.name ?? k;
}

export function optLabel(k: string, v: string, lang: BaseLang): string {
  const ja = item(k)?.opts.find((o) => o[0] === v)?.[1] ?? v;
  if (lang === 'ja') return ja;
  // 数だけの選択肢（25000・10-20 など）はそのまま
  if (/^[\d\-–]+$/.test(ja)) return ja;
  return OPTS[k]?.[v]?.[lang] ?? ON_OFF[v]?.[lang] ?? ja;
}

export function ruleNote(k: string, lang: BaseLang): string {
  const ja = item(k)?.note ?? '';
  if (!ja || lang === 'ja') return ja;
  return NOTES[k]?.[lang] ?? ja;
}

export function groupName(g: string, lang: BaseLang): string {
  return lang === 'ja' ? g : (GROUPS[g]?.[lang] ?? g);
}

/** 訳が抜けていないか（検査用）：英・中の名前が無い項目、選択肢の訳が無いもの */
export function missingTranslations(): string[] {
  const out: string[] = [];
  for (const it of JP_RULE_ITEMS) {
    if (!NAMES[it.k]) out.push(`名前 ${it.k}`);
    for (const [v, ja] of it.opts) if (!/^[\d\-–]+$/.test(ja) && !OPTS[it.k]?.[v] && !ON_OFF[v]) out.push(`選択肢 ${it.k}=${v}`);
    if (it.note && !NOTES[it.k]) out.push(`注記 ${it.k}`);
  }
  for (const g of JP_ITEMS.filter((x) => x.group).map((x) => x.group!)) if (!GROUPS[g]) out.push(`まとまり ${g}`);
  return out;
}
