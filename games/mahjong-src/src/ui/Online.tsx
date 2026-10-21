// オンライン対局：部屋の一覧（作る・入る）と待合（段階5の2）。
// 部屋の作り方・入り方は MOMO Hanafuda のロビーにならう（利用者指示 2026-10-09）：
// 部屋の名前・パスワード（任意）・非公開にする／一覧の 🔒 とパスワードつき／非公開の部屋を表示／
// 一覧の下のパスワード欄に入れてから参加。パスワード欄はブラウザに保存の候補を出させない（ふつうの文字の欄を伏せ字に見せる）。

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { joinRoleOf, MAX_SEATS, playersOf, REPLY_WAIT_MS, spectatorsOf, TIME_LIMIT_MS, TIME_LIMITS, type Member, type OnlineNote, type OnlineSession, type OnlineState, type ReplyWait, type RoomInfo, type TimeLimit } from '../online/session';
import type { OnlineTable } from '../online/table';
import type { Seat } from '../engine/events';
import { BackButton, ScreenHead } from './Menu';
import { Chat } from './Chat';
import { saveStrength } from '../cpu/strength';
import { StrengthPicker } from './StrengthPicker';
import { RuleSettings, saveRuleChoice } from './RuleSettings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

const NAME_KEY = 'momo-mahjong.playerName';
/** 一度作った部屋の名前（次に作るときの欄に最初から入れる＝訂正26101113。パスワードは覚えない） */
const ROOM_NAME_KEY = 'momo-mahjong.online.roomName';

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

function loadRoomName(): string {
  try {
    return localStorage.getItem(ROOM_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveRoomName(name: string) {
  if (!name) return;
  try {
    localStorage.setItem(ROOM_NAME_KEY, name);
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
    kicked: 'olErrKicked',
    noSpectators: 'olErrNoSpectators',
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
  const [roomName, setRoomName] = useState(loadRoomName);
  const [pw, setPw] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  // 観戦を許す（Q10=A：部屋を作るときに選ぶ・最初は許す。部屋に入ってからも切り替えられる）
  const [allowWatch, setAllowWatch] = useState(true);
  const [joinPw, setJoinPw] = useState('');
  const [showPrivate, setShowPrivate] = useState(false);
  useEffect(() => session.open(), [session]);
  const rename = (v: string) => {
    setName(v);
    saveName(v.trim());
  };
  const rooms = s.rooms.filter((r) => showPrivate || r.isPublic);
  // 開き直したとき：控えた部屋がまだ対局中なら「戻る」を出す
  const saved = s.saved && s.rooms.some((r) => r.id === s.saved!.roomId && r.gameState === 'playing') ? s.saved : null;
  const join = (r: RoomInfo) => session.join(r, name, joinPw);
  return (
    <>
      <ScreenHead title={t('menuOnline')} />
      <div className="screen-actions">
        <BackButton t={t} onClick={onBack} />
        <span className={`ol-server${s.wsOpen ? ' on' : ''}`}>{t(s.wsOpen ? 'olServerOn' : 'olServerConnecting')}</span>
      </div>
      {/* 知らせ（入れなかった・部屋が閉じた等）は、閉じるを押すまで消えない窓で出す（10-15 利用者指摘＝すぐ消えて読めなかった） */}
      {s.note && (
        <div className="sound-backdrop" role="alertdialog" aria-modal="true">
          <div className="sound-panel">
            <p className="ol-note">{noteText(t, s.note)}</p>
            <div className="sound-actions">
              <button type="button" className="btn-secondary sound-close" onClick={() => session.clearNote()}>
                {t('close')}
              </button>
            </div>
          </div>
        </div>
      )}
      {saved && (
        <section className="gset ol-panel ol-rejoin">
          <h3>{t('olRejoin')}</h3>
          <p className="guide">{t('olRejoinDesc', { room: saved.roomName })}</p>
          <div className="screen-actions">
            <button type="button" className="btn-primary" disabled={!s.wsOpen || s.busy} onClick={() => session.rejoin()}>
              {t('olRejoinBtn')}
            </button>
            <button type="button" className="choice-btn" onClick={() => session.forgetSaved()}>
              {t('olRejoinForget')}
            </button>
          </div>
        </section>
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
        <label className="ol-check">
          <input type="checkbox" checked={allowWatch} onChange={(e) => setAllowWatch(e.target.checked)} />
          <span>{t('olAllowSpectators')}</span>
        </label>
        <div>
          <button type="button" className="btn-primary" disabled={!s.wsOpen || s.busy} onClick={() => {
              saveRoomName(roomName.trim());
              session.create({ hostName: name, roomName, password: pw, isPrivate, allowSpectators: allowWatch });
            }}>
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
              // ボタンは 1 つ（Q13=B）：席が空いていれば「参加」、埋まっている・対局中なら「観戦」。観戦の枠も埋まっていれば押せない
              const watch = joinRoleOf(r) === 'spectator';
              const full = watch && (r.spectatorCount ?? 0) >= (r.maxSpectators ?? 0);
              const playing = r.gameState === 'playing';
              return (
                <li key={r.id} className="ol-room">
                  <span className="ol-room-name">
                    {r.hasPassword ? '🔒 ' : ''}
                    {r.name || '(no name)'}
                    <small>
                      {r.hostName}
                      {r.hasPassword ? ` ${t('listDot')} ${t('olPwTag')}` : ''}
                      {!r.isPublic ? ` ${t('listDot')} ${t('olPrivateTag')}` : ''}
                    </small>
                  </span>
                  <span className="ol-room-state">
                    {t('olPlayers', { n: Math.min(r.playerCount, MAX_SEATS), max: MAX_SEATS })}
                    {r.spectatorCount ? ` ${t('listDot')} ${t('olWatchers', { n: r.spectatorCount })}` : ''}
                    {playing ? ` ${t('listDot')} ${t('olPlaying')}` : ''}
                  </span>
                  <button type="button" className="choice-btn" disabled={full || s.busy} onClick={() => join(r)}>
                    {t(watch ? 'olWatchBtn' : 'olJoinBtn')}
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

/** オンラインの卓の上に出す一言：配っている・切れた人を待っている・検算の食い違い */
export function OnlineStatus({
  t,
  table,
  members,
  isHost,
  hostWait = null,
  hostNew = null,
  peerWait = {},
}: {
  t: T;
  table: OnlineTable;
  members: Member[];
  isHost: boolean;
  /** ホストを待っている（段階10の5・Q3=A＝卓の上に出し続ける） */
  hostWait?: OnlineState['hostWait'];
  /** ホストが移った（新しいホストの名前） */
  hostNew?: string | null;
  /** ほかのプレイヤーの接続を待っている（生存チェック・利用者 2026-10-20） */
  peerWait?: OnlineState['peerWait'];
}) {
  const waitLeft = useCountdown(hostWait?.kind === 'away' ? hostWait.until : null);
  // 人ごとの待ちの残り（1 秒ごとに描き直す）
  const peerLeftOf = useCountdownOf(Object.values(peerWait).some((w) => w.kind === 'away'));
  // 観戦者の名前（利用者指示＝観戦者名は表示される）
  const watchers = spectatorsOf(members).map((m) => m.name).join(t('listDot'));
  // CPU に任された人の席（段階10）。切れたまま CPU が打っている人は「戻るのを待っています」に出さない
  const proxyIds = new Set(table.seats.flatMap((x) => (x.kind === 'human' && x.proxy ? [x.id] : [])));
  const bad = table.lastVerify !== null && table.lastVerify.length > 0;
  const me = table.mySeat;
  const proxyMe = me !== null && table.isProxy(me);
  const proxyOthers = table.seats.flatMap((x, i) => (x.kind === 'human' && x.proxy && i !== me ? [x.name] : []));
  // この局は配り直した局か（いちばん新しい局の始まりの直前が「なかったことにした局」）
  const kinds = table.wire.map((x) => x.env.ev.type);
  const lastStart = kinds.lastIndexOf('roundStart');
  const redealt = lastStart > 0 && kinds.lastIndexOf('roundVoid', lastStart) > kinds.lastIndexOf('roundStart', lastStart - 1);
  const asks = isHost ? [...table.reclaims.keys()] : [];
  const nameOf = (seat: number) => {
    const x = table.seats[seat];
    return x?.kind === 'human' ? x.name : '?';
  };
  const othersText = proxyOthers.join(t('listDot'));
  const msgs = [
    ...(table.dealing ? [{ key: 'dealing', text: t('olDealing') }] : []),
    ...(proxyMe ? [{ key: 'proxyMe', text: t(isHost ? 'olProxyMeHost' : 'olProxyMe') }] : []),
    ...(proxyOthers.length ? [{ key: `proxy:${othersText}`, text: t('olProxyOthers', { name: othersText }) }] : []),
    ...(redealt ? [{ key: `redealt:${lastStart}`, text: t('olRedealt') }] : []),
    ...(table.reclaimRefused ? [{ key: 'refused', text: t('olReclaimRefused'), warn: true }] : []),
    ...(bad ? [{ key: 'bad', text: t('olVerifyBad'), warn: true }] : []),
    ...(hostNew ? [{ key: `hostNew:${hostNew}`, text: isHost ? t('olHostNewMe') : t('olHostNew', { name: hostNew }) }] : []),
  ];
  // ホストを待っている一言は、待ちが終わるまで出したまま（数秒で消さない）
  const hostWaitText =
    hostWait === null ? null : hostWait.kind === 'checking' ? t('olHostChecking') : hostWait.kind === 'away' ? t('olHostAway', { time: waitLeft }) : t('olHostGone');
  // ほかのプレイヤーを待っている一言も、待ちが終わるまで出したまま（観戦者は名簿の playersOf に入らない＝出さない）。
  // 確かめ中→「確かめています」／切れた→残り m:ss（サーバーの時計と同じ時点から）／それ以外で切れている（前のサーバーなど）→前と同じ一言
  const peerTexts = playersOf(members)
    .filter((m) => !proxyIds.has(m.id) && (peerWait[m.id] || !m.online))
    .map((m) => {
      const w = peerWait[m.id];
      const text = w?.kind === 'checking' ? t('olPeerChecking', { name: m.name }) : w?.kind === 'away' ? t('olPeerAway', { name: m.name, time: peerLeftOf(w.until) }) : t('olWaitBack', { name: m.name });
      return { key: m.id, text };
    });
  const shown = useToasts(msgs);
  return (
    <div className="ol-status" role="status">
      {/* 「自動で鳴く／鳴かない」の切り替えは鳴ける牌の欄へ移した（訂正26101113 Q3=B） */}
      {me === null && <span className="ol-watch-me">{t('olYouWatch')}</span>}
      {/* 帯は 1 行に固定＝長いと「…」で切れるので、全員の名前は title でも見られるようにする */}
      {watchers && (
        <span className="ol-watchers" title={t('olWatchingNames', { name: watchers })}>
          {t('olWatchingNames', { name: watchers })}
        </span>
      )}
      {/* 一言は卓に重ねて数秒だけ出す（卓の高さを変えない＝10-15 利用者 Q15=C）。席を返す頼みだけは答えるまで出したまま */}
      {createPortal(
      <div className="ol-toasts">
        {hostWaitText && (
          <p key="hostWait" className="ol-toast away ol-hostwait">
            {hostWaitText}
          </p>
        )}
        {peerTexts.map((p) => (
          <p key={`peer:${p.key}`} className="ol-toast away ol-peerwait">
            {p.text}
          </p>
        ))}
        {shown.map((m) => (
          <p key={m.key} className={`ol-toast${m.warn ? ' away' : ''}`}>
            {m.text}
          </p>
        ))}
        {asks.map((seat) => (
          <div key={seat} className="ol-toast ol-reclaim">
            <span>{t('olReclaimAsk', { name: nameOf(seat) })}</span>
            <button type="button" className="btn-secondary" onClick={() => void table.answerReclaim(seat as Seat, true)}>
              {t('olReclaimGive')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => void table.answerReclaim(seat as Seat, false)}>
              {t('olReclaimDecline')}
            </button>
          </div>
        ))}
      </div>,
        document.body,
      )}
    </div>
  );
}

/** 卓の上の一言を出しておく長さ */
export const TOAST_MS = 4000;

/**
 * 出ている一言のうち、新しく出たものだけを TOAST_MS のあいだ見せる（同じ一言は出続けていても 1 回だけ。
 * 一度消えてまた出たら、また見せる）
 */
/** 締め切りまでの残り（m:ss） */
const leftText = (until: number): string => {
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
};

/** 何人ぶんかの残りを数える（数えるものがあるあいだ 1 秒ごとに描き直す） */
function useCountdownOf(active: boolean): (until: number) => string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return leftText;
}

/** 締め切りまでの残り（m:ss）。1 秒ごとに数え直す。締め切りが無ければ空 */
function useCountdown(until: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (until === null) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [until]);
  if (until === null) return '';
  const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

function useToasts<M extends { key: string }>(msgs: M[]): M[] {
  const [since] = useState(() => new Map<string, number>());
  const [, tick] = useState(0);
  const now = Date.now();
  const keys = new Set(msgs.map((m) => m.key));
  for (const k of [...since.keys()]) if (!keys.has(k)) since.delete(k);
  for (const m of msgs) if (!since.has(m.key)) since.set(m.key, now);
  const live = msgs.filter((m) => now - since.get(m.key)! < TOAST_MS);
  const next = live.length ? Math.min(...live.map((m) => since.get(m.key)! + TOAST_MS)) - now : null;
  useEffect(() => {
    if (next === null) return;
    const id = setTimeout(() => tick((n) => n + 1), Math.max(0, next) + 20);
    return () => clearTimeout(id);
  }, [next]);
  return live;
}

/** 待合：返事の待ち（ホストだけが選べる。ゲストには選ばれた値を見せる） */
function ReplyWaitPicker({ t, session, value, isHost, started }: { t: T; session: OnlineSession; value: ReplyWait; isHost: boolean; started: boolean }) {
  const keys: ReplyWait[] = ['fast', 'normal', 'slow'];
  const label: Record<ReplyWait, MessageKey> = { fast: 'olWaitFast', normal: 'olWaitNormal', slow: 'olWaitSlow' };
  return (
    <div className="ol-replywait">
      <span>{t('olReplyWait')}</span>
      <span className="seg">
        {keys.map((k) => (
          <button type="button" key={k} className={value === k ? 'on' : ''} disabled={!isHost || started} onClick={() => session.setReplyWait(k)}>
            {t(label[k], { s: REPLY_WAIT_MS[k] / 1000 })}
          </button>
        ))}
      </span>
    </div>
  );
}

/** 待合：1 手の制限時間（段階10の2・ホストだけが選べる。ゲストには選ばれた値を見せる） */
function TimeLimitPicker({ t, session, value, isHost, started }: { t: T; session: OnlineSession; value: TimeLimit; isHost: boolean; started: boolean }) {
  return (
    <div className="ol-replywait ol-timelimit">
      <span>{t('olTimeLimit')}</span>
      <span className="seg">
        {TIME_LIMITS.map((k) => (
          <button type="button" key={k} className={value === k ? 'on' : ''} disabled={!isHost || started} onClick={() => session.setTimeLimit(k)}>
            {k === 'none' ? t('olTimeNone') : t('olTimeSec', { s: TIME_LIMIT_MS[k] / 1000 })}
          </button>
        ))}
      </span>
    </div>
  );
}

/** 待合：席は入った順。空いた席は CPU。ホストだけが始められる */
export function WaitingRoom({ t, lang, session }: { t: T; lang: BaseLang; session: OnlineSession }) {
  const s = useOnline(session);
  if (!s.room) return null;
  if (s.reconnecting) {
    return (
      <>
        <ScreenHead title={t('olRoomTitle')} />
        <p className="ol-note" role="status">
          {t('olReconnecting')}
        </p>
      </>
    );
  }
  const isHost = s.room.isHost;
  const players = playersOf(s.members);
  const watchers = spectatorsOf(s.members);
  const seats = Array.from({ length: MAX_SEATS }, (_, i) => players[i] ?? null);
  const meRole = session.myRole();
  // ホストの操作（Q12=B：プレイヤーの入れ替え・キックは待合だけ。対局中にキックできるのは観戦者だけ）
  const hostOps = (m: Member, spectator: boolean) =>
    isHost && m.id !== session.myId ? (
      <span className="ol-seat-ops">
        {!s.started && (
          <button type="button" className="choice-btn" disabled={spectator && players.length >= MAX_SEATS} onClick={() => session.setRole(m.id, spectator ? 'player' : 'spectator')}>
            {t(spectator ? 'olToPlayer' : 'olToSpectator')}
          </button>
        )}
        {(!s.started || spectator) && (
          <button type="button" className="choice-btn" onClick={() => session.kick(m.id)}>
            {t('olKick')}
          </button>
        )}
      </span>
    ) : null;
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
              {m && hostOps(m, false)}
              {/* プレイヤーは自分から観戦に回れる（待合だけ・ホストは除く） */}
              {m && m.id === session.myId && !isHost && !s.started && (
                <span className="ol-seat-ops">
                  <button type="button" className="choice-btn" onClick={() => session.becomeSpectator()}>
                    {t('olBecomeSpectator')}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        {/* 観戦者（名前を出す）。ホストは観戦を許す・断るをいつでも切り替えられる（断ると見ている人にも出てもらう＝Q11=B） */}
        <h4 className="ol-watch-head">{t('olSpectators')}</h4>
        <ul className="ol-seats ol-watchers-list">
          {watchers.length === 0 ? (
            <li className="cpu">
              <span className="ol-seat-name">{t('olNoSpectatorsYet')}</span>
            </li>
          ) : (
            watchers.map((m) => (
              <li key={m.id}>
                <span className="ol-seat-name">{m.name}</span>
                <span className="ol-seat-tags">{m.id === session.myId && <span className="ol-tag you">{t('you')}</span>}</span>
                {hostOps(m, true)}
              </li>
            ))
          )}
        </ul>
        {meRole === 'spectator' && <p className="guide">{t('olYouWatch')}</p>}
        <label className="ol-check">
          <input type="checkbox" checked={s.allowSpectators} disabled={!isHost} onChange={(e) => session.setAllowSpectators(e.target.checked)} />
          <span>{t('olAllowSpectators')}</span>
        </label>
        <p className="guide">{t('olAllowSpectatorsDesc')}</p>
        <ReplyWaitPicker t={t} session={session} value={s.replyWait} isHost={isHost} started={s.started} />
        <p className="guide">{t('olReplyWaitDesc')}</p>
        <TimeLimitPicker t={t} session={session} value={s.timeLimit} isHost={isHost} started={s.started} />
        <p className="guide">{t('olTimeLimitDesc')}</p>
        {/* 空き席の CPU の強さ：ホストだけ選べる（端末に覚える＝CPU と対局と同じ控え）。4 人そろっていても見せる */}
        <StrengthPicker
          t={t}
          value={s.strength}
          readOnly={!isHost || s.started}
          onChange={(v) => {
            saveStrength(v);
            session.setStrength(v);
          }}
        />
        {s.started ? (
          <p className="guide ol-started">{t('olStartedNote')}</p>
        ) : (
          <p className="guide">{t(isHost ? 'olHostHint' : 'olWaitHost')}</p>
        )}
      </section>
      {/* ルール：ホストは始める前だけ選べる（端末に覚える＝CPU と対局と同じ控え）。ゲストと始まったあとは見るだけ */}
      <p className="guide ol-rule-host">{t('olRuleHost')}</p>
      <RuleSettings
        t={t}
        lang={lang}
        choice={s.rules}
        readOnly={!isHost || s.started}
        share={isHost && !s.started}
        cnOk
        onChange={(c) => {
          saveRuleChoice(c);
          session.setRules(c);
        }}
      />
      {/* 始める前も話せる（待合と卓で同じ記録） */}
      <div className="ol-panel ol-chat">
        <Chat t={t} you={t('you')} online={{ lines: s.chat, myId: session.myId, onSend: (x) => session.sendChat(x), readOnly: !session.canChat() }} />
      </div>
    </>
  );
}
