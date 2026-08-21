/**
 * スクリーンセーバー抑止（★v1.55 新設・2026-08-21 実機のご要望）。
 *
 * ## 経緯
 *
 * 観戦中に画面が真っ暗になる、というご報告から測ったところ、**将棋にはこの仕掛けが
 * どこにも無かった**（**対局中も抑止していなかった**）。**同じ MOMO の中では
 * 花札・ダーツ・数独・Tilt・カラオケの 5 つに実績がある**ので、その形を借りた。
 *
 * ## どの画面で効かせるか
 *
 * **盤を見ている間と、その手前で人を待っている間**＝準備画面・対局・棋譜再生・感想戦。
 * **画面の名前を数え上げているように見えるが、ここは「盤を眺めていて手を触らない
 * 時間が続く画面」という事実で選んでいる**。ロビーは選ぶために触り続ける場所なので
 * 入れない。
 *
 * **観戦者のための例外は作らない**＝観戦者が居るのは対局・準備・感想戦のどれかで、
 * どれもこの一覧に入っている（**立場ごとに書き分けると片方だけ直った状態になる**）。
 *
 * ## 効かない場面があること
 *
 * この仕掛けは**ブラウザが備えていなければ何も起きない**（古い端末・非対応の browser）。
 * また**画面が裏に回ると自動的に外れる**ので、**戻ってきたら取り直す**。
 */
import { useEffect } from 'react';

/** 取っている間の掴み（同じものを二重に取らないため）。 */
let held: { release: () => Promise<void> } | null = null;

interface WakeLockNavigator {
  wakeLock?: {
    request: (type: 'screen') => Promise<{
      release: () => Promise<void>;
      addEventListener: (type: 'release', cb: () => void) => void;
    }>;
  };
}

async function acquire(): Promise<void> {
  try {
    const nav = navigator as unknown as WakeLockNavigator;
    if (!nav.wakeLock || held) return;
    const lock = await nav.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      held = null;
    });
    held = lock;
  } catch {
    // 非対応・画面が裏・許可されない等は黙って諦める（**画面は消えるが害は無い**）。
  }
}

function release(): void {
  try {
    if (held) {
      void held.release();
      held = null;
    }
  } catch {
    // 取り外せなくても先へ進む
  }
}

/** その画面では画面を消させないか。 */
export function keepsScreenAwake(screen: string): boolean {
  return screen === 'room' || screen === 'game' || screen === 'kifu-replay' || screen === 'review';
}

/**
 * 画面に応じて抑止を取ったり外したりする。
 *
 * **裏に回ると自動で外れる**ので、`visibilitychange` で取り直す
 * （取り直さないと、一度別のアプリを見ただけで以後ずっと消えるようになる）。
 */
export function useWakeLock(screen: string): void {
  useEffect(() => {
    const sync = () => {
      if (document.hidden) return;
      if (keepsScreenAwake(screen)) void acquire();
      else release();
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
    };
  }, [screen]);

  // 画面そのものを離れるときは必ず外す（掴んだまま残さない）。
  useEffect(() => () => release(), []);
}
