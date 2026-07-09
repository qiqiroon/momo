import { useEffect } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';

/**
 * 段階 2-4: S05 待機画面 (簡易版)
 *
 * 表示要素:
 * - 部屋名 / ルール要約
 * - 対局者カード (自分・相手・接続状態ドット)
 * - 退室ボタン (→ ロビー)
 * - 切断/エラー表示
 *
 * 段階 2-4 では両者接続完了で自動的に対局画面へ遷移 (Phase 2-5 で
 * ready/color_select プロトコルに置換予定)。振り駒・ルール同期プログレス・
 * チャット・準備完了カードは後の段階で実装。
 */
export function WaitingScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const isHost = useMatchmakingStore((s) => s.isHost);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const opponentName = useMatchmakingStore((s) => s.opponentName);
  const currentRoomName = useMatchmakingStore((s) => s.currentRoomName);
  const activeRoomConfig = useMatchmakingStore((s) => s.activeRoomConfig);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const resetRoomState = useMatchmakingStore((s) => s.resetRoomState);

  // P2P 接続完了で対局画面へ (Phase 2-5 で ready 制御に置換)
  useEffect(() => {
    if (connection === 'game_connected') {
      setScreen('game');
    }
  }, [connection, setScreen]);

  const onLeave = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    resetRoomState();
    setScreen('lobby');
  };

  const opponentConnected = connection === 'game_connected' || (isHost && !!opponentName);
  const opponentLabel = opponentName || (isHost ? 'ゲストの入室を待っています…' : '');

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

  const sideLabel = (() => {
    if (!activeRoomConfig) return '';
    switch (activeRoomConfig.sideSelection) {
      case 'host_sente':
        return isHost ? 'あなた先手' : '相手先手';
      case 'host_gote':
        return isHost ? 'あなた後手' : '相手後手';
      case 'random':
        return 'ランダム';
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
            <div className="subtitle">対局待機 - S05</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            <button className="reset-btn" type="button" onClick={onLeave}>
              退室
            </button>
          </div>
        </header>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>部屋情報</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text)' }}>
            <div>部屋名: {currentRoomName || '(未設定)'}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>本将棋 · {sideLabel} · {timeLabel}</div>
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>対局者</span></div>
          <PlayerRow
            name={playerName || 'あなた'}
            role={isHost ? 'ホスト' : 'ゲスト'}
            statusColor="var(--ok)"
            statusText="接続中"
            highlight
          />
          <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
          <PlayerRow
            name={opponentLabel}
            role={isHost ? 'ゲスト' : 'ホスト'}
            statusColor={opponentConnected ? 'var(--ok)' : 'var(--orange-light)'}
            statusText={opponentConnected ? '接続中' : '入室待ち…'}
            waiting={!opponentConnected}
          />
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {connection === 'game_connected'
              ? '両者接続完了。対局画面へ遷移します…'
              : isHost
                ? 'ゲストの入室と P2P 接続を待っています'
                : 'ホストとの P2P 接続を確立しています'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            ※ 振り駒・準備完了・ルール同期は段階 2-5〜2-7 で実装予定
          </div>
        </div>
      </div>
    </div>
  );
}

interface PlayerRowProps {
  name: string;
  role: string;
  statusColor: string;
  statusText: string;
  highlight?: boolean;
  waiting?: boolean;
}

function PlayerRow({ name, role, statusColor, statusText, highlight, waiting }: PlayerRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: statusColor,
          animation: waiting ? 'pulse 1.2s ease-in-out infinite' : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: waiting ? 400 : 700, color: waiting ? 'var(--text-muted)' : 'var(--text)' }}>
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
