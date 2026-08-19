/**
 * S12 感想戦ロビー（★v1.54 新設・意味論＝親 v1.48 §9.4.1・画面の要件＝画面機能 v0.42
 * §3 S12・絵柄＝付録D-12 v1.3 §13）。
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
 * **骨格はネット対戦のロビー（S04・付録D-6）に揃える**＝同じ形のものを違う見た目に
 * しない。
 */

import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { FloatingPanel } from '../../../core/ui-core/FloatingPanel';
import { get as pluginGet } from '../../../core/plugin/registry';
import type { ReviewRoomInfo, ReviewRoomRequest } from '../../../core/plugin/reviewRoom';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';
import { ensureMatchmakingInit } from '../bootstrap';
import { decodeRoomName } from '../roomNameCodec';
import { createReviewRoom, lastPlayerName } from '../reviewRoom';
import { RoomBadges } from './RoomBadges';
import { seButton } from '../../../core/audio/se-synth';

/** 一覧を取り直す間隔（S04 と同じ・待つための画面なので回数を抑える）。 */
const ROOM_LIST_REFRESH_MS = 10_000;

export function ReviewLobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const playerName = useMatchmakingStore((s) => s.playerName);

  /**
   * 部屋名と表示名を決めるパネル（付録D-12 §13）。null＝出していない。
   * **既定を入れて出す**＝多くの人はそのまま押すので、決めさせるために止めない。
   */
  const [form, setForm] = useState<{ room: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  // 一覧の取り直し（S04 と同じ流儀）。つながっていない間は何もしない。
  useEffect(() => {
    const refresh = () => getMomoMatchmaking()?.refreshRooms();
    refresh();
    const timer = window.setInterval(refresh, ROOM_LIST_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const connected = connection === 'connected';
  /** 既に部屋に居るなら建てられない（理由を言葉で出す）。 */
  const inRoom = connection === 'in_room' || connection === 'game_connected';

  /** 感想戦の部屋だけを並べる（親 §9.4.4）。対局の部屋はここに出さない。 */
  const reviewRooms = rooms
    .map((r) => ({ room: r, parts: decodeRoomName(r.name) }))
    .filter((x) => x.parts.review);

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
   * （親 §9.2.3 ②＝**確認の手前で、やめても取り消せない操作をしない**。v1.51 で対局の
   * ロビーが「建ててから尋ねる」形になっていて、やめると誰も居ない部屋が残った）。
   */
  const openForm = () => {
    seButton();
    const info = pluginGet<(l: LocaleCode) => ReviewRoomInfo>('review:roomInfo')?.(locale);
    setForm({
      room: info?.ruleName ? `${info.ruleName}${t('s11.roomSuffix')}` : t('s11.title'),
      name: lastPlayerName(),
    });
  };

  const makeRoom = (roomName: string, name: string) => {
    const info = pluginGet<(l: LocaleCode) => ReviewRoomInfo>('review:roomInfo')?.(locale);
    const req: ReviewRoomRequest = {
      gameType: info?.gameType ?? 'shogi',
      torus: info?.torus ?? false,
      quantum: info?.quantum ?? false,
      customRuleName: info?.customRuleName,
      roomName,
      playerName: name,
    };
    setForm(null);
    if (!createReviewRoom(req)) {
      setNotice(t('s11.roomFailed'));
      return;
    }
    // **建てた人は相手を待たずにそのまま入る**（親 §9.4.1）。
    pluginGet<() => void>('review:roomCreated')?.();
  };

  /** 感想戦の部屋へ入る。**待機画面 (S05) は通らない**（決めることが無い）。 */
  const joinRoom = (roomId: string) => {
    seButton();
    const client = getMomoMatchmaking();
    if (!client) return;
    const who = playerName.trim() || lastPlayerName();
    client.joinRoom(roomId, '', who);
  };

  return (
    <div className="stage" style={{ maxWidth: 720 }}>
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
          <HeaderCommonRight />
        </div>
      </header>

      <div className={`status-bar ${connected || inRoom ? 'connected' : 'connecting'}`}>
        <span className="st-dot" />
        <span>{connected || inRoom ? t('s00.connected') : t('s00.connecting')}</span>
      </div>

      <div className="s08-toolbar">
        <button
          type="button"
          className="back-btn"
          onClick={() => {
            seButton();
            setScreen('lobby');
          }}
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
        <span className="screen-badge">{t('s11.title')}</span>
      </div>

      <div className="screen-head">
        <h2>{t('s12.head')}</h2>
        <p className="lead">{t('s12.lead')}</p>
      </div>

      {/* 上段の 2 つの導線（付録D-12 §13）。**ひとりで始めるは接続していなくても押せる**
          ＝通信を要しないので、押せなくすると何もできない画面になる。 */}
      <div className="review-lobby-actions">
        <button type="button" className="btn primary" onClick={startSolo}>
          {t('s12.solo')}
        </button>
        <span className="make-room">
          <button
            type="button"
            className="io-btn"
            disabled={!connected}
            onClick={openForm}
          >
            {t('s11.makeRoom')}
          </button>
          {/* **灰色は「押せない」だけを意味する**ので、理由は色ではなく言葉で出す。 */}
          {!connected && (
            <span className="why">
              {inRoom ? t('s11.makeRoom.already-in-room') : t('s11.makeRoom.no-server')}
            </span>
          )}
        </span>
      </div>

      <div className="review-room-list">
        <h3>{t('s12.roomsHead')}</h3>
        {!connected && !inRoom ? (
          <p className="empty">{t('s12.roomsOffline')}</p>
        ) : reviewRooms.length === 0 ? (
          <p className="empty">{t('s12.roomsEmpty')}</p>
        ) : (
          reviewRooms.map(({ room, parts }) => (
            <div key={room.id} className="review-room-row">
              <div className="who">
                <div className="line">
                  <RoomBadges parts={parts} locale={locale} />
                  <span className="name">
                    {parts.userRoomName || `(${t('s04.roomNamePh')})`}
                  </span>
                </div>
                <div className="sub">
                  {t('s04.host')}: {room.hostName}
                  {room.guestConnected && `  ${t('s04.inGame')}`}
                </div>
              </div>
              <button
                type="button"
                className="reset-btn"
                disabled={!connected || room.guestConnected}
                onClick={() => joinRoom(room.id)}
              >
                {t('s04.enterRoom')}
              </button>
            </div>
          ))
        )}
      </div>

      {notice && <div className="toast">{notice}</div>}

      {/* 部屋名と表示名を決めてから建てる（付録D-12 §13・S11 から移設）。 */}
      {form && (
        <FloatingPanel
          className="floating-result floating-confirm review"
          title={<>{t('s11.makeRoom')}</>}
        >
          <div className="body">
            <label className="room-field">
              <span>{t('s04.roomName')}</span>
              <input
                type="text"
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })}
              />
            </label>
            <label className="room-field">
              <span>{t('s04.playerNameLbl')}</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost outline"
              onClick={() => {
                seButton();
                setForm(null);
              }}
            >
              {/* ★v1.54: v1.52 の S11 は `kifu.cancel` を出していたが**その言葉は存在せず**、
                  画面には鍵の名前がそのまま出ていた（公開版で確認）。既にある「やめる」を使う。 */}
              {t('kifu.guard.cancel')}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                seButton();
                makeRoom(form.room.trim(), form.name.trim());
              }}
            >
              {t('s04.createRoom')}
            </button>
          </div>
        </FloatingPanel>
      )}
    </div>
  );
}
