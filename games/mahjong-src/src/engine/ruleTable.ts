// ルールセットと設定項目の表（段階6の6a）。見本 L:\momo\games\mahjong\mock\settings.html の表を、そのまま写したもの。
// ★手で直さない。見本を直したら写し直す（node scripts/gen-rule-table.cjs）。
// 正本はルール設定 v0.03（作業側 docs）。見本と文書の 792 値（72 項目×11 セット）が一致することは 2026-10-10 に突き合わせて確かめた。
/* eslint-disable */

export type Opt = readonly [key: string, label: string];
/** 設定の 1 項目（group＝見出しの行） */
export interface RuleItem {
  k?: string;
  name?: string;
  note?: string;
  opts?: readonly Opt[];
  /** セットごとの値（ORDER の順。null＝条文なし→SUPP で補う） */
  v?: readonly (string | null)[];
  /** 別の項目が [項目, 値] のときだけ選べる（3 つ目が 'not' なら、その値でないときだけ）。4 つ目は表示用の一言 */
  dep?: readonly string[];
  group?: string;
  fold?: boolean;
}

export const TIERS = [
  {"label":"日本式：<br><small>（リーチ麻雀）</small>","sets":[["general","一般ルール"],["ml","Mリーグ"],["tenhou","天鳳","net"],["saikoui","最高位戦"],["npm","日本プロ麻雀協会"],["kenko","健康麻将"],["rmu","RMU"],["jpml","日本プロ麻雀連盟"],["mu","麻将連合"],["wrc","WRC 2025","intl"],["ema","EMA 2025","intl"]]},
  {"label":"中国式：","sets":[["sichuan","四川麻将"],["mcr","国標麻将（MCR）"],["hk","香港麻雀"]]},
] as const;
export const FAMILY: Record<string, 'jp' | 'cn'> = {
  "general": "jp",
  "sichuan": "cn",
  "mcr": "cn",
  "hk": "cn",
};
export const ORDER = [
  "general",
  "ml",
  "tenhou",
  "saikoui",
  "npm",
  "kenko",
  "rmu",
  "jpml",
  "mu",
  "wrc",
  "ema",
] as const;
export const JP_ITEMS: readonly RuleItem[] = [
  {"group":"対局の形"},
  {"k":"length","name":"長さ","opts":[["east","東風"],["half","半荘"]],"v":["half","half","half","half","half","half","half","half","half","half","half"]},
  {"k":"start","name":"持ち点","opts":[["25","25000"],["30","30000"]],"v":["25","25","25","30","25","25","30","30",null,"30","30"]},
  {"k":"kaeshi","name":"返し点","opts":[["30","30000"],["none","なし（素点のまま）"]],"v":["30","30","30","30","30","none","30","30",null,"30","30"]},
  {"k":"oka","name":"オカ（トップ賞）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","off","on","off","off","off",null,"off","off"],"dep":["kaeshi","30","返し点が30000のときだけ"]},
  {"k":"uma","name":"ウマ（順位点）","opts":[["10-20","10-20"],["10-30","10-30"],["5-15","5-15"],["4-12","4-12"],["float","浮きウマ"],["none","なし"]],"v":["10-20","10-30","10-20","10-30","10-30","4-12","5-15","float","4-12","5-15","5-15"]},
  {"k":"hasu","name":"最終得点の端数（1000点未満）","opts":[["none","丸めない（小数で残す）"],["gosha","五捨六入"],["shisha","四捨五入"],["kiri","切り捨て"]],"v":["gosha","none","none",null,"none","none",null,null,null,"none","none"]},
  {"k":"tobi","name":"飛び（0点未満で終了）","opts":[["on","あり"],["off","なし"]],"v":["on","off","on",null,"off","on","off",null,null,"off","off"]},
  {"k":"west","name":"西入（返し点に届かなければ延長）","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off",null,null,"off","off","off","off"],"dep":["kaeshi","30","返し点が30000のときだけ"]},
  {"k":"zero","name":"飛びの境目","opts":[["cont","0点ちょうどは続行"],["end","0点で終了"]],"v":["cont","cont","cont","cont","cont","cont","cont","cont","cont","cont","cont"],"dep":["tobi","on","飛びありのときだけ"]},
  {"k":"westEnd","name":"西入の終わり方","opts":[["sudden","返し点を超えたら終了（最大西4局）"],["full","西4局まで打つ"]],"v":["sudden","sudden","sudden","sudden","sudden","sudden","sudden","sudden","sudden","sudden","sudden"],"dep":["west","on","西入ありのときだけ"]},
  {"k":"agariyame","name":"オーラスのアガリやめ（トップの親）","opts":[["off","なし"],["auto","自動で終了"],["choose","本人が選ぶ"]],"v":["choose","off","auto","off","off","off","off","off","off","off","off"]},
  {"k":"tenpaiyame","name":"オーラスのテンパイやめ（トップの親）","opts":[["off","なし"],["auto","自動で終了"],["choose","本人が選ぶ"]],"v":["choose","off","auto","off","off","off","off","off","off","off","off"]},
  {"k":"riichiUnder","name":"1000点未満のリーチ","opts":[["ok","できる"],["ng","できない"]],"v":["ng","ng","ng","ng","ng","ng","ng","ng","ng","ok","ng"]},
  {"k":"riichiNoDraw","name":"ツモ番の無いリーチ","opts":[["ok","できる（山に1枚以上）"],["ng","できない（ツモ番があるときだけ）"]],"v":["ng","ok","ng","ok","ok","ok","ok","ok",null,"ok","ok"]},
  {"group":"ドラ・役"},
  {"k":"aka","name":"赤ドラ（5萬・5筒・5索 各1枚）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on",null,null,null,"off","off",null,"off","off"]},
  {"k":"ippatsu","name":"一発","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","off","off","on","on"]},
  {"k":"ura","name":"裏ドラ・カン裏","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","off","off","on","on"]},
  {"k":"kandora","name":"カンドラ","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","off","off","on","on"]},
  {"k":"kandoraWhen","name":"カンドラをめくる時","opts":[["split","暗槓はすぐ・明槓は打牌のとき"],["now","どのカンもすぐ"]],"v":["split","now","split","now","now","now","now","now","now","now","now"],"dep":["kandora","on","カンドラありのときだけ"]},
  {"k":"kuitan","name":"喰いタン","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","on","on","on","on"]},
  {"k":"kuikae","name":"喰い替え","opts":[["ok","許す"],["ng","禁止"]],"v":["ng","ng","ng","ng","ng","ng","ng","ng","ok","ng","ng"]},
  {"k":"shibari","name":"縛り","opts":[["1","1翻"],["2","2翻"],["5h2","5本場から2翻"]],"v":["1","1","1","1","1","1","1","1","1","1","1"]},
  {"k":"atozuke","name":"後付け","note":"「なし」は鳴いた手の片アガリ（待ちの一部でしか役が付かない形）を禁止","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","on","on","on","on"]},
  {"k":"furiten","name":"フリテン","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","on","on","on","on"]},
  {"k":"riichiAnkan","name":"リーチ後の暗槓（待ちが変わらなければ）","opts":[["ok","できる"],["ng","できない"]],"v":["ok","ok","ok","ok","ok",null,"ok","ok","ng","ok","ok"]},
  {"k":"ankanCond","name":"リーチ後の暗槓の条件","opts":[["wait","待ちが変わらなければ（牌の形・役の増減は問わない）"],["strict","刻子としか読めない形だけ"]],"v":["wait","wait","wait","wait","wait","wait","wait","wait","wait","wait","wait"],"dep":["riichiAnkan","ok"]},
  {"group":"アガリ・流局"},
  {"k":"double","name":"2人同時ロン","opts":[["atama","頭ハネ"],["double","ダブロン"]],"v":["double","atama","double","atama","atama","atama","atama","atama","atama","atama","double"]},
  {"k":"triple","name":"3人同時ロン","opts":[["ryukyoku","流局"],["all","3人ともアガリ"],["atama","頭ハネ"]],"v":["ryukyoku","atama","ryukyoku","atama","atama","atama","atama","atama","atama","atama","all"]},
  {"k":"multiWinSticks","name":"2人以上がアガったときの積み棒・供託","opts":[["first","最初の人がまとめて取る（上家取り）"],["each","積み棒はアガった全員に・リーチ棒は本人に戻す"]],"v":["first","first","first","first","first","first","first","first","first","first","each"]},
  {"k":"kyushu","name":"九種九牌で流せる","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","off","off","off","off",null]},
  {"k":"kyushuHow","name":"九種九牌の流し方","opts":[["choose","本人が選ぶ"],["must","必ず流す"]],"v":["choose","choose","choose","choose","choose","choose","choose","choose","choose","choose","choose"],"dep":["kyushu","on"]},
  {"k":"sufon","name":"四風連打で流局","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","off","off","off","off",null]},
  {"k":"sukan","name":"四開槓（2人以上で4回の槓）で流局","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","off","off","off","off",null]},
  {"k":"suricchi","name":"四家立直で流局","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","off","off","off","off",null]},
  {"k":"suricchiWhen","name":"四家立直が成立する時点","opts":[["pass","4人目の宣言牌が通ったとき"],["declare","4人目が宣言したとき"]],"v":["pass","pass","pass","pass","pass","pass","pass","pass","pass","pass","pass"],"dep":["suricchi","on"]},
  {"k":"keishiki","name":"形式テンパイ（役が無くてもテンパイ扱い）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","on","on","on","on"]},
  {"k":"nagashi","name":"流し満貫","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","off","off","off","off","off"]},
  {"k":"ippatsuChankan","name":"一発と槍槓の複合","opts":[["yes","する"],["no","しない"]],"v":["yes","yes","yes","yes","yes","yes","yes","yes","yes","yes","yes"],"dep":["ippatsu","on"]},
  {"k":"ippatsuKakan","name":"加槓したときの一発が消える時点","opts":[["after","槍槓の確認のあと"],["at","加槓した時点"]],"v":["after","after","after","after","after","after","after","after","after","after","after"],"dep":["ippatsu","on"]},
  {"k":"chankanDora","name":"槍槓で崩れたカンのカンドラ","opts":[["no","めくらない"],["yes","めくる"]],"v":["no","no","no","no","no","no","no","no","no","no","no"]},
  {"k":"tenhouAnkan","name":"天和・地和と暗槓","opts":[["lost","暗槓すると消える"],["keep","消えない"]],"v":["lost","lost","lost","lost","lost","lost","lost","lost","lost","lost","lost"]},
  {"k":"kokushiAnkan","name":"国士無双の暗槓ロン","opts":[["on","あり"],["off","なし"]],"v":["on","off","off","off","off","off","off","off","off","off","on"]},
  {"k":"pao","name":"責任払い（包）","opts":[["none","なし"],["2","大三元・大四喜"],["3","大三元・大四喜・四槓子"]],"v":["2","3","2","none","none","2","none","3","2","3","2"]},
  {"k":"paoMix","name":"包と複合役満の払い","opts":[["part","その役満分だけ包"],["all","全額を包"]],"v":["part","part","all","part","part",null,"part",null,null,"part",null],"dep":["pao","none","not"]},
  {"k":"paoHonba","name":"包のときの積み棒","opts":[["pao","包の人"],["deal","放銃者"]],"v":["pao","pao","pao","pao","pao",null,"pao","deal",null,null,"deal"],"dep":["pao","none","not"]},
  {"k":"tenpaiHide","name":"テンパイでも「ノーテン」と言える（リーチ者以外）","opts":[["ok","できる"],["ng","できない"]],"v":["ok","ng","ng","ok","ng","ng","ng","ng","ng","ok","ok"]},
  {"k":"kyotaku","name":"終局時に残った供託","opts":[["top","トップが取る"],["none","誰にも加えない"]],"v":["top","top","top","none","none","top","none","none","none","none","top"]},
  {"k":"renchan","name":"親の連荘（流局のとき）","opts":[["tenpai","テンパイなら連荘"],["agari","アガったときだけ連荘"]],"v":["tenpai","tenpai","tenpai","tenpai","tenpai","tenpai","tenpai","tenpai","tenpai","tenpai","tenpai"]},
  {"k":"honba","name":"本場（積み棒・1本300点）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","on","on","on","off","on","on"]},
  {"k":"abortRenchan","name":"途中流局のあとの親","opts":[["renchan","連荘"],["pass","親が流れる"]],"v":["renchan","renchan","renchan","renchan","renchan","renchan","renchan","renchan","renchan","renchan","renchan"]},
  {"group":"点数"},
  {"k":"kiriage","name":"切り上げ満貫（30符4翻・60符3翻）","opts":[["on","あり"],["off","なし"]],"v":["on","on","off","on","on","on","on","off","off","on","on"]},
  {"k":"kazoe","name":"数え役満（13翻以上）","opts":[["on","あり"],["off","なし"]],"v":["on","off","on","off","off","off","on","on","off","on","off"]},
  {"k":"renpu","name":"連風牌（場風かつ自風）の雀頭の符","opts":[["2","2符"],["4","4符"]],"v":["2","2","4",null,"2","2","2","2","2","2","2"]},
  {"k":"jinho","name":"人和","note":"満貫のときは、ほかの役・ドラと足さない（ほかの役で数えたほうが高ければそちら）","opts":[["none","なし"],["mangan","満貫"],["yakuman","役満"]],"v":["none","none","none","none","none","none","none","none","none","mangan","mangan"]},
  {"k":"doubleYakuman","name":"ダブル役満（四暗刻単騎・国士十三面・純正九蓮・大四喜）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"tie","name":"同点のときの順位","opts":[["seat","起家に近い人が上"],["split","順位点を分け合う"]],"v":["seat","split","seat",null,"split","seat","split","split","split","split","split"]},
  {"k":"yakumanMix","name":"役満どうしの複合（2倍・3倍）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on","on","on","off","on","on","off","on","off"]},
  {"group":"ローカル役","fold":true},
  {"k":"tsubame","name":"燕返し","note":"1翻・ほかの人のリーチ宣言牌でロン（制限なし）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"kanburi","name":"槓振り","note":"1翻・カンした人の直後の捨て牌でロン","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"shiiaru","name":"十二落抬","note":"1翻・4つとも鳴いて裸単騎でロン（ツモは不成立・暗槓を含むと不成立）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"uumen","name":"五門斉","note":"2翻・萬・筒・索・風牌・三元牌を全部使う（七対子でも成立）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"sanrenko","name":"三連刻","note":"2翻・数が続く刻子が3つ","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"isshoku3","name":"一色三順","note":"3翻（鳴くと2翻）・同じ色・同じ数の順子が3つ（一盃口は重ねない）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"ipin","name":"一筒摸月","note":"5翻（ほかの役・ドラと足す）・海底のツモが一筒","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"chupin","name":"九筒撈魚","note":"5翻（ほかの役・ドラと足す）・河底の九筒でロン","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"daisharin","name":"大車輪","note":"役満・門前で2〜8の筒子を2枚ずつ","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"daichikurin","name":"大竹林","note":"役満・門前で2〜8の索子を2枚ずつ","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"daisuurin","name":"大数隣","note":"役満・門前で2〜8の萬子を2枚ずつ","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"ishinoue","name":"石の上にも三年","note":"役満・ダブルリーチして海底か河底でアガる","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"surenko","name":"四連刻","note":"役満・数が続く刻子が4つ","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"parenchan","name":"八連荘","note":"役満・誰でも8回続けてアガる（流局の連荘は数えない・9回目以降も・役には数えない＝縛りを満たすほかの役があるときだけ役満）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"]},
  {"k":"daichisei","name":"大七星","note":"ダブル役満・字牌7種の七対子（字一色とは足さない）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off","off","off","off","off","off","off","off","off"],"dep":["doubleYakuman","on"]},
];
/** 条文なしを MOMO が補った値（2026-10-05 決定：書いていない仕組みは「なし」と読む） */
export const SUPP: Record<string, Record<string, string>> = {
  "saikoui": {"tobi":"off","aka":"off","renpu":"2","tie":"split","hasu":"none"},
  "npm": {"aka":"off"},
  "kenko": {"west":"off","aka":"off","riichiAnkan":"ng","paoMix":"part","paoHonba":"pao"},
  "rmu": {"west":"off","hasu":"none"},
  "jpml": {"tobi":"off","paoMix":"part","hasu":"none"},
  "mu": {"kaeshi":"30","riichiNoDraw":"ok","start":"30","oka":"off","tobi":"off","aka":"off","paoMix":"part","paoHonba":"pao","hasu":"none"},
  "ema": {"kyushu":"off","sufon":"off","sukan":"off","suricchi":"off","paoMix":"part"},
  "wrc": {"paoHonba":"pao"},
};
export const JP_FIXED = "<b>変えられない決まり（日本式で共通）</b>：4人・136枚（カンは1局4回まで）／鳴きの優先（ロン＞ポン・カン＞チー）／符の計算（七対子25符・平和ツモ20符など）／通常役と役満の顔ぶれ";
export const ORDER_CN = [
  "sichuan",
  "mcr",
  "hk",
] as const;
export const CN_ITEMS: readonly RuleItem[] = [
  {"group":"対局の形"},
  {"k":"length","name":"長さ","opts":[["1","1圏"],["4","4圏"]],"v":[null,"4","4"]},
  {"k":"start","name":"持ち点","opts":[["0","0点から"],["500","500点"]],"v":[null,"500",null]},
  {"k":"rank","name":"順位の付け方","opts":[["points","点の多い順"],["mcr","国標の標準分"]],"v":[null,"mcr",null]},
  {"k":"tieCn","name":"同点のときの順位","opts":[["mcrSeat","国標の決め方→決まらなければ起家に近い人"],["seat","起家に近い人が上"],["same","同じ順位"]],"v":[null,"mcrSeat",null]},
  {"k":"dealer","name":"親の決め方","opts":[["firstWin","最初にアガった人が次の親"],["rotate","連荘なし（順に回る）"],["renchan","親がアガれば連荘"]],"v":["firstWin","rotate","renchan"]},
  {"k":"tobi","name":"飛び（0点未満で終了）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off"]},
  {"k":"tochu","name":"途中流局（九種九牌など）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off"]},
  {"group":"牌"},
  {"k":"honors","name":"字牌（東南西北白發中）","opts":[["on","あり"],["off","なし"]],"v":["off","on","on"]},
  {"k":"flower","name":"花牌（春夏秋冬梅蘭菊竹）","opts":[["on","あり"],["off","なし"]],"v":["off","on","off"]},
  {"k":"flowerRefill","name":"花牌を引いたときの補充","opts":[["back","牌山の最後から"],["front","牌山の前から"]],"v":["back","back","back"],"dep":["flower","on"]},
  {"group":"鳴き・アガリ"},
  {"k":"chi","name":"チー","opts":[["on","あり"],["off","なし"]],"v":["off","on","on"]},
  {"k":"lastTile","name":"最後の1枚での鳴き・槓","opts":[["ok","できる"],["ng","禁止"]],"v":["ok","ng","ok"]},
  {"k":"queyimen","name":"1色を捨てきらないとアガれない（缺一門）","opts":[["on","あり"],["off","なし"]],"v":["on","off","off"]},
  {"k":"minFan","name":"アガリに必要な最低の番","opts":[["0","なし"],["3","3番"],["8","8番"]],"v":["0","8","3"]},
  {"k":"qidui","name":"七対子","opts":[["on","あり"],["off","なし"]],"v":["on","on","off"]},
  {"k":"haitei","name":"最後の1枚でのアガリ（海底）","opts":[["both","ツモ・ロンとも"],["tsumo","ツモのみ"]],"v":["both","both","tsumo"]},
  {"k":"tenhou","name":"天和・地和","opts":[["on","あり"],["off","なし"]],"v":["off","off","on"]},
  {"k":"multiWin","name":"同じ捨て牌で2人以上がアガれるとき","opts":[["all","全員アガれる"],["atama","頭ハネ（1人だけ）"]],"v":["all","atama","all"]},
  {"k":"afterWin","name":"アガった後","opts":[["end","局を終える"],["leave","抜けて続く（血戦到底）"],["again","何度でもアガれる（血流成河）"]],"v":["leave","end","end"]},
  {"k":"ron","name":"ロン","opts":[["ok","あり"],["tsumo","ツモだけ"]],"v":["ok","ok","ok"]},
  {"k":"rinshan","name":"嶺上（槓のあとの補充でアガる）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on"]},
  {"k":"chankan","name":"槍槓（加槓の牌でロン）","opts":[["on","あり"],["off","なし"]],"v":["on","on","on"]},
  {"k":"kokushi13","name":"十三么（国士無双）の暗槓ロン","opts":[["on","あり"],["off","なし"]],"v":["off","off","on"],"dep":["honors","on"]},
  {"k":"miss","name":"見逃したあとのロンの縛り","opts":[["none","なし"],["nextDraw","次に自分が引くまでロンできない"],["sameTile","同じ巡目は同じ牌でロンできない"]],"v":["nextDraw","none","sameTile"]},
  {"k":"multiDealer","name":"同時アガリのときの次の親","opts":[["dealIn","放銃者が次の親"],["dealerWin","親が含まれれば連荘"]],"v":["dealIn","dealIn",null],"dep":["multiWin","all"]},
  {"k":"huan3","name":"開局時の3枚交換（換三張）","opts":[["on","あり"],["off","なし"]],"v":["off","off","off"],"note":"どの条文にも無い＝MOMO の設定"},
  {"group":"点数"},
  {"k":"scoring","name":"点数の数え方","opts":[["mcr","国標（81種の番・足し算）"],["sichuan","四川の番（倍々）"],["hk","香港の番（倍々）"]],"v":["sichuan","mcr","hk"]},
  {"k":"cap","name":"点数の上限","opts":[["3","3番"],["10","10番"],["none","なし"]],"v":["3","none","10"]},
  {"k":"pay","name":"点の払い方","opts":[["sichuan","四川式"],["mcr","国標式（底分8を全員）"],["hk","香港式（ツモは半額×3人）"]],"v":["sichuan","mcr","hk"]},
  {"k":"kanPay","name":"カンのその場精算（刮風下雨）","opts":[["on","あり"],["off","なし"]],"v":["on","off","off"]},
  {"k":"chajiao","name":"流局時、テンパイしていない人が払う（查叫）","opts":[["on","あり"],["off","なし"]],"v":["on","off","off"]},
  {"k":"huazhu","name":"流局時、3色とも残した人の罰（花豬）","opts":[["on","あり"],["off","なし"]],"v":["on","off","off"],"dep":["queyimen","on"]},
  {"k":"gangshangpao","name":"杠上炮（槓の直後の捨て牌でロン＝1番）","opts":[["on","あり"],["off","なし"]],"v":["on","off","off"],"dep":["scoring","sichuan"]},
  {"k":"chajiaoPts","name":"查叫で払う「理論上の最大点」","opts":[["ron","待ちで一番高いロンの点（上限8点）"],["tsumo","待ちで一番高いツモの点（上限8点）"]],"v":[null,"ron","ron"],"dep":["chajiao","on"]},
  {"k":"baopai","name":"責任払い（十二章包・大三元包）","opts":[["on","あり"],["off","なし"]],"v":["off","off","on"]},
];
export const SUPP_CN: Record<string, Record<string, string>> = {
  "sichuan": {"length":"4","start":"0","rank":"points","tieCn":"mcrSeat","chajiaoPts":"ron"},
  "hk": {"start":"0","rank":"points","tieCn":"mcrSeat","multiDealer":"dealIn"},
};
export const CN_FIXED = "<b>中国式に無いもの</b>：赤5・リーチ・ドラ（日本式だけの仕組み）／誤ったアガリ・反則の罰（ゲームが受け付けないので起きない）";
