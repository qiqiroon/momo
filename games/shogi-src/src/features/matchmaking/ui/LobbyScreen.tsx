import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import { SHOGI_GAME_TYPE, SIGNALING_URL } from '../config';
import { useMatchmakingStore } from '../store';

export function LobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setConnection = useMatchmakingStore((s) => s.setConnection);
  const setRooms = useMatchmakingStore((s) => s.setRooms);
  const setError = useMatchmakingStore((s) => s.setError);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [password, setPassword] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

  useEffect(() => {
    const client = getMomoMatchmaking();
    if (!client) {
      setError('matchmaking module not available');
      return;
    }
    setConnection('connecting');
    setError(null);
    client.init({
      signalingUrl: SIGNALING_URL,
      gameType: SHOGI_GAME_TYPE,
      onRoomList: (list) => {
        setRooms(list);
      },
      onRoomCreated: () => {
        setConnection('in_room');
      },
      onJoinedRoom: () => {
        setConnection('in_room');
      },
      onGuestJoined: () => {
        setConnection('game_connected');
      },
      onConnected: () => {
        setConnection('game_connected');
      },
      onDisconnected: (reason) => {
        setConnection('disconnected');
        if (reason) setError(reason);
      },
      onError: (msg) => {
        setError(msg);
      },
    });
    // 接続 open 後に enter_lobby が送信されて onRoomList が呼ばれる。
    // 現時点で「連結中」を示すため、少し待って connected に更新するよう UI 側で扱う。
    const timer = setTimeout(() => {
      if (useMatchmakingStore.getState().connection === 'connecting') {
        setConnection('connected');
      }
    }, 1500);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = () => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
      return;
    }
    client.createRoom({
      hostName: playerName,
      name: roomName || '名無しの部屋',
      password: password,
      isPublic: isPublic,
      rules: { game: 'honshogi' },
    });
    setShowCreateForm(false);
  };

  const onJoin = (roomId: string, needsPassword: boolean) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError('プレイヤー名を入力してください');
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

  const onBackToLocal = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    setScreen('game');
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
            <div className="subtitle">オンライン対戦 ロビー</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            <button className="reset-btn" type="button" onClick={onBackToLocal}>
              ローカル対局へ戻る
            </button>
          </div>
        </header>

        <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
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
              onChange={(e) => setPlayerName(e.target.value)}
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
                {rooms.map((r) => (
                  <div
                    key={r.roomId}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--text)' }}>{r.name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        ホスト: {r.hostName}
                        {r.hasPassword && '  鍵付き'}
                      </div>
                    </div>
                    {joinRoomId === r.roomId && r.hasPassword ? (
                      <>
                        <input
                          type="password"
                          value={joinPassword}
                          onChange={(e) => setJoinPassword(e.target.value)}
                          placeholder="パスワード"
                          style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontSize: 12, width: 120 }}
                        />
                        <button className="reset-btn" type="button" onClick={() => onJoin(r.roomId, r.hasPassword)}>
                          入室
                        </button>
                      </>
                    ) : (
                      <button className="reset-btn" type="button" onClick={() => onJoin(r.roomId, r.hasPassword)} disabled={connection !== 'connected'}>
                        入室
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          {!showCreateForm ? (
            <button
              className="act"
              type="button"
              onClick={() => setShowCreateForm(true)}
              disabled={connection !== 'connected'}
              style={{ width: '100%' }}
            >
              部屋を作成する
            </button>
          ) : (
            <div style={{ padding: 14, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10 }}>
              <div className="panel-label">
                <span>部屋作成</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>部屋名</span>
                  <input
                    type="text"
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="名無しの部屋"
                    maxLength={30}
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
                  />
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>パスワード</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="(任意)"
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
                  />
                </label>
                <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                  <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                  <span style={{ color: 'var(--text-muted)' }}>ロビー一覧に公開する</span>
                </label>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                  <button className="reset-btn" type="button" onClick={() => setShowCreateForm(false)}>
                    キャンセル
                  </button>
                  <button className="act" type="button" onClick={onCreate}>
                    作成
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          ※ Phase 2-2 実装中: 接続確立後の対局遷移は 2-4/2-5 で実装予定
        </div>
      </div>
    </div>
  );
}
