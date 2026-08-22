/**
 * S12 感想戦ロビー（★v1.54 新設・★v1.55 全面改訂・意味論＝親 v1.49 §9.4.1・
 * 画面の要件＝画面機能 v0.43 §3 S12・絵柄＝付録D-12 v1.4 §13）。
 *
 * **感想戦の入り口**。モード選択の「感想戦」からここへ入り、
 * **ひとりで始める／部屋を作る／部屋に入る**の 3 つを選ぶ。
 *
 * **ここでは振り返る 1 局を決めない**＝記憶している 1 局があればそれで始まり、
 * 無ければ空のまま S11 へ入って中で読み込む（親 §9.4.1）。したがってこの画面は
 * **棋譜のことを何も知らない**でよく、必要なものは registry の口越しに聞く。
 *
 * **一覧に並べるのは感想戦の部屋だけ**（親 §9.4.4 の部屋の切り分け）。対局の部屋は
 * ネット対戦の一覧（S04）から入る。**互いに見えてよいが、違う用途の部屋へは入れない**
 * ＝入れてしまうと、対局の相手を待っている人のところへ感想戦の客が来る。
 *
 * ★**v1.55: 骨格をネット対戦のロビー（S04）とまったく同じにした**（付録D-12 v1.4 §13・
 * 2026-08-19 ユーザーご指示）＝**箱を 4 つ縦に並べる**（接続／部屋に入る／部屋を作る／
 * ひとりで始める）。**v1.54 の「部屋を作る」パネルは廃止**し、中身を箱へ直接置く
 * ＝**押してからパネルが出る形は S04 と揃わず、同じことを 2 通りの見せ方で行うことに
 * なる**。**画面名バッジ（オレンジ枠の「感想戦」）も廃止**＝**枠で囲うとボタンに見える**
 * （ご指摘）。**戻るはタイトルブロックの右**（他の画面と同じ位置）。
 * **パスワードと非公開も S04 とまったく同じ扱いで効かせる**（親 §9.4.4）。
 */

import { useEffect, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { get as pluginGet } from '../../../core/plugin/registry';
import type { ReviewRoomInfo, ReviewRoomRequest } from '../../../core/plugin/reviewRoom';
import { getMomoMatchmaking } from '../client';
import { isRoomPlayersFull, joinSeatedRoom } from '../roster';
import { useMatchmakingStore } from '../store';
import { ensureMatchmakingInit } from '../bootstrap';
import { decodeRoomName } from '../roomNameCodec';
import { createReviewRoom, lastPlayerName } from '../reviewRoom';
import { RoomBadges } from './RoomBadges';
import { seButton } from '../../../core/audio/se-synth';

/** localStorage キー：前回のプレイヤー名（S04 と同じ 1 つの名前を使い回す）。 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';

/** 一覧を取り直す間隔（S04 と同じ・待つための画面なので回数を抑える）。 */
const ROOM_LIST_REFRESH_MS = 10_000;

export function ReviewLobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);

  /** 箱 ③「部屋を作る」の入力。**画面に直接置く**（v1.54 のパネルは廃止）。 */
  const [roomName, setRoomName] = useState('');
  const [createPw, setCreatePw] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  /**
   * ★v1.55: 観戦を許すか（親 §6.8.2／§6.8.6・付録D-6 v1.2 §4）。**既定は「許す」**。
   * **この画面の中だけで持つ**＝**端末に覚えさせない**ことを仕組みで保証するため
   * （S04 と同じ理由。数え上げて戻す形にすると入口が増えたとき必ず 1 つ漏れる）。
   */
  const [allowSpectators, setAllowSpectators] = useState(true);

  /** 箱 ②「部屋に入る」の非公開まわり（S04 と同じ流儀）。 */
  const [showPrivate, setShowPrivate] = useState(false);
  const [privatePw, setPrivatePw] = useState('');
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  const [notice, setNotice] = useState<string | null>(null);

  // Chrome の autofill 対策（S04 と同じ・自動で埋まったパスワードを空へ戻す）。
  const privatePwRef = useRef<HTMLInputElement | null>(null);
  const createPwRef = useRef<HTMLInputElement | null>(null);
  const joinPwRef = useRef<HTMLInputElement | null>(null);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  // 既定を入れて出す（付録D-12 §13）＝**そのまま押せる**ようにしておく。
  // 部屋名は**棋譜のルール名＋「の感想戦」**、名前は**前に使ったもの**。
  useEffect(() => {
    const info = pluginGet<(l: LocaleCode) => ReviewRoomInfo>('review:roomInfo')?.(locale);
    setRoomName(info?.ruleName ? `${info.ruleName}${t('s11.roomSuffix')}` : t('s11.title'));
    if (!useMatchmakingStore.getState().playerName) {
      const saved = lastPlayerName();
      if (saved) setPlayerName(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 一覧の取り直し（S04 と同じ流儀）。部屋に入っている間は触らない。
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      if (useMatchmakingStore.getState().currentRoomId) return;
      getMomoMatchmaking()?.refreshRooms();
    };
    refresh();
    const timer = window.setInterval(refresh, ROOM_LIST_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    const clearPw = () => {
      if (privatePwRef.current) privatePwRef.current.value = '';
      if (createPwRef.current) createPwRef.current.value = '';
      if (joinPwRef.current) joinPwRef.current.value = '';
    };
    clearPw();
    const t1 = setTimeout(clearPw, 0);
    const t2 = setTimeout(clearPw, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const connected = connection === 'connected';
  /** 既に部屋に居るなら建てられない（理由を言葉で出す）。 */
  const inRoom = connection === 'in_room' || connection === 'game_connected';

  /**
   * 感想戦の部屋だけを並べる（親 §9.4.4）。
   * **非公開は「表示」を入れるまで出さない**（S04 と同じ扱い＝v1.55）。
   */
  const reviewRooms = rooms
    .map((r) => ({ room: r, parts: decodeRoomName(r.name) }))
    .filter((x) => x.parts.review)
    .filter((x) => showPrivate || x.room.isPublic);

  const onPlayerNameChange = (name: string) => {
    setPlayerName(name);
    try {
      if (name.trim()) localStorage.setItem(LS_LAST_PLAYER_NAME, name);
    } catch {
      // localStorage が使えない環境は無視
    }
  };

  /** ひとりで始める。**部屋を作らない**＝誰も居ない部屋を一覧に並べないため。 */
  const startSolo = () => {
    seButton();
    pluginGet<() => void>('review:startSolo')?.();
  };

  /**
   * 部屋を作る。**棋譜の確認は出ない**＝感想戦は記憶に触らないので、**破棄の契機では
   * ない**（親 §9.4.3・§9.2.3 ②）。対局の部屋（S04）が確認を通すのは、その先で必ず
   * 盤が作り直されるからで、こちらにはその先が無い。
   *
   * **もしここに確認の要る操作を足すことになったら、部屋を建てる前に出すこと**
   * （親 §9.2.3 ②＝**確認の手前で、やめても取り消せない操作をしない**）。
   */
  const makeRoom = () => {
    seButton();
    const info = pluginGet<(l: LocaleCode) => ReviewRoomInfo>('review:roomInfo')?.(locale);
    const req: ReviewRoomRequest = {
      gameType: info?.gameType ?? 'shogi',
      torus: info?.torus ?? false,
      quantum: info?.quantum ?? false,
      customRuleName: info?.customRuleName,
      roomName: roomName.trim(),
      playerName: (playerName.trim() || lastPlayerName()).trim(),
      password: createPw,
      isPublic,
      allowSpectators,
    };
    if (!createReviewRoom(req)) {
      setNotice(t('s11.roomFailed'));
      return;
    }
    // **建てた人は相手を待たずにそのまま入る**（親 §9.4.1）。
    pluginGet<() => void>('review:roomCreated')?.();
  };

  /**
   * 感想戦の部屋へ入る。**待機画面 (S05) は通らない**（決めることが無い）。
   * パスワードの扱いは S04 と同じ＝非公開一覧のパスワードがあればそれを使い、
   * 無ければその行に入力欄を出す。
   */
  const joinRoom = (roomId: string, needsPassword: boolean, autoPassword?: string) => {
    seButton();
    const client = getMomoMatchmaking();
    if (!client) return;
    const who = (playerName.trim() || lastPlayerName()).trim();
    if (needsPassword && autoPassword !== undefined && autoPassword !== '') {
      joinSeatedRoom(client, { roomId, password: autoPassword, name: who, isPublic: false });
      setJoinRoomId(null);
      setJoinPassword('');
      return;
    }
    if (needsPassword && joinRoomId !== roomId) {
      setJoinRoomId(roomId);
      setJoinPassword('');
      return;
    }
    joinSeatedRoom(client, {
      roomId,
      password: needsPassword ? joinPassword : '',
      name: who,
      isPublic: rooms.find((r) => r.id === roomId)?.isPublic !== false,
    });
    setJoinRoomId(null);
    setJoinPassword('');
  };

  const inputStyle = {
    flex: 1,
    background: 'var(--surface2)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text)',
    padding: '5px 10px',
    borderRadius: 6,
    fontSize: 13,
  } as const;

  return (
    <div className="stage">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <header className="match-header">
          <CatIcon />
          <div className="title-block">
            <h1>
              <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
              <span className="ver">{t('app.ver')}</span>
            </h1>
            <div className={`subtitle${subLocale === 'zh' ? ' zh' : ''}`}>{subtitle}</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            {/* ★v1.55: 戻るはタイトルブロックの右（S04 と同じ位置・付録D-12 §13）。
                v1.54 のヘッダ直下のツールバー帯と画面名バッジは廃止した。 */}
            <button
              className="reset-btn"
              type="button"
              onClick={() => {
                seButton();
                setScreen('lobby');
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('s00.modeSelect')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        <div className="screen-head">
          <h2>{t('s12.head')}</h2>
          <p className="lead">{t('s12.lead')}</p>
        </div>

        {/* ── 箱 ①: 接続 + プレイヤー名（S04 のカード A と同一） ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardConn')}</div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('s04.connLabel')}:{' '}
              <span style={{ color: connected || inRoom ? 'var(--orange-light)' : 'var(--text-muted)' }}>
                {connected || inRoom ? t('s00.connected') : t('s00.connecting')}
              </span>
            </div>
            <button
              className="reset-btn"
              type="button"
              onClick={() => getMomoMatchmaking()?.refreshRooms()}
              disabled={!connected}
            >
              {t('s04.refresh')}
            </button>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.playerNameLbl')}</span>
            <input
              type="text"
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              placeholder={t('s04.playerNamePh')}
              maxLength={20}
              style={inputStyle}
            />
          </label>
        </div>

        {/* ── 箱 ②: 部屋に入る（S04 のカード B と同一・並ぶのは感想戦の部屋だけ） ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardJoin')}</div>

          <div
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
            }}
          >
            {!connected && !inRoom ? (
              <div className="spec-empty">{t('s12.roomsOffline')}</div>
            ) : reviewRooms.length === 0 ? (
              <div className="spec-empty">{t('s12.roomsEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {reviewRooms.map(({ room, parts }) => {
                  const autoPw = !room.isPublic ? privatePw : undefined;
                  return (
                    <div
                      key={room.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '8px 12px',
                        background: 'var(--surface2)',
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <RoomBadges parts={parts} locale={locale} />
                          <span style={{ color: 'var(--text)' }}>
                            {parts.userRoomName || `(${t('s04.roomNamePh')})`}
                          </span>
                          {!room.isPublic && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--orange-light)',
                                border: '1px solid var(--orange)',
                                padding: '1px 6px',
                                borderRadius: 10,
                              }}
                            >
                              {t('s04.privateFlag')}
                            </span>
                          )}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                          {t('s04.host')}: {room.hostName}
                          {room.hasPassword && `  ${t('s04.hasPassword')}`}
                          {isRoomPlayersFull(room) && `  ${t('s04.inGame')}`}
                        </div>
                      </div>
                      {joinRoomId === room.id &&
                      room.hasPassword &&
                      (autoPw === undefined || autoPw === '') ? (
                        <>
                          <input
                            ref={joinPwRef}
                            type="password"
                            name="shogi-join-pw"
                            autoComplete="new-password"
                            value={joinPassword}
                            onChange={(e) => setJoinPassword(e.target.value)}
                            placeholder={t('s04.passwordPh2')}
                            style={{
                              background: 'var(--bg)',
                              border: '1px solid var(--border-strong)',
                              color: 'var(--text)',
                              padding: '4px 8px',
                              borderRadius: 6,
                              fontSize: 12,
                              width: 120,
                            }}
                          />
                          <button
                            className="reset-btn"
                            type="button"
                            onClick={() => joinRoom(room.id, room.hasPassword)}
                          >
                            {t('s04.enterRoom')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="reset-btn"
                          type="button"
                          disabled={!connected || isRoomPlayersFull(room)}
                          onClick={() => joinRoom(room.id, room.hasPassword, autoPw)}
                        >
                          {t('s04.enterRoom')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 非公開の部屋を表示（S04 と同じ・パスワードは入室時に自動で使う） */}
          <div className="private-panel">
            <div className="pp-title">{t('s04.privateTitle')}</div>
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="pp-row">
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('s04.privatePwLabel')}
                </label>
                <input
                  ref={privatePwRef}
                  type="password"
                  name="shogi-priv-pw"
                  autoComplete="new-password"
                  value={privatePw}
                  onChange={(e) => setPrivatePw(e.target.value)}
                />
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => setShowPrivate((v) => !v)}
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {showPrivate ? t('s04.privateBtnHide') : t('s04.privateBtnShow')}
                </button>
              </div>
            </form>
            <div className="pp-note">{t('s04.privateNote')}</div>
          </div>
        </div>

        {/* ── 箱 ③: 部屋を作る（S04 のカード C と同一。**ルールと持ち時間は無い**
               ＝ルールは棋譜が持ち、感想戦に時計が無いため） ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardCreate')}</div>
          <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.roomName')}</span>
                <input
                  type="text"
                  name="shogi-review-room-label"
                  autoComplete="off"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  placeholder={t('s04.roomNamePh')}
                  maxLength={30}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.password')}</span>
                <input
                  ref={createPwRef}
                  type="password"
                  name="shogi-review-room-key"
                  autoComplete="new-password"
                  value={createPw}
                  onChange={(e) => setCreatePw(e.target.value)}
                  placeholder={t('s04.passwordPh')}
                  style={inputStyle}
                />
              </label>
              <label className="check-private">
                <input
                  type="checkbox"
                  checked={!isPublic}
                  onChange={(e) => setIsPublic(!e.target.checked)}
                />
                <span style={{ color: 'var(--text)' }}>{t('s04.private')}</span>
              </label>
              {/* ★v1.55: 観戦を許す（S04 とまったく同じ扱い・親 §6.8.2／§6.8.6）。 */}
              <label className="check-private">
                <input
                  type="checkbox"
                  checked={allowSpectators}
                  onChange={(e) => setAllowSpectators(e.target.checked)}
                />
                <span style={{ color: 'var(--text)' }}>{t('s04.allowSpec')}</span>
              </label>
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: -4 }}>
                {t('s04.allowSpecNote')}
              </div>
            </div>
          </form>
          <button type="button" className="create-big-btn" onClick={makeRoom} disabled={!connected}>
            {t('s04.createRoom')}
          </button>
          {/* **灰色は「押せない」だけを意味する**ので、理由は色ではなく言葉で出す。 */}
          {!connected && (
            <div className="why">
              {inRoom ? t('s11.makeRoom.already-in-room') : t('s11.makeRoom.no-server')}
            </div>
          )}
        </div>

        {/* ── 箱 ④: ひとりで始める（S04 には無い箱）。**接続していなくても押せる**
               ＝通信を要しないので、押せなくすると何もできない画面になる。 ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s12.solo')}</div>
          <button type="button" className="create-big-btn" onClick={startSolo}>
            {t('s12.solo')}
          </button>
        </div>
      </div>

      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}
