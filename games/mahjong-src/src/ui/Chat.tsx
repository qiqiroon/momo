// チャット欄（訂正26100917・利用者 Q6=B）。いまは場所と文字を打つ所だけ＝打った文字が自分の画面に出る。
// 人と話す中身（送る・受け取る）はオンライン対局の段階5で足す。並べ方の確かめに使う。
// 置き場所：横4列は画面の下（手牌の下）・正方形の卓は卓の横の空き（入らなければ卓の下）。

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey) => string;

export function Chat({ t, you }: { t: T; you: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  // 新しい行が来たら一番下を見せる
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const s = text.trim();
    if (!s) return;
    setLines((xs) => [...xs, `${you}: ${s}`]);
    setText('');
  };
  return (
    <section className="chat" aria-label={t('chatLabel')}>
      <div className="chat-log" ref={log}>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chatPlaceholder')} maxLength={200} aria-label={t('chatPlaceholder')} />
        <button type="submit" className="btn-secondary chat-send">
          {t('chatSend')}
        </button>
      </form>
    </section>
  );
}
