// リンクをコピーするボタン（牌譜の再生・同じ山で勝負）。終局の画面・対局の再生の画面・再生中の画面で同じものを使う。
// desc があればボタンの中に説明を 2 行目として出す（対局の再生の保存先の 4 行）。
// warn は押したときに出す注意（同じ山で勝負：山の情報が入ること。同意は求めない）。コピーできない端末では住所を選べる欄に出す。

import { useState } from 'react';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

interface Props {
  t: T;
  label: string;
  desc?: string;
  disabled?: boolean;
  /** リンクを作る（作れなければ投げる） */
  make: () => string | Promise<string>;
  /** コピーできたときの一言 */
  done: MessageKey;
  /** 押したときに出す注意 */
  warn?: MessageKey;
  className?: string;
}

export function LinkCopy({ t, label, desc, disabled = false, make, done, warn, className = 'choice-btn' }: Props) {
  const [st, setSt] = useState<{ state: 'idle' | 'copied' | 'failed' | 'error'; url: string; why: string }>({ state: 'idle', url: '', why: '' });
  const copy = async () => {
    let url = '';
    try {
      url = await make();
    } catch (e) {
      return setSt({ state: 'error', url: '', why: (e as Error).message });
    }
    try {
      await navigator.clipboard.writeText(url);
      setSt({ state: 'copied', url, why: '' });
    } catch {
      setSt({ state: 'failed', url, why: '' });
    }
  };
  return (
    <>
      <button type="button" className={`${className}${desc ? ' with-desc' : ''}`} disabled={disabled} onClick={() => void copy()}>
        <span className="choice-label">{label}</span>
        {desc && <span className="choice-desc">{desc}</span>}
      </button>
      {warn && st.state !== 'idle' && st.state !== 'error' && <p className="choice-note same-warn">{t(warn)}</p>}
      {st.state === 'copied' && <p className="choice-note">{t(done)}</p>}
      {st.state === 'error' && <p className="choice-note">{t('kifuLinkFailed', { why: st.why })}</p>}
      {st.state === 'failed' && (
        <>
          <p className="choice-note">{t('rsCopyFail')}</p>
          <input className="kifu-link-url" readOnly value={st.url} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </>
  );
}
