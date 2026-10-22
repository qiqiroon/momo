// アシストの欄：つぶれる役の決め方（設計 アシストモード v0.01 §4.3）
import type { YakuPlan } from '../assist/yakuPlan';
import { crushedBy } from './Assist';

const plan = (key: string, spare: number[], partial = false): YakuPlan => ({ ids: [key as YakuPlan['ids'][number]], key, need: 2, points: 1000, fan: 0, tiles: [], furiten: false, spare: new Set(spare), partial });

describe('切るとつぶれる役', () => {
  const list = [plan('chun', [0, 4]), plan('tanyao', [33, 0]), plan('honitsu', [], true)];
  it('切る牌がその役の余っている牌に無ければつぶれる。数えきれていない段の役は出さない', () => {
    // 中（33）の背番号 132
    expect([...crushedBy(list, 14, 132)]).toEqual(['chun']);
    // 1萬（0）はどちらにも余っている
    expect([...crushedBy(list, 14, 0)]).toEqual([]);
  });
  it('切る番でない（13 枚）・牌に合わせていない・一覧が無いときは出さない', () => {
    expect(crushedBy(list, 13, 132).size).toBe(0);
    expect(crushedBy(list, 14, null).size).toBe(0);
    expect(crushedBy(null, 14, 132).size).toBe(0);
  });
});
