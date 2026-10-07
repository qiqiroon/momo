import { createRng, shuffle } from './rng';

describe('種から決まる乱数', () => {
  it('同じ種なら同じ並び', () => {
    const a = createRng('abc'), b = createRng('abc');
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });

  it('違う種なら違う並び', () => {
    const a = createRng('abc'), b = createRng('abd');
    const xs = Array.from({ length: 10 }, () => a());
    const ys = Array.from({ length: 10 }, () => b());
    expect(xs).not.toEqual(ys);
  });

  it('値は 0 以上 1 未満', () => {
    const r = createRng('range');
    for (let i = 0; i < 10000; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('似た種の「最初の1個」が偏らない（種 0〜3999 の最初の値を 10 区間に分けて数える）', () => {
    const bins = new Array(10).fill(0);
    const n = 4000;
    for (let i = 0; i < n; i++) bins[Math.floor(createRng(String(i))() * 10)]++;
    // 期待 400。かなり緩い幅（±25%）で、捨て忘れのような大きな偏りだけを捕まえる
    for (const c of bins) {
      expect(c).toBeGreaterThan(300);
      expect(c).toBeLessThan(500);
    }
  });

  it('混ぜても中身は同じで、元の配列は変わらない', () => {
    const items = Array.from({ length: 136 }, (_, i) => i);
    const mixed = shuffle(items, createRng('s'));
    expect(items).toEqual(Array.from({ length: 136 }, (_, i) => i));
    expect(mixed.slice().sort((x, y) => x - y)).toEqual(items);
    expect(mixed).not.toEqual(items);
  });
});
