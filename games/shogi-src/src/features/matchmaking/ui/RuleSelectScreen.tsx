import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import type { TimeControlMode } from '../store';
import { useMatchmakingStore } from '../store';

const TIME_MODES: { value: TimeControlMode; label: string; desc: string }[] = [
  { value: 'byoyomi', label: '秒読み', desc: '本時間 + 一手ごとに秒読み' },
  { value: 'sudden_death', label: '切れ負け', desc: '本時間のみ・切れたら負け' },
  { value: 'fischer', label: 'フィッシャー', desc: '本時間 + 一手ごとに加算' },
  { value: 'no_limit', label: '時間フリー', desc: '制限なし' },
];

export function RuleSelectScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const setError = useMatchmakingStore((s) => s.setError);
  const setActiveRoomConfig = useMatchmakingStore((s) => s.setActiveRoomConfig);
  const setCurrentRoom = useMatchmakingStore((s) => s.setCurrentRoom);
  const setOpponentName = useMatchmakingStore((s) => s.setOpponentName);

  const onBack = () => setScreen('net-lobby');

  const onStart = () => {
    if (!playerName.trim()) {
      setError('ロビー画面でプレイヤー名を入力してください');
      setScreen('net-lobby');
      return;
    }
    const client = getMomoMatchmaking();
    if (!client) return;
    setActiveRoomConfig({ ...config, roomName: config.roomName || '本将棋の部屋' });
    setCurrentRoom({ roomId: null, roomName: config.roomName || '本将棋の部屋', isHost: true });
    setOpponentName('');
    client.createRoom({
      hostName: playerName,
      name: config.roomName || '本将棋の部屋',
      password: config.password,
      isPublic: config.isPublic,
      rules: {
        game: 'honshogi',
        time: config.timeControl,
      },
    });
    setScreen('waiting');
  };

  return (
    <div className="stage">
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <header className="match-header">
          <CatIcon />
          <div className="title-block">
            <h1>
              <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
              <span className="ver">{t('app.ver')}</span>
            </h1>
            <div className="subtitle">部屋作成 - ルール選択</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            <button className="reset-btn" type="button" onClick={onBack}>
              ロビーへ戻る
            </button>
          </div>
        </header>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>部屋情報</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>部屋名</span>
              <input
                type="text"
                value={config.roomName}
                onChange={(e) => setConfig({ roomName: e.target.value })}
                placeholder="本将棋の部屋"
                maxLength={30}
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>パスワード</span>
              <input
                type="password"
                value={config.password}
                onChange={(e) => setConfig({ password: e.target.value })}
                placeholder="(任意)"
                style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 13 }}
              />
            </label>
            <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={config.isPublic} onChange={(e) => setConfig({ isPublic: e.target.checked })} />
              <span style={{ color: 'var(--text-muted)' }}>ロビー一覧に公開する</span>
            </label>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>ゲーム</span></div>
          <div style={{ fontSize: 13, color: 'var(--text)' }}>本将棋 (Phase 2 では本将棋固定)</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            トーラス将棋・量子将棋・自由ルールは後の Phase で追加予定
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>先後</span></div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            入室後の準備画面で両者がそれぞれ選択します
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>持ち時間</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {TIME_MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className="act"
                onClick={() => setConfig({ timeControl: { mode: m.value, mainSeconds: 600, byoyomiSeconds: m.value === 'byoyomi' ? 30 : undefined, incrementSeconds: m.value === 'fischer' ? 10 : undefined } })}
                style={config.timeControl.mode === m.value ? { borderColor: 'var(--orange)', color: 'var(--orange-light)', background: 'var(--bg-selected)' } : {}}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            現在の設定: {TIME_MODES.find((m) => m.value === config.timeControl.mode)?.desc}
            {config.timeControl.mode !== 'no_limit' && (
              <> (本時間 {Math.floor(config.timeControl.mainSeconds / 60)}分)</>
            )}
            {config.timeControl.mode === 'byoyomi' && (
              <> + 秒読み {config.timeControl.byoyomiSeconds}秒</>
            )}
            {config.timeControl.mode === 'fischer' && (
              <> + 加算 {config.timeControl.incrementSeconds}秒</>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            ※ 詳細な時間調整 UI は段階 2-8 で追加予定
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button className="act taunt" type="button" onClick={onStart} style={{ minWidth: 180 }}>
            対局準備 (部屋作成)
          </button>
        </div>
      </div>
    </div>
  );
}
