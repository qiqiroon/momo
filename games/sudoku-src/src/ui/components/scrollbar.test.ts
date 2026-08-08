/**
 * 盤面のスクロールバー（C-165）
 *
 * つまみの長さは「見えている割合」、位置は「送った割合」を表す。
 * **盤面が収まりきっているあいだは帯いっぱいで、送る余地が無い**ことまで確かめる。
 */

import { describe, expect, it } from 'vitest';
import { axisMetrics } from './BoardScrollbars';

describe('つまみの長さ（見えている割合）', () => {
  it('盤面が収まっているときは帯いっぱいになり、送る余地が無い', () => {
    const m = axisMetrics(200, 300, 50);
    expect(m.thumbLength).toBe(300);
    expect(m.scrollable).toBe(0);
    expect(m.thumbStart).toBe(0);
  });

  it('半分しか見えていないときは、つまみも帯の半分になる', () => {
    const m = axisMetrics(600, 300, 0);
    expect(m.thumbLength).toBe(150);
    expect(m.scrollable).toBe(300);
  });

  it('細くなりすぎると掴めないので、下限で止める', () => {
    // 見えているのは 1% だが、それでも 24px は残す
    const m = axisMetrics(30000, 300, 0);
    expect(m.thumbLength).toBe(24);
  });
});

describe('つまみの位置（送った割合）', () => {
  it('先頭では帯の先頭、末尾では余地いっぱいまで動く', () => {
    const head = axisMetrics(600, 300, 0);
    expect(head.thumbStart).toBe(0);

    // 末尾まで送った状態＝盤面の下端が描画領域の下端に来る
    const tail = axisMetrics(600, 300, -300);
    expect(tail.thumbStart).toBeCloseTo(300 - tail.thumbLength, 6);
  });

  it('中ほどでは、送った割合と同じ割合の位置に来る', () => {
    const m = axisMetrics(600, 300, -150);
    const room = 300 - m.thumbLength;
    expect(m.thumbStart).toBeCloseTo(room * 0.5, 6);
  });

  it('境界の外は詰める（想定外の値で帯からはみ出さない）', () => {
    expect(axisMetrics(600, 300, 100).thumbStart).toBe(0);
    const over = axisMetrics(600, 300, -9999);
    expect(over.thumbStart).toBeCloseTo(300 - over.thumbLength, 6);
  });
});

describe('描画領域がまだ測れていないとき', () => {
  it('寸法 0 では何も出さない（0 除算を作らない）', () => {
    const m = axisMetrics(600, 0, 0);
    expect(m).toEqual({ track: 0, thumbStart: 0, thumbLength: 0, scrollable: 0 });
  });
});
