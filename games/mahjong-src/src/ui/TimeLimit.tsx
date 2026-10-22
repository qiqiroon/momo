// 1 手の制限時間の画面（段階10の2・利用者決定 2026-10-16）
//  - TimeConsent：時間のある対局の同意の窓。始めるとき（60 秒・押さなければ CPU）と、席を返してもらうとき（時間なし）
//  - MoveClock：自分の番の残り秒数。残り 4〜1 秒で「ぽっ」、時間切れで「ブー」
// 見た目は歯車の設定の窓（sound-backdrop・sound-panel）にそろえる。
import { useEffect, useRef, useState } from 'react';
import { playClockBuzz, playClockPip } from '../audio/clockSound';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 締め切りまでの残り秒数（切り上げ）。描き直しのため少しずつ時を進める */
function useSecondsLeft(deadline: number | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export interface TimeConsentProps {
  t: T;
  /** 1 手の制限時間（秒） */
  seconds: number;
  /** 押す締め切り（始めるとき）。null＝時間なし（席を返してもらうとき） */
  deadline: number | null;
  /** 下に添える一言（始めるとき＝やめたらどうなるか／返してもらうとき＝押したら頼む） */
  note: 'tcCancelNote' | 'tcReclaimNote';
  onOk: () => void;
  onCancel: () => void;
}

export function TimeConsent({ t, seconds, deadline, note, onOk, onCancel }: TimeConsentProps) {
  const left = useSecondsLeft(deadline);
  return (
    <div className="sound-backdrop tc-backdrop" role="dialog" aria-modal="true" aria-label={t('tcTitle')}>
      <div className="sound-panel time-consent">
        <h2>{t('tcTitle')}</h2>
        <p>{t('tcBody', { s: seconds })}</p>
        <p className="tc-note">{t(note)}</p>
        <div className="tc-buttons">
          <button type="button" className="btn-primary tc-ok" onClick={onOk}>
            {t('tcOk')}
          </button>
          <button type="button" className="btn-secondary tc-cancel" onClick={onCancel}>
            {t('tcCancel')}
          </button>
        </div>
        {left !== null && <p className="tc-countdown">{t('tcCountdown', { n: left })}</p>}
      </div>
    </div>
  );
}

/** 秒読みの音を鳴らす残り秒数（利用者指示＝最後の 5 秒。残り 4〜1 秒で「ぽっ」、0 秒で「ブー」） */
const PIPS = [4, 3, 2, 1];

/** 自分の番の残り秒数。deadline＝締め切り（null なら出さない）・timeouts＝時間切れの手を出した回数（増えたら「ブー」） */
export function MoveClock({ t, deadline, timeouts }: { t: T; deadline: number | null; timeouts: number }) {
  const left = useSecondsLeft(deadline);
  // 「ぽっ」は締め切りから数えた時刻に合わせて鳴らす（描き直しの間隔に左右されない）
  useEffect(() => {
    if (deadline === null) return;
    const ids = PIPS.map((n) => deadline - n * 1000 - Date.now())
      .filter((ms) => ms >= 0)
      .map((ms) => setTimeout(playClockPip, ms));
    return () => ids.forEach(clearTimeout);
  }, [deadline]);
  // 「ブー」は時間切れの手を出した瞬間（卓が数を増やす）
  const seen = useRef(timeouts);
  useEffect(() => {
    if (timeouts > seen.current) playClockBuzz();
    seen.current = timeouts;
  }, [timeouts]);
  if (left === null) return null;
  return <span className={`move-clock${left <= 5 ? ' urgent' : ''}`}>{t('clockLeft', { n: left })}</span>;
}
