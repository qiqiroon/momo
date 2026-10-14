// 役の判定（yaku.ts）にある役の id を全部並べたもの。ルールブックの一覧に抜けが無いかの検査で使う。
// 型 YakuId に役を足してここに足し忘れると、下の確かめが型の検査で赤になる。

import type { YakuId } from '../engine/yaku';

const IDS = [
  'riichi', 'doubleRiichi', 'ippatsu', 'menzenTsumo', 'tanyao', 'pinfu', 'iipeikou',
  'haku', 'hatsu', 'chun', 'roundWind', 'seatWind',
  'rinshan', 'chankan', 'haitei', 'houtei',
  'chiitoitsu', 'sanshoku', 'ittsu', 'chanta', 'toitoi', 'sanankou', 'sanshokuDoukou', 'sankantsu',
  'shousangen', 'honroutou',
  'ryanpeikou', 'honitsu', 'junchan',
  'chinitsu',
  'tenhou', 'chiihou', 'kokushi', 'suuankou', 'daisangen', 'tsuuiisou', 'ryuuiisou', 'chinroutou',
  'shousuushii', 'daisuushii', 'suukantsu', 'chuuren',
  'jinho',
  'tsubame', 'kanburi', 'shiiaru', 'uumen', 'sanrenko', 'isshoku3', 'ipin', 'chupin',
  'daisharin', 'daichikurin', 'daisuurin', 'ishinoue', 'surenko', 'parenchan', 'daichisei',
] as const satisfies readonly YakuId[];

/** 型の YakuId のうち、上の一覧に無いもの（無ければ never） */
type Missing = Exclude<YakuId, (typeof IDS)[number]>;
const allListed: [Missing] extends [never] ? true : false = true;
void allListed;

/** 一覧に載せる役（八連荘は役でなく点数の側で足すが、一覧には載せる） */
export function yakuIdsForList(): YakuId[] {
  return [...IDS];
}
