// チャット欄（訂正26100917・利用者 Q6=B）。CPU と対局では打った文字が自分の画面に出るだけ。
// オンライン対局（段階5の5）では部屋の全員と話す：lines と onSend を渡す。自由に打つ形だけ（定型あいさつは作らない）。
// いつも一番上に禁止事項を 1 行出す（仕様書 §14.4：賭博への勧誘・掛け金の募集・外部の賭博サービスへの誘導）。
// 置き場所：横4列は画面の下（手牌の下）・正方形の卓は卓の横の空き（入らなければ卓の下）・待合は名簿の下。

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { MessageKey } from '../i18n/strings';
import { CHAT_MAX_LEN, type ChatLine } from '../online/session';

type T = (k: MessageKey) => string;

interface Props {
  t: T;
  you: string;
  /** オンライン：部屋のチャット（無ければ自分の画面だけ） */
  online?: { lines: readonly ChatLine[]; myId: string; onSend: (text: string) => boolean };
}

export function Chat({ t, you, online }: Props) {
  const [localLines, setLocalLines] = useState<string[]>([]);
  const lines = online ? online.lines.map((l) => `${l.id === online.myId ? you : l.name}: ${l.text}`) : localLines;
  const [text, setText] = useState('');
  const log = useRef<HTMLDivElement>(null);
  // 新しい行が来たら一番下を見せる
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines.length]);
  const send = (e: FormEvent) => {
    e.preventDefault();
    const s = text.trim();
    if (!s) return;
    // オンライン：送れなかったとき（1 秒に 2 回目など）は文字を残す
    if (online) {
      if (online.onSend(s)) setText('');
      return;
    }
    setLocalLines((xs) => [...xs, `${you}: ${s}`]);
    setText('');
  };
  return (
    <section className="chat" aria-label={t('chatLabel')}>
      {online && <p className="chat-rule">{t('chatRule')}</p>}
      <div className="chat-log" ref={log}>
        {lines.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chatPlaceholder')} maxLength={CHAT_MAX_LEN} aria-label={t('chatPlaceholder')} />
        <button type="submit" className="btn-secondary chat-send">
          {t('chatSend')}
        </button>
      </form>
    </section>
  );
}
