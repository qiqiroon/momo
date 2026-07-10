import { useEffect } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';

/**
 * 段階 2-4.2: S05 待機画面（ホスト単独待ち専用）
 *
 * この画面はホストがゲスト到着を待つ間だけ表示される。ゲストは
 * 入室時点で直接 'room' 画面へ飛ぶ（LobbyScreen 側の onJoinedRoom）。
 *
 * 接続ドットの意味は「相手の名前を受信済み（= 同じ部屋に居る）」で
 * 両画面（ここと RoomScreen）で統一。この画面ではホストしか居ないので、
 * 自分カード=緑、相手カード=橙点滅「入室待ち…」となる。相手の名前が
 * 入ったら（ゲスト到着）'room' 画面へ自動遷移する。
 */
export function WaitingScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const playerName = useMatchmakingStore((s) => s.playerName);
  const opponentName = useMatchmakingStore((s) => s.opponentName);
  const currentRoomName = useMatchmakingStore((s) => s.currentRoomName);
  const activeRoomConfig = useMatchmakingStore((s) => s.activeRoomConfig);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const resetRoomState = useMatchmakingStore((s) => s.resetRoomState);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  // ゲスト到着（= 相手名受信）で room 画面へ
  useEffect(() => {
    if (opponentName) {
      setScreen('room');
    }
  }, [opponentName, setScreen]);

  const onLeave = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    resetRoomState();
    setScreen('net-lobby');
  };

  const timeLabel = (() => {
    if (!activeRoomConfig) return '';
    const tc = activeRoomConfig.timeControl;
    const min = Math.floor(tc.mainSeconds / 60);
    switch (tc.mode) {
      case 'byoyomi':
        return `秒読み ${min}分 + ${tc.byoyomiSeconds}秒`;
      case 'sudden_death':
        return `切れ負け ${min}分`;
      case 'fischer':
        return `フィッシャー ${min}分 + ${tc.incrementSeconds}秒`;
      case 'no_limit':
        return '時間フリー';
    }
  })();

  return (
    <div className="stage">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
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
        </header>

        <ScreenBand code="S05" name="ホスト待機" />

        <div style={{ marginTop: 10, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>部屋情報</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text)' }}>
            <div>部屋名: {currentRoomName || '(未設定)'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>本将棋 · {timeLabel}</div>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>対局者</span></div>
          <PlayerRow
            name={playerName || 'あなた'}
            role="ホスト"
            connected
            highlight
          />
          <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
          <PlayerRow
            name="ゲストの入室を待っています…"
            role="ゲスト"
            connected={false}
          />
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            ゲストが入室すると準備画面へ進みます
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            ※ 両者で先後選択・準備完了・振り駒は段階 2-5〜2-7 で実装予定
          </div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="reset-btn"
            onClick={onLeave}
            style={{ minWidth: 260, padding: '8px 18px', fontSize: 13 }}
          >
            退室（オンライン対戦ロビーに戻る）
          </button>
        </div>
      </div>
    </div>
  );
}

interface PlayerRowProps {
  name: string;
  role: string;
  connected: boolean;
  highlight?: boolean;
}

function PlayerRow({ name, role, connected, highlight }: PlayerRowProps) {
  const statusColor = connected ? 'var(--ok)' : 'var(--orange-light)';
  const statusText = connected ? '接続中' : '入室待ち…';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: statusColor,
          animation: connected ? undefined : 'pulse 1.2s ease-in-out infinite',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: connected ? 700 : 400, color: connected ? 'var(--text)' : 'var(--text-muted)' }}>
        {name}
      </span>
      <span
        style={{
          fontSize: 9,
          padding: '1px 7px',
          borderRadius: 20,
          border: highlight ? '1px solid var(--orange)' : '1px solid var(--border-strong)',
          color: highlight ? 'var(--orange-light)' : 'var(--text-muted)',
          background: highlight ? 'var(--bg-selected)' : 'var(--surface2)',
        }}
      >
        {role}
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: statusColor }}>{statusText}</span>
    </div>
  );
}
