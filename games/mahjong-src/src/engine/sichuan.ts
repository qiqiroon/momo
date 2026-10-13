// 四川（血戦到底）のアガリと点（段階9の手順2）。原典 MIL『Brief Introduction to Bloody Mahjong』§3・§9・§10。
//
// アガリの形：4 面子 1 雀頭（チーは無いので面子は手の中の順子・刻子と鳴いた刻子）か、七対子（ルールの qidui。同じ牌 4 枚は 2 対に数える）。
// 缺一門（ルールの queyimen）：捨てる色の牌が手にも面子にも 1 枚も無いこと。
// 番（§10）：根（同じ牌 4 枚 1 組ごとに 1・カンした 4 枚も数える）・碰碰胡 1・金钩钓 1・清一色 2・七对 2・海底 1・
//   杠上开花 1（嶺上牌でツモ＝ルールの rinshan）・杠上炮 1（カンした人の直後の打牌でロン＝gangshangpao）・抢杠 1（加槓の牌でロン＝chankan）。
// 点（§9）：基本点＝2 の番数乗（0 番 1 点・上限はルールの cap＝四川は 3 番 8 点）。
//   ロン＝放銃者が基本点を払う／ツモ＝まだアガっていない各人が（基本点＋1）を払う（ルールの pay が sichuan のとき）。
// 番の数え方が「四川の番」でないルール：香港＝hongkong.ts（段階9 香港の手順2）。国標は国標の手順で足す（いまは null＝アガれない）。

import { decompose } from './yaku';
import type { Rules } from './rules';
import type { KindId } from './tiles';
import type { HkFanId } from './hongkong';
import type { McrFanId } from './mcr';

/** 番の一覧（画面の言葉の抜けを検査で見張る） */
export const CN_FAN_IDS = ['gen', 'pengpeng', 'jingou', 'qingyise', 'qidui', 'haidi', 'gangkai', 'gangpao', 'qianggang'] as const;
export type CnFanId = (typeof CN_FAN_IDS)[number];

export interface CnScore {
  /** 付いた番（同じ番は 1 行。根は数を fan に入れる）。香港の番（hongkong.ts）も同じ形 */
  fans: { id: CnFanId | HkFanId | McrFanId; fan: number }[];
  /** 番の合計（上限で切る前） */
  fan: number;
  /** 上限で切ったか */
  capped: boolean;
  /** 基本点＝2 の（上限で切ったあとの）番数乗。香港は出銃（ロン）の点（換算表） */
  points: number;
}

/** アガリの場面（全員に見えることだけ） */
export interface CnWinContext {
  /** 手の中の牌（アガリ牌を含む・鳴いた面子は含まない）の種類ごとの枚数（長さ 34 以上） */
  concealed: readonly number[];
  /** 鳴いた面子（ポン＝3 枚・カン＝4 枚。暗槓も入れる）の種類と枚数 */
  melds: readonly { kind: KindId; size: 3 | 4 }[];
  /** 最後の 1 枚のツモ・最後の捨て牌でのロン（海底） */
  haidi: boolean;
  /** 嶺上牌でツモ（杠上开花）・カンした人の直後の打牌でロン（杠上炮）・加槓の牌でロン（抢杠） */
  gangkai?: boolean;
  gangpao?: boolean;
  qianggang?: boolean;
}

const suitOf = (k: KindId) => (k < 27 ? Math.floor(k / 9) : -1);

/** 七対子の形か（同じ牌 4 枚は 2 対に数える） */
function sevenPairs(c: readonly number[]): boolean {
  let pairs = 0;
  for (let k = 0; k < 34; k++) {
    if (c[k] % 2 !== 0) return false;
    pairs += c[k] / 2;
  }
  return pairs === 7;
}

/** 四川の番と基本点。アガリの形でなければ null（缺一門は呼ぶ側で確かめる） */
export function sichuanScore(ctx: CnWinContext, rules: Rules): CnScore | null {
  if (rules.family !== 'cn' || rules.values.scoring !== 'sichuan') return null;
  const v = rules.values;
  const c = ctx.concealed.slice(0, 34);
  const all = c.slice();
  for (const m of ctx.melds) all[m.kind] += m.size;
  // 手の中の牌と面子（カンも 3 枚に数える）で 14 枚
  if (c.reduce((a, b) => a + b, 0) + 3 * ctx.melds.length !== 14) return null;
  // 共通に付く番：根（同じ牌 4 枚）・清一色・海底
  const gen = all.filter((n) => n === 4).length;
  const suits = new Set(all.flatMap((n, k) => (n > 0 ? [suitOf(k)] : [])));
  const common: CnScore['fans'] = [];
  if (gen > 0) common.push({ id: 'gen', fan: gen });
  if (suits.size === 1 && !suits.has(-1)) common.push({ id: 'qingyise', fan: 2 });
  if (ctx.haidi) common.push({ id: 'haidi', fan: 1 });
  if (ctx.gangkai && v.rinshan === 'on') common.push({ id: 'gangkai', fan: 1 });
  if (ctx.gangpao && v.gangshangpao === 'on') common.push({ id: 'gangpao', fan: 1 });
  if (ctx.qianggang && v.chankan === 'on') common.push({ id: 'qianggang', fan: 1 });

  const candidates: CnScore['fans'][] = [];
  for (const d of decompose(c)) {
    const fans = common.slice();
    if (d.sets.every((x) => x.type === 'tri')) fans.push({ id: 'pengpeng', fan: 1 });
    // 金钩钓：4 組とも鳴いて、手の中は雀頭だけ（単騎待ちでアガった）
    if (ctx.melds.length === 4) fans.push({ id: 'jingou', fan: 1 });
    candidates.push(fans);
  }
  if (v.qidui === 'on' && ctx.melds.length === 0 && sevenPairs(c)) candidates.push([...common, { id: 'qidui', fan: 2 }]);
  if (candidates.length === 0) return null;
  const sum = (fs: CnScore['fans']) => fs.reduce((a, f) => a + f.fan, 0);
  const best = candidates.reduce((a, b) => (sum(b) > sum(a) ? b : a));
  const fan = sum(best);
  const cap = v.cap === 'none' ? Infinity : Number(v.cap);
  const used = Math.min(fan, cap);
  return { fans: best, fan, capped: used < fan, points: 2 ** used };
}
