import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useI18nStore } from '../store/i18n-store';
import { useGameStore } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import { useOffersStore } from '../store/offers-store';
import { ChatConsole } from './ChatConsole';
import { useRouteStore } from '../store/route-store';
import { get as pluginGet } from '../plugin/registry';
import {
  seMove,
  seCheck,
  seFanfareWin,
  seGameLose,
  sePause,
  seResume,
  seSelect,
  seCapture,
  seAnomalyHalt,
  seAnomalyVoteOpen,
  seAnomalyContinue,
  seAnomalyNogame,
} from '../audio/se-synth';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { Mgf, PieceId, PieceInstance, Position, Square } from '../engine';
import {
  buildInitialKindMap,
  displayKindsFor,
  foretellKindByDestination,
  isInCheck,
  positionHash,
} from '../engine';
import { pieceNameFor } from '../engine/kifu/format';
import { strengthOf } from '../engine/piece-strength';
import type { QuantumDisplay } from '../store/game-store';
import { CatIcon } from './CatIcon';
import { FloatingPanel } from './FloatingPanel';
import { HeaderCommonRight } from './HeaderCommonRight';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { useDebugStore } from '../store/debug-store';
import { DebugClickLog } from './DebugClickLog';

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

  const mgf = useGameStore((s) => s.mgf);
  const position = useGameStore((s) => s.position);
  const selectedSquare = useGameStore((s) => s.selectedSquare);
  const selectedHandPieceId = useGameStore((s) => s.selectedHandPieceId);
  const legalDestinations = useGameStore((s) => s.legalDestinations);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const status = useGameStore((s) => s.status);
  const lastAppliedMove = useGameStore((s) => s.lastAppliedMove);
  const entangledPieceIds = useGameStore((s) => s.entangledPieceIds);
  // v1.08 (Phase 5-11): 量子表示まわり。currentQuantum が false のときは
  // displayKindsFor が常に [piece.kind] を返すので、以下は全て本将棋と同じ挙動に縮退する。
  const currentQuantum = useGameStore((s) => s.currentQuantum);
  const quantumDisplay = useGameStore((s) => s.quantumDisplay);
  const setQuantumDisplay = useGameStore((s) => s.setQuantumDisplay);
  const selectSquare = useGameStore((s) => s.selectSquare);
  const selectHandPiece = useGameStore((s) => s.selectHandPiece);
  const clearSelection = useGameStore((s) => s.clearSelection);
  const tryMove = useGameStore((s) => s.tryMove);
  const reset = useGameStore((s) => s.reset);

  // v0.91: デバッグモード (?debug=1) 用の hooks。enabled が false なら
  // 全て no-op と等価 (overlay 非表示・logClick 呼び出しても捨てられる)。
  const debugEnabled = useDebugStore((s) => s.enabled);
  const showPieceIds = useDebugStore((s) => s.showPieceIds);
  const debugLogClick = useDebugStore((s) => s.logClick);

  // オンライン対戦の接続点（features/matchmaking が登録・A ビルドでは undefined）
  const [online, setOnline] = useState<{
    isOnline: boolean;
    mySide: 'player1' | 'player2' | null;
    myName: string;
    opponentName: string;
    /** v1.08: 両者共通適用の対局設定 (未確定駒の見せ方) を操作できる側か */
    isRuleSetter: boolean;
  }>(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    return c
      ? {
          isOnline: c.isOnline(),
          mySide: c.getMySide(),
          myName: c.getMyName(),
          opponentName: c.getOpponentName(),
          isRuleSetter: c.isRuleSetter(),
        }
      : { isOnline: false, mySide: null, myName: '', opponentName: '', isRuleSetter: true };
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
        isRuleSetter: c.isRuleSetter(),
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
  // v0.99: 量子もつれハイライト用 Set (盤マス位置は駒の pieceId 経由で判定)
  const entangledSet = new Set(entangledPieceIds);
  const isEntangledBoard = (row: number, col: number) => {
    const cell = position.board[row][col];
    return !!cell && entangledSet.has(cell.pieceId);
  };

  // ===== v1.08 (Phase 5-11): 候補集合の可視化 =====
  // 本将棋モードでは候補集合が無く displayKindsFor が常に [piece.kind] を返すため、
  // 以下は全て「未確定駒ゼロ」に縮退して従来と同じ描画になる。

  // 候補 PieceID → 初期駒種 の対応表。局面が変わったときだけ作り直す。
  const kindMap = useMemo(() => buildInitialKindMap(position), [position]);

  // 巡回表示の時計。
  // v1.09: 仕様 (駒デザイン §4.5) では「駒を持っている間は巡回を止める」だが、
  // 実機で見てユーザー判断により止めないことにした。止めると持っている間だけ
  // 表示が固まって、指すまでの確認に余計な時間がかかるため。
  const [cycleTick, setCycleTick] = useState(0);
  useEffect(() => {
    if (!currentQuantum || quantumDisplay !== 'cycle') return;
    const id = setInterval(() => setCycleTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [currentQuantum, quantumDisplay]);

  // 観測アニメ (spec §Q17.8): 着手のたびに「動いた駒 + 候補が変化した駒」を収縮させる。
  // どこまで波及したかが一目で分かるので、量子もつれハイライトと役割が重なるが、
  // ハイライトは次の着手まで残る静的表示、こちらは発生の瞬間だけの動きで住み分ける。
  const [collapsingIds, setCollapsingIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!currentQuantum || !lastAppliedMove) return;
    const ids = new Set(useGameStore.getState().entangledPieceIds);
    ids.add(lastAppliedMove.move.pieceId);
    setCollapsingIds(ids);
    const id = setTimeout(() => setCollapsingIds(new Set()), 600);
    return () => clearTimeout(id);
  }, [lastAppliedMove, currentQuantum]);

  // 見せ方を実際に切り替えられる側か (オフラインは常に本人)
  const ruleSetter = online.isRuleSetter;

  // v1.10: 予告の文字も駒と同じ向きにする。選んでいるのが相手側 (viewer から見て
  // 逆向きに置かれている側) の駒なら、予告も逆さにしないと「自分の駒に決まる」ように
  // 見えてしまう。
  const selectedPieceOwner = selectedSquare
    ? position.board[selectedSquare.row][selectedSquare.col]?.owner ?? null
    : null;
  const foretellFlipped = selectedPieceOwner !== null && selectedPieceOwner !== viewerSide;

  // 移動先による駒種確定の予告 (spec §4.3)。選択中の未確定駒について、
  // 「そこへ動けるのが 1 駒種だけ」のマスに、確定する駒種を薄く出す。
  const foretellMap = useMemo(
    () => computeForetell(mgf, position, selectedSquare, kindMap),
    [mgf, position, selectedSquare, kindMap],
  );

  // オンライン対戦で自分の手番でないなら入力を受け付けない
  const inputBlocked = online.isOnline && online.mySide !== null && position.sideToMove !== online.mySide;

  const onSquareClick = (row: number, col: number) => {
    if (status !== 'playing') return;
    // v0.91: デバッグ時は手番/side を問わず駒を選ぶ動作前にログ (相手駒も対象)。
    if (debugEnabled) {
      const clicked = position.board[row][col];
      if (clicked) debugLogClick(clicked, 'board');
    }
    if (inputBlocked) return;
    // v1.09: 持っている駒の元の位置をもう一度クリックしたら持ち直し (持ち駒台と同じ操作感)。
    if (selectedSquare && selectedSquare.row === row && selectedSquare.col === col) {
      clearSelection();
      return;
    }
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
    // v0.91: デバッグ時は相手側/手番外の持ち駒クリックもログに拾う。
    if (debugEnabled) {
      const clicked = position.hands[owner].find((p) => p.pieceId === pieceId);
      if (clicked) debugLogClick(clicked, 'hand');
    }
    if (inputBlocked) return;
    if (owner !== position.sideToMove) return;
    if (selectedHandPieceId === pieceId) {
      clearSelection();
      return;
    }
    selectHandPiece(pieceId);
    seSelect(); // v0.73 音響: 持ち駒選択音
  };

  const senteHandGrouped = groupHand(position.hands.player1, mgf, kindMap);
  const goteHandGrouped = groupHand(position.hands.player2, mgf, kindMap);
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
            {/* v1.08: 量子 ON のときだけ出す。公平性原則 (spec §4.4) により実際に
                切り替えられるのはルール設定者だけで、相手側は現在値の表示のみ。 */}
            {currentQuantum && (
              <div className="qmode-toggle" title={ruleSetter ? undefined : t('qmode.lockedHint')}>
                <button
                  type="button"
                  className={`qm${quantumDisplay === 'cycle' ? ' active' : ''}`}
                  disabled={!ruleSetter}
                  onClick={() => setQuantumDisplay('cycle')}
                >
                  {t('qmode.cycle')}
                </button>
                <button
                  type="button"
                  className={`qm${quantumDisplay === 'stack' ? ' active' : ''}`}
                  disabled={!ruleSetter}
                  onClick={() => setQuantumDisplay('stack')}
                >
                  {t('qmode.stack')}
                </button>
                {!ruleSetter && <span className="qm-lock" aria-hidden="true">🔒</span>}
              </div>
            )}
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
              entangledPieceIds={entangledSet}
              debugShowPieceIds={debugEnabled && showPieceIds}
              mode={quantumDisplay}
              tick={cycleTick}
              collapsingIds={collapsingIds}
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
                    // v1.08: 未確定駒は「元々そこに置かれていた駒」ではなく候補を見せる。
                    // 確定した駒も、候補が示す駒種の顔になる (piece.kind ではない)。
                    const kinds = piece ? displayKindsFor(mgf, piece, kindMap) : [];
                    const unconfirmed = kinds.length >= 2;
                    const foretellKind = foretellMap.get(`${row},${col}`);
                    const cls = [
                      'sq',
                      isSelected(row, col) ? 'selected' : '',
                      isHint(row, col) ? 'hint' : '',
                      isLastMove(row, col) ? 'lastmove' : '',
                      isEntangledBoard(row, col) ? 'entangled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div key={i} className={cls} onClick={() => onSquareClick(row, col)}>
                        {piece && (
                          <PieceView
                            piece={piece}
                            kinds={kinds}
                            locale={locale}
                            viewerSide={viewerSide}
                            mode={quantumDisplay}
                            tick={cycleTick}
                            collapsing={collapsingIds.has(piece.pieceId)}
                          />
                        )}
                        {/* 未確定マーク。駒 (.pc) は clip-path で切り抜かれるのでマス直下に置く */}
                        {piece && unconfirmed && (
                          <span className={`qmark-b${piece.owner !== viewerSide ? ' gote' : ''}`}>？</span>
                        )}
                        {foretellKind && (
                          <span className={`foretell${foretellFlipped ? ' gote' : ''}`}>
                            {pieceNameFor(foretellKind, locale)}
                          </span>
                        )}
                        {/* 候補ボックス: 選択した未確定駒の右上に候補を文字だけで並べる */}
                        {piece && unconfirmed && isSelected(row, col) && (
                          <CandidateBox kinds={kinds} locale={locale} onLeft={visualCol >= 6} />
                        )}
                        {debugEnabled && showPieceIds && piece && (
                          <DebugIdBadge piece={piece} />
                        )}
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
              entangledPieceIds={entangledSet}
              debugShowPieceIds={debugEnabled && showPieceIds}
              mode={quantumDisplay}
              tick={cycleTick}
              collapsingIds={collapsingIds}
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
                    // v1.09: 量子モードでは「この手で何が確定したか」を手の下に
                    // 改行で書き足しているので、改行をそのまま出す
                    <div key={i} style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'pre-line' }}>
                      {i + 1}. {m}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* v0.94: ?debug=1 の時のみ棋譜パネル直下にクリック履歴枠を常時表示。
              v0.95 で PieceID スイッチ等を持つフローティング DebugPanel (App.tsx で描画・
              歯車内リンクから開く) と分離した。ここは対局中に垂れ流しで見るログ専用。
              内部で enabled ガードしているので、通常モードでは何もレンダリングしない。 */}
          <DebugClickLog />
        </div>
      </div>
      <PromotionModal locale={locale} t={t} viewerSide={viewerSide} mode={quantumDisplay} tick={cycleTick} />
      <OpponentLeftModal t={t} />
      <GameEndModal t={t} online={online} />
      <OfferReceivedModal t={t} online={online} />
      <OfferSentPanel t={t} />
      <PauseCenterPanel t={t} />
      <OfferResponseToast t={t} />
      <ConnectionUncertainBanner t={t} />
      <AnomalyNotice t={t} />
    </div>
  );
}

/**
 * Phase 5-13 (v1.12): 異常状態の通知バナー + 投票画面 (画面機能 §3 S06.Q5 / 付録D-1 §5.7.3)。
 *
 * 観測 (候補の絞り込み) が矛盾または上限で止まったときに出る。盤は隠さず、
 * 停止時点の状態を薄いスクリム越しに見せたまま投票してもらう決まりなので、
 * 待った・中断で使う盤隠しフィルターとは別建てにしてある。
 *
 * 時間の流れ (付録D-1 §5.7.3.6):
 *   0ms    バナー登場 + 停止音
 *   300ms  投票画面が開く + 投票開始音
 *   投票確定 継続音 または 不成立音
 *
 * v1.13 (仕様と違えた点・ユーザー指示): 見出しに「量子異常 / Quantum anomaly」を冠する。
 * 仕様の文言は「観測が完了しませんでした」だけだが、それだけでは何が起きたのか
 * 名前が付かないため、呼び名を先頭に出す。終局理由も「ノーゲーム（量子異常で合意）」。
 */
function AnomalyNotice({ t }: { t: (key: string) => string }) {
  const anomaly = useGameStore((s) => s.anomaly);
  const voteAnomaly = useGameStore((s) => s.voteAnomaly);
  const [voteOpen, setVoteOpen] = useState(false);
  // 投票が決着したとき (anomaly が null に戻ったとき) にどちらの音を鳴らすかの判断材料。
  const prevRef = useRef<{ myVote: string | null; oppVote: string | null } | null>(null);
  const status = useGameStore((s) => s.status);

  // 発火の瞬間に停止音、300ms 後に投票画面と投票開始音。
  useEffect(() => {
    if (!anomaly) {
      setVoteOpen(false);
      return;
    }
    if (voteOpen) return;
    seAnomalyHalt();
    const id = setTimeout(() => {
      setVoteOpen(true);
      seAnomalyVoteOpen();
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anomaly === null]);

  // 決着音。ノーゲームなら勝敗音は鳴らさない決まり (音響 §2.7.4) だが、
  // 'nogame' は勝者が居ない終局なので勝敗音側の判定に元々引っかからない。
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = anomaly ? { myVote: anomaly.myVote, oppVote: anomaly.oppVote } : null;
    if (anomaly || !prev) return;
    if (status === 'nogame') seAnomalyNogame();
    else seAnomalyContinue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anomaly]);

  if (!anomaly) return null;
  const causeKey = anomaly.cause === 'iteration_limit' ? 'anomaly.cause.limit' : 'anomaly.cause.empty';
  const oppLabel =
    anomaly.oppVote === 'continue'
      ? t('anomaly.opp.continue')
      : anomaly.oppVote === 'nogame'
        ? t('anomaly.opp.nogame')
        : t('anomaly.opp.choosing');
  const oppMark = anomaly.oppVote === 'continue' ? '○' : anomaly.oppVote === 'nogame' ? '─' : '…';

  return (
    <>
      <div className="anomaly-banner" role="alert" aria-live="assertive">
        {/* 観測停止アイコン: 目の上に一時停止バー 2 本 (付録D-1 §5.7.3.2) */}
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
          <ellipse cx="12" cy="15" rx="8" ry="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="15" r="2.5" fill="currentColor" />
          <rect x="9" y="3" width="2" height="6" rx="1" fill="currentColor" />
          <rect x="13" y="3" width="2" height="6" rx="1" fill="currentColor" />
        </svg>
        <span className="txt">
          <span className="hd">{t('anomaly.title')}</span>
          <span className="cause">{t(causeKey)}</span>
        </span>
      </div>
      {voteOpen && (
        <>
          <div className="anomaly-scrim" aria-hidden="true" />
          <div className="anomaly-modal" role="dialog" aria-modal="true">
            <div className="ttl">{t('anomaly.vote.title')}</div>
            <div className="desc">{t('anomaly.vote.desc')}</div>
            <div className="btns">
              <button
                type="button"
                className={`ay-btn cont${anomaly.myVote === 'continue' ? ' picked' : ''}${anomaly.myVote === 'nogame' ? ' dimmed' : ''}`}
                onClick={() => voteAnomaly('continue')}
              >
                {t('anomaly.btn.continue')}
              </button>
              <button
                type="button"
                className={`ay-btn ng${anomaly.myVote === 'nogame' ? ' picked' : ''}${anomaly.myVote === 'continue' ? ' dimmed' : ''}`}
                onClick={() => voteAnomaly('nogame')}
              >
                {t('anomaly.btn.nogame')}
              </button>
            </div>
            {/* 相手の選択は自分が投票してから出す (相手に引っ張られないため・付録D-1 §5.7.3.4)。
                一人で遊んでいるときは相手が居ないので出さない。 */}
            {anomaly.online && anomaly.myVote !== null && (
              <div className="opp">
                <span className="mk">{oppMark}</span> {oppLabel}
              </div>
            )}
          </div>
        </>
      )}
    </>
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
    case 'nogame':
      // Phase 5-13: ノーゲーム (異常状態合意)。勝敗つかず・レート非変動 (親 §4.4)。
      winnerSide = null;
      reasonKey = 'result.reason.nogame';
      break;
    default:
      return null;
  }

  // 表示は「自分視点」を優先、なければ絶対 side（先手/後手）
  // v0.42: 投了の場合は「投了しました」「相手が投了」だけを reasonKey に上書きして冗長表示を避ける
  let verdictKey: string;
  if (status === 'nogame') {
    // 引分とは別扱い。「対局不成立」と言い切る (勝敗も引分も付かない)。
    verdictKey = 'result.verdict.nogame';
  } else if (winnerSide === null) {
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
  /** v1.10: 未確定駒の見せ方。盤と同じ方式 (巡回 / 重ね) で候補を出す。 */
  mode: QuantumDisplay;
  /** v1.10: 巡回表示の共有時計。盤と同じ拍で字が入れ替わる。 */
  tick: number;
}

function PromotionModal({ locale, t, viewerSide, mode, tick }: PromotionModalProps) {
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
    initialKind: pendingPromotion.pieceKind,
    initialSquare: { row: -1, col: -1 },
    promoted: false,
  };
  const promotePiece: PieceInstance = {
    pieceId: '__preview_promo__',
    kind: pendingPromotion.promotedKind,
    owner: pendingPromotion.owner,
    initialOwner: pendingPromotion.owner,
    initialKind: pendingPromotion.pieceKind,
    initialSquare: { row: -1, col: -1 },
    promoted: true,
  };

  // v1.08: 未確定駒が成るときは「初期位置の駒種」ではなく候補を見せる。
  // v1.10: 見せ方は盤と揃える (巡回なら巡回・重ねなら重ね)。この画面だけ別方式だと
  // 「同じ駒なのに見え方が違う」ことになり、成る/成らずの判断がしにくい。
  const nonPromoteKinds = pendingPromotion.candidateKinds;
  const promoteKinds = pendingPromotion.promotedCandidateKinds;

  return (
    <div className="promotion-modal-overlay" onClick={cancelPromotion}>
      <div className="promotion-modal" onClick={(e) => e.stopPropagation()}>
        <div className="heading">{pendingPromotion.heading}</div>
        <div className="cards">
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(false)}>
            <div className="label">{t('promote.decline')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={nonPromotePiece} kinds={nonPromoteKinds} locale={locale} viewerSide={viewerSide} mode={mode} tick={tick} />
            </div>
          </button>
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(true)}>
            <div className="label">{t('promote.confirm')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={promotePiece} kinds={promoteKinds} locale={locale} viewerSide={viewerSide} mode={mode} tick={tick} />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

interface HandGroup {
  /** React の key。確定駒は駒種で 1 枚に束ね、未確定駒は 1 枚ずつ独立させる。 */
  key: string;
  /** 表示する駒種 (強さ降順)。2 個以上なら未確定 = ? + 巡回/重ね表示の対象。 */
  kinds: string[];
  pieceIds: string[];
  /** v1.03: debug 表示で持ち駒の PieceID + candidates.size を出すため、生 PieceInstance も保持。 */
  pieces: PieceInstance[];
}

/**
 * 持ち駒を駒台のカードに束ねる。
 *
 * v1.08 (Phase 5-11): 量子モードの未確定駒は候補の中身が 1 枚ごとに違うので、
 * 「同じ駒だから 1 枚にまとめる」ができない。よって未確定駒は 1 枚ずつ別カードにし、
 * 確定した駒だけを従来通り駒種でまとめる。
 * 並び順は spec D1 §4.4 の「未確定駒の強さは候補中の最強の駒」に従う
 * (displayKindsFor が強さ降順を返すので kinds[0] がその最強)。
 */
function groupHand(hand: PieceInstance[], mgf: Mgf, kindMap: Map<PieceId, string>): HandGroup[] {
  const groups: HandGroup[] = [];
  const byKind = new Map<string, HandGroup>();
  for (const p of hand) {
    const kinds = displayKindsFor(mgf, p, kindMap);
    if (kinds.length >= 2) {
      groups.push({ key: p.pieceId, kinds, pieceIds: [p.pieceId], pieces: [p] });
      continue;
    }
    const existing = byKind.get(kinds[0]);
    if (existing) {
      existing.pieceIds.push(p.pieceId);
      existing.pieces.push(p);
      continue;
    }
    const group: HandGroup = { key: `k:${kinds[0]}`, kinds, pieceIds: [p.pieceId], pieces: [p] };
    byKind.set(kinds[0], group);
    groups.push(group);
  }
  // v0.88: spec D1 §4.4 準拠で強さ降順にソート (大駒 上・小駒 下)。
  // .stand.you の caps は justify-end で下寄せ、.stand.opp は justify-start で上寄せだが、
  // どちらも DOM 順の先頭が視覚的な「上」なので、DESC ソートで大駒が上に来る。
  groups.sort((a, b) => strengthOf(b.kinds[0]) - strengthOf(a.kinds[0]));
  return groups;
}

/**
 * v1.08 (Phase 5-11): 巡回表示で「今どの字を出すか」を選ぶ。
 * 全ての未確定駒が同じ tick を共有するので、候補数の違う駒は自然に別々の周期で回る
 * (候補 3 個の駒と 8 個の駒が同時に同じ駒種を出し続けることがない)。
 */
function shownKind(kinds: string[], tick: number): string {
  return kinds[tick % kinds.length];
}

function PieceView({
  piece,
  kinds,
  locale,
  viewerSide = 'player1',
  mode = 'cycle',
  tick = 0,
  collapsing = false,
}: {
  piece: PieceInstance;
  /** 表示する駒種 (強さ降順)。本将棋モードは [piece.kind] の 1 個。 */
  kinds: string[];
  locale: LocaleCode;
  viewerSide?: 'player1' | 'player2';
  mode?: QuantumDisplay;
  tick?: number;
  collapsing?: boolean;
}) {
  const isEn = locale === 'en';
  const unconfirmed = kinds.length >= 2;
  const stacked = unconfirmed && mode === 'stack';
  const shown = unconfirmed ? shownKind(kinds, tick) : kinds[0];
  const name = pieceNameFor(shown, locale);
  const isMulti = isEn && name.length > 1;
  // v0.34: gote 反転は viewer 基準（相手の駒＝反転して viewer 側から見て逆向き）
  const cls = [
    'pc',
    piece.owner !== viewerSide ? 'gote' : '',
    piece.promoted ? 'promoted' : '',
    !isEn && !stacked && isTwoChar(shown) ? 'two' : '',
    collapsing ? 'collapsing' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const jaCls = ['ja', isEn ? 'en' : '', isEn && isMulti ? 'multi' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {stacked ? (
        <QuantumStack kinds={kinds} locale={locale} />
      ) : (
        <span className={jaCls}>{name}</span>
      )}
    </div>
  );
}

/**
 * 重ね表示 (spec 駒デザイン §4.2)。候補の駒種をくっきり黒で重ね、
 * 文字を衝突させて一瞥性を意図的に殺す = 「揺れている」の表現。
 * 正確な候補は候補ボックス (§4.5) で補う。
 *
 * 2 文字の駒種 (成銀・成桂 等) が混ざるときは縦書きにし、先頭字が全候補で共通なら
 * 先頭字を 1 枚だけ描いて末尾字を重ねる (「成」を二重に太らせない)。
 * 英字表記 (locale=en) は縦書きにすると読めないので常に横重ねにする。
 */
function QuantumStack({ kinds, locale }: { kinds: string[]; locale: LocaleCode }) {
  const names = kinds.map((k) => pieceNameFor(k, locale));
  const vertical = locale !== 'en' && names.some((n) => n.length > 1);
  if (!vertical) {
    return (
      <span className="qstack">
        {names.map((n, i) => (
          <span key={i} className="ov">{n}</span>
        ))}
      </span>
    );
  }
  const head = names[0][0];
  const shared = names.every((n) => n.length > 1 && n[0] === head);
  return (
    <span className="qstack">
      {names.map((n, i) => (
        <span key={i} className="vov">
          {shared ? (i === 0 ? head : '　') + (n[1] ?? '') : n}
        </span>
      ))}
    </span>
  );
}

/**
 * 候補ボックス (spec 駒デザイン §4.5)。未確定駒を選んだとき、その右上に候補の駒種を
 * 文字だけ並べる (例「歩桂銀」)。説明文は付けない。盤の右端寄りでは左上へ回避する。
 * 英字表記のときは読みやすさのため空白区切りにする (例「P N S」)。
 */
function CandidateBox({
  kinds,
  locale,
  onLeft,
  flipped = false,
}: {
  kinds: string[];
  locale: LocaleCode;
  onLeft: boolean;
  /** 180 度回転した器 (相手側の駒台) の中に置くとき、文字を読める向きに戻す */
  flipped?: boolean;
}) {
  const sep = locale === 'en' ? ' ' : '';
  const text = kinds.map((k) => pieceNameFor(k, locale)).join(sep);
  const style: CSSProperties = onLeft
    ? { right: '100%', bottom: '92%', marginRight: 4 }
    : { left: '100%', bottom: '92%', marginLeft: 4 };
  if (flipped) style.transform = 'rotate(180deg)';
  return (
    <span className="qtip" style={style}>
      {text}
    </span>
  );
}

/**
 * 移動先による駒種確定の予告 (spec 駒デザイン §4.3)。
 * 判定そのものは core/engine/foretell.ts に置いてある (盤面の理屈なので engine 側)。
 * ここは「選択していないときは何も出さない」だけを足す薄い包み。
 */
function computeForetell(
  mgf: Mgf,
  position: Position,
  selectedSquare: Square | null,
  kindMap: Map<PieceId, string>,
): Map<string, string> {
  if (!selectedSquare) return new Map();
  return foretellKindByDestination(mgf, position, selectedSquare, kindMap);
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
  /** v0.99: 量子もつれで candidates が変化した pieceId 集合。持ち駒台側の当該駒にも
   * 薄い水色ハイライトを付ける。 */
  entangledPieceIds?: Set<string>;
  /** v1.03: ?debug=1 && showPieceIds ON で持ち駒カードにも PieceID + candidates.size を出す。 */
  debugShowPieceIds?: boolean;
  /** v1.08: 未確定持ち駒の見せ方 (巡回 / 重ね)。 */
  mode?: QuantumDisplay;
  /** v1.08: 巡回表示の共有時計。 */
  tick?: number;
  /** v1.08: 観測アニメ中の pieceId 群。 */
  collapsingIds?: ReadonlySet<string>;
}

function PieceStandView({ side, pieces, onClick, selectedId, activePlayer, locale, label, entangledPieceIds, debugShowPieceIds, mode = 'cycle', tick = 0, collapsingIds }: PieceStandViewProps) {
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
          // v1.08: 未確定の持ち駒は盤上と同じ扱い (? + 巡回/重ね)。確定駒は従来通り。
          const unconfirmed = g.kinds.length >= 2;
          const stacked = unconfirmed && mode === 'stack';
          const shown = unconfirmed ? shownKind(g.kinds, tick) : g.kinds[0];
          const name = pieceNameFor(shown, locale);
          const isMulti = isEn && name.length > 1;
          const jaCls = ['ja', isEn ? 'en' : '', isEn && isMulti ? 'multi' : ''].filter(Boolean).join(' ');
          const hasEntangled = !!entangledPieceIds && g.pieceIds.some((pid) => entangledPieceIds.has(pid));
          const isCollapsing = !!collapsingIds && g.pieceIds.some((pid) => collapsingIds.has(pid));
          const capCls = [
            'cap',
            selectedId && g.pieceIds.includes(selectedId) ? 'selected' : '',
            hasEntangled ? 'entangled' : '',
            isCollapsing ? 'collapsing' : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              key={g.key}
              className={capCls}
              onClick={() => activePlayer && onClick(g.pieceIds[0])}
              style={{ cursor: activePlayer ? 'pointer' : 'default', position: 'relative' } as CSSProperties}
            >
              <div className="capface">
                {stacked ? (
                  <QuantumStack kinds={g.kinds} locale={locale} />
                ) : (
                  <span className={jaCls}>{name}</span>
                )}
              </div>
              {unconfirmed && <span className="qmark">？</span>}
              {/* v1.09: 持ち駒を持ったときも候補ボックスを出す (盤の駒と揃える)。
                  相手側の駒台は .cap ごと 180 度回っているので、文字が読めるよう回し戻す。 */}
              {unconfirmed && selectedId && g.pieceIds.includes(selectedId) && (
                <CandidateBox
                  kinds={g.kinds}
                  locale={locale}
                  onLeft={side === 'you'}
                  flipped={side === 'opp'}
                />
              )}
              {g.pieceIds.length >= 2 && <span className="ct">{g.pieceIds.length}</span>}
              {debugShowPieceIds && <HandDebugIdBadge pieces={g.pieces} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * v0.91: デバッグモードで盤マスの左上に出す小さい PieceID バッジ。
 * 候補集合を持っていれば [size] を後ろに付けて Phase 5 の収縮状況を可視化する。
 * 通常表示 (駒の kind 表示) に被らないよう左上に絶対配置、小さく淡色で描画。
 */
function DebugIdBadge({ piece }: { piece: PieceInstance }) {
  const sizeLabel = piece.candidates !== undefined ? ` [${piece.candidates.size}]` : '';
  return (
    <span
      style={{
        // v0.92: 駒本体 (.pc) が transform で stacking context を作るため、
        // z-index を明示指定して常に駒より前面に表示させる。
        position: 'absolute', top: 1, left: 2, zIndex: 20,
        fontSize: 9, lineHeight: 1,
        color: 'rgba(255, 255, 0, 0.95)',
        textShadow: '0 0 3px rgba(0, 0, 0, 1), 0 0 3px rgba(0, 0, 0, 1)',
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        letterSpacing: '-0.02em',
        userSelect: 'none',
        fontWeight: 700,
      }}
    >
      {piece.pieceId}{sizeLabel}
    </span>
  );
}

/**
 * v1.03: 持ち駒カード上に出す PieceID + candidates.size のデバッグバッジ。
 * 同 kind 群の全 PieceID を縦に列挙 (P0[8]/P1[8]/... 形式)。カード左上に絶対配置。
 */
function HandDebugIdBadge({ pieces }: { pieces: PieceInstance[] }) {
  return (
    <span
      style={{
        position: 'absolute', top: 1, left: 2, zIndex: 20,
        fontSize: 8, lineHeight: 1.05,
        color: 'rgba(255, 255, 0, 0.95)',
        textShadow: '0 0 3px rgba(0, 0, 0, 1), 0 0 3px rgba(0, 0, 0, 1)',
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
        letterSpacing: '-0.02em',
        userSelect: 'none',
        fontWeight: 700,
        display: 'flex', flexDirection: 'column', gap: 1,
        maxWidth: '95%',
      }}
    >
      {pieces.map((p) => {
        const sizeLabel = p.candidates !== undefined ? `[${p.candidates.size}]` : '';
        return <span key={p.pieceId}>{p.pieceId}{sizeLabel}</span>;
      })}
    </span>
  );
}
