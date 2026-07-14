import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore, type TimeControlMode } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import { decodeRoomName, encodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { ensureMatchmakingInit } from '../bootstrap';

/** localStorage キー：前回のプレイヤー名 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';
/** localStorage キー：前回の部屋名（パスワードは保存しない） */
const LS_LAST_ROOM_NAME = 'shogi.roomForm.lastRoomName';

// v0.36 仕様書 D5 §7 の候補（本時間・秒読み・加算の秒数）
const MAIN_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: '0（秒読みのみ）' },
  { value: 5 * 60, label: '5分' },
  { value: 15 * 60, label: '15分' },
  { value: 30 * 60, label: '30分' },
  { value: 60 * 60, label: '1時間' },
];
const BYO_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: '5秒' },
  { value: 10, label: '10秒' },
  { value: 30, label: '30秒' },
  { value: 60, label: '60秒' },
];

/** v0.57 S04 通信対戦ロビー。
 *  - 部屋一覧 (既存)
 *  - プレイヤー名入力 (既存)
 *  - v0.57 追加: 対局ルールサマリ + 「ルールを選択」ボタン (S02 へ)
 *  - v0.57 追加: 持ち時間モード + 秒数選択 (旧 S02 から移設)
 *  - v0.57 追加: 部屋名 / パスワード / 公開チェック (旧 S02 から移設)
 *  - v0.57 追加: 「部屋を作成」ボタン (旧 S02 の createRoom を移設)
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

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  // 前回のプレイヤー名 / 部屋名を localStorage から復元
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

  // v0.55: matchmaking 初期化は bootstrap 側に集約 (S00 メニューからも呼び出す)
  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  const onJoin = (roomId: string, needsPassword: boolean) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError('サーバーに繋がっていません。少しお待ちください。');
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
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    setScreen('lobby');
  };

  const onEditRule = () => setScreen('rule-select');

  // v0.57: 部屋作成ロジック (旧 S02 の onStart を S04 に移設)
  const onCreateRoom = () => {
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError('サーバーに繋がっていません。少しお待ちください。');
      return;
    }
    const client = getMomoMatchmaking();
    if (!client) return;
    setError(null);
    const userRoomName = config.roomName || '本将棋の部屋';
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

  // 持ち時間モード切替 (旧 S02 のロジック)
  const setTimeMode = (m: TimeControlMode) => {
    const cur = config.timeControl;
    setConfig({
      timeControl: {
        mode: m,
        mainSeconds: m === 'no_limit' ? 0 : cur.mainSeconds || 600,
        byoyomiSeconds: m === 'byoyomi' ? cur.byoyomiSeconds ?? 30 : undefined,
        incrementSeconds: m === 'fischer' ? cur.incrementSeconds ?? 10 : undefined,
      },
    });
  };

  const connLabel: Record<string, string> = {
    disconnected: '未接続',
    connecting: '接続中…',
    connected: '接続済み（ロビー）',
    in_room: '部屋作成/入室完了',
    game_connected: '相手と接続完了',
  };

  // ルールサマリ
  const ruleName =
    config.gameType === 'shogi' ? t('s02.ruleHongi.name')
    : config.gameType === 'hasami' ? t('s02.ruleHasami.name')
    : t('s02.ruleCustom.name');
  const modChips: string[] = [];
  if (config.torusMode === 'cylinder') modChips.push(t('s04.summaryTorusCyl'));
  else if (config.torusMode === 'full') modChips.push(t('s04.summaryTorusFull'));
  if (config.quantum) modChips.push(t('s04.summaryQuantum'));

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
            <button className="reset-btn" type="button" onClick={onBackToMenu}>
              メニューへ戻る
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        <ScreenBand code="S04" name="通信対戦ロビー" />

        <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              接続状態: <span style={{ color: connection === 'disconnected' || connection === 'connecting' ? 'var(--text-muted)' : 'var(--orange-light)' }}>{connLabel[connection]}</span>
            </div>
            <button className="reset-btn" type="button" onClick={onRefresh} disabled={connection === 'connecting' || connection === 'disconnected'}>
              一覧更新
            </button>
          </div>
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        {/* プレイヤー名 */}
        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>プレイヤー名</span>
            <input
              type="text"
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              placeholder="表示名を入力"
              maxLength={20}
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
            />
          </label>
        </div>

        {/* 部屋一覧 */}
        <div style={{ marginTop: 14 }}>
          <div className="panel-label">
            <span>部屋一覧</span>
          </div>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
            {rooms.length === 0 ? (
              <div className="spec-empty">部屋がありません（作成できます）</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rooms.map((r) => {
                  const parts = decodeRoomName(r.name);
                  return (
                  <div
                    key={r.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <RoomBadges parts={parts} locale={locale} />
                        <span style={{ color: 'var(--text)' }}>{parts.userRoomName || '(名前なし)'}</span>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                        ホスト: {r.hostName}
                        {r.hasPassword && '  鍵付き'}
                        {r.guestConnected && '  対戦中'}
                      </div>
                    </div>
                    {joinRoomId === r.id && r.hasPassword ? (
                      <>
                        <input
                          type="password"
                          value={joinPassword}
                          onChange={(e) => setJoinPassword(e.target.value)}
                          placeholder="パスワード"
                          style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontSize: 12, width: 120 }}
                        />
                        <button className="reset-btn" type="button" onClick={() => onJoin(r.id, r.hasPassword)}>
                          入室
                        </button>
                      </>
                    ) : (
                      <button className="reset-btn" type="button" onClick={() => onJoin(r.id, r.hasPassword)} disabled={connection !== 'connected' || r.guestConnected}>
                        入室
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── ここから下: 部屋作成セクション (v0.57 で S02 から移設) ── */}
        <div style={{ marginTop: 22, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>{t('s04.lblRule')}</span></div>

          {/* ルールサマリ + 選択ボタン */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
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
            </div>
            <button className="reset-btn" type="button" onClick={onEditRule}>
              {t('s04.btnEditRule')}
            </button>
          </div>
        </div>

        {/* 持ち時間 */}
        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>{t('s04.lblTime')}</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="act"
              onClick={() => setTimeMode('no_limit')}
              style={config.timeControl.mode === 'no_limit' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
            >
              {t('s04.timeFree')}
            </button>
            <button
              type="button"
              className="act"
              onClick={() => setTimeMode('byoyomi')}
              style={config.timeControl.mode === 'byoyomi' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
            >
              {t('s04.timeByoyomi')}
            </button>
            <button
              type="button"
              className="act"
              onClick={() => setTimeMode('fischer')}
              style={config.timeControl.mode === 'fischer' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
            >
              {t('s04.timeIncrement')}
            </button>
            <button
              type="button"
              className="act"
              onClick={() => setTimeMode('sudden_death')}
              style={config.timeControl.mode === 'sudden_death' ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
            >
              {t('s04.timeBoth')}
            </button>
          </div>

          {config.timeControl.mode !== 'no_limit' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{t('s04.mainSec')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {MAIN_OPTIONS.filter((o) => o.value > 0 || config.timeControl.mode === 'byoyomi').map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="act"
                    onClick={() => setConfig({ timeControl: { ...config.timeControl, mainSeconds: o.value } })}
                    style={config.timeControl.mainSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {config.timeControl.mode === 'byoyomi' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{t('s04.byoyomiSec')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {BYO_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="act"
                    onClick={() => setConfig({ timeControl: { ...config.timeControl, byoyomiSeconds: o.value } })}
                    style={config.timeControl.byoyomiSeconds === o.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {config.timeControl.mode === 'fischer' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>{t('s04.incrementSec')}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[0, ...BYO_OPTIONS.map((o) => o.value)].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="act"
                    onClick={() => setConfig({ timeControl: { ...config.timeControl, incrementSeconds: v } })}
                    style={config.timeControl.incrementSeconds === v ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                  >
                    {v === 0 ? '0秒' : `${v}秒`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 部屋情報 */}
        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
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
                  type="password"
                  name="shogi-room-key"
                  autoComplete="new-password"
                  value={config.password}
                  onChange={(e) => setConfig({ password: e.target.value })}
                  placeholder={t('s04.passwordPh')}
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
                />
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={config.isPublic} onChange={(e) => setConfig({ isPublic: e.target.checked })} />
                <span style={{ color: 'var(--text-muted)' }}>{t('s04.public')}</span>
              </label>
            </div>
          </form>
        </div>

        {/* 部屋を作成ボタン */}
        <div style={{ marginTop: 16 }}>
          <button
            className="act"
            type="button"
            onClick={onCreateRoom}
            disabled={connection !== 'connected'}
            style={{ width: '100%' }}
          >
            {t('s04.createRoom')}
          </button>
        </div>
      </div>
    </div>
  );
}
