import { useEffect } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { getMomoMatchmaking } from '../client';
import { useMatchmakingStore } from '../store';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import { decodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';

/**
 * 段階 2-4.2: S06 準備画面（両者集合後）
 *
 * この画面は「ゲストが入室し、両者が同じ部屋に居る」状態で表示される。
 * 段階 2-4.2 の時点では以下だけを担う:
 * - 両者の名前表示（= 名前交換 IF、両サイドとも同じ内容が見える）
 * - 部屋情報とルール要約
 * - 退室ボタン
 *
 * ゲストが離脱した場合（ホスト側で onGuestLeft により opponentName='' に
 * なる）、ホストは自動で待機画面へ戻る。
 *
 * 段階 2-5 で以下を追加予定:
 * - 両者による先後選択（P2P メッセージ）
 * - 両者 ready で対局画面へ遷移
 * - チャット
 */
export function RoomScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const isHost = useMatchmakingStore((s) => s.isHost);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const opponentName = useMatchmakingStore((s) => s.opponentName);
  const currentRoomName = useMatchmakingStore((s) => s.currentRoomName);
  const activeRoomConfig = useMatchmakingStore((s) => s.activeRoomConfig);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const resetRoomState = useMatchmakingStore((s) => s.resetRoomState);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  // ゲスト離脱でホストは待機画面に戻る
  useEffect(() => {
    if (isHost && !opponentName) {
      setScreen('waiting');
    }
  }, [isHost, opponentName, setScreen]);

  const onLeave = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    resetRoomState();
    setScreen('net-lobby');
  };

  const hostName = isHost ? playerName : opponentName;
  const guestName = isHost ? opponentName : playerName;

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

        <ScreenBand code="S06" name="対局準備" />

        <div style={{ marginTop: 10, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>部屋情報</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: 'var(--text)' }}>
            {(() => {
              const parts = decodeRoomName(currentRoomName || '');
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span>部屋名:</span>
                    <RoomBadges parts={parts} locale={locale} />
                    <span>{parts.userRoomName || '(未設定)'}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{timeLabel}</div>
                </>
              );
            })()}
          </div>
        </div>

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div className="panel-label"><span>対局者</span></div>
          <PlayerRow
            name={hostName || '(未設定)'}
            role="ホスト"
            isSelf={isHost}
          />
          <div style={{ borderTop: '1px dashed var(--border)', margin: '8px 0' }} />
          <PlayerRow
            name={guestName || '(未設定)'}
            role="ゲスト"
            isSelf={!isHost}
          />
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            両者が集合しました。先後選択と対局開始は次の段階（2-5）で実装します。
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
  isSelf: boolean;
}

function PlayerRow({ name, role, isSelf }: PlayerRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: 'var(--ok)',
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        {name}
        {isSelf && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>
            (あなた)
          </span>
        )}
      </span>
      <span
        style={{
          fontSize: 9,
          padding: '1px 7px',
          borderRadius: 20,
          border: isSelf ? '1px solid var(--orange)' : '1px solid var(--border-strong)',
          color: isSelf ? 'var(--orange-light)' : 'var(--text-muted)',
          background: isSelf ? 'var(--bg-selected)' : 'var(--surface2)',
        }}
      >
        {role}
      </span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--ok)' }}>接続中</span>
    </div>
  );
}
