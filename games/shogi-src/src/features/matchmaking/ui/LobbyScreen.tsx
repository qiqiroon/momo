import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import { decodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { ensureMatchmakingInit } from '../bootstrap';

/** localStorage キー：前回のプレイヤー名 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';

export function LobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setError = useMatchmakingStore((s) => s.setError);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);

  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  // 前回のプレイヤー名を localStorage から復元
  useEffect(() => {
    if (playerName) return;
    try {
      const saved = localStorage.getItem(LS_LAST_PLAYER_NAME);
      if (saved) setPlayerName(saved);
    } catch {
      // localStorage 使えない環境は無視
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlayerNameChange = (name: string) => {
    setPlayerName(name);
    try {
      if (name.trim()) {
        localStorage.setItem(LS_LAST_PLAYER_NAME, name);
      }
    } catch {
      // localStorage 使えない環境は無視
    }
  };

  // v0.55: matchmaking 初期化は bootstrap 側に集約 (S00 メニューからも呼び出す)
  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  const onCreateNavigate = () => {
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
      return;
    }
    setError(null);
    setScreen('rule-select');
  };

  const onJoin = (roomId: string, needsPassword: boolean) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
      return;
    }
    // v0.50: サーバー未接続で押されたら黙って失敗させず、エラーを出す
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

  const connLabel: Record<string, string> = {
    disconnected: '未接続',
    connecting: '接続中…',
    connected: '接続済み（ロビー）',
    in_room: '部屋作成/入室完了',
    game_connected: '相手と接続完了',
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

        <div style={{ marginTop: 14 }}>
          <button
            className="act"
            type="button"
            onClick={onCreateNavigate}
            disabled={connection !== 'connected'}
            style={{ width: '100%' }}
          >
            部屋を作成する (ルール選択へ)
          </button>
        </div>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          ※ 接続後の対局遷移は 2-4 / 2-5 で実装予定
        </div>
      </div>
    </div>
  );
}
