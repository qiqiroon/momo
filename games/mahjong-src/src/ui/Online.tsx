// オンライン対局：部屋の一覧（作る・入る）と待合（段階5の2）。
// 部屋の作り方・入り方は MOMO Hanafuda のロビーにならう（利用者指示 2026-10-09）：
// 部屋の名前・パスワード（任意）・非公開にする／一覧の 🔒 とパスワードつき／非公開の部屋を表示／
// 一覧の下のパスワード欄に入れてから参加。パスワード欄はブラウザに保存の候補を出させない（ふつうの文字の欄を伏せ字に見せる）。

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { MessageKey } from '../i18n/strings';
import { MAX_SEATS, type OnlineNote, type OnlineSession, type RoomInfo } from '../online/session';
import { BackButton, ScreenHead } from './Menu';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

const NAME_KEY = 'momo-mahjong.playerName';

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 覚えられない端末では毎回入れてもらう */
  }
}

export function useOnline(session: OnlineSession) {
  return useSyncExternalStore(session.subscribe, () => session.state);
}

function noteText(t: T, note: OnlineNote): string {
  if (typeof note === 'object') return note.raw;
  const keys: Record<Exclude<OnlineNote, { raw: string }>, MessageKey> = {
    noName: 'olErrNoName',
    noRoomName: 'olErrNoRoomName',
    wrongPw: 'olErrWrongPw',
    roomFull: 'olErrFull',
    roomGone: 'olErrGone',
    rejectedStarted: 'olErrStarted',
    hostLeft: 'olHostLeft',
    hostLeftGame: 'olHostLeftGame',
    connectionLost: 'olLost',
    serverBusy: 'olBusy',
  };
  return t(keys[note]);
}

/** パスワードの欄（Chrome の保存済みパスワードの吹き出しを出させない＝MOMO Hanafuda v2.98 と同じ手） */
function PwInput({ value, onChange, placeholder, name }: { value: string; onChange: (v: string) => void; placeholder: string; name: string }) {
  const [ro, setRo] = useState(true);
  return (
    <input
      className="ol-input pw-mask"
      type="text"
      inputMode="text"
      maxLength={16}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-1p-ignore="true"
      data-lpignore="true"
      data-form-type="other"
      name={name}
      readOnly={ro}
      onFocus={() => setRo(false)}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** 部屋の一覧：あなたの名前・部屋を作る・部屋に入る */
export function Lobby({ t, session, onBack }: { t: T; session: OnlineSession; onBack: () => void }) {
  const s = useOnline(session);
  const [name, setName] = useState(loadName);
  const [roomName, setRoomName] = useState('');
  const [pw, setPw] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [joinPw, setJoinPw] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  useEffect(() => session.open(), [session]);
  // 知らせは画面の上に出す。携帯で一覧まで下げていても見えるよう、出たらそこまで戻す
  const noteRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (s.note) noteRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [s.note]);
  const rename = (v: string) => {
    setName(v);
    saveName(v.trim());
  };
  const rooms = s.rooms.filter((r) => showPrivate || r.isPublic);
  const join = (r: RoomInfo) => session.join(r, name, joinPw);
  return (
    <>
      <ScreenHead title={t('menuOnline')} />
      <div className="screen-actions">
        <BackButton t={t} onClick={onBack} />
        <span className={`ol-server${s.wsOpen ? ' on' : ''}`}>{t(s.wsOpen ? 'olServerOn' : 'olServerConnecting')}</span>
      </div>
      {s.note && (
        <p ref={noteRef} className="ol-note" role="alert">
          {noteText(t, s.note)}
        </p>
      )}
      <section className="gset ol-panel">
        <h3>{t('olYourName')}</h3>
        <p className="guide">{t('olYourNameDesc')}</p>
        <input className="ol-input" type="text" maxLength={16} autoComplete="off" spellCheck={false} placeholder={t('olNamePh')} value={name} onChange={(e) => rename(e.target.value)} />
      </section>
      <section className="gset ol-panel">
        <h3>{t('olCreate')}</h3>
        <p className="guide">{t('olCreateDesc')}</p>
        <label className="ol-field">
          <span>{t('olRoomName')}</span>
          <input className="ol-input" type="text" maxLength={24} autoComplete="off" spellCheck={false} placeholder={t('olRoomNamePh')} value={roomName} onChange={(e) => setRoomName(e.target.value)} />
        </label>
        <label className="ol-field">
          <span>{t('olPassword')}</span>
          <PwInput name="mj-nopw-1" value={pw} onChange={setPw} placeholder={t('olPwOptional')} />
        </label>
        <label className="ol-check">
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          <span>{t('olPrivate')}</span>
        </label>
        <div>
          <button type="button" className="btn-primary" disabled={!s.wsOpen || s.busy} onClick={() => session.create({ hostName: name, roomName, password: pw, isPrivate })}>
            {t('olCreateBtn')}
          </button>
        </div>
      </section>
      <section className="gset ol-panel">
        <div className="ol-join-head">
          <h3>{t('olJoin')}</h3>
          <button type="button" className="choice-btn" disabled={!s.wsOpen} onClick={() => session.refresh()}>
            {t('olRefresh')}
          </button>
        </div>
        <p className="guide">{t('olJoinDesc')}</p>
        <ul className="ol-rooms">
          {!s.wsOpen ? (
            <li className="ol-empty">{t('olServerConnecting')}</li>
          ) : rooms.length === 0 ? (
            <li className="ol-empty">{t('olNoRooms')}</li>
          ) : (
            rooms.map((r) => {
              const full = r.playerCount >= Math.min(r.maxPlayers, MAX_SEATS);
              const playing = r.gameState === 'playing';
              return (
                <li key={r.id} className="ol-room">
                  <span className="ol-room-name">
                    {r.hasPassword ? '🔒 ' : ''}
                    {r.name || '(no name)'}
                    <small>
                      {r.hostName}
                      {r.hasPassword ? ` ・ ${t('olPwTag')}` : ''}
                      {!r.isPublic ? ` ・ ${t('olPrivateTag')}` : ''}
                    </small>
                  </span>
                  <span className="ol-room-state">
                    {t('olPlayers', { n: r.playerCount, max: MAX_SEATS })}
                    {playing ? ` ・ ${t('olPlaying')}` : ''}
                  </span>
                  <button type="button" className="choice-btn" disabled={full || s.busy} onClick={() => join(r)}>
                    {t('olJoinBtn')}
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <label className="ol-check">
          <input type="checkbox" checked={showPrivate} onChange={(e) => setShowPrivate(e.target.checked)} />
          <span>{t('olShowPrivate')}</span>
        </label>
        <PwInput name="mj-nopw-2" value={joinPw} onChange={setJoinPw} placeholder={t('olPassword')} />
      </section>
    </>
  );
}

/** 待合：席は入った順。空いた席は CPU。ホストだけが始められる */
export function WaitingRoom({ t, session }: { t: T; session: OnlineSession }) {
  const s = useOnline(session);
  if (!s.room) return null;
  const isHost = s.room.isHost;
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => s.members[i] ?? null);
  return (
    <>
      <ScreenHead title={t('olRoomTitle')} />
      <div className="screen-actions">
        {isHost && !s.started && (
          <button type="button" className="btn-primary btn-start" onClick={() => session.start()}>
            {t('start')}
          </button>
        )}
        <button type="button" className="btn-secondary back-btn" onClick={() => session.leave()}>
          {t(isHost ? 'olCloseRoom' : 'olLeaveRoom')}
        </button>
      </div>
      <section className="gset ol-panel">
        <h3>
          {s.room.name}
          {s.room.hasPassword && <span className="ol-room-pw"> 🔒 {t('olPwTag')}</span>}
        </h3>
        <ol className="ol-seats">
          {seats.map((m, i) => (
            <li key={i} className={m ? (m.online ? '' : 'away') : 'cpu'}>
              <span className="ol-seat-no">{i + 1}</span>
              <span className="ol-seat-name">{m ? m.name : t('olCpuSeat')}</span>
              <span className="ol-seat-tags">
                {i === 0 && <span className="ol-tag host">{t('olHost')}</span>}
                {m && m.id === session.myId && <span className="ol-tag you">{t('you')}</span>}
                {m && !m.online && <span className="ol-tag">{t('olAway')}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="guide">{t('olRuleFixed')}</p>
        {s.started ? (
          <p className="guide ol-started">{t('olStartedNote')}</p>
        ) : (
          <p className="guide">{t(isHost ? 'olHostHint' : 'olWaitHost')}</p>
        )}
      </section>
    </>
  );
}
