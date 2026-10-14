// ルールブックの役の例（日本式）が、ルール部分の役の判定で本当にその役・その翻になるか。
// 例の手が間違っていれば赤になる（説明と絵だけの一覧にしない）。
import { GENERAL_RULES, type Rules } from '../engine/rules';
import { judgeAll, type YakuId } from '../engine/yaku';
import { yakuIdsForList } from './jpYakuIds';
import { contextOf, shownGroups } from './example';
import { JP_YAKU, isLocalYaku, membersOf, type JpYakuEntry } from './jpYaku';
import { parseKinds } from './notation';

/** その役が付くルール（ローカル役は「あり」・ダブル役満の役はダブル役満「あり」・人和は役満） */
function rulesFor(e: JpYakuEntry): Rules {
  if (GENERAL_RULES.family !== 'jp') throw new Error('一般ルールは日本式');
  const v: Record<string, string> = { ...GENERAL_RULES.values };
  for (const id of membersOf(e)) if (isLocalYaku(id)) v[id] = 'on';
  if (e.yakuman === 2) v.doubleYakuman = 'on';
  if (e.id === 'jinho') v.jinho = 'yakuman';
  return { family: 'jp', values: v as typeof GENERAL_RULES.values };
}

describe('役の一覧の例（日本式）', () => {
  // 八連荘は役の判定に無い（点数の側で、縛りを満たす役があるときだけ役満にする）。例はほかの役が付く手であることだけ確かめる
  it('parenchan：例の手にほかの役が付く', () => {
    const e = JP_YAKU.find((x) => x.id === 'parenchan')!;
    expect(judgeAll(contextOf(e.ex, rulesFor(e))).some((r) => r.han > 0)).toBe(true);
  });

  for (const e of JP_YAKU.filter((x) => x.id !== 'parenchan')) {
    it(`${e.id}：例の手にその役が付き、翻（役満）が一覧と同じ`, () => {
      const ctx = contextOf(e.ex, rulesFor(e));
      const open = ctx.melds.some((m) => m.open);
      const hits = judgeAll(ctx).flatMap((r) => r.yaku).filter((y) => y.id === e.id);
      expect(hits.length).toBeGreaterThan(0);
      if (e.yakuman) expect(hits.some((y) => y.yakuman === e.yakuman)).toBe(true);
      else expect(hits.some((y) => y.han === (open ? (e.openHan ?? e.han) : e.han))).toBe(true);
    });
  }

  it('どの例も 14 枚（カンは 1 枚多く数える）・アガリ牌が手の中にある', () => {
    for (const e of JP_YAKU) {
      const hand = e.ex.hand.flatMap(parseKinds);
      const kans = (e.ex.melds ?? []).filter((m) => m.startsWith('kan:') || m.startsWith('ankan:')).length;
      const tiles = hand.length + (e.ex.melds ?? []).reduce((a, m) => a + parseKinds(m.split(':')[1]).length, 0);
      expect({ id: e.id, n: tiles - kans }).toEqual({ id: e.id, n: 14 });
      expect(hand).toContain(parseKinds(e.ex.win)[0]);
      expect(shownGroups(e.ex).flatMap((g) => g.tiles).filter((x) => x.win)).toHaveLength(1);
    }
  });

  it('役の判定にある役は全部一覧にある（八連荘も載せる）', () => {
    const listed = new Set<YakuId>(JP_YAKU.flatMap(membersOf));
    expect(JP_YAKU.flatMap(membersOf)).toHaveLength(listed.size); // 2 回載せていない
    expect(yakuIdsForList().filter((id) => !listed.has(id))).toEqual([]);
  });
});
