// ルールブックの番の例（国標）が、ルール部分の番の数え方で本当にその番・その点数になるか。
import { MCR_FAN_IDS, MCR_FANS, mcrScore } from '../engine/mcr';
import { mcrContextOf, shownGroups } from './example';
import { MCR_FAN_LIST, mcrMembersOf } from './mcrFan';
import { parseKinds } from './notation';

const PTS = new Map<string, number>(MCR_FANS.map(([id, p]) => [id, p]));

describe('番の一覧の例（国標）', () => {
  for (const e of MCR_FAN_LIST) {
    it(`${e.id}：例の手にその番が付き、点数が一覧と同じ`, () => {
      const ctx = mcrContextOf(e.ex);
      const s = mcrScore(ctx);
      const hit = s?.fans.find((x) => x.id === e.id);
      expect(hit, JSON.stringify(s?.fans)).toBeDefined();
      expect(hit!.fan).toBe(e.each ? e.fan * ctx.flowers : e.fan);
    });
  }

  it('一覧の点数はルール部分の表と同じ（まとめた仲間も同じ点数）', () => {
    for (const e of MCR_FAN_LIST) for (const id of mcrMembersOf(e)) expect({ id, p: PTS.get(id) }).toEqual({ id, p: e.fan });
  });

  it('国標の番は全部一覧にある（2 回載せていない）・点の高い順に並ぶ', () => {
    const ids = MCR_FAN_LIST.flatMap(mcrMembersOf);
    expect([...ids].sort()).toEqual([...MCR_FAN_IDS].sort());
    const fans = MCR_FAN_LIST.map((e) => e.fan);
    expect(fans).toEqual([...fans].sort((a, b) => b - a));
  });

  it('どの例も 14 枚（カンは 1 枚多く数える・花牌は別）・アガリ牌の印が 1 つ', () => {
    for (const e of MCR_FAN_LIST) {
      const hand = e.ex.hand.flatMap(parseKinds);
      const melds = e.ex.melds ?? [];
      const kans = melds.filter((m) => m.startsWith('kan:') || m.startsWith('ankan:')).length;
      const n = hand.length + melds.reduce((a, m) => a + parseKinds(m.split(':')[1]).length, 0) - kans;
      expect({ id: e.id, n }).toEqual({ id: e.id, n: 14 });
      expect(hand).toContain(parseKinds(e.ex.win)[0]);
      expect(shownGroups(e.ex).flatMap((g) => g.tiles).filter((x) => x.win)).toHaveLength(1);
    }
  });
});
