import { useEffect, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { ScreenBand } from '../../../core/ui-core/ScreenBand';
import { getMomoMatchmaking } from '../client';
import { decodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { useMatchmakingStore, type SideChoice, type SideSelection } from '../store';
import { PROTOCOL_VERSION } from '../protocol';

/**
 * S06 対局準備画面（段階 2-5.1 で S05 ホスト待機と統合）。
 *
 * モック momo_shogi_S05_mock_v1.html の構造・スタイル・翻訳データを
 * verbatim にコピーして持ち込む。
 *
 * この画面が担当するもの:
 * - プレイヤー状態行（自分＋相手・接続ドット・ホスト/ゲストタグ）
 * - ルール同期の進捗（3 ステップ・段階 2-5.1 時点は「即座に全部完了」の見せかけ）
 * - 先後選択（先手/後手/おまかせ の駒モチーフ 3 カード＋振り駒アニメ）
 * - チャット枠（送受信は段階 2-5.2 以降で実装）
 * - 準備完了カード（両者ready で S07 対局へ遷移）
 *
 * ゲスト未入室状態（ホスト単独）でも同じ画面を表示し、相手行を「入室待ち」に
 * する（旧 S05 ホスト待機画面の役割を吸収）。
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

  const mySideChoice = useMatchmakingStore((s) => s.mySideChoice);
  const oppSideChoice = useMatchmakingStore((s) => s.oppSideChoice);
  const myReady = useMatchmakingStore((s) => s.myReady);
  const oppReady = useMatchmakingStore((s) => s.oppReady);
  const setMySideChoice = useMatchmakingStore((s) => s.setMySideChoice);
  const setMyReady = useMatchmakingStore((s) => s.setMyReady);
  const resetHandshake = useMatchmakingStore((s) => s.resetHandshake);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const oppPresent = !!opponentName;

  // 振り駒アニメ用の状態（先後選択で「おまかせ」を選んだときのみ動く）
  const [furigomaSpinning, setFurigomaSpinning] = useState(false);
  const [furigomaResult, setFurigomaResult] = useState<{ isSente: boolean; count: number } | null>(null);

  // 送信ユーティリティ
  const sendMsg = (msg: unknown) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send(msg);
  };

  // 相手が入室してきた瞬間に自分の現在状態を送る（キャッチアップ用）
  useEffect(() => {
    if (!oppPresent) return;
    sendMsg({ v: PROTOCOL_VERSION, type: 'state_sync', choice: mySideChoice, ready: myReady });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppPresent]);

  // ゲスト退室でホストは待機表示に戻る（相手行が「入室待ち」に戻る）
  // また、ゲスト退室時にハンドシェイク状態はリセット（再入室で新規開始）
  useEffect(() => {
    if (isHost && !opponentName) {
      resetHandshake();
    }
  }, [isHost, opponentName, resetHandshake]);

  // 先後選択が両者そろい、コンフリクトがなければ準備完了ボタンを有効化
  // conflict: 両者が明示的に同じ側を選んだ場合
  const hasConflict = (() => {
    if (!oppPresent) return true; // 相手不在なら準備不可
    if (mySideChoice === null || oppSideChoice === null) return true; // どちらか未選択
    if (mySideChoice === 'sente' && oppSideChoice === 'sente') return true;
    if (mySideChoice === 'gote' && oppSideChoice === 'gote') return true;
    return false;
  })();
  const readyDisabled = hasConflict && !myReady;

  // 両者準備完了 → ホストが振り駒（必要なら）+ 先後確定 + game_start 送信
  useEffect(() => {
    if (!myReady || !oppReady) return;
    if (!isHost) return; // 送信はホストのみ
    // 両者の選択から先後を確定する
    const { hostSide, guestSide } = resolveSides(
      isHost ? mySideChoice : oppSideChoice,
      isHost ? oppSideChoice : mySideChoice,
    );
    sendMsg({ v: PROTOCOL_VERSION, type: 'game_start', hostSide, guestSide });
    // ホスト自身も遷移
    useMatchmakingStore.setState({ gameStartInfo: { hostSide, guestSide } });
    setScreen('game');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReady, oppReady, isHost]);

  const onLeave = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    resetRoomState();
    setScreen('net-lobby');
  };

  const onPickSide = (choice: SideChoice) => {
    // 「おまかせ」→ 振り駒アニメ演出（段階 2-5.1 では見せかけのローカル演出）
    if (choice === 'random') {
      setMySideChoice('random');
      sendMsg({ v: PROTOCOL_VERSION, type: 'side_select', choice: 'random' });
      // アニメだけ再生。実際の先後は両者準備完了時にホストが確定する。
      setFurigomaSpinning(true);
      setFurigomaResult(null);
      setTimeout(() => {
        setFurigomaSpinning(false);
        // 演出上のダミー結果（実際の割当は game_start 時）
        const count = Math.floor(Math.random() * 4) + 1; // 1〜4 の歩
        const isSente = Math.random() < 0.5;
        setFurigomaResult({ isSente, count });
      }, 1200);
      return;
    }
    setMySideChoice(choice);
    setFurigomaSpinning(false);
    setFurigomaResult(null);
    sendMsg({ v: PROTOCOL_VERSION, type: 'side_select', choice });
  };

  const onToggleReady = () => {
    if (readyDisabled) return;
    const next = !myReady;
    setMyReady(next);
    sendMsg({ v: PROTOCOL_VERSION, type: 'ready', ready: next });
  };

  const parts = decodeRoomName(currentRoomName || '');

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

  // 自分の役割（ホスト/ゲスト）と相手の役割
  const myRoleLabel = isHost ? t('s06.roleHost') : t('s06.roleGuest');
  const oppRoleLabel = isHost ? t('s06.roleGuest') : t('s06.roleHost');

  return (
    <div className="stage">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* ===== ヘッダ ===== */}
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

        {/* ===== 部屋情報（ルール表示） ===== */}
        <div style={{ marginTop: 10, padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>部屋名:</span>
          <RoomBadges parts={parts} locale={locale} />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{parts.userRoomName || '(未設定)'}</span>
          {timeLabel && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{timeLabel}</span>
          )}
        </div>

        {/* ===== 対局者 ===== */}
        <div className="section-label">{t('s06.lblPlayers')}</div>
        <div className="s06-card">
          {/* 自分 */}
          <div className="player-row">
            <span className="p-dot ok" />
            <span className="p-name">{playerName || t('s06.youName')}</span>
            <span className="role-tag you">{myRoleLabel}</span>
            <span className="p-spacer" />
            <span className="p-status ok">{t('s06.stConnected')}</span>
          </div>
          {/* 相手 */}
          <div className="player-row">
            <span className={`p-dot ${oppPresent ? 'ok' : 'wait'}`} />
            <span className={`p-name${oppPresent ? '' : ' muted'}`}>
              {oppPresent ? opponentName : t('s06.oppWaiting')}
            </span>
            {oppPresent && <span className="role-tag">{oppRoleLabel}</span>}
            <span className="p-spacer" />
            <span className={`p-status ${oppPresent ? 'ok' : 'warn'}`}>
              {oppPresent ? t('s06.stConnected') : ''}
            </span>
          </div>
        </div>

        {/* ===== ルール同期の進捗（段階 2-5.1 では見せかけ全部完了） ===== */}
        <div className="section-label">{t('s06.lblSync')}</div>
        <div className="s06-card">
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss1')}</span>
              <small>rule_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss2')}</span>
              <small>modifiers_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss3')}</span>
              <small>rule_ack</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
        </div>

        {/* ===== 先後選択 ===== */}
        <div className="section-label">{t('s06.lblSide')}</div>
        <div className="side-pick">
          <SideCard
            label={t('s06.sideNameS')}
            desc={t('s06.sideDescS')}
            glyph="先"
            selected={mySideChoice === 'sente'}
            onClick={() => onPickSide('sente')}
          />
          <SideCard
            label={t('s06.sideNameG')}
            desc={t('s06.sideDescG')}
            glyph="後"
            selected={mySideChoice === 'gote'}
            onClick={() => onPickSide('gote')}
          />
          <SideCard
            label={t('s06.sideNameR')}
            desc={t('s06.sideDescR')}
            glyph="？"
            selected={mySideChoice === 'random'}
            onClick={() => onPickSide('random')}
          />
        </div>

        {/* ===== 振り駒アニメ ===== */}
        <div className={`furigoma${mySideChoice === 'random' ? ' show' : ''}`}>
          <div className="fg-row">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`fg-piece${furigomaSpinning ? ' spin' : ''}`}>
                <div className="fg-inner" style={furigomaSpinning ? undefined : (furigomaResult && !furigomaResult.isSente ? { transform: 'rotateX(180deg)' } : undefined)}>
                  <div className="fg-face">
                    <span>歩</span>
                  </div>
                  <div className="fg-face back">
                    <span>と</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={`fg-result${furigomaResult && !furigomaSpinning ? ' win' : ''}`}>
            {furigomaSpinning
              ? t('s06.frRolling')
              : furigomaResult
              ? furigomaResult.isSente
                ? t('s06.frSente').replace('{n}', String(furigomaResult.count))
                : t('s06.frGote').replace('{n}', String(furigomaResult.count))
              : ''}
          </div>
        </div>
        <div style={{ marginTop: 10, padding: '0 4px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {t('s06.sideShareNote')}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--orange-light)', lineHeight: 1.55, marginTop: 4 }}>
            {t('s06.fairNote')}
          </div>
        </div>

        {/* ===== チャット（送受信は段階 2-5.2 以降で実装） ===== */}
        <div className="section-label">{t('s06.lblChatSec')}</div>
        <div className="s06-card">
          <div className="s06-console">
            <div className="chat-log" />
            <div className="inputline">
              <span className="prompt">{isHost ? t('s06.pHost') : t('s06.pGuest')}</span>
              <input type="text" autoComplete="off" />
              <button type="button" className="send">{t('s06.lblSend')}</button>
            </div>
          </div>
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        {/* ===== 準備完了カード ===== */}
        <div className="start-card">
          <div className="st-line">{t('s06.stLead')}</div>
          <div className="st-rule">
            <span>本将棋</span>
          </div>
          <button
            type="button"
            className={`start-btn${myReady ? ' armed' : ''}`}
            onClick={onToggleReady}
            disabled={readyDisabled}
          >
            {myReady ? t('s06.readyArmed') : t('s06.readyBtn')}
          </button>
          <div className={`opp-ready${oppReady ? ' ok' : ''}`}>
            {!oppPresent
              ? t('s06.readyHint')
              : oppReady
              ? t('s06.oppReadyYes')
              : t('s06.oppReadyNo')}
          </div>
          <div className="start-dest">{t('s06.startDest')}</div>
        </div>

        {/* ===== 退室 ===== */}
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

/** 先後選択カード（駒モチーフ 3 枚のうちの 1 枚） */
function SideCard({
  label,
  desc,
  glyph,
  selected,
  onClick,
}: {
  label: string;
  desc: string;
  glyph: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`side-card${selected ? ' on' : ''}`} onClick={onClick}>
      <div className="side-glyph">
        <span>{glyph}</span>
      </div>
      <div className="sc-name">{label}</div>
      <div className="sc-desc">{desc}</div>
      <span className="sc-check">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    </button>
  );
}

/**
 * 両者の選択から先後を確定する（ホストが両者準備完了時に呼ぶ）。
 *
 * ルール:
 * - 両者「おまかせ」または「片方おまかせ + 片方おまかせでない」→ ローカルランダムで確定
 *   （公平乱数は段階 2-5.3+ で実装予定）
 * - 「先手」×「後手」→ そのまま確定
 * - conflict（両者「先手」or 両者「後手」）→ 到達しないはず（readyDisabled で防ぐ）が保険で
 *   ホスト側の選択を優先
 */
function resolveSides(
  hostChoice: SideChoice,
  guestChoice: SideChoice,
): { hostSide: SideSelection; guestSide: SideSelection } {
  // 両者明示（かつ conflict なし）
  if (hostChoice === 'sente' && guestChoice === 'gote') {
    return { hostSide: 'sente', guestSide: 'gote' };
  }
  if (hostChoice === 'gote' && guestChoice === 'sente') {
    return { hostSide: 'gote', guestSide: 'sente' };
  }
  // 片方おまかせ
  if (hostChoice === 'sente' && guestChoice === 'random') {
    return { hostSide: 'sente', guestSide: 'gote' };
  }
  if (hostChoice === 'gote' && guestChoice === 'random') {
    return { hostSide: 'gote', guestSide: 'sente' };
  }
  if (guestChoice === 'sente' && hostChoice === 'random') {
    return { hostSide: 'gote', guestSide: 'sente' };
  }
  if (guestChoice === 'gote' && hostChoice === 'random') {
    return { hostSide: 'sente', guestSide: 'gote' };
  }
  // 両者おまかせ → ローカルランダム（公平乱数は 2-5.3+）
  // ここに来る conflict ケース（両者同じ明示）はホスト先手優先で解決
  const hostIsSente = Math.random() < 0.5;
  return hostIsSente
    ? { hostSide: 'sente', guestSide: 'gote' }
    : { hostSide: 'gote', guestSide: 'sente' };
}
