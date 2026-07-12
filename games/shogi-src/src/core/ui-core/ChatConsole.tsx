import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat-store';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';

/**
 * 対局準備 / 対局中のチャット表示・送信 UI（段階 v0.32 で S06/S07 共通化）。
 *
 * - 自分の発言は白／相手はオレンジで、プロンプトは表示名（アリス＞ 等）
 * - オンライン対戦中でなくても、入室していれば送受信できる（S06 対局準備でも動く）
 * - 入力欄・送信ボタンは connector.getMyChatSide() が返す side があれば有効
 * - 履歴は chat-store 経由で両画面で共有される
 *
 * A ビルド（オフライン単人）では gameConnector が undefined なので入力 disabled 表示のみ。
 */
export function ChatConsole({ t }: { t: (key: string) => string }) {
  const messages = useChatStore((s) => s.messages);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(readState);

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const update = () => setState(readState());
    update();
    return c.subscribe(update);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const canSend = state.mySide !== null;
  const sideFallback = (side: 'player1' | 'player2') =>
    t(side === 'player1' ? 'chat.pSente' : 'chat.pGote');
  const myPrompt = state.myName
    ? `${state.myName}＞`
    : state.mySide
      ? sideFallback(state.mySide)
      : sideFallback('player1');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (!canSend) return;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    c.sendChat(text);
    setDraft('');
  };

  return (
    <div className="console">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => {
          const isMine = state.mySide !== null && m.side === state.mySide;
          const nameForSide = isMine ? state.myName : state.opponentName;
          const prompt = nameForSide ? `${nameForSide}＞` : sideFallback(m.side);
          return (
            <div key={i} className={`line ${isMine ? 'self' : 'other'}`}>
              <span className="prompt">{prompt}</span>
              {m.text}
            </div>
          );
        })}
      </div>
      <div className="inputline">
        <span className="prompt">{myPrompt}</span>
        <input
          type="text"
          placeholder={t('chat.placeholder')}
          value={draft}
          disabled={!canSend}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="send" onClick={send} disabled={!canSend}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}

function readState() {
  const c = pluginGet<OnlineGameConnector>('gameConnector');
  if (!c) return { mySide: null as 'player1' | 'player2' | null, myName: '', opponentName: '' };
  return {
    mySide: c.getMyChatSide(),
    myName: c.getMyName(),
    opponentName: c.getOpponentName(),
  };
}
