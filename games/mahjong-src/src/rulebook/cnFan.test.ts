// ルールブックの番の例（四川・香港）が、ルール部分の番の数え方で本当にその番・その番数になるか。
import { HK_FAN_IDS, hongkongScore } from '../engine/hongkong';
import { rulesOfCnSet } from '../engine/ruleSets';
import { CN_FAN_IDS, sichuanScore } from '../engine/sichuan';
import { cnMembersOf, HK_FANS, SICHUAN_FANS } from './cnFan';
import { hkContextOf, shownGroups, sichuanContextOf } from './example';
import { parseKinds } from './notation';

const sichuan = rulesOfCnSet('sichuan');
const hk = rulesOfCnSet('hk');

describe('番の一覧の例（四川）', () => {
  for (const e of SICHUAN_FANS) {
    it(`${e.id}：例の手にその番が付き、番数が一覧と同じ`, () => {
      const s = sichuanScore(sichuanContextOf(e.ex), sichuan);
      expect(s?.fans.find((f) => f.id === e.id)?.fan).toBe(e.fan);
    });
  }
  it('例は 2 色だけ（缺一門）・字牌なし', () => {
    for (const e of SICHUAN_FANS) {
      const kinds = [...e.ex.hand, ...(e.ex.melds ?? []).map((m) => m.split(':')[1])].flatMap(parseKinds);
      expect(new Set(kinds.map((k) => Math.floor(k / 9))).size).toBeLessThanOrEqual(2);
      expect(kinds.every((k) => k < 27)).toBe(true);
    }
  });
});

describe('番の一覧の例（香港）', () => {
  for (const e of HK_FANS) {
    it(`${e.id}：例の手にその番が付き、番数が一覧と同じ`, () => {
      const s = hongkongScore(hkContextOf(e.ex), hk);
      expect(s?.fans.find((f) => f.id === e.id)?.fan).toBe(e.fan);
      if (e.limit) expect(s?.limit).toBe(true);
    });
  }
});

describe('番の一覧の抜けと形', () => {
  it('四川・香港の番は全部一覧にある（2 回載せていない）', () => {
    const sc = SICHUAN_FANS.flatMap(cnMembersOf);
    const hkIds = HK_FANS.flatMap(cnMembersOf);
    expect([...sc].sort()).toEqual([...CN_FAN_IDS].sort());
    expect([...hkIds].sort()).toEqual([...HK_FAN_IDS].sort());
  });
  it('どの例も 14 枚（カンは 1 枚多く数える）・アガリ牌の印が 1 つ', () => {
    for (const e of [...SICHUAN_FANS, ...HK_FANS]) {
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
