/**
 * 画面を寝かせないの検査（C-209）
 *
 * **本当に画面が点いたままかは実機でしか分からない。** ここで確かめるのは
 * 「いつ頼み、いつ外し、断られたときにどう振る舞うか」という段取りのほうである。
 *
 * 段取りのうち**外し忘れが最も害が大きい**（遊び終えても画面が点きっぱなしになる）ので、
 * 後片付けは頼んでいる途中で捨てられた場合まで見る。
 */

import { describe, expect, it, vi } from 'vitest';
import { keepAwake } from './wakeLock';

interface FakeLock {
  released: boolean;
  release(): Promise<void>;
}

/** 頼まれた回数と、掛かっている申請を数える偽の端末 */
function fakeWindow(options: { visible?: boolean; deny?: boolean; delayMs?: number } = {}) {
  const listeners = new Set<EventListener>();
  const locks: FakeLock[] = [];
  let requests = 0;

  const doc = {
    visibilityState: options.visible === false ? 'hidden' : 'visible',
    addEventListener: (_type: string, fn: EventListener) => listeners.add(fn),
    removeEventListener: (_type: string, fn: EventListener) => listeners.delete(fn),
  };

  const win = {
    document: doc,
    navigator: {
      wakeLock: {
        request: async (): Promise<FakeLock> => {
          requests++;
          if (options.deny === true) throw new Error('断られた');
          if (options.delayMs !== undefined) {
            await new Promise((resolve) => setTimeout(resolve, options.delayMs));
          }
          const lock: FakeLock = {
            released: false,
            release: async () => {
              lock.released = true;
            },
          };
          locks.push(lock);
          return lock;
        },
      },
    },
  };

  return {
    win: win as unknown as Window,
    locks,
    get requests() {
      return requests;
    },
    setVisible(visible: boolean) {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      for (const fn of listeners) fn(new Event('visibilitychange'));
    },
    get watching() {
      return listeners.size;
    },
  };
}

/** 頼みは非同期なので、たまっている仕事を吐き出させる */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('画面を寝かせない', () => {
  it('始めた時点で頼み、やめる時点で外す', async () => {
    const env = fakeWindow();
    const stop = keepAwake(env.win);
    await settle();

    expect(env.requests).toBe(1);
    expect(env.locks[0].released).toBe(false);

    stop();
    await settle();
    expect(env.locks[0].released).toBe(true);
    // 見張りも残さない
    expect(env.watching).toBe(0);
  });

  it('画面が表に出ていないあいだは頼まない', async () => {
    const env = fakeWindow({ visible: false });
    const stop = keepAwake(env.win);
    await settle();
    expect(env.requests).toBe(0);

    // 戻ってきたら掛け直す（**申請は離れた時点で自動で外れている**）
    env.setVisible(true);
    await settle();
    expect(env.requests).toBe(1);
    stop();
  });

  it('掛かっているあいだは、戻ってきても頼み直さない', async () => {
    const env = fakeWindow();
    const stop = keepAwake(env.win);
    await settle();

    env.setVisible(true);
    await settle();
    expect(env.requests).toBe(1);
    stop();
  });

  it('断られても投げ出さない', async () => {
    const env = fakeWindow({ deny: true });
    const stop = keepAwake(env.win);
    await settle();

    expect(env.requests).toBe(1);
    expect(env.locks).toHaveLength(0);
    // 後片付けも素通りする
    expect(() => stop()).not.toThrow();
  });

  it('頼んでいる途中でやめたら、掛かったそばから外す', async () => {
    vi.useFakeTimers();
    const env = fakeWindow({ delayMs: 50 });
    const stop = keepAwake(env.win);

    // 返事が返る前にやめる
    stop();
    await vi.advanceTimersByTimeAsync(100);
    vi.useRealTimers();
    await settle();

    expect(env.locks).toHaveLength(1);
    expect(env.locks[0].released).toBe(true);
  });
});
