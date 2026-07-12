import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore, type LocaleMode } from '../store/i18n-store';
import { useGameStore } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import { useRouteStore } from '../store/route-store';
import { get as pluginGet, has as pluginHas } from '../plugin/registry';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { PieceInstance } from '../engine';
import { isInCheck } from '../engine';
import { pieceNameFor } from '../engine/kifu/format';
import { CatIcon } from './CatIcon';
import { ScreenBand } from './ScreenBand';
import type { OnlineGameConnector } from '../plugin/gameConnector';

interface GameScreenProps {
  variant: 'a' | 'b';
}

const TWO_CHAR_KINDS = new Set(['narikyo', 'narikei', 'narigin']);

function isTwoChar(kind: string): boolean {
  return TWO_CHAR_KINDS.has(kind);
}

export function GameScreen({ variant }: GameScreenProps) {
  const mode = useI18nStore((s) => s.mode);
  const locale = useI18nStore((s) => s.locale);
  const setMode = useI18nStore((s) => s.setMode);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = (key: string) => _t(key, locale);
  const [qmode, setQmode] = useState<'cycle' | 'stack'>('cycle');

  const mgf = useGameStore((s) => s.mgf);
  const position = useGameStore((s) => s.position);
  const selectedSquare = useGameStore((s) => s.selectedSquare);
  const selectedHandPieceId = useGameStore((s) => s.selectedHandPieceId);
  const legalDestinations = useGameStore((s) => s.legalDestinations);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const status = useGameStore((s) => s.status);
  const lastAppliedMove = useGameStore((s) => s.lastAppliedMove);
  const selectSquare = useGameStore((s) => s.selectSquare);
  const selectHandPiece = useGameStore((s) => s.selectHandPiece);
  const clearSelection = useGameStore((s) => s.clearSelection);
  const tryMove = useGameStore((s) => s.tryMove);
  const reset = useGameStore((s) => s.reset);

  // オンライン対戦の接続点（features/matchmaking が登録・A ビルドでは undefined）
  const [online, setOnline] = useState<{ isOnline: boolean; mySide: 'player1' | 'player2' | null }>(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    return c ? { isOnline: c.isOnline(), mySide: c.getMySide() } : { isOnline: false, mySide: null };
  });

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const update = () => setOnline({ isOnline: c.isOnline(), mySide: c.getMySide() });
    update();
    return c.subscribe(update);
  }, []);

  // オンラインモード開始時に対局盤面とチャット履歴を初期化（前回のゲームの残り状態を持ち越さない）
  const clearChat = useChatStore((s) => s.clearChat);
  useEffect(() => {
    if (online.isOnline) {
      reset();
      clearChat();
    }
  }, [online.isOnline, reset, clearChat]);

  // 自分の着手を相手に送信
  useEffect(() => {
    if (!online.isOnline) return;
    if (!lastAppliedMove) return;
    if (lastAppliedMove.source !== 'local') return;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const move = lastAppliedMove.move;
    if (move.type === 'move') {
      c.sendMove({
        kind: 'move',
        pieceId: move.pieceId,
        from: move.from,
        to: move.to,
        promote: move.promote,
      });
    } else {
      c.sendMove({
        kind: 'drop',
        pieceId: move.pieceId,
        to: move.to,
      });
    }
  }, [lastAppliedMove, online.isOnline]);

  const hasMomoLang = typeof window !== 'undefined' && 'MomoLang' in window;

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const langOptions: { value: LocaleMode; label: string }[] = [];
  if (hasMomoLang) langOptions.push({ value: 'auto', label: 'Auto' });
  langOptions.push({ value: 'ja', label: '日本語' });
  langOptions.push({ value: 'en', label: 'EN' });
  langOptions.push({ value: 'zh', label: '中文' });
  if (variant === 'b') langOptions.push({ value: 'cat', label: 'CAT' });

  const senteInCheck = isInCheck(mgf, position, 'player1');
  const goteInCheck = isInCheck(mgf, position, 'player2');
  // オンライン対戦時は自分の手番か相手の手番かを表示
  const isMyTurnOnline = online.isOnline && online.mySide === position.sideToMove;
  const turnLabel =
    status === 'checkmate'
      ? t(position.sideToMove === 'player1' ? 'status.checkmate_p1' : 'status.checkmate_p2')
      : status === 'sennichite'
        ? t('status.sennichite')
        : status === 'nyugyoku_win_p1'
          ? t('status.nyugyoku_win_p1')
          : status === 'nyugyoku_win_p2'
            ? t('status.nyugyoku_win_p2')
            : online.isOnline
              ? (isMyTurnOnline ? t('turn.mine') : t('turn.opp')) +
                (position.sideToMove === 'player1' ? (senteInCheck ? '（王手）' : '') : goteInCheck ? '（王手）' : '')
              : position.sideToMove === 'player1'
                ? '先手番' + (senteInCheck ? '（王手）' : '')
                : '後手番' + (goteInCheck ? '（王手）' : '');

  const isSelected = (row: number, col: number) => selectedSquare?.row === row && selectedSquare?.col === col;
  const isHint = (row: number, col: number) => legalDestinations.some((d) => d.row === row && d.col === col);
  const lastMoveTo = position.history.length > 0 ? position.history[position.history.length - 1].to : null;
  const isLastMove = (row: number, col: number) => lastMoveTo?.row === row && lastMoveTo?.col === col;

  // オンライン対戦で自分の手番でないなら入力を受け付けない
  const inputBlocked = online.isOnline && online.mySide !== null && position.sideToMove !== online.mySide;

  const onSquareClick = (row: number, col: number) => {
    if (status !== 'playing') return;
    if (inputBlocked) return;
    if ((selectedSquare || selectedHandPieceId) && isHint(row, col)) {
      tryMove({ row, col });
      return;
    }
    const piece = position.board[row][col];
    if (piece && piece.owner === position.sideToMove) {
      selectSquare({ row, col });
    } else {
      clearSelection();
    }
  };

  const onHandPieceClick = (owner: 'player1' | 'player2', pieceId: string) => {
    if (status !== 'playing') return;
    if (inputBlocked) return;
    if (owner !== position.sideToMove) return;
    if (selectedHandPieceId === pieceId) {
      clearSelection();
      return;
    }
    selectHandPiece(pieceId);
  };

  const senteHandGrouped = groupHand(position.hands.player1);
  const goteHandGrouped = groupHand(position.hands.player2);

  const kifuScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (kifuScrollRef.current) {
      kifuScrollRef.current.scrollTop = kifuScrollRef.current.scrollHeight;
    }
  }, [moveHistory]);

  return (
    <div className="stage">
      <div className="grid">
        <div className="main-col">
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
              {online.isOnline ? (
                <button
                  className="reset-btn"
                  type="button"
                  onClick={() => {
                    const c = pluginGet<OnlineGameConnector>('gameConnector');
                    if (c) c.leaveOnline();
                  }}
                >
                  退室（対戦ロビーに戻る）
                </button>
              ) : (
                <>
                  {pluginHas('screen:lobby') && (
                    <button
                      className="reset-btn"
                      type="button"
                      onClick={() => useRouteStore.getState().setScreen('lobby')}
                    >
                      メニューへ戻る
                    </button>
                  )}
                  <button className="reset-btn" type="button" onClick={reset}>
                    リセット
                  </button>
                </>
              )}
              <div className="lang-select">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
                </svg>
                <select
                  id="lang-select"
                  value={mode}
                  onChange={(e) => {
                    const m = e.target.value as LocaleMode;
                    setMode(m);
                    if (m !== 'auto') setLocale(m);
                  }}
                >
                  {langOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </header>

          <ScreenBand code="S07" name="対局" />

          <div className="turn-row">
            <div className={`turn-banner${status === 'checkmate' ? ' opp' : ''}`}>{turnLabel}</div>
            <div className="qmode-toggle">
              <button
                type="button"
                className={`qm${qmode === 'cycle' ? ' active' : ''}`}
                onClick={() => setQmode('cycle')}
              >
                {t('qmode.cycle')}
              </button>
              <button
                type="button"
                className={`qm${qmode === 'stack' ? ' active' : ''}`}
                onClick={() => setQmode('stack')}
              >
                {t('qmode.stack')}
              </button>
            </div>
          </div>

          <div className="pinfo opp">
            <span className="nm">{t('player.opp')}</span>
            <span className="sub">後手</span>
            <span className="clk">--:--</span>
            <span className="byo">秒読み--</span>
          </div>

          <div className="broadcast">
            <PieceStandView
              side="opp"
              pieces={goteHandGrouped}
              onClick={(pid) => onHandPieceClick('player2', pid)}
              selectedId={selectedHandPieceId}
              activePlayer={position.sideToMove === 'player2'}
              locale={locale}
            />
            <div className="board-with-coords">
              {/* 上部の筋番号（将棋は右から 1〜9） */}
              <div className="col-coords">
                {[9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
              <div className={`board-outer${isMyTurnOnline ? ' myturn' : ''}`}>
                <div className="board" aria-label="将棋盤 (9x9)">
                  <div className="stars">
                    {[3, 6].flatMap((cx) =>
                      [3, 6].map((cy) => (
                        <div
                          key={`${cx}-${cy}`}
                          className="star"
                          style={{ left: `${(cx / 9) * 100}%`, top: `${(cy / 9) * 100}%` }}
                        />
                      )),
                    )}
                  </div>
                  {Array.from({ length: 81 }).map((_, i) => {
                    const row = Math.floor(i / 9);
                    const col = i % 9;
                    const piece = position.board[row][col];
                    const cls = [
                      'sq',
                      isSelected(row, col) ? 'selected' : '',
                      isHint(row, col) ? 'hint' : '',
                      isLastMove(row, col) ? 'lastmove' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div key={i} className={cls} onClick={() => onSquareClick(row, col)}>
                        {piece && <PieceView piece={piece} locale={locale} />}
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* 右辺の段番号（一〜九） */}
              <div className="row-coords">
                {['一', '二', '三', '四', '五', '六', '七', '八', '九'].map((s) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
            </div>
            <PieceStandView
              side="you"
              pieces={senteHandGrouped}
              onClick={(pid) => onHandPieceClick('player1', pid)}
              selectedId={selectedHandPieceId}
              activePlayer={position.sideToMove === 'player1'}
              locale={locale}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{t('player.you')}</span>
            <span className="sub">先手</span>
            <span className="clk running">--:--</span>
            <span className="byo">秒読み--</span>
          </div>

          <div className="command-bar">
            <button type="button" className="act taunt">
              {t('cmd.taunt')} <span className="cnt">3</span>
            </button>
            <button type="button" className="act">
              {t('cmd.undo')}
            </button>
            <button type="button" className="act">
              {t('cmd.draw')}
            </button>
            <button type="button" className="act">
              {t('cmd.pause')}
            </button>
            <button type="button" className="act danger">
              {t('cmd.resign')}
            </button>
            <button type="button" className="act" onClick={clearSelection}>
              {t('cmd.cancel')}
            </button>
            <NyugyokuButton t={t} />
          </div>
        </div>

        <div className="chat-col">
          <div className="panel">
            <div className="panel-label">
              <span>{t('chat.title')}</span>
            </div>
            <ChatConsole t={t} online={online} />
          </div>

          <div className="panel spectators" style={{ marginTop: 12 }}>
            <div className="panel-label">
              <span>{t('spec.title')}</span>
            </div>
            <div className="spec-empty">{t('spec.empty')}</div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-label">
              <span>棋譜</span>
            </div>
            <div className="console">
              <div className="chat-log" ref={kifuScrollRef} style={{ maxHeight: 180 }}>
                {moveHistory.length === 0 ? (
                  <div className="spec-empty">まだ指し手がありません</div>
                ) : (
                  moveHistory.map((m, i) => (
                    <div key={i} style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {i + 1}. {m}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <PromotionModal locale={locale} t={t} />
      <OpponentLeftModal t={t} />
    </div>
  );
}

/**
 * 対局中のチャット（段階 2-7 v0.28）。
 * オンライン対局中のみ入力可能。オフライン時は入力欄を disabled で表示（モック沿いの受け皿）。
 * 履歴は chat-store 経由で両者に共有される。プロンプトは自分の側のものを表示。
 */
function ChatConsole({
  t,
  online,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
}) {
  const messages = useChatStore((s) => s.messages);
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const canSend = online.isOnline && online.mySide !== null;
  const myPrompt = t(online.mySide === 'player2' ? 'chat.pGote' : 'chat.pSente');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (!canSend) return;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    c.sendChat(text);
    setDraft('');
  };

  return (
    <div className="console">
      <div className="chat-log" ref={logRef}>
        {messages.map((m, i) => (
          <div key={i} className={`line ${m.side === 'player1' ? 'p-sente' : 'p-gote'}`}>
            <span className="prompt">{t(m.side === 'player1' ? 'chat.pSente' : 'chat.pGote')}</span>
            {m.text}
          </div>
        ))}
      </div>
      <div className="inputline">
        <span className="prompt">{myPrompt}</span>
        <input
          type="text"
          placeholder={t('chat.placeholder')}
          value={draft}
          disabled={!canSend}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="send" onClick={send} disabled={!canSend}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}

/**
 * オンライン対局中に相手が退室 or 通信が切断されたら表示するモーダル。
 * 「対戦ロビーに戻る」ボタン以外の操作を封じ、ユーザーに退室を促す。
 * A ビルドでは gameConnector が undefined なので何もしない。
 */
function OpponentLeftModal({ t }: { t: (key: string) => string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const update = () => setVisible(c.getOpponentLeftDuringGame());
    update();
    return c.subscribe(update);
  }, []);

  const onLeave = () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) c.leaveOnline();
    setVisible(false);
  };

  if (!visible) return null;
  return (
    <div className="opp-left-overlay" role="dialog" aria-modal="true">
      <div className="opp-left-modal">
        <div className="title">{t('s07.oppLeftTitle')}</div>
        <div className="body">{t('s07.oppLeftBody')}</div>
        <button type="button" className="btn" onClick={onLeave}>
          {t('s07.oppLeftBtn')}
        </button>
      </div>
    </div>
  );
}

interface NyugyokuButtonProps {
  t: (key: string) => string;
}

function NyugyokuButton({ t }: NyugyokuButtonProps) {
  const position = useGameStore((s) => s.position);
  const canP1 = useGameStore((s) => s.canNyugyokuP1);
  const canP2 = useGameStore((s) => s.canNyugyokuP2);
  const status = useGameStore((s) => s.status);
  const declareNyugyoku = useGameStore((s) => s.declareNyugyoku);
  const canNow = status === 'playing' && (position.sideToMove === 'player1' ? canP1 : canP2);
  if (!canNow) return null;
  return (
    <button type="button" className="act" onClick={() => declareNyugyoku()}>
      {t('cmd.nyugyoku')}
    </button>
  );
}

interface PromotionModalProps {
  locale: LocaleCode;
  t: (key: string) => string;
}

function PromotionModal({ locale, t }: PromotionModalProps) {
  const pendingPromotion = useGameStore((s) => s.pendingPromotion);
  const confirmPromotion = useGameStore((s) => s.confirmPromotion);
  const cancelPromotion = useGameStore((s) => s.cancelPromotion);

  useEffect(() => {
    if (!pendingPromotion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelPromotion();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPromotion, cancelPromotion]);

  if (!pendingPromotion) return null;

  const nonPromotePiece: PieceInstance = {
    pieceId: '__preview_non__',
    kind: pendingPromotion.pieceKind,
    owner: pendingPromotion.owner,
    initialOwner: pendingPromotion.owner,
    promoted: false,
  };
  const promotePiece: PieceInstance = {
    pieceId: '__preview_promo__',
    kind: pendingPromotion.promotedKind,
    owner: pendingPromotion.owner,
    initialOwner: pendingPromotion.owner,
    promoted: true,
  };

  return (
    <div className="promotion-modal-overlay" onClick={cancelPromotion}>
      <div className="promotion-modal" onClick={(e) => e.stopPropagation()}>
        <div className="heading">{pendingPromotion.heading}</div>
        <div className="cards">
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(false)}>
            <div className="label">{t('promote.decline')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={nonPromotePiece} locale={locale} />
            </div>
          </button>
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(true)}>
            <div className="label">{t('promote.confirm')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={promotePiece} locale={locale} />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

interface HandGroup {
  kind: string;
  pieceIds: string[];
}

function groupHand(hand: PieceInstance[]): HandGroup[] {
  const groups = new Map<string, string[]>();
  for (const p of hand) {
    if (!groups.has(p.kind)) groups.set(p.kind, []);
    groups.get(p.kind)!.push(p.pieceId);
  }
  return Array.from(groups.entries()).map(([kind, pieceIds]) => ({ kind, pieceIds }));
}

function PieceView({ piece, locale }: { piece: PieceInstance; locale: LocaleCode }) {
  const name = pieceNameFor(piece.kind, locale);
  const isEn = locale === 'en';
  const isMulti = isEn && name.length > 1;
  const cls = [
    'pc',
    piece.owner === 'player2' ? 'gote' : '',
    piece.promoted ? 'promoted' : '',
    !isEn && isTwoChar(piece.kind) ? 'two' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const jaCls = ['ja', isEn ? 'en' : '', isEn && isMulti ? 'multi' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      <span className={jaCls}>{name}</span>
    </div>
  );
}

interface PieceStandViewProps {
  side: 'opp' | 'you';
  pieces: HandGroup[];
  onClick: (pieceId: string) => void;
  selectedId: string | null;
  activePlayer: boolean;
  locale: LocaleCode;
}

function PieceStandView({ side, pieces, onClick, selectedId, activePlayer, locale }: PieceStandViewProps) {
  const isEn = locale === 'en';
  return (
    <div className={`stand ${side}`}>
      <div className="stand-h">{side === 'opp' ? 'Gote' : 'You'}</div>
      <div className="caps">
        {pieces.map((g) => {
          const name = pieceNameFor(g.kind, locale);
          const isMulti = isEn && name.length > 1;
          const jaCls = ['ja', isEn ? 'en' : '', isEn && isMulti ? 'multi' : ''].filter(Boolean).join(' ');
          return (
            <div
              key={g.kind}
              className={`cap${selectedId && g.pieceIds.includes(selectedId) ? ' selected' : ''}`}
              onClick={() => activePlayer && onClick(g.pieceIds[0])}
              style={{ cursor: activePlayer ? 'pointer' : 'default' } as CSSProperties}
            >
              <div className="capface">
                <span className={jaCls}>{name}</span>
              </div>
              {g.pieceIds.length >= 2 && <span className="ct">{g.pieceIds.length}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
