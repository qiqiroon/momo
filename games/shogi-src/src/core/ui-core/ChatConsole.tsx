import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '../store/chat-store';
import { useRouteStore } from '../store/route-store';
import { useGameStore } from '../store/game-store';
import { get as pluginGet } from '../plugin/registry';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { seChatRecv } from '../audio/se-synth';

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
  /**
   * ★v1.55: 観戦者の発言が観戦者どうしに絞られるのは**対局が進んでいる間だけ**
   * （親 §6.8.5）。**ここは購読して読む**＝口越しに一度だけ聞くと、
   * **終局しても古いまま**になり、**届いているのに「届いていません」と出し続ける**
   * （2026-08-21 実サーバーで実際にそうなった）。**送る側と同じ条件**で判断する。
   */
  const screen = useRouteStore((s) => s.screen);
  const gameStatus = useGameStore((s) => s.status);
  const inPlay = screen === 'game' && gameStatus === 'playing';
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

  // v0.74: メッセージが増えたら SE-chat-recv を鳴らす (S06/S07 両方で発火)。
  // 従来 GameScreen 側だけに配線していたので S06 対局準備画面のチャットで
  // 鳴らなかったのを、共通コンポーネントで一元発火するように移動。
  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) seChatRecv();
    prevMsgCountRef.current = messages.length;
  }, [messages.length]);

  // ★v1.55 (親 §6.8.5): 観戦者は席を持たないが**書ける**（届く先が違うだけ）。
  const canSend = state.mySide !== null || state.spectating;
  const sideFallback = (side: 'player1' | 'player2') =>
    t(side === 'player1' ? 'chat.pSente' : 'chat.pGote');
  const myPrompt = state.myName
    ? `${state.myName}＞`
    : state.mySide
      ? sideFallback(state.mySide)
      : sideFallback('player1');
  /** ★v1.55: 観戦者の名札は「名前（観戦者）」（§6.8.5）。 */
  const watcherPrompt = (name: string) => `${name}（${t('spec.role')}）＞`;

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
          // ★v1.55: 席の無い人の発言（§6.8.5）。**名前に「観戦者」を添える**＝
          // 誰が対局している人なのかが分かるようにするため。
          if (m.kind === 'spectator') {
            const mine = state.spectating && m.name === state.myName;
            return (
              <div key={i} className={`line ${mine ? 'self' : 'other'}`}>
                <span className="prompt">{watcherPrompt(m.name)}</span>
                {m.text}
              </div>
            );
          }
          const isMine = state.mySide !== null && m.side === state.mySide;
          const nameForSide = isMine
            ? state.myName
            : state.seatNames
              ? state.seatNames[m.side]
              : state.opponentName;
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
      {/* ★v1.55 (親 §6.8.5): **書いた本人に届き先を知らせる**＝知らせないと、
          対局者にも届いたと思い込んだまま話し続ける。**絞られるのは対局が進んで
          いる間だけ**なので、準備室・終局後・感想戦ではこの一言を出さない
          （出すと、届いているのに届いていないと思わせる）。 */}
      {state.spectating && inPlay && (
        <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 4 }}>
          {t('spec.chatNote')}
        </div>
      )}
    </div>
  );
}

function readState() {
  const c = pluginGet<OnlineGameConnector>('gameConnector');
  const empty = {
    mySide: null as 'player1' | 'player2' | null,
    myName: '',
    opponentName: '',
    spectating: false,
    seatNames: null as { player1: string; player2: string } | null,
  };
  if (!c) return empty;
  return {
    mySide: c.getMyChatSide(),
    myName: c.getMyName(),
    opponentName: c.getOpponentName(),
    // **口が無いビルド・古い形の相手でも落ちない**ようにする（縮退互換）。
    spectating: typeof c.isSpectating === 'function' ? c.isSpectating() : false,
    seatNames: typeof c.getSeatNames === 'function' ? c.getSeatNames() : null,
  };
}
