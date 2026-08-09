/**
 * 遊んでいるあいだ画面を寝かせない（C-209）
 *
 * 数独は**手が止まっている時間が長い**遊びである。盤面を眺めて考えているあいだ、
 * 端末は「何もしていない」と見なして画面を暗くしてしまう。実機で不便だという指摘があった。
 *
 * **効かせるのはプレイ画面のあいだだけ**（利用者の指示）。タイトル画面や成績を眺めている
 * あいだは効かせない。入切は設定で選べる（既定は入）。
 *
 * 申請は**画面を離れると自動で外れる**ので、戻ってきたときに掛け直す。
 * 対応しない環境では、そもそも項目を出さない（`isSupported`）。
 */

import { useEffect } from 'react';

/** この端末で「画面を寝かせない」を頼めるか */
export function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

/**
 * 掛けたり外したりを引き受ける。後片付けの関数を返す。
 *
 * React に依存しないので、単独で確かめられる。
 */
export function keepAwake(win: Window): () => void {
  const nav = win.navigator;
  const doc = win.document;
  /** 掛かっている申請。外れたものは持ち続けない */
  let sentinel: WakeLockSentinel | null = null;
  /** 後片付けが済んだか。**掛けている途中で捨てられた場合に取りこぼさないための札** */
  let disposed = false;

  const acquire = async (): Promise<void> => {
    if (disposed) return;
    // 画面が表に出ていないあいだは頼めない（頼んでも断られる）
    if (doc.visibilityState !== 'visible') return;
    if (sentinel !== null && !sentinel.released) return;
    try {
      const next = await nav.wakeLock.request('screen');
      // 待っているあいだに用済みになっていたら、掛かったそばから外す
      if (disposed) {
        void next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
    } catch {
      // 断られることはある（電池が少ない・設定で禁じられている）。**諦める。騒がない**
    }
  };

  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') void acquire();
  };

  void acquire();
  doc.addEventListener('visibilitychange', onVisibility);

  return () => {
    disposed = true;
    doc.removeEventListener('visibilitychange', onVisibility);
    const held = sentinel;
    sentinel = null;
    void held?.release().catch(() => undefined);
  };
}

/** `active` が真のあいだだけ画面を寝かせない */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !isSupported()) return;
    return keepAwake(window);
  }, [active]);
}
