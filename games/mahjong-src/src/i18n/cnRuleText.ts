// 中国式のルールの設定画面の言葉（2026-10-13 第16・中国式の個別設定）。日本語は見本から写した表（engine/ruleTable.ts の CN_ITEMS）をそのまま使う。
// ここは英語・中国語（簡体字）の訳だけ。日本式と同じ項目名（length・start・tobi・kuikae など）があるので、表は日本式と分ける。訳は Claude。

type Tr = { en: string; zh: string };

/** 項目の名前 */
export const CN_NAMES: Record<string, Tr> = {
  length: { en: 'Game length', zh: '对局长度' },
  handCap: { en: 'Maximum number of hands', zh: '局数上限' },
  start: { en: 'Starting points', zh: '起始分' },
  rank: { en: 'How placement is decided', zh: '名次的计算方法' },
  tieCn: { en: 'Placement when tied', zh: '同分时的名次' },
  dealer: { en: 'Next dealer', zh: '庄家的决定方法' },
  tobi: { en: 'Bust (end below 0)', zh: '击飞（低于0分结束）' },
  tochu: { en: 'Abortive draws (nine terminals etc.)', zh: '中途流局（九种九牌等）' },
  honors: { en: 'Honor tiles (winds and dragons)', zh: '字牌（东南西北中发白）' },
  flower: { en: 'Flower tiles (8 flowers and seasons)', zh: '花牌（春夏秋冬梅兰菊竹）' },
  flowerRefill: { en: 'Replacement after a flower', zh: '补花的位置' },
  chi: { en: 'Chow', zh: '吃' },
  lastTile: { en: 'Chow / pung on the last discard', zh: '最后一张打出的牌吃·碰' },
  kuikae: { en: 'Swap-discard after a call', zh: '食换' },
  queyimen: { en: 'Must be missing one suit to win (que yi men)', zh: '缺一门才能和牌' },
  minFan: { en: 'Minimum fan to win', zh: '起和番数' },
  qidui: { en: 'Seven pairs', zh: '七对' },
  haitei: { en: 'Winning on the last tile (haidi)', zh: '最后一张和牌（海底）' },
  tenhou: { en: 'Heavenly / earthly hand', zh: '天和·地和' },
  multiWin: { en: 'Two or more players win on the same discard', zh: '同一张牌多人和牌' },
  afterWin: { en: 'After a win', zh: '和牌之后' },
  ron: { en: 'Win on a discard', zh: '点和（吃和）' },
  rinshan: { en: 'Win on a kong replacement', zh: '杠上开花' },
  chankan: { en: 'Robbing a kong', zh: '抢杠' },
  kokushi13: { en: 'Thirteen orphans robbing a concealed kong', zh: '十三幺抢暗杠' },
  miss: { en: 'Restriction after passing on a win', zh: '过手不和的限制' },
  multiDealer: { en: 'Next dealer after a multiple win', zh: '一炮多响时的下一任庄家' },
  huan3: { en: 'Exchange three tiles at the start', zh: '开局换三张' },
  scoring: { en: 'Scoring system', zh: '计分方式' },
  cap: { en: 'Score cap', zh: '封顶' },
  pay: { en: 'Payment', zh: '支付方式' },
  kanPay: { en: 'Immediate kong payment (gua feng xia yu)', zh: '刮风下雨（杠牌当场结算）' },
  chajiao: { en: 'Non-ready players pay at a draw (cha jiao)', zh: '流局查叫' },
  huazhu: { en: 'Penalty for keeping all three suits at a draw (hua zhu)', zh: '流局查花猪' },
  gangshangpao: { en: 'Win on the discard right after a kong (1 fan)', zh: '杠上炮（1番）' },
  chajiaoPts: { en: 'Points paid in cha jiao', zh: '查叫支付的分数' },
  baopai: { en: 'Liability payment (twelve-tile / big three dragons)', zh: '包牌（十二张包·大三元包）' },
};

/** 選択肢（あり・なしは共通の言葉） */
export const CN_OPTS: Record<string, Record<string, Tr>> = {
  length: { '1': { en: '1 round', zh: '1圈' }, '4': { en: '4 rounds', zh: '4圈' } },
  handCap: { none: { en: 'None', zh: '无' }, '24': { en: '24 hands', zh: '24局' } },
  start: { '0': { en: 'From 0', zh: '从0分开始' }, '500': { en: '500', zh: '500分' } },
  rank: { points: { en: 'By points', zh: '按分数高低' }, mcr: { en: 'MCR table points', zh: '国标标准分' } },
  tieCn: { seat: { en: 'Closer to the first dealer ranks higher', zh: '离起家近者在前' }, same: { en: 'Same place (table points shared)', zh: '名次并列（平分标准分）' } },
  dealer: {
    firstWin: { en: 'First winner becomes dealer', zh: '首先和牌者做庄' },
    rotate: { en: 'Always rotates', zh: '轮庄（不连庄）' },
    renchan: { en: 'Dealer stays after winning', zh: '庄家和牌连庄' },
  },
  flowerRefill: { back: { en: 'From the end of the wall', zh: '从牌墙尾部补' }, front: { en: 'From the front of the wall', zh: '从牌墙前方补' } },
  lastTile: { ok: { en: 'Allowed', zh: '可以' }, ng: { en: 'Not allowed', zh: '禁止' } },
  kuikae: { ok: { en: 'Allowed', zh: '允许' }, ng: { en: 'Not allowed', zh: '禁止' } },
  minFan: { '0': { en: 'None', zh: '无' }, '3': { en: '3 fan', zh: '3番' }, '8': { en: '8 fan', zh: '8番' } },
  haitei: { both: { en: 'Self-draw and discard', zh: '自摸·点和均可' }, tsumo: { en: 'Self-draw only', zh: '仅自摸' } },
  multiWin: { all: { en: 'All may win', zh: '一炮多响' }, atama: { en: 'Only the first in turn order (head bump)', zh: '截和（只一人）' } },
  afterWin: {
    end: { en: 'Hand ends', zh: '本局结束' },
    leave: { en: 'Winner leaves, others continue (xue zhan dao di)', zh: '和牌者退出，其余继续（血战到底）' },
    again: { en: 'Keep playing and win again (xue liu cheng he)', zh: '可以多次和牌（血流成河）' },
  },
  ron: { ok: { en: 'Yes', zh: '有' }, tsumo: { en: 'Self-draw only', zh: '仅自摸' } },
  miss: {
    none: { en: 'None', zh: '无' },
    nextDraw: { en: 'No win until your next draw', zh: '到自己下次摸牌前不能和' },
    sameTile: { en: 'Not on the same tile in the same turn', zh: '同巡内不能和同一张牌' },
  },
  multiDealer: { dealIn: { en: 'The discarder deals next', zh: '放炮者做庄' }, dealerWin: { en: 'Dealer stays if among the winners', zh: '庄家在和牌者之中则连庄' } },
  scoring: {
    mcr: { en: 'MCR (81 fan, added up)', zh: '国标（81种番，相加）' },
    sichuan: { en: 'Sichuan fan (doubling)', zh: '四川番（翻倍）' },
    hk: { en: 'Hong Kong fan (doubling)', zh: '香港番（翻倍）' },
  },
  cap: { '3': { en: '3 fan', zh: '3番' }, '10': { en: '10 fan', zh: '10番' }, none: { en: 'None', zh: '无' } },
  pay: {
    sichuan: { en: 'Sichuan style', zh: '四川式' },
    mcr: { en: 'MCR style (base 8 from everyone)', zh: '国标式（每人底分8）' },
    hk: { en: 'Hong Kong style (self-draw: half from each of 3)', zh: '香港式（自摸每人付一半）' },
  },
  chajiaoPts: {
    ron: { en: 'Highest discard-win value among the waits (max 8)', zh: '听牌中最高的点和分（最多8分）' },
    tsumo: { en: 'Highest self-draw value among the waits (max 8)', zh: '听牌中最高的自摸分（最多8分）' },
  },
};

/** 注記 */
export const CN_NOTES: Record<string, Tr> = {
  handCap: {
    en: 'Hong Kong: "4 rounds or 24 hands" (ends at 24 hands even if the dealer keeps winning). Sichuan and MCR have no such rule (both end at exactly 16 hands)',
    zh: '香港为“4圈或24局”（连庄也在24局结束）。四川·国标无此条文（均为16局结束）',
  },
  tieCn: {
    en: 'MCR has no rule for a tie within one game; follows a tournament rule (Tencent TMT 2016: tied players share table points). The official tie-breaks are for overall tournament standings',
    zh: '国标对单场同分没有条文，依照赛事规程（腾讯TMT 2016“比赛分相同，则均分标准分”）。规则中的比较方法用于整个比赛的排名',
  },
  tochu: { en: '"Yes" = nine terminals (player may choose), four winds, four kongs — same as the Japanese general rule. Dealer as in a normal draw', zh: '“有”＝九种九牌（本人选择）·四风连打·四杠散了（与日本一般规则相同）。庄家按流局处理' },
  lastTile: {
    en: 'Kongs are never possible on the last tile (no replacement tile). MCR also forbids added/concealed kongs and flower replacement for whoever draws the last tile (MIL23-15)',
    zh: '最后一张时任何规则都不能杠（没有补牌）。国标还禁止摸最后一张牌者加杠·暗杠·补花（MIL23-15）',
  },
  kuikae: {
    en: 'Hong Kong treats swap-discarding (discarding a tile that matches or extends the meld just called) as a foul = not allowed. Sichuan and MCR have no rule',
    zh: '香港把“食换”（碰·吃后立即打出与该副露相同或可连接的牌）视为犯规＝禁止。四川·国标无条文',
  },
  afterWin: {
    en: 'Xue liu cheng he is not in any official rule (an app variant) and no set uses it. Winners stay in and may only discard what they draw (no calls or kongs). Win as often as you like until the wall runs out',
    zh: '血流成河不在任何条文中（应用程序的玩法），任何规则集都不使用。和牌后不退出，之后只能摸什么打什么（不吃碰杠），直到牌摸完可多次和牌',
  },
  huan3: {
    en: 'Not in any official rule (a familiar app variant). "Yes" = after dealing, everyone passes 3 tiles of one suit (honors with honors) face down; dice decide the direction (left, right or across). Que yi men is chosen afterwards',
    zh: '不在任何条文中（应用程序中常见的玩法）。“有”＝配牌后每人扣出同一花色3张（字牌与字牌），掷骰决定方向（下家·上家·对家）后交换。之后再定缺',
  },
};

/** まとまりの名前（日本式に無いもの） */
export const CN_GROUPS: Record<string, Tr> = {
  牌: { en: 'Tiles', zh: '牌' },
  '鳴き・アガリ': { en: 'Calls and wins', zh: '吃碰·和牌' },
};
