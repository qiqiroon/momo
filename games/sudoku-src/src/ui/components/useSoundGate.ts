/**
 * 音の問いかけを出すしかけ（C-180 / MOMO Hanafuda v1.90 準拠）
 *
 * ブラウザは「人が実際に画面を触るまで」音を鳴らさない。したがって問いかけへの返事は、
 * 音を出してよいという意思表示であると同時に、**音を出せるようにする合図**を兼ねる。
 *
 * 花札と同じく、**起動した瞬間には出さない。最初の操作を1回だけ横取りして、そこで出す。**
 * 横取りした操作は捨てず、返事のあとに自動でやり直す（利用者が押し直さなくてよい）。
 * いきなり問いかけで塞ぐと、まだ何をする画面かも分からないうちに判断を迫ることになる。
 *
 * さらに、**一定時間ぶりに画面へ戻ったときは訊き直す**。長く離れているあいだに
 * ブラウザが音の許可を落としていることがあるためで、短い出入りでは訊き直さない。
 *
 * > 盤面はマウス・指の押し下げで動くため、遊んでいる最中に訊き直しが起きた場合は
 * > **押し下げの側が先に効く**（横取りできるのは「押して離す」のほうである）。
 * > その操作は成立したうえで問いかけが出る。害は無いので、そのままとする。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SOUND_ASK_LONG_AWAY_MS } from '../config';

export interface SoundGate {
  /** 問いかけを出しているか */
  asking: boolean;
  /** 返事を受け取る。横取りしていた操作をやり直す */
  answer(): void;
}

/** 問いかけ自身の中身。ここへの操作は横取りの対象にしない */
const DIALOG_SELECTOR = '.dialog-backdrop';

export function useSoundGate(longAwayMs: number = SOUND_ASK_LONG_AWAY_MS): SoundGate {
  /** 次の操作を横取りする構えでいるか。**起動直後から構える** */
  const [armed, setArmed] = useState(true);
  const [asking, setAsking] = useState(false);
  /** 横取りした操作の相手。返事のあとにやり直す */
  const pending = useRef<HTMLElement | null>(null);
  /**
   * 画面から離れた時刻。壁時計でよい（分単位の判定であり、精度は要らない）。
   * **「離れていない」は 0 ではなく null で表す。** 0 も正当な時刻でありうる
   */
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    if (!armed) return;

    const onFirst = (event: MouseEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      // 問いかけの中を押したときは横取りしない（構え直しの直後に起こりうる）
      if (target?.closest(DIALOG_SELECTOR)) return;

      pending.current = target;
      // **捕捉の段になって止める。** こうすると React 側の受け口まで届かない
      event.preventDefault();
      event.stopPropagation();
      setArmed(false);
      setAsking(true);
    };

    document.addEventListener('click', onFirst, true);
    return () => document.removeEventListener('click', onFirst, true);
  }, [armed]);

  useEffect(() => {
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current === null ? 0 : Date.now() - hiddenAt.current;
      hiddenAt.current = null;
      // 長く離れていたときだけ構え直す。短い出入りでは訊かない
      if (away >= longAwayMs) setArmed(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [longAwayMs]);

  const answer = useCallback(() => {
    setAsking(false);
    const target = pending.current;
    pending.current = null;
    if (target === null || !target.isConnected) return;
    // 問いかけを閉じたあとにやり直す。同じ回のうちに押すと、また自分で横取りしかねない
    setTimeout(() => {
      try {
        target.click();
      } catch {
        // やり直せない相手なら諦める。押し直してもらえば済む
      }
    }, 0);
  }, []);

  return { asking, answer };
}
