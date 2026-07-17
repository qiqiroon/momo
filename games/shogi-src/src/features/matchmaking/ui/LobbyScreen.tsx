import { useEffect, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';
import { decodeRoomName, encodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { ensureMatchmakingInit } from '../bootstrap';
import { formatTimeSummary } from './RuleSelectScreen';
import { seButton } from '../../../core/audio/se-synth';

/** localStorage キー：前回のプレイヤー名 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';
/** localStorage キー：前回の部屋名 (パスワードは保存しない) */
const LS_LAST_ROOM_NAME = 'shogi.roomForm.lastRoomName';

/** v0.58 S04 通信対戦ロビー。3 カード構成。
 *  - カード A: 接続状態 + プレイヤー名
 *  - カード B: 部屋に入る (公開部屋一覧 + 非公開部屋の表示切替)
 *  - カード C: 部屋を作る (ルールサマリ + 部屋名 + パスワード + 非公開 + 作成)
 *
 *  持ち時間設定は S02 に移動、S04 側はサマリ 1 行のみ。
 */
export function LobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setError = useMatchmakingStore((s) => s.setError);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);
  const setActiveRoomConfig = useMatchmakingStore((s) => s.setActiveRoomConfig);
  const setCurrentRoom = useMatchmakingStore((s) => s.setCurrentRoom);
  const setOpponentName = useMatchmakingStore((s) => s.setOpponentName);

  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  // v0.58: 非公開部屋の表示切替 + そのパスワード欄 (入室時に自動使用)
  const [showPrivate, setShowPrivate] = useState(false);
  const [privatePw, setPrivatePw] = useState('');
  // v0.58.1: Chrome の autofill でパスワード欄が勝手に埋まるのを防ぐため、
  // 直後 + 200ms 後にパスワード欄の DOM 値を強制クリア (gomoku-go 方式)
  const privatePwRef = useRef<HTMLInputElement | null>(null);
  const createPwRef = useRef<HTMLInputElement | null>(null);
  const joinPwRef = useRef<HTMLInputElement | null>(null);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  useEffect(() => {
    try {
      if (!playerName) {
        const saved = localStorage.getItem(LS_LAST_PLAYER_NAME);
        if (saved) setPlayerName(saved);
      }
      if (!config.roomName) {
        const savedRoom = localStorage.getItem(LS_LAST_ROOM_NAME);
        if (savedRoom) setConfig({ roomName: savedRoom });
      }
    } catch {
      // localStorage 使えない環境は無視
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlayerNameChange = (name: string) => {
    setPlayerName(name);
    try {
      if (name.trim()) localStorage.setItem(LS_LAST_PLAYER_NAME, name);
    } catch {
      // localStorage 使えない環境は無視
    }
  };

  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  // v0.58.1: Chrome の autofill 対策。autocomplete="new-password" を Chrome は無視するので、
  // マウント直後 + 少し遅延して 2 回、パスワード欄の DOM 値を強制的に空に戻す。
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

  const onJoin = (roomId: string, needsPassword: boolean, autoPassword?: string) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError(t('s04.errNoName'));
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError(t('s04.errNoServer'));
      return;
    }
    // 自動パスワード (非公開一覧のパスワード欄) が指定されていればそれを使う
    if (needsPassword && autoPassword !== undefined && autoPassword !== '') {
      client.joinRoom(roomId, autoPassword, playerName);
      setJoinRoomId(null);
      setJoinPassword('');
      return;
    }
    if (needsPassword && joinRoomId !== roomId) {
      setJoinRoomId(roomId);
      setJoinPassword('');
      return;
    }
    client.joinRoom(roomId, needsPassword ? joinPassword : '', playerName);
    setJoinRoomId(null);
    setJoinPassword('');
  };

  const onRefresh = () => {
    const client = getMomoMatchmaking();
    if (client) client.refreshRooms();
  };

  const onBackToMenu = () => {
    seButton(); // v0.76
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    setScreen('lobby');
  };

  // v0.69: S02 (ルール選択) から戻る際に S04 (net-lobby) に戻すよう指定
  const onEditRule = () => {
    useRouteStore.getState().setRuleSelectReturn('net-lobby');
    setScreen('rule-select');
  };

  const onCreateRoom = () => {
    seButton(); // v0.74
    if (!playerName.trim()) {
      setError(t('s04.errNoName'));
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError(t('s04.errNoServer'));
      return;
    }
    const client = getMomoMatchmaking();
    if (!client) return;
    setError(null);
    const userRoomName = config.roomName || t('s04.defaultRoomName');
    const encodedName = encodeRoomName({
      gameType: config.gameType,
      torus: config.torus,
      quantum: config.quantum,
      customRuleName: config.customRuleName,
      userRoomName,
    });
    try {
      localStorage.setItem(LS_LAST_ROOM_NAME, userRoomName);
    } catch {
      // localStorage 使えない環境は無視
    }
    setActiveRoomConfig({ ...config, roomName: encodedName });
    setCurrentRoom({ roomId: null, roomName: encodedName, isHost: true });
    setOpponentName('');
    client.createRoom({
      hostName: playerName,
      name: encodedName,
      password: config.password,
      isPublic: config.isPublic,
      rules: {
        game: config.gameType,
        torus: config.torus,
        quantum: config.quantum,
        customRuleName: config.customRuleName,
        time: config.timeControl,
      },
    });
    setScreen('room');
  };

  const connLabel: Record<string, string> = {
    disconnected: t('s04.connState.disconnected'),
    connecting: t('s04.connState.connecting'),
    connected: t('s04.connState.connected'),
    in_room: t('s04.connState.inRoom'),
    game_connected: t('s04.connState.gameConnected'),
  };

  const ruleName =
    config.gameType === 'shogi' ? t('s02.ruleHongi.name')
    : config.gameType === 'hasami' ? t('s02.ruleHasami.name')
    : t('s02.ruleCustom.name');
  const modChips: string[] = [];
  if (config.torusMode === 'cylinder') modChips.push(t('s04.summaryTorusCyl'));
  else if (config.torusMode === 'full') modChips.push(t('s04.summaryTorusFull'));
  if (config.quantum) modChips.push(t('s04.summaryQuantum'));
  const timeSummary = formatTimeSummary(config.timeControl, t);

  // v0.58.1: 部屋リストは 1 つに統合。「非公開を表示」トグルで非公開部屋が
  // 同じリストに増減する (パスワードの有無でリストが増える・減るだけ)。
  // 公開 + パスワード有りの部屋は最初から表示 (パスワードは入室時のゲート)。
  const publicRooms = rooms.filter((r) => r.isPublic);
  const privateRooms = rooms.filter((r) => !r.isPublic);
  const visibleRooms = showPrivate ? [...publicRooms, ...privateRooms] : publicRooms;

  const renderRoomRow = (r: typeof rooms[number]) => {
    const parts = decodeRoomName(r.name);
    // 非公開 (privateRooms) の入室にはパスワード欄の値を自動送信する
    const autoPw = !r.isPublic ? privatePw : undefined;
    return (
      <div
        key={r.id}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <RoomBadges parts={parts} locale={locale} />
            <span style={{ color: 'var(--text)' }}>{parts.userRoomName || `(${t('s04.roomNamePh')})`}</span>
            {!r.isPublic && <span style={{ fontSize: 10, color: 'var(--orange-light)', border: '1px solid var(--orange)', padding: '1px 6px', borderRadius: 10 }}>{t('s04.privateFlag')}</span>}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
            {t('s04.host')}: {r.hostName}
            {r.hasPassword && `  ${t('s04.hasPassword')}`}
            {r.guestConnected && `  ${t('s04.inGame')}`}
          </div>
        </div>
        {joinRoomId === r.id && r.hasPassword && (autoPw === undefined || autoPw === '') ? (
          <>
            <input
              ref={joinPwRef}
              type="password"
              name="shogi-join-pw"
              autoComplete="new-password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder={t('s04.passwordPh2')}
              style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontSize: 12, width: 120 }}
            />
            <button className="reset-btn" type="button" onClick={() => onJoin(r.id, r.hasPassword)}>
              {t('s04.enterRoom')}
            </button>
          </>
        ) : (
          <button
            className="reset-btn"
            type="button"
            onClick={() => onJoin(r.id, r.hasPassword, autoPw)}
            disabled={connection !== 'connected' || r.guestConnected}
          >
            {t('s04.enterRoom')}
          </button>
        )}
      </div>
    );
  };

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
            {/* v0.71: 家アイコン + 「モード選択」に統一 */}
            <button className="reset-btn" type="button" onClick={onBackToMenu} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('s00.modeSelect')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        {/* ── カード A: 接続 + プレイヤー名 ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardConn')}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('s04.connLabel')}:{' '}
              <span style={{ color: connection === 'disconnected' || connection === 'connecting' ? 'var(--text-muted)' : 'var(--orange-light)' }}>
                {connLabel[connection]}
              </span>
            </div>
            <button className="reset-btn" type="button" onClick={onRefresh} disabled={connection === 'connecting' || connection === 'disconnected'}>
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
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
            />
          </label>
        </div>

        {/* ── カード B: 部屋に入る (v0.58.1: 統合リスト。非公開切替でリストが増減) ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardJoin')}</div>

          {/* 部屋一覧 (公開・パスワード有りも含む。非公開表示 ON で非公開部屋が追加される) */}
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
            {visibleRooms.length === 0 ? (
              <div className="spec-empty">{t('s04.noRooms')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleRooms.map((r) => renderRoomRow(r))}
              </div>
            )}
          </div>

          {/* 非公開部屋を表示 (パスワードは入室時に自動送信) */}
          <div className="private-panel">
            <div className="pp-title">{t('s04.privateTitle')}</div>
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="pp-row">
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('s04.privatePwLabel')}</label>
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

        {/* ── カード C: 部屋を作る ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardCreate')}</div>

          {/* ルールサマリ + 選択ボタン */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 700 }}>{ruleName}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {t('s04.summaryMods')}:{' '}
                {modChips.length === 0 ? (
                  t('s04.summaryNone')
                ) : (
                  modChips.map((c, i) => (
                    <span key={i} className="mod-chip">{c}</span>
                  ))
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {t('s04.summaryTime')}: {timeSummary}
              </div>
            </div>
            <button className="reset-btn" type="button" onClick={onEditRule}>
              {t('s04.btnEditRule')}
            </button>
          </div>

          {/* 部屋情報 */}
          <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.roomName')}</span>
                <input
                  type="text"
                  name="shogi-room-label"
                  autoComplete="off"
                  value={config.roomName}
                  onChange={(e) => setConfig({ roomName: e.target.value })}
                  placeholder={t('s04.roomNamePh')}
                  maxLength={30}
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.password')}</span>
                <input
                  ref={createPwRef}
                  type="password"
                  name="shogi-room-key"
                  autoComplete="new-password"
                  value={config.password}
                  onChange={(e) => setConfig({ password: e.target.value })}
                  placeholder={t('s04.passwordPh')}
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
                />
              </label>
              {/* v0.58: 「公開」→「非公開」に反転 + オレンジのアクセント */}
              <label className="check-private">
                <input
                  type="checkbox"
                  checked={!config.isPublic}
                  onChange={(e) => setConfig({ isPublic: !e.target.checked })}
                />
                <span style={{ color: 'var(--text)' }}>{t('s04.private')}</span>
              </label>
            </div>
          </form>

          {/* 部屋を作成 (大オレンジボタン) */}
          <button
            type="button"
            className="create-big-btn"
            onClick={onCreateRoom}
            disabled={connection !== 'connected'}
          >
            {t('s04.createRoom')}
          </button>
        </div>
      </div>
    </div>
  );
}
