import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { useGameStore } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import { useOffersStore } from '../store/offers-store';
import { ChatConsole } from './ChatConsole';
import { useRouteStore } from '../store/route-store';
import { get as pluginGet } from '../plugin/registry';
import { seMove, seCheck, seFanfareWin, seGameLose, sePause, seResume, seSelect, seCapture } from '../audio/se-synth';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { PieceInstance } from '../engine';
import { isInCheck, positionHash } from '../engine';
import { pieceNameFor } from '../engine/kifu/format';
import { strengthOf } from '../engine/piece-strength';
import { CatIcon } from './CatIcon';
import { FloatingPanel } from './FloatingPanel';
import { HeaderCommonRight } from './HeaderCommonRight';
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
    // v0.35: 送信直後の自分側の時計状態を添えて時計をシンク
    const mySide = online.mySide;
    const clocks = useGameStore.getState().clocks;
    const myClock = mySide ? clocks[mySide] : null;
    const timePayload = myClock ? { mainMs: myClock.mainMs, byoyomiMs: myClock.byoyomiMs, inByoyomi: myClock.inByoyomi } : undefined;
    // v0.52 (段階 2-6): 送信直後の自分の局面ハッシュを添える。受信側が着手適用後に
    // 照合してズレを検知する。
    const hashPayload = positionHash(useGameStore.getState().position);
    if (move.type === 'move') {
      c.sendMove({
        kind: 'move',
        pieceId: move.pieceId,
        from: move.from,
        to: move.to,
        promote: move.promote,
        time: timePayload,
        hash: hashPayload,
      });
    } else {
      c.sendMove({
        kind: 'drop',
        pieceId: move.pieceId,
        to: move.to,
        time: timePayload,
        hash: hashPayload,
      });
    }
  }, [lastAppliedMove, online.isOnline, online.mySide]);

  // v0.35 ticker → v0.38: アンカー方式に置換。手番開始時の (時計値, Date.now()) を anchor に、
  // 各 tick で elapsed = Date.now() - anchor.at をもとに絶対再計算する。
  // 積算 delta 方式ではないため累積誤差ゼロ、Date.now() は OS 時計と同期するので長時間対局でも drift しない。
  // 相手からの syncClock は「動いていない側」の時計を更新するので、この anchor には影響しない。
  // v0.42: 待った申し出中は両者の時計を止める（申し出者・相手ともに）。中断中と合わせて undoOfferPending も deps に。
  const activeClockSide = useGameStore((s) => s.activeClockSide);
  const paused = useGameStore((s) => s.paused);
  const undoOfferPending = useOffersStore((s) => s.undoOfferFrom) !== null;
  useEffect(() => {
    if (!activeClockSide) return;
    if (status !== 'playing') return;
    if (paused) return; // 一時中断中は tick しない
    if (undoOfferPending) return; // v0.42: 待った申し出中は両者の時計を止める
    const anchorSide = activeClockSide;
    const anchorAt = Date.now();
    const s = useGameStore.getState();
    const anchorClock = { ...s.clocks[anchorSide] };
    const tc = s.timeControl;
    if (tc.mode === 'no_limit') return;

    const advance = () => {
      const elapsed = Date.now() - anchorAt;
      let next = { ...anchorClock };
      let timedOut = false;
      if (anchorClock.inByoyomi) {
        const newByo = anchorClock.byoyomiMs - elapsed;
        if (newByo <= 0) {
          next.byoyomiMs = 0;
          timedOut = true;
        } else {
          next.byoyomiMs = newByo;
        }
      } else {
        const newMain = anchorClock.mainMs - elapsed;
        if (newMain > 0) {
          next.mainMs = newMain;
        } else if (tc.mode === 'byoyomi') {
          // 本時間切れ → 秒読み突入。elapsed のうち本時間ぶんを超えた分を秒読みから引く
          const excess = -newMain;
          const byoTotal = (tc.byoyomiSeconds ?? 0) * 1000;
          const newByo = byoTotal - excess;
          next.mainMs = 0;
          next.inByoyomi = true;
          if (newByo <= 0) {
            next.byoyomiMs = 0;
            timedOut = true;
          } else {
            next.byoyomiMs = newByo;
          }
        } else {
          // sudden_death / fischer で本時間切れ → 即負け
          next.mainMs = 0;
          timedOut = true;
        }
      }
      if (timedOut) {
        useGameStore.getState().timeout(anchorSide);
      } else {
        useGameStore.getState().syncClock(anchorSide, next);
      }
    };

    advance(); // 初回即時
    const interval = setInterval(advance, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClockSide, status, paused, undoOfferPending]);

  // v0.35: 時間切れになったら相手に通知
  useEffect(() => {
    if (status !== 'timeout_p1' && status !== 'timeout_p2') return;
    if (!online.isOnline) return;
    const timedOutSide: 'player1' | 'player2' = status === 'timeout_p1' ? 'player1' : 'player2';
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) c.sendTimeout(timedOutSide);
  }, [status, online.isOnline]);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const senteInCheck = isInCheck(mgf, position, 'player1');
  const goteInCheck = isInCheck(mgf, position, 'player2');

  // v0.73 音響: 駒取り検出用に前回の持ち駒数を保持
  const prevHandsRef = useRef({ p1: position.hands.player1.length, p2: position.hands.player2.length });
  // v0.72/v0.73 音響: 着手音 (取ったなら capture、それ以外は move) と、王手音
  useEffect(() => {
    if (!lastAppliedMove) return;
    const curP1 = position.hands.player1.length;
    const curP2 = position.hands.player2.length;
    const wasCapture = curP1 > prevHandsRef.current.p1 || curP2 > prevHandsRef.current.p2;
    prevHandsRef.current = { p1: curP1, p2: curP2 };
    if (wasCapture) seCapture();
    else seMove();
    // 着手後、手番が回ってきた側 (position.sideToMove) が王手されているか判定
    const inCheck = position.sideToMove === 'player1' ? senteInCheck : goteInCheck;
    if (inCheck) setTimeout(seCheck, 90);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastAppliedMove]);

  // v0.72 音響: 勝敗の効果音 (自分視点)
  useEffect(() => {
    if (status === 'playing' || status === 'sennichite' || status === 'agreed_draw') return;
    // オンライン: 自分の勝ちなら fanfare、負けなら lose。オフラインでは負けた側視点で lose。
    const winnerSide: 'player1' | 'player2' | null =
      status === 'checkmate' ? (position.sideToMove === 'player1' ? 'player2' : 'player1')
      : status === 'resigned_p1' ? 'player2'
      : status === 'resigned_p2' ? 'player1'
      : status === 'timeout_p1' ? 'player2'
      : status === 'timeout_p2' ? 'player1'
      : status === 'nyugyoku_win_p1' ? 'player1'
      : status === 'nyugyoku_win_p2' ? 'player2'
      : null;
    if (!winnerSide) return;
    if (online.isOnline) {
      if (winnerSide === online.mySide) seFanfareWin();
      else seGameLose();
    } else {
      // オフライン: 対局終了は「誰かの負け」体験として lose 音
      seGameLose();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // v0.72 音響: 一時停止 / 再開音
  const prevPausedRef = useRef(paused);
  useEffect(() => {
    if (prevPausedRef.current !== paused) {
      if (paused) sePause();
      else seResume();
    }
    prevPausedRef.current = paused;
  }, [paused]);

  // v0.74: チャット音の発火は ChatConsole 側に移動 (S06/S07 共通化)
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
                  : status === 'timeout_p1'
                    ? t('status.timeout_p1')
                    : status === 'timeout_p2'
                      ? t('status.timeout_p2')
                      : online.isOnline
                  ? (isMyTurnOnline ? t('turn.mine') : t('turn.opp')) +
                    (position.sideToMove === 'player1' ? (senteInCheck ? t('s07.checkTag') : '') : goteInCheck ? t('s07.checkTag') : '')
                    : position.sideToMove === 'player1'
                      ? t('s07.senteTurn') + (senteInCheck ? t('s07.checkTag') : '')
                      : t('s07.goteTurn') + (goteInCheck ? t('s07.checkTag') : '');

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
      seSelect(); // v0.73 音響: 駒選択音
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
    seSelect(); // v0.73 音響: 持ち駒選択音
  };

  const senteHandGrouped = groupHand(position.hands.player1);
  const goteHandGrouped = groupHand(position.hands.player2);
  // v0.34: 相手／自分 の持ち駒を viewer 基準で
  const oppHandGrouped = viewerSide === 'player1' ? goteHandGrouped : senteHandGrouped;
  const myHandGrouped = viewerSide === 'player1' ? senteHandGrouped : goteHandGrouped;
  const oppSideLabel = oppSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl');
  const mySideLabel = viewerSide === 'player1' ? t('s07.senteLbl') : t('s07.goteLbl');

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
                    {t('s07.leaveGame')}
                  </button>
                </>
              ) : (
                <>
                  {/* v0.68: オフライン対局はオフライン設定から入るので、戻り先も
                      オフライン設定にする (以前はメニューまで戻していた) */}
                  <button
                    className="reset-btn"
                    type="button"
                    onClick={() => useRouteStore.getState().setScreen('offline-rule')}
                  >
                    {t('s07.backToOfflineSetup')}
                  </button>
                  <button className="reset-btn" type="button" onClick={() => reset()}>
                    {t('s07.reset')}
                  </button>
                </>
              )}
              <HeaderCommonRight includeCat={variant === 'b'} />
            </div>
          </header>

          {/* v0.68: 従来の「S07 · 対局」バンドをルール表示に置換。
              オフライン (rules===null) は本将棋のみ表示、オンラインは gameType +
              トーラス/量子のチップ列。 */}
          <div style={{ marginTop: 4, padding: '3px 2px', fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text)', fontWeight: 700 }}>
              {(() => {
                const g = pluginGet<OnlineGameConnector>('gameConnector')?.getActiveRules()?.gameType ?? 'shogi';
                return g === 'hasami' ? t('s07.ruleHasami') : g === 'shogi-custom' ? t('s07.ruleCustom') : t('s07.ruleShogi');
              })()}
            </span>
            {(() => {
              const r = pluginGet<OnlineGameConnector>('gameConnector')?.getActiveRules();
              if (!r) return null;
              return (
                <>
                  {r.torusMode === 'cylinder' && <span className="chip mod">{t('s04.summaryTorusCyl')}</span>}
                  {r.torusMode === 'full' && <span className="chip mod">{t('s04.summaryTorusFull')}</span>}
                  {r.quantum && <span className="chip mod">{t('s04.summaryQuantum')}</span>}
                </>
              );
            })()}
          </div>

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
            {/* v0.51: モック S06_mock_v7 由来のレーティング表示 (「先手 · 1420」など)。
                レーティング機構は Phase 9 で実装。それまで 0 固定。 */}
            <span className="sub">
              {oppSideLabel} · {0}
            </span>
            <ClockDisplay side={oppSide} active={activeClockSide === oppSide} t={t} />
          </div>

          <div className="broadcast">
            <BoardBlocker />
            <PieceStandView
              side="opp"
              pieces={oppHandGrouped}
              onClick={(pid) => onHandPieceClick(oppSide, pid)}
              selectedId={selectedHandPieceId}
              activePlayer={position.sideToMove === oppSide}
              locale={locale}
              label={oppSideLabel}
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
                <div className="board" aria-label={t('s07.boardAria')}>
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
              label={mySideLabel}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">{online.myName || t('player.you')}</span>
            <span className="sub">
              {mySideLabel} · {0}
            </span>
            <ClockDisplay side={viewerSide} active={activeClockSide === viewerSide} t={t} />
          </div>

          <div className="command-bar">
            <button type="button" className="act taunt">
              {t('cmd.taunt')} <span className="cnt">3</span>
            </button>
            <UndoButton t={t} online={online} status={status} sideToMove={position.sideToMove} />
            <DrawButton t={t} online={online} status={status} sideToMove={position.sideToMove} />
            <PauseButton t={t} online={online} status={status} />
            <ResignButton t={t} online={online} status={status} sideToMove={position.sideToMove} />
            <button type="button" className="act" onClick={clearSelection}>
              {t('cmd.cancel')}
            </button>
            <NyugyokuButton t={t} />
          </div>
        </div>

        <div className="chat-col">
          {/* v0.68: オフライン対戦では相手不在なのでチャット・観戦者パネルを
              視覚的に「使えない」と分かるようにグレーアウトする */}
          <div className={`panel${!online.isOnline ? ' offline-disabled' : ''}`}>
            <div className="panel-label">
              <span>{t('chat.title')}</span>
            </div>
            <ChatConsole t={t} />
          </div>

          <div className={`panel spectators${!online.isOnline ? ' offline-disabled' : ''}`} style={{ marginTop: 12 }}>
            <div className="panel-label">
              <span>{t('spec.title')}</span>
            </div>
            <div className="spec-empty">{t('spec.empty')}</div>
          </div>

          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-label">
              <span>{t('s07.kifuTitle')}</span>
            </div>
            <div className="console">
              <div className="chat-log" ref={kifuScrollRef} style={{ maxHeight: 180 }}>
                {moveHistory.length === 0 ? (
                  <div className="spec-empty">{t('s07.kifuEmpty')}</div>
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
      <PromotionModal locale={locale} t={t} viewerSide={viewerSide} />
      <OpponentLeftModal t={t} />
      <GameEndModal t={t} online={online} />
      <OfferReceivedModal t={t} online={online} />
      <OfferSentPanel t={t} />
      <PauseCenterPanel t={t} />
      <OfferResponseToast t={t} />
      <ConnectionUncertainBanner t={t} />
    </div>
  );
}

/**
 * v0.47-0.48: サーバー経由の連絡経路 (WS) だけが瞬断した際に画面上部へ出すバナー。
 *
 * v0.47 は「20 秒待って何もなければ OK と判定」だったが、これだと WebRTC の
 * 「静かに死んだ状態」(UDP なので相手が黙り込んでもすぐには切断判定されない) を
 * 検知できず、対局が凍りついた。
 *
 * v0.48 の判定:
 *   1. バナー開始と同時に相手に ping を送る (以後 2 秒おきに継続)
 *   2. 相手から何らかのメッセージ (pong 含む) が届けば P2P 直通は健在
 *      → バナーを畳んで対局続行
 *   3. 10 秒経っても届かなければ P2P も静かに死んだと判定
 *      → wsPendingReconnect を降ろし、opponentLeftDuringGame を立てて退室モーダルへ
 */
function ConnectionUncertainBanner({ t }: { t: (key: string) => string }) {
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(10);

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const update = () => setPending(c.getWsPendingReconnect());
    update();
    return c.subscribe(update);
  }, []);

  useEffect(() => {
    if (!pending) {
      setRemaining(10);
      return;
    }
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    const startedAt = Date.now();
    setRemaining(10);
    // 相手が最近メッセージを送ってきていれば即 healthy とみなす。
    // そうでなければバナー開始時点をカットオフに使う。
    const cutoff = startedAt;

    // 即 ping、以後 2 秒おきに送信
    c.sendPing();
    const pingId = setInterval(() => {
      const stillPending = pluginGet<OnlineGameConnector>('gameConnector')?.getWsPendingReconnect();
      if (stillPending) c.sendPing();
    }, 2000);

    const checkId = setInterval(() => {
      const conn = pluginGet<OnlineGameConnector>('gameConnector');
      if (!conn) return;
      const last = conn.getLastPeerMessageAt();
      const elapsed = Date.now() - startedAt;
      setRemaining(Math.max(0, 10 - Math.floor(elapsed / 1000)));
      if (last !== null && last >= cutoff) {
        // 生存確認できた → バナーを畳んで対局続行
        clearInterval(pingId);
        clearInterval(checkId);
        conn.markConnectionHealthy();
        return;
      }
      if (elapsed >= 10_000) {
        // 10 秒経過しても生存確認できず → 対局中断へ escalate
        clearInterval(pingId);
        clearInterval(checkId);
        conn.markConnectionDead();
      }
    }, 500);

    return () => {
      clearInterval(pingId);
      clearInterval(checkId);
    };
  }, [pending]);

  if (!pending) return null;
  return (
    <div className="connection-banner" role="status" aria-live="polite">
      <span className="icon">⚠</span>
      <span className="msg">{t('conn.uncertain')}</span>
      <span className="cnt">{remaining}s</span>
    </div>
  );
}

/**
 * v0.42: 盤面と持ち駒を隠すフィルター。
 * 待った申し出中（me/opp どちらも）と一時中断中（＝再開合意含む）で表示。
 * 引分・投了確認では出さない。
 */
function BoardBlocker() {
  const paused = useGameStore((s) => s.paused);
  const undoOfferFrom = useOffersStore((s) => s.undoOfferFrom);
  if (!paused && undoOfferFrom === null) return null;
  return <div className="board-blocker" aria-hidden="true" />;
}

/**
 * 引分申し出ボタン（段階 2-7 v0.33、v0.42 で制約追加）。
 * オフライン: クリック→確認モーダル→即引分終局。
 * オンライン: クリック→相手に申し出送信＋盤面中央パネル＋キャンセル可。
 *   - 自分の手番中のみ活性
 *   - 秒読み残り 15 秒以下なら不可
 *   - 申し出中も自分側の時計は動く（Q1B）
 * 対局終了 or 一時中断中 or 別の申し出待ちで disabled。
 */
function DrawButton({
  t,
  online,
  status,
  sideToMove,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
  sideToMove: 'player1' | 'player2';
}) {
  const anyOffer = useAnyOfferPending();
  const paused = useGameStore((s) => s.paused);
  const clocks = useGameStore((s) => s.clocks);
  const agreeDraw = useGameStore((s) => s.agreeDraw);
  const [confirming, setConfirming] = useState(false);

  // v0.42 制約: 自分の手番中のみ、秒読み 15 秒以下は不可（オンライン時）
  const mySide = online.mySide;
  const notMyTurn = online.isOnline && mySide !== null && mySide !== sideToMove;
  const myClock = online.isOnline && mySide ? clocks[mySide] : null;
  const byoyomiTooLow =
    !!myClock && myClock.inByoyomi && myClock.byoyomiMs <= 15_000;

  const disabled = status !== 'playing' || paused || anyOffer || notMyTurn || byoyomiTooLow;

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
        <FloatingPanel
          className="floating-result floating-confirm draw"
          title={
            <>
              <span className="icon">🤝</span>
              {t('draw.confirmTitle')}
            </>
          }
        >
          <div className="body">{t('draw.confirmBody')}</div>
          <div className="body warn">{t('offer.notResignNote')}</div>
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={() => setConfirming(false)}>
              {t('draw.confirmNo')}
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

/** どの合意フロー申し出が pending か（v0.42：pause は合意不要なので除外） */
function useAnyOfferPending(): boolean {
  const draw = useOffersStore((s) => s.drawOfferFrom);
  const undo = useOffersStore((s) => s.undoOfferFrom);
  const resume = useOffersStore((s) => s.resumeOfferFrom);
  return draw !== null || undo !== null || resume !== null;
}

/**
 * 待った申し出ボタン（v0.42 改装）。
 * count 判定:
 *   - 自分の手番 (＝相手が指した後) → 2手戻す（相手の直前手＋自分の1手）
 *   - 相手の手番 (＝自分が指しただけ) → 1手戻す
 * challengerSide は自分の side。承諾されると承諾者の時計だけ復元される。
 * オフライン: 即実行（時計は両側巻き戻し）。
 * オンライン: 相手に申し出＋盤面中央パネル＋キャンセル可＋両者時計停止。
 */
function UndoButton({
  t,
  online,
  status,
  sideToMove,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
  sideToMove: 'player1' | 'player2';
}) {
  const anyOffer = useAnyOfferPending();
  const paused = useGameStore((s) => s.paused);
  const undoLastMove = useGameStore((s) => s.undoLastMove);
  const historyLen = useGameStore((s) => s.positionHistory.length);
  // v0.44: 待ったで戻せるのは「自分の手」だけ。自分の手が 0 なら不可。
  //   sente の自手数 = ceil(historyLen/2)、gote の自手数 = floor(historyLen/2)
  //   オフラインは相手概念がないので全手を自分の手扱い（historyLen 直接）。
  const myOwnMoveCount =
    online.isOnline && online.mySide
      ? online.mySide === 'player1'
        ? Math.ceil(historyLen / 2)
        : Math.floor(historyLen / 2)
      : historyLen;
  const disabled = status !== 'playing' || paused || myOwnMoveCount === 0 || anyOffer;

  const onClick = () => {
    if (online.isOnline) {
      const c = pluginGet<OnlineGameConnector>('gameConnector');
      if (!c) return;
      const mySide = online.mySide;
      if (!mySide) return;
      // 自分の手番 = 相手が直前に指した → 2 手戻す（相手＋自分）
      // 相手の手番 = 自分が指しただけ → 1 手戻す
      // どちらの場合も disabled チェックで自分の手が 1 手以上あることは保証済み。
      const count = sideToMove === mySide ? 2 : 1;
      c.sendUndoOffer(count, mySide);
    } else {
      // オフラインは相手役もいないので単純に 1 手戻す（両側の時計も戻す）
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
 * 一時中断／再開ボタン（v0.42 改装）。paused=false のとき「一時中断」、paused=true のとき「再開」。
 * 一時中断: 合意不要。即中断＋相手へ通知。
 * 再開: 双方合意。相手に申し出→承諾で解除。
 */
function PauseButton({
  t,
  online,
  status,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
}) {
  const paused = useGameStore((s) => s.paused);
  const pauseGame = useGameStore((s) => s.pauseGame);
  const resumeGame = useGameStore((s) => s.resumeGame);
  const anyOffer = useAnyOfferPending();
  const gameOver = status !== 'playing';
  const disabled = gameOver || anyOffer;

  const onClick = () => {
    if (paused) {
      // 再開は合意必要
      if (online.isOnline) {
        const c = pluginGet<OnlineGameConnector>('gameConnector');
        if (c) c.sendResumeOffer();
      } else {
        resumeGame();
      }
    } else {
      // 一時中断は合意不要
      if (online.isOnline) {
        const c = pluginGet<OnlineGameConnector>('gameConnector');
        if (c) c.sendPauseNotify();
      } else {
        pauseGame();
      }
    }
  };

  const label = paused ? t('cmd.resume') : t('cmd.pause');
  return (
    <button type="button" className={`act${paused ? ' resume-active' : ''}`} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

/**
 * 相手からの引分／待った／再開申し出を受けたときに表示する承諾/拒否モーダル。
 * v0.42: 一時中断は合意不要のためここには出さない（PauseCenterPanel が担当）。
 */
function OfferReceivedModal({
  t,
  online,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
}) {
  const drawFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoFrom = useOffersStore((s) => s.undoOfferFrom);
  const undoMeta = useOffersStore((s) => s.undoOfferMeta);
  const resumeFrom = useOffersStore((s) => s.resumeOfferFrom);
  const historyLen = useGameStore((s) => s.positionHistory.length);

  const send = (fn: (c: OnlineGameConnector) => void) => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) fn(c);
  };

  if (drawFrom === 'opp') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm draw"
        title={
          <>
            <span className="icon">🤝</span>
            {t('draw.receivedTitle')}
          </>
        }
      >
        <div className="body">{t('draw.receivedBody')}</div>
        <div className="body warn">{t('offer.notResignNote')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => send((c) => c.sendDrawResponse(false))}>
            {t('draw.rejectAction')}
          </button>
          <button type="button" className="btn" onClick={() => send((c) => c.sendDrawResponse(true))}>
            {t('draw.acceptAction')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  if (undoFrom === 'opp') {
    const count = undoMeta?.count ?? 1;
    const canAccept = historyLen >= count;
    // v0.42: 説明文に「n 手戻す」を表示（受信側にとって count=2 なら「自分の直前手が消える」意味）
    const bodyText = t('undo.receivedBody').replace('{n}', String(count));
    return (
      <FloatingPanel
        className="floating-result floating-confirm undo"
        title={
          <>
            <span className="icon">🙏</span>
            {t('undo.receivedTitle')}
          </>
        }
      >
        <div className="body">{bodyText}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => send((c) => c.sendUndoResponse(false))}>
            {t('undo.rejectAction')}
          </button>
          <button type="button" className="btn" disabled={!canAccept} onClick={() => send((c) => c.sendUndoResponse(true))}>
            {t('undo.acceptAction')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  if (resumeFrom === 'opp') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm resume"
        title={
          <>
            <span className="icon">▶</span>
            {t('resume.receivedTitle')}
          </>
        }
      >
        <div className="body">{t('resume.receivedBody')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => send((c) => c.sendResumeResponse(false))}>
            {t('resume.rejectAction')}
          </button>
          <button type="button" className="btn" onClick={() => send((c) => c.sendResumeResponse(true))}>
            {t('resume.acceptAction')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  // オフラインで online.isOnline=false のときは opp からの申し出は来ない。
  void online;
  return null;
}

/**
 * v0.42: 自分が申し出中のとき盤面中央にパネル表示＋撤回ボタン。
 * 引分・待った・再開の 3 種。
 */
function OfferSentPanel({ t }: { t: (key: string) => string }) {
  const drawFrom = useOffersStore((s) => s.drawOfferFrom);
  const undoFrom = useOffersStore((s) => s.undoOfferFrom);
  const resumeFrom = useOffersStore((s) => s.resumeOfferFrom);

  const send = (fn: (c: OnlineGameConnector) => void) => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) fn(c);
  };

  if (drawFrom === 'me') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm draw"
        title={
          <>
            <span className="icon">🤝</span>
            {t('draw.sentWaiting')}
          </>
        }
      >
        <div className="body">{t('offer.waitingBody')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => send((c) => c.sendDrawCancel())}>
            {t('offer.cancelAction')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  if (undoFrom === 'me') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm undo"
        title={
          <>
            <span className="icon">🙏</span>
            {t('undo.sentWaiting')}
          </>
        }
      >
        <div className="body">{t('offer.waitingBody')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={() => send((c) => c.sendUndoCancel())}>
            {t('offer.cancelAction')}
          </button>
        </div>
      </FloatingPanel>
    );
  }
  if (resumeFrom === 'me') {
    return (
      <FloatingPanel
        className="floating-result floating-confirm resume"
        title={
          <>
            <span className="icon">▶</span>
            {t('resume.sentWaiting')}
          </>
        }
      >
        <div className="body">{t('offer.waitingBody')}</div>
      </FloatingPanel>
    );
  }
  return null;
}

/**
 * v0.42: 一時中断中の盤面中央パネル。
 * paused=true かつ resume 合意フロー中でない・relayed from opp でもないときに、
 * 「一時中断中」の告知を出す。両者共通。
 * ここでは撤回ボタンは出さない（PauseButton が「再開」に切り替わる）。
 */
function PauseCenterPanel({ t }: { t: (key: string) => string }) {
  const paused = useGameStore((s) => s.paused);
  const resumeFrom = useOffersStore((s) => s.resumeOfferFrom);
  if (!paused) return null;
  if (resumeFrom !== null) return null; // 再開合意フロー中は OfferReceivedModal / OfferSentPanel が担当
  return (
    <FloatingPanel
      className="floating-result floating-confirm pause"
      title={
        <>
          <span className="icon">⏸</span>
          {t('pause.title')}
        </>
      }
    >
      <div className="body">{t('pause.body')}</div>
    </FloatingPanel>
  );
}

/**
 * v0.42: 拒否・撤回・中断通知を短時間トースト表示。
 * 直前 4 秒以内の通知のみ表示、自動で消える。
 */
function OfferResponseToast({ t }: { t: (key: string) => string }) {
  const kind = useOffersStore((s) => s.lastNoticeKind);
  const type = useOffersStore((s) => s.lastNoticeType);
  const setNotice = useOffersStore((s) => s.setNotice);

  useEffect(() => {
    if (kind === null) return;
    const timer = setTimeout(() => setNotice(null, null), 4000);
    return () => clearTimeout(timer);
  }, [kind, type, setNotice]);

  if (kind === null || type === null) return null;
  const key =
    type === 'rejected'
      ? kind === 'draw'
        ? 'draw.rejectedByOpp'
        : kind === 'undo'
          ? 'undo.rejectedByOpp'
          : kind === 'resume'
            ? 'resume.rejectedByOpp'
            : 'pause.rejectedByOpp'
      : /* cancelled */
        kind === 'draw'
        ? 'draw.cancelledByOpp'
        : kind === 'undo'
          ? 'undo.cancelledByOpp'
          : kind === 'pause'
            ? 'pause.notifiedByOpp'
            : 'resume.cancelledByOpp';
  return <div className="offer-response-toast">{t(key)}</div>;
}

/**
 * v0.35: 各プレイヤーの時計表示（本時間 + 秒読み / 制限なしは ∞）
 * active=true のとき色を強調して「今動いている時計」を示す
 */
function ClockDisplay({
  side,
  active,
  t,
}: {
  side: 'player1' | 'player2';
  active: boolean;
  t: (key: string) => string;
}) {
  const clock = useGameStore((s) => s.clocks[side]);
  const tc = useGameStore((s) => s.timeControl);
  if (tc.mode === 'no_limit') {
    return (
      <>
        <span className={`clk${active ? ' running' : ''}`}>∞</span>
        <span className="byo">&nbsp;</span>
      </>
    );
  }
  const mainStr = formatMainTime(clock.mainMs);
  const showByoyomi = tc.mode === 'byoyomi';
  // v0.36: 秒読み突入時（inByoyomi=true or 本時間 0）は byo を大きくオレンジ表示
  const byoyomiOn = showByoyomi && (clock.inByoyomi || clock.mainMs === 0);
  const byoStr = showByoyomi
    ? byoyomiOn
      ? `${t('clk.byoyomi')} ${Math.ceil(clock.byoyomiMs / 1000)}`
      : `${t('clk.byoyomi')} ${tc.byoyomiSeconds ?? 0}`
    : '';
  return (
    <>
      <span className={`clk${active ? ' running' : ''}`}>{mainStr}</span>
      <span className={`byo${byoyomiOn ? ' byoyomi-on' : ''}${byoyomiOn && active ? ' running' : ''}`}>{byoStr}</span>
    </>
  );
}

function formatMainTime(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
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
  const paused = useGameStore((s) => s.paused);
  const anyOffer = useAnyOfferPending();
  const doResign = () => {
    const side: 'player1' | 'player2' = online.isOnline && online.mySide ? online.mySide : sideToMove;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) {
      c.sendResign(side);
    } else {
      useGameStore.getState().resign(side);
    }
    setConfirming(false);
  };
  return (
    <>
      <button
        type="button"
        className="act danger"
        disabled={gameOver || paused || anyOffer}
        onClick={() => setConfirming(true)}
      >
        {t('cmd.resign')}
      </button>
      {confirming && (
        <FloatingPanel
          className="floating-result floating-confirm resign"
          title={
            <>
              <span className="icon">🙇</span>
              {t('resign.confirmTitle')}
            </>
          }
        >
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
    case 'timeout_p1':
      winnerSide = 'player2';
      reasonKey = 'result.reason.timeout';
      break;
    case 'timeout_p2':
      winnerSide = 'player1';
      reasonKey = 'result.reason.timeout';
      break;
    default:
      return null;
  }

  // 表示は「自分視点」を優先、なければ絶対 side（先手/後手）
  // v0.42: 投了の場合は「投了しました」「相手が投了」だけを reasonKey に上書きして冗長表示を避ける
  let verdictKey: string;
  if (winnerSide === null) {
    verdictKey = 'result.verdict.draw';
  } else if (online.isOnline && online.mySide) {
    if (winnerSide === online.mySide) {
      verdictKey = 'result.verdict.win';
      if (status === 'resigned_p1' || status === 'resigned_p2') {
        reasonKey = 'result.reason.resign.opp';
      }
    } else {
      verdictKey = 'result.verdict.lose';
      if (status === 'resigned_p1' || status === 'resigned_p2') {
        reasonKey = 'result.reason.resign.mine';
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
      <div className="body">{t(reasonKey)}</div>
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
  /** v0.87: viewer 基準の駒反転バグ修正。後手視点でも駒が上下正しく表示されるよう
   *  PieceView に viewer 情報を伝播する (既定値 'player1' へのフォールバックで
   *  後手時に piece.owner !== viewerSide となり誤って gote クラスが付いていた) */
  viewerSide: 'player1' | 'player2';
}

function PromotionModal({ locale, t, viewerSide }: PromotionModalProps) {
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
              <PieceView piece={nonPromotePiece} locale={locale} viewerSide={viewerSide} />
            </div>
          </button>
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(true)}>
            <div className="label">{t('promote.confirm')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={promotePiece} locale={locale} viewerSide={viewerSide} />
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
  const arr = Array.from(groups.entries()).map(([kind, pieceIds]) => ({ kind, pieceIds }));
  // v0.88: spec D1 §4.4 準拠で強さ降順にソート (大駒 上・小駒 下)。
  // .stand.you の caps は justify-end で下寄せ、.stand.opp は justify-start で上寄せだが、
  // どちらも DOM 順の先頭が視覚的な「上」なので、DESC ソートで大駒が上に来る。
  // 量子将棋の未確定駒は candidates 集合中の最強で順位付け (spec D1 §4.4) — 現在
  // PieceInstance に candidates フィールドは無いので kind ベース。将来の Phase 5 で
  // groupHand を含むこの経路の再検討時に candidates 伝播を組み込む。
  arr.sort((a, b) => strengthOf(b.kind) - strengthOf(a.kind));
  return arr;
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
  /** v0.68 C4: 駒台ヘッダーに表示するラベル (先手/後手 等)。未指定なら従来通り Gote/You */
  label?: string;
}

function PieceStandView({ side, pieces, onClick, selectedId, activePlayer, locale, label }: PieceStandViewProps) {
  const isEn = locale === 'en';
  // v0.89: spec D1 §4.4 「相手の持ち駒は先手と点対称：並び順も先手を逆順にする」
  // groupHand は DESC (大駒 上) で返すので、you 側はそのまま。opp 側は reverse して
  // 「相手視点での大駒上 = 盤面上では opp 駒台の下側 (盤に近い側)」に配置する。
  const orderedPieces = side === 'opp' ? [...pieces].reverse() : pieces;
  return (
    <div className={`stand ${side}`}>
      {/* v0.68 C4: 従来 'Gote'/'You' 固定で自分が後手のときも相手側が Gote になっていたのを、
          呼び出し側から先手/後手ラベルを注入して viewer 基準に合わせる。 */}
      <div className="stand-h">{label ?? (side === 'opp' ? 'Gote' : 'You')}</div>
      <div className="caps">
        {orderedPieces.map((g) => {
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
