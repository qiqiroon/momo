/**
 * 経過時間計測（第2分冊 9章）の検査。
 *
 * **時刻は注入して固定する。** 実時間に依存させると、遅い機械でだけ落ちる検査になる。
 */

import { describe, expect, it } from 'vitest';

import * as timer from './timer';

/** 手で進める時計。単調増加時刻の代わりに使う（9.3） */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('経過時間（9.2 / 9.3）', () => {
  it('動いている間だけ増え、止めている間は増えない', () => {
    const clock = fakeClock();
    const state = timer.create(0, clock.now);

    timer.start(state);
    clock.advance(5000);
    expect(timer.elapsed(state)).toBe(5000);
    expect(timer.running(state)).toBe(true);

    // 画面が見えなくなった。**停止中の時間は経過時間に含めない**
    timer.pause(state);
    clock.advance(60000);
    expect(timer.elapsed(state)).toBe(5000);
    expect(timer.running(state)).toBe(false);

    timer.resume(state);
    clock.advance(3000);
    expect(timer.elapsed(state)).toBe(8000);
  });

  it('中断からの再開は保存値を初期累積値として始める（9.4）', () => {
    const clock = fakeClock();
    const state = timer.create(120000, clock.now);
    expect(timer.elapsed(state)).toBe(120000);

    timer.start(state);
    clock.advance(1000);
    // **中断していた実時間は加算しない**
    expect(timer.elapsed(state)).toBe(121000);
  });

  it('停止したあとは再開しても増えない', () => {
    const clock = fakeClock();
    const state = timer.create(0, clock.now);

    timer.start(state);
    clock.advance(2000);
    timer.stop(state);

    timer.resume(state);
    clock.advance(10000);
    expect(timer.elapsed(state)).toBe(2000);
    expect(timer.running(state)).toBe(false);
  });

  it('二重に開始しても時間が二重に進まない', () => {
    const clock = fakeClock();
    const state = timer.create(0, clock.now);

    timer.start(state);
    clock.advance(1000);
    timer.start(state);
    clock.advance(1000);
    expect(timer.elapsed(state)).toBe(2000);
  });

  it('動いていないときの一時停止は無視される', () => {
    const clock = fakeClock();
    const state = timer.create(500, clock.now);
    timer.pause(state);
    clock.advance(1000);
    expect(timer.elapsed(state)).toBe(500);
  });

  it('既定の時刻取得でも動く（単調増加時刻を用いる）', () => {
    const state = timer.create(0);
    timer.start(state);
    expect(timer.elapsed(state)).toBeGreaterThanOrEqual(0);
    timer.stop(state);
    const fixed = timer.elapsed(state);
    expect(timer.elapsed(state)).toBe(fixed);
  });
});
