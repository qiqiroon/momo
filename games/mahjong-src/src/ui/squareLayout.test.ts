import { HAND_ROW, RIVER_BASE, handRowUnits, handTileWidth, riverRows, riverTileWidth } from './squareLayout';

describe('正方形の卓の大きさ', () => {
  it('ふだん（鳴きなし）は基本の大きさのまま＝自分 5.4・ほか 4.1・河 4.1', () => {
    const me = handTileWidth(handRowUnits(14, true), HAND_ROW.me);
    const other = handTileWidth(handRowUnits(13, false), HAND_ROW.other);
    expect(me).toBe(5.4);
    expect(other).toBe(4.1);
    expect(riverTileWidth([me, other, other, other])).toBe(RIVER_BASE);
  });

  it('列が長くなると列ごと縮み、河は手牌の列より大きくならない', () => {
    const long = handTileWidth(30, HAND_ROW.other);
    expect(long).toBeCloseTo(77 / 30);
    expect(riverTileWidth([5.4, long, 4.1, 4.1])).toBe(long);
  });

  it('河は 9 枚・9 枚・残り全部の 3 行', () => {
    const t = Array.from({ length: 29 }, (_, i) => i);
    expect(riverRows(t).map((r) => r.length)).toEqual([9, 9, 11]);
    expect(riverRows(t.slice(0, 10)).map((r) => r.length)).toEqual([9, 1]);
    expect(riverRows([])).toEqual([]);
  });
});
