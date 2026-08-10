/**
 * 器の高さの実測の検査（C-207）
 *
 * **携帯の横画面で起きたことは、この環境では再現できない。** 確かめられるのは
 * 「2つの数字を渡したとき、こちらがどちらを採るか」という決め方のほうである。
 * 決め方さえ間違っていなければ、実機がどちらの数字を返してきても外さない。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_HEIGHT_VAR,
  adoptHeight,
  applyAppHeight,
  forgetSmallest,
  measureAppHeight,
  observeAppHeight,
} from './appHeight';

/** 高さを答えるだけの偽の窓。実際の `window` は寸法を差し替えられない */
function fakeWindow(options: {
  client?: number;
  innerHeight?: number;
  visual?: { height: number; scale: number } | null;
}): Window {
  const listeners = new Map<string, Set<EventListener>>();
  const style = document.createElement('div').style;
  const visual =
    options.visual === undefined || options.visual === null
      ? null
      : {
          height: options.visual.height,
          scale: options.visual.scale,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        };

  return {
    innerHeight: options.innerHeight ?? 0,
    visualViewport: visual,
    document: { documentElement: { clientHeight: options.client ?? 0, style } },
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn);
    },
    /** 検査から合図を送るための入口 */
    __fire: (type: string) => {
      for (const fn of listeners.get(type) ?? []) fn(new Event(type));
    },
  } as unknown as Window;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('画面の高さの見立て', () => {
  it('器と見えている高さが食い違うときは、小さいほうを採る', () => {
    // 携帯の横画面で起きていた形。器のほうが大きい＝見えていない下側まで含んでいる
    const win = fakeWindow({ client: 430, visual: { height: 330, scale: 1 } });
    expect(measureAppHeight(win)).toBe(330);
  });

  it('見えている高さのほうが大きくても、小さいほうを採る', () => {
    // ホームバーの帯を含んで大きく答える環境。**採るのはやはり小さいほう**
    const win = fakeWindow({ client: 320, visual: { height: 360, scale: 1 } });
    expect(measureAppHeight(win)).toBe(320);
  });

  it('ページが拡大されているときは、見えているぶんだけの高さを採る', () => {
    // 2倍に拡大されていれば、目に入っているのは半分だけ。**器もその半分に合わせる。**
    // v0.09 までは倍率で 800 へ戻していたが、**携帯を横にしたときにブラウザが自分で
    // 拡大する場合まで打ち消してしまい、「表示したあと拡大して下がはみ出す」**形になった。
    // 拡大の理由（ブラウザの都合か、指で広げたのか）は見分けない
    const win = fakeWindow({ client: 800, visual: { height: 400, scale: 2 } });
    expect(measureAppHeight(win)).toBe(400);
  });

  it('どちらも答えない環境では窓の高さへ落とす', () => {
    const win = fakeWindow({ client: 0, visual: null, innerHeight: 667 });
    expect(measureAppHeight(win)).toBe(667);
  });

  it('飾りが全部出ているときの高さがいちばん小さければ、それを採る', () => {
    // 実機の横画面で起きていた形。器も見えている高さも、帯が引っ込むと 393 と答えるが、
    // **帯が出ているときは 334 しかない。** そこへ倒さないと、帯が戻った瞬間に下が隠れる
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect(this: Element): DOMRect {
      const height = this.id === 'momo-sudoku-viewport-probe' ? 334 : 0;
      return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0 } as DOMRect;
    };
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 393,
      configurable: true,
    });

    try {
      expect(measureAppHeight(window)).toBe(334);
    } finally {
      Element.prototype.getBoundingClientRect = original;
      document.getElementById('momo-sudoku-viewport-probe')?.remove();
    }
  });

  it('何も測れなければ 0 を返し、書き込まない', () => {
    const win = fakeWindow({ client: 0, visual: null, innerHeight: 0 });
    expect(applyAppHeight(win)).toBe(0);
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('');
  });
});

describe('いちばん狭かった高さを覚える（C-214）', () => {
  beforeEach(() => {
    forgetSmallest();
  });

  it('一度でも狭いと答えたら、あとで広いと言われても狭いほうを使う', () => {
    // 実機で起きた順序そのもの。帯が乗っているあいだは 334、
    // その 0.3 秒後に 393 と言い直され、以後 334 には戻らなかった
    expect(adoptHeight(734, 334, true, false)).toBe(334);
    expect(adoptHeight(734, 393, true, false)).toBe(334);
  });

  it('先に広いと答えても、あとで狭いと分かればそちらへ下げる', () => {
    expect(adoptHeight(734, 393, true, false)).toBe(393);
    expect(adoptHeight(734, 334, true, false)).toBe(334);
    expect(adoptHeight(734, 393, true, false)).toBe(334);
  });

  it('向きが変われば覚え直す', () => {
    adoptHeight(734, 334, true, false);
    // 縦向き（幅が変わる）。**横で狭かったことを持ち込まない**
    expect(adoptHeight(393, 793, true, false)).toBe(793);
    // 横へ戻ったら、その向きとして測り直す
    expect(adoptHeight(734, 393, true, false)).toBe(393);
  });

  it('指で広げているあいだの狭さは覚えない', () => {
    adoptHeight(734, 393, true, false);
    // 拡大中は見えている範囲が狭くなる。**そのまま使うが、その向きの答えとしては握らない**
    expect(adoptHeight(734, 200, true, true)).toBe(200);
    expect(adoptHeight(734, 393, true, false)).toBe(393);
  });

  it('マウスの端末では覚えない（窓を広げたら広がる）', () => {
    expect(adoptHeight(1280, 400, false, false)).toBe(400);
    expect(adoptHeight(1280, 800, false, false)).toBe(800);
  });
});

describe('測り続けるしかけ', () => {
  it('採った高さを CSS 変数へ書き込む', () => {
    const win = fakeWindow({ client: 430, visual: { height: 330, scale: 1 } });
    applyAppHeight(win);
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('330px');
  });

  it('向きが変わったあと、少し置いて測り直す', () => {
    vi.useFakeTimers();
    const win = fakeWindow({ client: 800, visual: { height: 800, scale: 1 } });
    const stop = observeAppHeight(win);
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('800px');

    // **合図が来た瞬間はまだ古い値のまま**、という端末がある。
    // ここでは合図のあとで寸法が変わる状況をそのまま作る
    (win as unknown as { __fire(type: string): void }).__fire('orientationchange');
    (win.document.documentElement as unknown as { clientHeight: number }).clientHeight = 380;
    (win.visualViewport as unknown as { height: number }).height = 380;
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('800px');

    vi.advanceTimersByTime(500);
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('380px');
    stop();
  });

  it('後片付けをすると、以後の合図では測らない', () => {
    const win = fakeWindow({ client: 800, visual: { height: 800, scale: 1 } });
    const stop = observeAppHeight(win);
    stop();

    (win.document.documentElement as unknown as { clientHeight: number }).clientHeight = 380;
    (win as unknown as { __fire(type: string): void }).__fire('resize');
    expect(win.document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR)).toBe('800px');
  });
});
