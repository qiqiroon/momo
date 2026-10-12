// 四川（血戦到底）のアガリと点（段階9の手順2）。原典 MIL『Brief Introduction to Bloody Mahjong』§3・§9・§10。
//
// アガリの形：4 面子 1 雀頭（チーは無いので面子は手の中の順子・刻子と鳴いた刻子）か、七対子（ルールの qidui。同じ牌 4 枚は 2 対に数える）。
// 缺一門（ルールの queyimen）：捨てる色の牌が手にも面子にも 1 枚も無いこと。
// 番（§10。手順2 で数えるもの）：根（同じ牌 4 枚 1 組ごとに 1）・碰碰胡 1・金钩钓 1・清一色 2・七对 2・海底 1。
//   杠上开花・杠上炮・抢杠（各 1）はカンが入る手順4 で足す。
// 点（§9）：基本点＝2 の番数乗（0 番 1 点・上限はルールの cap＝四川は 3 番 8 点）。
//   ロン＝放銃者が基本点を払う／ツモ＝まだアガっていない各人が（基本点＋1）を払う（ルールの pay が sichuan のとき）。
// 番の数え方が「四川の番」でないルール（国標・香港）は、それぞれの手順で足す（いまは null＝アガれない）。

import { decompose } from './yaku';
import type { Rules } from './rules';
import type { KindId } from './tiles';

export type CnFanId = 'gen' | 'pengpeng' | 'jingou' | 'qingyise' | 'qidui' | 'haidi';

export interface CnScore {
  /** 付いた番（同じ番は 1 行。根は数を fan に入れる） */
  fans: { id: CnFanId; fan: number }[];
  /** 番の合計（上限で切る前） */
  fan: number;
  /** 上限で切ったか */
  capped: boolean;
  /** 基本点＝2 の（上限で切ったあとの）番数乗 */
  points: number;
}

/** アガリの場面（全員に見えることだけ） */
export interface CnWinContext {
  /** 手の中の牌（アガリ牌を含む・鳴いた面子は含まない）の種類ごとの枚数（長さ 34 以上） */
  concealed: readonly number[];
  /** 鳴いた刻子の種類（ポン。カンは手順4） */
  pons: readonly KindId[];
  /** 最後の 1 枚のツモ・最後の捨て牌でのロン（海底） */
  haidi: boolean;
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
  for (const k of ctx.pons) all[k] += 3;
  const total = all.reduce((a, b) => a + b, 0);
  if (total !== 14) return null;
  // 共通に付く番：根（同じ牌 4 枚）・清一色・海底
  const gen = all.filter((n) => n === 4).length;
  const suits = new Set(all.flatMap((n, k) => (n > 0 ? [suitOf(k)] : [])));
  const common: CnScore['fans'] = [];
  if (gen > 0) common.push({ id: 'gen', fan: gen });
  if (suits.size === 1 && !suits.has(-1)) common.push({ id: 'qingyise', fan: 2 });
  if (ctx.haidi) common.push({ id: 'haidi', fan: 1 });

  const candidates: CnScore['fans'][] = [];
  for (const d of decompose(c)) {
    const fans = common.slice();
    if (d.sets.every((x) => x.type === 'tri')) fans.push({ id: 'pengpeng', fan: 1 });
    // 金钩钓：4 組とも鳴いて、手の中は雀頭だけ（単騎待ちでアガった）
    if (ctx.pons.length === 4) fans.push({ id: 'jingou', fan: 1 });
    candidates.push(fans);
  }
  if (v.qidui === 'on' && ctx.pons.length === 0 && sevenPairs(c)) candidates.push([...common, { id: 'qidui', fan: 2 }]);
  if (candidates.length === 0) return null;
  const sum = (fs: CnScore['fans']) => fs.reduce((a, f) => a + f.fan, 0);
  const best = candidates.reduce((a, b) => (sum(b) > sum(a) ? b : a));
  const fan = sum(best);
  const cap = v.cap === 'none' ? Infinity : Number(v.cap);
  const used = Math.min(fan, cap);
  return { fans: best, fan, capped: used < fan, points: 2 ** used };
}
