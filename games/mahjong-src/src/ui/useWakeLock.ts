// 卓を出しているあいだ、携帯の画面が暗くならないようにする（Screen Wake Lock・訂正26101113）。
// 画面を隠すとブラウザが自動で外すので、戻ったら取り直す。使えない端末では何もしない。
import { useEffect } from 'react';

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const take = async () => {
      if (done || document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (done) void l.release();
        else lock = l;
      } catch {
        /* 電池の節約中などで断られた：そのまま */
      }
    };
    const onVisible = () => void take();
    void take();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock && !lock.released) void lock.release();
    };
  }, [active]);
}
