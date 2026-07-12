import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { useGameStore } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import { useOffersStore } from '../store/offers-store';
import { ChatConsole } from './ChatConsole';
import { useRouteStore } from '../store/route-store';
import { get as pluginGet, has as pluginHas } from '../plugin/registry';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { PieceInstance } from '../engine';
import { isInCheck } from '../engine';
import { pieceNameFor } from '../engine/kifu/format';
import { CatIcon } from './CatIcon';
import { FloatingPanel } from './FloatingPanel';
import { LangSelect } from './LangSelect';
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
  const locale = useI18nStore((s) => s.locale);
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
  const [online, setOnline] = useState<{
    isOnline: boolean;
    mySide: 'player1' | 'player2' | null;
    myName: string;
    opponentName: string;
  }>(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    return c
      ? {
          isOnline: c.isOnline(),
          mySide: c.getMySide(),
          myName: c.getMyName(),
          opponentName: c.getOpponentName(),
        }
      : { isOnline: false, mySide: null, myName: '', opponentName: '' };
  });

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const update = () =>
      setOnline({
        isOnline: c.isOnline(),
        mySide: c.getMySide(),
        myName: c.getMyName(),
        opponentName: c.getOpponentName(),
      });
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

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const senteInCheck = isInCheck(mgf, position, 'player1');
  const goteInCheck = isInCheck(mgf, position, 'player2');
  // オンライン対戦時は自分の手番か相手の手番かを表示
  const isMyTurnOnline = online.isOnline && online.mySide === position.sideToMove;
  // v0.34: 盤面の視点。mySide=player2 のとき盤を反転して「自分の駒を下側」に表示
  const viewerSide: 'player1' | 'player2' = online.mySide ?? 'player1';
  const oppSide: 'player1' | 'player2' = viewerSide === 'player1' ? 'player2' : 'player1';
  const flipped = viewerSide === 'player2';
  const turnLabel =
    status === 'checkmate'
      ? t(position.sideToMove === 'player1' ? 'status.checkmate_p1' : 'status.checkmate_p2')
      : status === 'sennichite'
        ? t('status.sennichite')
        : status === 'nyugyoku_win_p1'
          ? t('status.nyugyoku_win_p1')
          : status === 'nyugyoku_win_p2'
            ? t('status.nyugyoku_win_p2')
            : status === 'resigned_p1'
              ? t('status.resigned_p1')
              : status === 'resigned_p2'
                ? t('status.resigned_p2')
                : status === 'agreed_draw'
                  ? t('status.agreed_draw')
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
  // v0.34: 相手／自分 の持ち駒を viewer 基準で
  const oppHandGrouped = viewerSide === 'player1' ? goteHandGrouped : senteHandGrouped;
  const myHandGrouped = viewerSide === 'player1' ? senteHandGrouped : goteHandGrouped;
  const oppSideLabel = oppSide === 'player1' ? '先手' : '後手';
  const mySideLabel = viewerSide === 'player1' ? '先手' : '後手';

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
                <>
                  {status !== 'playing' && (
                    <button
                      className="reset-btn primary"
                      type="button"
                      onClick={() => {
                        const c = pluginGet<OnlineGameConnector>('gameConnector');
                        if (c) c.returnToPreparation();
                      }}
                    >
                      {t('result.rematch.online')}
                    </button>
                  )}
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
                </>
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
              <LangSelect includeCat={variant === 'b'} />
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
            <span className="nm">{online.opponentName || t('player.opp')}</span>
            <span className="sub">{oppSideLabel}</span>
            <span className="clk">--:--</span>
            <span className="byo">秒読み--</span>
          </div>

          <div className="broadcast">
            <PieceStandView
              side="opp"
              pieces={oppHandGrouped}
              onClick={(pid) => onHandPieceClick(oppSide, pid)}
              selectedId={selectedHandPieceId}
              activePlayer={position.sideToMove === oppSide}
              locale={locale}
            />
            <div className={`board-with-coords${flipped ? ' flipped' : ''}`}>
              <div className={`board-outer${isMyTurnOnline ? ' myturn' : ''}`}>
                {/* v0.34: 座標は viewer 基準。先手=上/右、後手=下/左 */}
                <div className="col-coords">
                  {(flipped ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [9, 8, 7, 6, 5, 4, 3, 2, 1]).map((n) => (
                    <span key={n}>{n}</span>
                  ))}
                </div>
                <div className={`row-coords${locale === 'en' ? ' en' : ''}`}>
                  {((): string[] => {
                    const arabic = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
                    const kanji = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
                    const arr = locale === 'en' ? arabic : kanji;
                    return flipped ? [...arr].reverse() : arr;
                  })().map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
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
                    const visualRow = Math.floor(i / 9);
                    const visualCol = i % 9;
                    // v0.34: 後手視点なら盤を反転して描画（board データ自体は先手基準のまま）
                    const row = flipped ? 8 - visualRow : visualRow;
                    const col = flipped ? 8 - visualCol : visualCol;
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
                        {piece && <PieceView piece={piece} locale={locale} viewerSide={viewerSide} />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <PieceStandView
              side="you"
              pieces={myHandGrouped}
              onClick={(pid) => onHandPieceClick(viewerSide, pid)}
              selectedId={selectedHandPieceId}
              activePlayer={position.sideToMove === viewerSide}
              locale={locale}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{online.myName || t('player.you')}</span>
            <span className="sub">{mySideLabel}</span>
            <span className="clk running">--:--</span>
            <span className="byo">秒読み--</span>
          </div>

          <div className="command-bar">
            <button type="button" className="act taunt">
              {t('cmd.taunt')} <span className="cnt">3</span>
            </button>
            <UndoButton t={t} online={online} status={status} />
            <DrawButton t={t} online={online} status={status} />
            <button type="button" className="act">
              {t('cmd.pause')}
            </button>
            <ResignButton t={t} online={online} status={status} sideToMove={position.sideToMove} />
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
            <ChatConsole t={t} />
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
      <GameEndModal t={t} online={online} />
      <OfferReceivedModal t={t} />
      <OfferSentToast t={t} />
      <OfferResponseToast t={t} />
    </div>
  );
}

/**
 * 引分申し出ボタン（段階 2-7 v0.33）。
 * オフライン: クリック→確認モーダル→即引分終局。
 * オンライン: クリック→相手に申し出送信＋自分側「申し出中」表示。
 * 対局終了 or 既に別の申し出待ちで disabled。
 */
function DrawButton({
  t,
  online,
  status,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
}) {
  const drawOfferFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoOfferFrom = useOffersStore((s) => s.undoOfferFrom);
  const agreeDraw = useGameStore((s) => s.agreeDraw);
  const [confirming, setConfirming] = useState(false);
  const disabled = status !== 'playing' || drawOfferFrom !== null || undoOfferFrom !== null;

  const onClick = () => {
    if (online.isOnline) {
      const c = pluginGet<OnlineGameConnector>('gameConnector');
      if (c) c.sendDrawOffer();
    } else {
      setConfirming(true);
    }
  };
  const confirmYes = () => {
    agreeDraw();
    setConfirming(false);
  };

  return (
    <>
      <button type="button" className="act" disabled={disabled} onClick={onClick}>
        {t('cmd.draw')}
      </button>
      {confirming && (
        <FloatingPanel className="floating-result floating-confirm" title={t('draw.confirmTitle')}>
          <div className="body">{t('draw.confirmBody')}</div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              {t('resign.confirmNo')}
            </button>
            <button type="button" className="btn" onClick={confirmYes}>
              {t('draw.confirmYes')}
            </button>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}

/**
 * 待った申し出ボタン（段階 2-7 v0.33）。
 * オフライン: クリック→即 1 手戻す（履歴があれば）。
 * オンライン: クリック→相手に申し出送信＋自分側「申し出中」表示。
 * 履歴が空 or 対局終了 or 既に別申し出待ちで disabled。
 */
function UndoButton({
  t,
  online,
  status,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
}) {
  const drawOfferFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoOfferFrom = useOffersStore((s) => s.undoOfferFrom);
  const undoLastMove = useGameStore((s) => s.undoLastMove);
  const historyLen = useGameStore((s) => s.positionHistory.length);
  const disabled = status !== 'playing' || historyLen === 0 || drawOfferFrom !== null || undoOfferFrom !== null;

  const onClick = () => {
    if (online.isOnline) {
      const c = pluginGet<OnlineGameConnector>('gameConnector');
      if (c) c.sendUndoOffer(1);
    } else {
      undoLastMove(1);
    }
  };

  return (
    <button type="button" className="act" disabled={disabled} onClick={onClick}>
      {t('cmd.undo')}
    </button>
  );
}

/**
 * 相手からの引分/待った申し出を受けたときに表示する承諾/拒否モーダル（v0.33）。
 * オンライン専用（相手からの申し出は connector 経由でしか届かない）。
 */
function OfferReceivedModal({ t }: { t: (key: string) => string }) {
  const drawFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoFrom = useOffersStore((s) => s.undoOfferFrom);
  const historyLen = useGameStore((s) => s.positionHistory.length);

  if (drawFrom === 'opp') {
    return (
      <FloatingPanel className="floating-result floating-confirm" title={t('draw.receivedTitle')}>
        <div className="body">{t('draw.receivedBody')}</div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const c = pluginGet<OnlineGameConnector>('gameConnector');
              if (c) c.sendDrawResponse(false);
            }}
          >
            {t('offer.reject')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              const c = pluginGet<OnlineGameConnector>('gameConnector');
              if (c) c.sendDrawResponse(true);
            }}
          >
            {t('offer.accept')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  if (undoFrom === 'opp') {
    // 履歴なしの場合 accept ボタンは disabled
    const canAccept = historyLen > 0;
    return (
      <FloatingPanel className="floating-result floating-confirm" title={t('undo.receivedTitle')}>
        <div className="body">{t('undo.receivedBody')}</div>
        <div className="btn-row">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              const c = pluginGet<OnlineGameConnector>('gameConnector');
              if (c) c.sendUndoResponse(false, 1);
            }}
          >
            {t('offer.reject')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canAccept}
            onClick={() => {
              const c = pluginGet<OnlineGameConnector>('gameConnector');
              if (c) c.sendUndoResponse(true, 1);
            }}
          >
            {t('offer.accept')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  return null;
}

/**
 * 自分が申し出中の間、待機表示を右下に出す（v0.33）。
 * ドラッグはしない小さな受動的表示。
 */
function OfferSentToast({ t }: { t: (key: string) => string }) {
  const drawFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoFrom = useOffersStore((s) => s.undoOfferFrom);
  if (drawFrom !== 'me' && undoFrom !== 'me') return null;
  const label = drawFrom === 'me' ? t('draw.sentWaiting') : t('undo.sentWaiting');
  return <div className="offer-sent-toast">{label}</div>;
}

/**
 * 直前の応答が拒否だった場合に短時間表示するトースト（v0.33）。
 * 承諾は既に盤面反映されるので別途表示不要。
 */
function OfferResponseToast({ t }: { t: (key: string) => string }) {
  const kind = useOffersStore((s) => s.lastResponseKind);
  const accepted = useOffersStore((s) => s.lastResponseAccepted);
  const setLastResponse = useOffersStore((s) => s.setLastResponse);

  useEffect(() => {
    if (kind === null) return;
    // 4 秒後に自動でトーストを消す
    const timer = setTimeout(() => setLastResponse(null, null), 4000);
    return () => clearTimeout(timer);
  }, [kind, accepted, setLastResponse]);

  if (kind === null || accepted === null) return null;
  if (accepted) return null; // 承諾は盤面反映で済み、明示表示は不要
  const label = kind === 'draw' ? t('draw.rejectedByOpp') : t('undo.rejectedByOpp');
  return <div className="offer-response-toast">{label}</div>;
}

/**
 * 投了ボタン。オンライン対戦時は自分の側の投了、
 * オフライン時は現在の手番の側の投了として扱う。
 * 対局終了状態では disabled。段階 2-7 v0.30。
 */
function ResignButton({
  t,
  online,
  status,
  sideToMove,
}: {
  t: (key: string) => string;
  online: {
    isOnline: boolean;
    mySide: 'player1' | 'player2' | null;
    myName: string;
    opponentName: string;
  };
  status: string;
  sideToMove: 'player1' | 'player2';
}) {
  const [confirming, setConfirming] = useState(false);
  const gameOver = status !== 'playing';
  const doResign = () => {
    // オンラインなら自分の側を投了、オフラインなら現在の手番の側を投了
    const side: 'player1' | 'player2' = online.isOnline && online.mySide ? online.mySide : sideToMove;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) {
      c.sendResign(side);
    } else {
      // A ビルド（オフライン）は connector がないので直接 store を叩く
      useGameStore.getState().resign(side);
    }
    setConfirming(false);
  };
  return (
    <>
      <button
        type="button"
        className="act danger"
        disabled={gameOver}
        onClick={() => setConfirming(true)}
      >
        {t('cmd.resign')}
      </button>
      {confirming && (
        <FloatingPanel className="floating-result floating-confirm" title={t('resign.confirmTitle')}>
          <div className="body">{t('resign.confirmBody')}</div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              {t('resign.confirmNo')}
            </button>
            <button type="button" className="btn danger" onClick={doResign}>
              {t('resign.confirmYes')}
            </button>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}

/**
 * 対局終了時のフローティング結果パネル（v0.30 新設・v0.31 で改造）。
 *
 * v0.31 変更:
 * - 全画面オーバーレイを廃止し、盤面が見える半透明のパネルに
 * - タイトル部を掴んでドラッグで移動可能
 * - 「対戦ロビーに戻る」を「対局準備に戻る」に変更（部屋を継続、同じルールで再対局）
 * - オフラインは「もう一度対局」で盤面をリセットして続行
 * - 「閉じる」で一時的に隠せる（盤面を見返すため）。次に status が変わったら再表示
 */
function GameEndModal({
  t,
  online,
}: {
  t: (key: string) => string;
  online: {
    isOnline: boolean;
    mySide: 'player1' | 'player2' | null;
    myName: string;
    opponentName: string;
  };
}) {
  const status = useGameStore((s) => s.status);
  const position = useGameStore((s) => s.position);
  const reset = useGameStore((s) => s.reset);
  const [dismissed, setDismissed] = useState<string>('');

  useEffect(() => {
    setDismissed('');
  }, [status]);

  if (status === 'playing') return null;
  if (dismissed === status) return null;

  // 誰が勝ちで誰が負けか（絶対 side ベース）
  let winnerSide: 'player1' | 'player2' | null;
  let reasonKey: string;
  switch (status) {
    case 'checkmate':
      winnerSide = position.sideToMove === 'player1' ? 'player2' : 'player1';
      reasonKey = 'result.reason.checkmate';
      break;
    case 'nyugyoku_win_p1':
      winnerSide = 'player1';
      reasonKey = 'result.reason.nyugyoku';
      break;
    case 'nyugyoku_win_p2':
      winnerSide = 'player2';
      reasonKey = 'result.reason.nyugyoku';
      break;
    case 'resigned_p1':
      winnerSide = 'player2';
      reasonKey = 'result.reason.resign';
      break;
    case 'resigned_p2':
      winnerSide = 'player1';
      reasonKey = 'result.reason.resign';
      break;
    case 'sennichite':
      winnerSide = null;
      reasonKey = 'result.reason.sennichite';
      break;
    case 'agreed_draw':
      winnerSide = null;
      reasonKey = 'result.reason.agreed_draw';
      break;
    default:
      return null;
  }

  // 表示は「自分視点」を優先、なければ絶対 side（先手/後手）
  let verdictKey: string;
  let reasonSuffix = '';
  if (winnerSide === null) {
    verdictKey = 'result.verdict.draw';
  } else if (online.isOnline && online.mySide) {
    if (winnerSide === online.mySide) {
      verdictKey = 'result.verdict.win';
      if (status === 'resigned_p1' || status === 'resigned_p2') {
        reasonSuffix = ` (${t('result.reason.resign.opp')})`;
      }
    } else {
      verdictKey = 'result.verdict.lose';
      if (status === 'resigned_p1' || status === 'resigned_p2') {
        reasonSuffix = ` (${t('result.reason.resign.mine')})`;
      }
    }
  } else {
    verdictKey = winnerSide === 'player1' ? 'result.verdict.senteWin' : 'result.verdict.goteWin';
  }

  // 「対局準備に戻る」or「もう一度対局」— 同じ部屋で再対局を可能に
  const rematchLabel = online.isOnline ? t('result.rematch.online') : t('result.rematch.offline');
  const onRematch = () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (online.isOnline && c) {
      c.returnToPreparation();
    } else {
      reset();
      setDismissed(status);
    }
  };

  const verdictClass =
    winnerSide === null ? 'draw' : online.isOnline && online.mySide === winnerSide ? 'win' : online.isOnline ? 'lose' : '';

  return (
    <FloatingPanel key={status} className="floating-result" title={t('result.title')}>
      <div className={`verdict ${verdictClass}`}>{t(verdictKey)}</div>
      <div className="body">
        {t(reasonKey)}
        {reasonSuffix}
      </div>
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={() => setDismissed(status)}>
          {t('result.close')}
        </button>
        <button type="button" className="btn" onClick={onRematch}>
          {rematchLabel}
        </button>
      </div>
    </FloatingPanel>
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

function PieceView({
  piece,
  locale,
  viewerSide = 'player1',
}: {
  piece: PieceInstance;
  locale: LocaleCode;
  viewerSide?: 'player1' | 'player2';
}) {
  const name = pieceNameFor(piece.kind, locale);
  const isEn = locale === 'en';
  const isMulti = isEn && name.length > 1;
  // v0.34: gote 反転は viewer 基準（相手の駒＝反転して viewer 側から見て逆向き）
  const cls = [
    'pc',
    piece.owner !== viewerSide ? 'gote' : '',
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
