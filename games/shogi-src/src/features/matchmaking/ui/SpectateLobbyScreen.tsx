/**
 * S13 観戦ロビー（★v1.55 新設・意味論＝親 v1.55 §6.8・
 * 画面の要件＝画面機能 v0.49 §3 S13・絵柄＝付録D-6 v1.2 §12）。
 *
 * **観戦の入り口**。モード選択の「ネット観戦」からここへ入り、観戦できる部屋を選ぶ。
 *
 * ## なぜ独立した画面にしたか
 *
 * **部屋は用途で入り口を切り分ける**（親 §9.4.4 と同じ考え方）＝対局の部屋には
 * ネット対戦の一覧（S04）から、感想戦の部屋には感想戦ロビー（S12）から、
 * 観戦にはここから入る。**S12 を新設したときとまったく同じ理由**で、
 * 1 つの一覧に相乗りさせると、**そこから入った人がどの立場で入ったのかを
 * 画面が言えなくなる**。
 *
 * ## 骨格
 *
 * **S04／S12 と同じ骨格**（同じ形のものを違う見た目にしない）。ただし
 * **観戦者は部屋を建てない**ので箱は 2 つだけ（接続／観戦する部屋）。
 * **空けた場所を埋めるために何かを足さない。**
 *
 * ## ★棋譜の確認をここで出す理由
 *
 * 観戦に入ると**盤は作り直される**（配られた対局を組み立て直すため）ので、
 * 未保存の棋譜があれば尋ねなければならない。**尋ねるのは部屋へ入る前**
 * （親 §9.2.3 ②＝**確認の手前で、やめても取り消せない操作をしない**）。
 * 部屋へ入ってから尋ねると、**やめても部屋には入ったあと**になってしまう。
 */

import { useEffect, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { requestNewGame } from '../../../core/store/kifu-guard';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { getMomoMatchmaking, type MomoRoomInfo } from '../client';
import { isRoomSpectatorsFull, isSpectatable } from '../roster';
import { useMatchmakingStore } from '../store';
import { ensureMatchmakingInit } from '../bootstrap';
import { decodeRoomName } from '../roomNameCodec';
import { lastPlayerName } from '../reviewRoom';
import { RoomBadges } from './RoomBadges';
import { seButton } from '../../../core/audio/se-synth';

/** localStorage キー：前回のプレイヤー名（S04／S12 と同じ 1 つの名前を使い回す）。 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';

/** 一覧を取り直す間隔（S04／S12 と同じ）。 */
const ROOM_LIST_REFRESH_MS = 10_000;

/**
 * 一覧のバッジに出す「その部屋の段」（親 §6.8.2）。
 *
 * **サーバーが持っている段をそのまま出す**＝ホストが `game_state_update` で
 * 知らせたもの（`features/matchmaking/roomState.ts`）。**席の数から推し量らない**
 * ＝席が 2 つ埋まっていても、先後を決めている最中なら「対局中」ではない。
 *
 * **席の数で補わない**＝補うと、**本当に対局前の部屋**（席が 2 つ埋まって先後を
 * 決めている最中）まで「対局中」と書いてしまう。**サーバーの段が唯一の材料**とし、
 * 知らせてこない相手の部屋は素直に「対局前」と出す（**当てにいかない**）。
 */
function roomPhaseLabel(room: MomoRoomInfo, t: (k: string) => string): string {
  if (room.gameState === 'playing') return t('s13.badgePlaying');
  if (room.gameState === 'ended') return t('s13.badgeEnded');
  return t('s13.badgeWaiting');
}

export function SpectateLobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);

  /** 非公開まわり（S04／S12 とまったく同じ流儀）。 */
  const [showPrivate, setShowPrivate] = useState(false);
  const [privatePw, setPrivatePw] = useState('');
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  const privatePwRef = useRef<HTMLInputElement | null>(null);
  const joinPwRef = useRef<HTMLInputElement | null>(null);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  useEffect(() => {
    if (!useMatchmakingStore.getState().playerName) {
      const saved = lastPlayerName();
      if (saved) setPlayerName(saved);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 一覧の取り直し（S04／S12 と同じ流儀）。部屋に入っている間は触らない。
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

  // Chrome の autofill 対策（S04／S12 と同じ）。
  useEffect(() => {
    const clearPw = () => {
      if (privatePwRef.current) privatePwRef.current.value = '';
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
  const inRoom = connection === 'in_room' || connection === 'game_connected';

  /**
   * 観戦できる部屋を並べる（親 §6.8.2）。
   * - **観戦を許していない部屋は出さない**（観戦枠 0）。
   * - **満員でも出す**＝押せないことと理由を見せるため（画面機能 §3 S13）。
   * - **非公開は「表示」を入れるまで出さない**（S04 とまったく同じ扱い）。
   * - **感想戦の部屋も並べる**（親 §6.8.6）＝印が付くので取り違えない。
   */
  const watchable = rooms
    .filter((r) => isSpectatable(r))
    .filter((r) => showPrivate || r.isPublic)
    .map((r) => ({ room: r, parts: decodeRoomName(r.name) }));

  const onPlayerNameChange = (name: string) => {
    setPlayerName(name);
    try {
      if (name.trim()) localStorage.setItem(LS_LAST_PLAYER_NAME, name);
    } catch {
      // localStorage が使えない環境は無視
    }
  };

  /**
   * 観戦する。**部屋へ入る前に棋譜の確認を通す**（上記・親 §9.2.3 ②）。
   * パスワードの扱いは S04／S12 と同じ。
   */
  const watchRoom = (roomId: string, needsPassword: boolean, autoPassword?: string) => {
    seButton();
    const client = getMomoMatchmaking();
    if (!client) return;
    const who = (playerName.trim() || lastPlayerName()).trim();
    const enter = (password: string) => {
      requestNewGame(() => {
        // ★v1.55: **役を渡して入る**＝渡さないと席に着いてしまう（親 §6.8）。
        client.joinRoom(roomId, password, who, 'spectator');
        setJoinRoomId(null);
        setJoinPassword('');
      });
    };
    if (needsPassword && autoPassword !== undefined && autoPassword !== '') {
      enter(autoPassword);
      return;
    }
    if (needsPassword && joinRoomId !== roomId) {
      setJoinRoomId(roomId);
      setJoinPassword('');
      return;
    }
    enter(needsPassword ? joinPassword : '');
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
          <h2>{t('s13.head')}</h2>
          <p className="lead">{t('s13.lead')}</p>
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

        {/* ── 箱 ②: 観戦する部屋（S04 のカード B と同じ骨格） ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s13.roomsHead')}</div>

          <div
            style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
            }}
          >
            {!connected && !inRoom ? (
              <div className="spec-empty">{t('s13.roomsOffline')}</div>
            ) : watchable.length === 0 ? (
              <div className="spec-empty">{t('s13.roomsEmpty')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {watchable.map(({ room, parts }) => {
                  const autoPw = !room.isPublic ? privatePw : undefined;
                  const full = isRoomSpectatorsFull(room);
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
                        opacity: full ? 0.55 : 1,
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
                          {/* ★v1.55: その部屋の段（人待ち／対局中）と観戦の人数。 */}
                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--text-muted)',
                              border: '1px solid var(--border-strong)',
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                          >
                            {roomPhaseLabel(room, t)}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              color: full ? 'var(--text-muted)' : 'var(--ok)',
                              border: `1px solid ${full ? 'var(--border-strong)' : 'var(--ok)'}`,
                              padding: '1px 6px',
                              borderRadius: 10,
                            }}
                          >
                            {t('spec.role')} {room.spectatorCount ?? 0}/{room.maxSpectators ?? 0}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                          {t('s04.host')}: {room.hostName}
                          {room.hasPassword && `  ${t('s04.hasPassword')}`}
                        </div>
                        {/* ★満員の理由は色ではなく言葉で出す（付録D-3 §4.1）。 */}
                        {full && (
                          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                            {t('s13.specFull')}
                          </div>
                        )}
                      </div>
                      {joinRoomId === room.id &&
                      room.hasPassword &&
                      (autoPw === undefined || autoPw === '') ? (
                        <>
                          <input
                            ref={joinPwRef}
                            type="password"
                            name="shogi-watch-pw"
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
                            onClick={() => watchRoom(room.id, room.hasPassword)}
                          >
                            {t('s13.watch')}
                          </button>
                        </>
                      ) : (
                        <button
                          className="reset-btn"
                          type="button"
                          disabled={!connected || full}
                          onClick={() => watchRoom(room.id, room.hasPassword, autoPw)}
                        >
                          {t('s13.watch')}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 非公開の部屋を表示（S04／S12 とまったく同じ扱い） */}
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
      </div>
    </div>
  );
}
