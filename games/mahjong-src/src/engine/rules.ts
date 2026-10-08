// ルールの値。項目の名前は見本 mock/settings.html の項目名をそのまま使う（段階6でセット選びをつなぐときに付け替えが要らないように）。
// 正本はルール設定 v0.03（作業側の games/mahjong/docs/）。値はコードの中で直接書かず、ここから読む。
// 日本式 71 項目・中国式 35 項目。

export const JP_RULE_KEYS = [
  'length',
  'start',
  'oka',
  'uma',
  'hasu',
  'tobi',
  'west',
  'zero',
  'westEnd',
  'agariyame',
  'tenpaiyame',
  'riichiUnder',
  'riichiNoDraw',
  'aka',
  'ippatsu',
  'ura',
  'kandora',
  'kandoraWhen',
  'kuitan',
  'kuikae',
  'shibari',
  'atozuke',
  'furiten',
  'riichiAnkan',
  'ankanCond',
  'double',
  'triple',
  'multiWinSticks',
  'kyushu',
  'kyushuHow',
  'sufon',
  'sukan',
  'suricchi',
  'suricchiWhen',
  'keishiki',
  'nagashi',
  'ippatsuChankan',
  'ippatsuKakan',
  'chankanDora',
  'tenhouAnkan',
  'kokushiAnkan',
  'pao',
  'paoMix',
  'paoHonba',
  'tenpaiHide',
  'kyotaku',
  'renchan',
  'honba',
  'abortRenchan',
  'kiriage',
  'kazoe',
  'renpu',
  'jinho',
  'doubleYakuman',
  'tie',
  'yakumanMix',
  'tsubame',
  'kanburi',
  'shiiaru',
  'uumen',
  'sanrenko',
  'isshoku3',
  'ipin',
  'chupin',
  'daisharin',
  'daichikurin',
  'daisuurin',
  'ishinoue',
  'surenko',
  'parenchan',
  'daichisei',
] as const;
export const CN_RULE_KEYS = [
  'length',
  'start',
  'rank',
  'tieCn',
  'dealer',
  'tobi',
  'tochu',
  'honors',
  'flower',
  'flowerRefill',
  'chi',
  'lastTile',
  'queyimen',
  'minFan',
  'qidui',
  'haitei',
  'tenhou',
  'multiWin',
  'afterWin',
  'ron',
  'rinshan',
  'chankan',
  'kokushi13',
  'miss',
  'multiDealer',
  'huan3',
  'scoring',
  'cap',
  'pay',
  'kanPay',
  'chajiao',
  'huazhu',
  'gangshangpao',
  'chajiaoPts',
  'baopai',
] as const;

export type JpRuleKey = (typeof JP_RULE_KEYS)[number];
export type CnRuleKey = (typeof CN_RULE_KEYS)[number];

export type Rules =
  | { family: 'jp'; values: Readonly<Record<JpRuleKey, string>> }
  | { family: 'cn'; values: Readonly<Record<CnRuleKey, string>> };

/** 一般ルール（MOMO が定める日本式の既定セット）。段階5まではこの1組だけで動かす */
export const GENERAL_RULES: Rules = {
  family: 'jp',
  values: {
    length: 'half', // 長さ
    start: '25', // 持ち点
    oka: 'on', // オカ（トップ賞）
    uma: '10-20', // ウマ（順位点）
    hasu: 'gosha', // 最終得点の端数（1000点未満）
    tobi: 'on', // 飛び（0点未満で終了）
    west: 'on', // 西入（返し点に届かなければ延長）
    zero: 'cont', // 飛びの境目
    westEnd: 'sudden', // 西入の終わり方
    agariyame: 'choose', // オーラスのアガリやめ（トップの親）
    tenpaiyame: 'choose', // オーラスのテンパイやめ（トップの親）
    riichiUnder: 'ng', // 1000点未満のリーチ
    riichiNoDraw: 'ng', // ツモ番の無いリーチ（ok＝山に1枚以上ならできる／ng＝ツモ番があるときだけ）
    aka: 'on', // 赤ドラ（5萬・5筒・5索 各1枚）
    ippatsu: 'on', // 一発
    ura: 'on', // 裏ドラ・カン裏
    kandora: 'on', // カンドラ
    kandoraWhen: 'split', // カンドラをめくる時（split＝暗槓はすぐ・明槓は打牌のとき／now＝どのカンもすぐ）
    kuitan: 'on', // 喰いタン
    kuikae: 'ng', // 喰い替え
    shibari: '1', // 縛り
    atozuke: 'on', // 後付け
    furiten: 'on', // フリテン
    riichiAnkan: 'ok', // リーチ後の暗槓（待ちが変わらなければ）
    ankanCond: 'wait', // リーチ後の暗槓の条件
    double: 'double', // 2人同時ロン
    triple: 'ryukyoku', // 3人同時ロン
    multiWinSticks: 'first', // 2人以上がアガったときの積み棒・供託（first＝上家取り／each＝積み棒は全員・リーチ棒は本人に戻す）
    kyushu: 'on', // 九種九牌で流せる
    kyushuHow: 'choose', // 九種九牌の流し方
    sufon: 'on', // 四風連打で流局
    sukan: 'on', // 四開槓（2人以上で4回の槓）で流局
    suricchi: 'on', // 四家立直で流局
    suricchiWhen: 'pass', // 四家立直が成立する時点
    keishiki: 'on', // 形式テンパイ（役が無くてもテンパイ扱い）
    nagashi: 'on', // 流し満貫
    ippatsuChankan: 'yes', // 一発と槍槓の複合
    ippatsuKakan: 'after', // 加槓したときの一発が消える時点
    chankanDora: 'no', // 槍槓で崩れたカンのカンドラ
    tenhouAnkan: 'lost', // 天和・地和と暗槓
    kokushiAnkan: 'on', // 国士無双の暗槓ロン
    pao: '2', // 責任払い（包）
    paoMix: 'part', // 包と複合役満の払い
    paoHonba: 'pao', // 包のときの積み棒
    tenpaiHide: 'ok', // テンパイでも「ノーテン」と言える（リーチ者以外）
    kyotaku: 'top', // 終局時に残った供託
    renchan: 'tenpai', // 親の連荘（流局のとき）：tenpai＝テンパイなら連荘／agari＝アガったときだけ連荘
    honba: 'on', // 本場（積み棒・1本300点）
    abortRenchan: 'renchan', // 途中流局のあとの親：renchan＝連荘／pass＝親が流れる
    kiriage: 'on', // 切り上げ満貫（30符4翻・60符3翻）
    kazoe: 'on', // 数え役満（13翻以上）
    renpu: '2', // 連風牌（場風かつ自風）の雀頭の符
    jinho: 'none', // 人和
    doubleYakuman: 'off', // ダブル役満（四暗刻単騎・国士十三面・純正九蓮・大四喜）
    tie: 'seat', // 同点のときの順位
    yakumanMix: 'on', // 役満どうしの複合（2倍・3倍）
    tsubame: 'off', // 燕返し
    kanburi: 'off', // 槓振り
    shiiaru: 'off', // 十二落抬
    uumen: 'off', // 五門斉
    sanrenko: 'off', // 三連刻
    isshoku3: 'off', // 一色三順
    ipin: 'off', // 一筒摸月
    chupin: 'off', // 九筒撈魚
    daisharin: 'off', // 大車輪
    daichikurin: 'off', // 大竹林
    daisuurin: 'off', // 大数隣
    ishinoue: 'off', // 石の上にも三年
    surenko: 'off', // 四連刻
    parenchan: 'off', // 八連荘
    daichisei: 'off', // 大七星
  },
};
