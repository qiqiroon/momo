import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useFitHeight } from './useFitHeight';
import { createPortal } from 'react-dom';
import { useI18nStore } from '../store/i18n-store';
import { useGameStore, winnerOf } from '../store/game-store';
import { useChatStore } from '../store/chat-store';
import {
  JISHOGI_ANSWER_MS,
  JISHOGI_WAIT_TIMEOUT_MS,
  useOffersStore,
} from '../store/offers-store';
import { ChatConsole } from './ChatConsole';
import { useRouteStore } from '../store/route-store';
import { requestNewGame } from '../store/kifu-guard';
import { get as pluginGet } from '../plugin/registry';
import { useQuantumCycle, type CycleReader } from './quantum-cycle';
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
  seButton,
  seNotify,
} from '../audio/se-synth';
import { t as _t } from '../i18n';
import type { LocaleCode } from '../i18n/types';
import type { Mgf, PieceId, PieceInstance, Position, Square } from '../engine';
import {
  REQUIRED_PIECE_COUNT,
  buildInitialKindMap,
  countBoardPieces,
  countEnterZonePieces,
  displayKindsFor,
  enterZonePointBreakdown,
  hasCandidateSets,
  isEnteringKingEstablished,
  jishogiPointBreakdown,
  listEnterZoneMajors,
  moveLandingSquare,
  foretellKindByDestination,
  isInCheck,
  positionHash,
  resolveSideThreshold,
} from '../engine';
import type { PointBreakdown } from '../engine/victory/nyugyoku';
import { pieceNameFor } from '../engine/kifu/format';
import { strengthOf } from '../engine/piece-strength';
import type { QuantumDisplay } from '../store/game-store';
import { CatIcon } from './CatIcon';
import { FloatingPanel } from './FloatingPanel';
import { HeaderCommonRight } from './HeaderCommonRight';
import type { OnlineGameConnector } from '../plugin/gameConnector';
import { useDebugStore } from '../store/debug-store';
import { useAiStore } from '../store/ai-store';
import { useAiOpponent } from '../controller/ai-driver';
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
  const roomQuantumDisplay = useGameStore((s) => s.roomQuantumDisplay);
  // v1.22: 移動先ヒント (行き先マスのオレンジ) の表示。S10 設定で消せる。
  const hintOn = useGameStore((s) => s.hintAlwaysOn);
  const setQuantumDisplay = useGameStore((s) => s.setQuantumDisplay);
  const selectSquare = useGameStore((s) => s.selectSquare);
  const selectHandPiece = useGameStore((s) => s.selectHandPiece);
  const clearSelection = useGameStore((s) => s.clearSelection);
  const tryMove = useGameStore((s) => s.tryMove);
  const reset = useGameStore((s) => s.reset);

  // Phase 3: 対 AI 対局。オフラインのときだけ効く。
  const vsAi = useAiStore((s) => s.enabled);
  const aiSide = useAiStore((s) => s.aiSide);
  const aiThinking = useAiStore((s) => s.thinking);

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

  /**
   * ★v1.55 (親 §6.8.4): 観戦しているときの情報。
   *
   * **`online` とは別に持つ**＝あちらは操作ボタン群へそのまま渡している入れ物で、
   * 形を変えると関係の無い箇所まで触ることになるため。
   * **口が無いビルド（アプリ A）では観戦していない扱い**になる（縮退互換）。
   */
  const [spec, setSpec] = useState<{
    spectating: boolean;
    seatNames: { player1: string; player2: string } | null;
    watchers: { pid: string; name: string }[];
    waiting: boolean;
  }>({ spectating: false, seatNames: null, watchers: [], waiting: false });

  useEffect(() => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c) return;
    // **口が古い／部分的な相手でも落ちないようにする**＝観戦の口は v1.55 で
    // 足したものなので、それ以前の形の connector（検査の差し替えを含む）には無い。
    // **無ければ「観戦していない」**として扱う（縮退互換）。
    const update = () =>
      setSpec({
        spectating: typeof c.isSpectating === 'function' ? c.isSpectating() : false,
        seatNames: typeof c.getSeatNames === 'function' ? c.getSeatNames() : null,
        watchers: typeof c.getSpectators === 'function' ? c.getSpectators() : [],
        waiting: typeof c.isSpectateWaiting === 'function' ? c.isSpectateWaiting() : false,
      });
    update();
    return c.subscribe(update);
  }, []);

  /**
   * ★v1.61 (画面機能 §3 S06): **観戦者を退室させられるのは、その部屋のホストだけ**。
   *
   * **観戦者自身には出さない**（自分を追い出す押し方を置かない）。**口が無いビルド・
   * 古い形の相手では出さない**（縮退互換＝押せるのに何も起きない状態を作らない）。
   */
  const canKick = (() => {
    if (spec.spectating) return false;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (!c || typeof c.isRoomHost !== 'function' || typeof c.kickSpectator !== 'function') return false;
    return c.isRoomHost();
  })();

  /**
   * ★v1.55 (親 §6.8.4): 観戦者が盤の上下を入れ替えたか。
   *
   * **既定は先手が手前**。**自分の画面だけに効き、誰にも伝えない**。
   * **画面より長生きさせない**＝この画面を離れれば消える入れ物に置くことで、
   * 「入るたび既定へ戻す」が仕組みとして保証される（S08／S11 と同じ考え方）。
   */
  const [specFlip, setSpecFlip] = useState(false);

  // オンラインモード開始時に対局盤面とチャット履歴を初期化（前回のゲームの残り状態を持ち越さない）
  const clearChat = useChatStore((s) => s.clearChat);
  useEffect(() => {
    if (!online.isOnline) return;
    /**
     * ★v1.55（親 §6.8.4）: **観戦者の盤は作り直さない。**
     *
     * 観戦者はこの画面へ来る直前に、配られた対局を**盤へ並べ直し終えている**。
     * ここで作り直すと**並べ直したぶんが丸ごと消え、初期配置が出る**
     * （途中から入ったのに「まだ 1 手も指されていない」ように見える）。
     *
     * ★**`spec.spectating` を見ない**＝あちらは別の効果で入る値なので、
     * **この効果が最初に走る回では、まだ入っていない**（同じ描き直しの中では
     * 前の値のまま）。**いまこの瞬間の事実を口に聞く。**
     */
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    const spectating = c && typeof c.isSpectating === 'function' ? c.isSpectating() : false;
    if (!spectating) reset();
    clearChat();
  }, [online.isOnline, reset, clearChat]);

  // 自分の着手を相手に送信
  // ★v1.88 (親 v1.63 §4.4.2.2): 入玉宣言を尋ねている間も**両者の時計を止める**。
  // **時間制限が無い**ので、止めなければ**選んでいる間ずっと時間が減る**。
  const nyugyokuPrompt = useGameStore((s) => s.nyugyokuPromptSide);
  useEffect(() => {
    if (!online.isOnline) return;
    if (!lastAppliedMove) return;
    if (lastAppliedMove.source !== 'local') return;
    // ★v1.88 (親 v1.63 §4.4.2.2): **「入玉宣言しますか」に答えるまで、指した手を送らない**
    // ＝**相手に手番を渡さない**を、そのままの形で実現する。
    //
    // **知らせの伝言に頼らないのはこのため**＝**送らなければ相手は「まだ自分の番では
    // ない」ままなので、知らせが届かなくても固まらない**。知らせ (`nyugyoku_prompt`)
    // は**「選択中」と出すためだけのもの**で、届かなくても害が無い。
    // **答えたあとにこの効果がもう一度走って送る**（`nyugyokuPrompt` を deps に入れてある）。
    if (nyugyokuPrompt) return;
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
    } else if (move.type === 'drop') {
      c.sendMove({
        kind: 'drop',
        pieceId: move.pieceId,
        to: move.to,
        time: timePayload,
        hash: hashPayload,
      });
    }
    // ★v1.55: `free`（感想戦の自由な手）はここへ来ない＝**対局画面では生まれない**。
    // 感想戦の共有は別の伝言（親 §6.3.6 の `review_move`）が受け持つ。
  }, [lastAppliedMove, online.isOnline, online.mySide, nyugyokuPrompt]);

  /**
   * ★v1.88 (親 v1.63 §6): 自分の入玉宣言を相手と観戦者へ知らせる。
   *
   * **上の「手を送る」効果より後に置いてある**＝**答えるまで送らずに持っている手が
   * ある場合、手 → 宣言の順で送らないと、相手は終局だけ受け取って盤が 1 手古いまま**に
   * なる（終局画面の点数はその局面から数えるので、数まで食い違う）。
   * 同じ描き直しの中では、宣言した順に効果が走る。
   */
  const nyugyokuAnnounce = useGameStore((s) => s.nyugyokuAnnounce);
  useEffect(() => {
    if (!nyugyokuAnnounce) return;
    if (online.isOnline) {
      const c = pluginGet<OnlineGameConnector>('gameConnector');
      c?.sendNyugyokuDeclare?.(nyugyokuAnnounce);
    }
    useGameStore.getState().clearNyugyokuAnnounce();
  }, [nyugyokuAnnounce, online.isOnline]);

  // v0.35 ticker → v0.38: アンカー方式に置換。手番開始時の (時計値, Date.now()) を anchor に、
  // 各 tick で elapsed = Date.now() - anchor.at をもとに絶対再計算する。
  // 積算 delta 方式ではないため累積誤差ゼロ、Date.now() は OS 時計と同期するので長時間対局でも drift しない。
  // 相手からの syncClock は「動いていない側」の時計を更新するので、この anchor には影響しない。
  // v0.42: 待った申し出中は両者の時計を止める（申し出者・相手ともに）。中断中と合わせて undoOfferPending も deps に。
  const activeClockSide = useGameStore((s) => s.activeClockSide);
  const paused = useGameStore((s) => s.paused);
  const undoOfferPending = useOffersStore((s) => s.undoOfferFrom) !== null;
  // ★v1.84 (親 §4.4.1.3): 持将棋の提案中も**両者の時計を止める**。
  // 提案できるのは自分の手番のときだけなので、止めなければ**答えを待っている間ずっと
  // 提案した側の時間が減る**＝提案そのものが不利になり、誰も提案しなくなる。
  const jishogiOfferPending = useOffersStore((s) => s.jishogiOfferFrom) !== null;
  useEffect(() => {
    if (!activeClockSide) return;
    if (status !== 'playing') return;
    if (paused) return; // 一時中断中は tick しない
    if (undoOfferPending) return; // v0.42: 待った申し出中は両者の時計を止める
    if (jishogiOfferPending) return; // ★v1.84: 持将棋の提案中も両者の時計を止める
    if (nyugyokuPrompt) return; // ★v1.88: 入玉宣言を尋ねている間も止める
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
  }, [activeClockSide, status, paused, undoOfferPending, jishogiOfferPending, nyugyokuPrompt]);

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
    // ★v1.84: 持将棋も勝った側が居ないので、勝敗の音は鳴らさない。
    if (
      status === 'playing' ||
      status === 'sennichite' ||
      status === 'agreed_draw' ||
      status === 'jishogi'
    )
      return;
    // オンライン: 自分の勝ちなら fanfare、負けなら lose。オフラインでは負けた側視点で lose。
    const winnerSide = winnerOf(status, position.sideToMove);
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

  // Phase 3: AI の手番が来たら考えさせて 1 手指す (オンライン対局中は何もしない)。
  useAiOpponent(online.isOnline);

  // v0.74: チャット音の発火は ChatConsole 側に移動 (S06/S07 共通化)
  // オンライン対戦時は自分の手番か相手の手番かを表示
  const isMyTurnOnline = online.isOnline && online.mySide === position.sideToMove;
  /**
   * ★v1.53: 盤枠のオレンジ＝**人が指す番であること**の合図（2026-08-18 ユーザー報告）。
   *
   * v1.52 まではネット対戦のときだけ点けていたので、**対 AI では一度も出なかった**。
   * 対 AI は「AI の側でなければ人の番」。
   *
   * **人どうしのオフライン対局では出さない**＝どちらの番も人なので常時点灯になり、
   * 合図として何も区別しない（点きっぱなしの灯りは消えているのと同じ）。
   *
   * **終わった盤では点けない**＝勝負が付いた後は誰の番でもない。
   */
  const isMyTurn =
    status === 'playing' &&
    (online.isOnline
      ? online.mySide === position.sideToMove
      : vsAi && position.sideToMove !== aiSide);
  // v0.34: 盤面の視点。mySide=player2 のとき盤を反転して「自分の駒を下側」に表示
  // Phase 3-1 追補: 対 AI では AI の反対側が自分なので、後手を選んだときも自分の駒が下に来る。
  // v1.33: 人どうしのオフライン対局は localViewerSide (手前に座っている側)。
  //   駒落ちで向こう側が落とすと上手＝先手＝player1 が向こう側になるため、既定の player1 固定では
  //   落とした側が手前に来てしまう (ルール選択のプレビューと上下が逆になる)。
  const localViewerSide = useGameStore((s) => s.localViewerSide);
  // ★v1.55 (親 §6.8.4): 観戦者には「自分の側」が無いので**先手が手前**を既定にし、
  // **いつでも上下を入れ替えられる**ようにする（対局者には出さない＝向きは確定済み）。
  const viewerSide: 'player1' | 'player2' = spec.spectating
    ? specFlip
      ? 'player2'
      : 'player1'
    : (online.mySide ?? (vsAi ? (aiSide === 'player1' ? 'player2' : 'player1') : localViewerSide));
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
                  : status === 'jishogi'
                    ? t('status.jishogi')
                  : status === 'timeout_p1'
                    ? t('status.timeout_p1')
                    : status === 'timeout_p2'
                      ? t('status.timeout_p2')
                      : status === 'annihilation_win_p1'
                        ? t('status.annihilation_win_p1')
                      : status === 'annihilation_win_p2'
                        ? t('status.annihilation_win_p2')
                      : online.isOnline
                  ? // ★v1.55: **観戦者に「あなた／相手」は使えない**（親 §6.8.4）。
                    // 席の名前で言い直す＝誰の手番なのかが読み取れるようにする。
                    (spec.spectating
                      ? (spec.seatNames
                          ? `${spec.seatNames[position.sideToMove]}${t('spec.turnSuffix')}`
                          : position.sideToMove === 'player1'
                            ? t('s07.senteTurn')
                            : t('s07.goteTurn'))
                      : isMyTurnOnline
                        ? t('turn.mine')
                        : t('turn.opp')) +
                    (position.sideToMove === 'player1' ? (senteInCheck ? t('s07.checkTag') : '') : goteInCheck ? t('s07.checkTag') : '')
                    : position.sideToMove === 'player1'
                      ? t('s07.senteTurn') + (senteInCheck ? t('s07.checkTag') : '')
                      : t('s07.goteTurn') + (goteInCheck ? t('s07.checkTag') : '');

  // Phase 3: AI の手番の間は、手番表示に「考え中」を添えて待ち時間を分かるようにする。
  const turnLabelWithAi =
    vsAi && status === 'playing' && position.sideToMove === aiSide
      ? `${turnLabel}${aiThinking ? t('s07.aiThinking') : ''}`
      : turnLabel;

  const isSelected = (row: number, col: number) => selectedSquare?.row === row && selectedSquare?.col === col;
  const isHint = (row: number, col: number) => legalDestinations.some((d) => d.row === row && d.col === col);
  const lastMoveTo =
    position.history.length > 0
      ? moveLandingSquare(position.history[position.history.length - 1])
      : null;
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

  // v1.16 (ユーザー要望): 候補ボックスをマウスを乗せただけでも出す。相手の駒・自分の
  // 手番でない駒も対象 (候補は両者に等しく見えている公開情報なので隠す理由がない)。
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);
  const isHovered = (row: number, col: number) => hoverSquare === `${row},${col}`;

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
  // v1.45: 「いま出している字の次」へ送る (付録D-1 §5.6.2)。番号で選ぶと、
  // 候補が減った拍子に前と同じ字を指してその駒だけ止まって見える。
  const cycle = useQuantumCycle(cycleTick, quantumDisplay === 'cycle');

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

  // v1.24: 見せ方の切替は「ルールを決めた側か」を見なくなった (部屋の値だけで決まる)。

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

  // オンライン対戦で自分の手番でないなら入力を受け付けない。
  // Phase 3: 対 AI では AI の手番も同じく受け付けない (人が AI の駒を動かせてしまわないように)。
  const inputBlocked =
    // ★v1.55 (親 §6.8.1): **観戦者は盤に触れない**。
    // **`mySide === null` では止まらない**＝観戦者は側を持たないので、
    // 上の 1 つ目の条件をすり抜けて相手の駒まで動かせてしまう。
    spec.spectating ||
    (online.isOnline && online.mySide !== null && position.sideToMove !== online.mySide) ||
    (vsAi && !online.isOnline && position.sideToMove === aiSide);

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

  // ★v1.60: 盤以外に置くものの高さを毎回測って CSS へ返す（付録D-8 v1.10 §5.1）。
  // ★v1.62: あわせて「窓の大きさが変わるたびに、盤をいくつにしたか」を記録する
  //          （?debug=1 のときだけ・デバッグ情報の枠に出る／2026-08-20 ユーザーご依頼）。
  const fitRef = useRef<HTMLDivElement>(null);
  const debugLogLayout = useDebugStore((s) => s.logLayout);
  useFitHeight(fitRef, [], debugEnabled ? debugLogLayout : undefined);

  const kifuScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (kifuScrollRef.current) {
      kifuScrollRef.current.scrollTop = kifuScrollRef.current.scrollHeight;
    }
  }, [moveHistory]);

  return (
    <div ref={fitRef}
      className="stage s06">
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
              {/* ★v1.55 (親 §6.8.6): **観戦者には再戦の導線を出さない**＝
                  これは対局者どうしの始末であり、押すと**観戦者の盤だけが作り直されて
                  準備画面へ飛ぶ**（他人の対局を見に来ただけなのに見失う）。 */}
              {status !== 'playing' && !spec.spectating && (
                <button
                  className="reset-btn primary"
                  type="button"
                  onClick={() => {
                    // 再戦は待機 (S05) へ戻る＝新しい対局の開始 (親 §9.2.3 ②)。
                    // **確認はここで取る**。戻る処理は盤を作り直してから画面を移すので、
                    // 画面を移る側の関門だけに任せると、やめても盤が消えてしまう。
                    requestNewGame(() => {
                      const c = pluginGet<OnlineGameConnector>('gameConnector');
                      if (c) c.returnToPreparation();
                    });
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
                {/* ★v1.55: 観戦者は**観戦をやめる**（戻る先も観戦の一覧・親 §6.8.6）。 */}
                {spec.spectating ? t('s13.leave') : t('s07.leaveGame')}
              </button>
            </>
          ) : (
            <>
              {/* v0.68: オフライン対局はオフライン設定から入るので、戻り先も
                  オフライン設定にする (以前はメニューまで戻していた)
                  v1.31 (Phase 3-2): 対 AI で始めた対局は対AI設定 (S03) から入るので、
                  そちらへ戻す (先後と AI を選び直して指し直せる) */}
              {/* v1.43: **モード選択へ戻る道は、他の戻る導線と同じ場所に置く**
                  （2026-08-17 ユーザー判断）。終局パネルの中ではなくここに置くのは、
                  **戻る先を選ぶ操作は同じ並びに集める**ため（終局していなくても押せる）。
                  **設定画面と違って盤を作り直さない**ので、棋譜の確認は出ない。 */}
              <button
                className="reset-btn"
                type="button"
                onClick={() => useRouteStore.getState().setScreen('lobby')}
              >
                {t('s00.modeSelect')}
              </button>
              <button
                className="reset-btn"
                type="button"
                onClick={() =>
                  useRouteStore.getState().setScreen(
                    useAiStore.getState().enabled ? 'ai-setup' : 'offline-rule',
                  )
                }
              >
                {t(vsAi ? 's07.backToAiSetup' : 's07.backToOfflineSetup')}
              </button>
              {/* リセットだけ二段 (画面機能 §3 S07)＝対局中に押せる位置にあり、
                  誤操作の代償が大きいので、先に「リセットしますか」を尋ねる。 */}
              <button
                className="reset-btn"
                type="button"
                onClick={() => requestNewGame(() => reset(), { twoStep: true })}
              >
                {t('s07.reset')}
              </button>
            </>
          )}
          <HeaderCommonRight includeCat={variant === 'b'} />
        </div>
      </header>
      <div className="grid">
        <div className="main-col">

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
            <div className={`turn-banner${status === 'checkmate' ? ' opp' : ''}`}>{turnLabelWithAi}</div>
            {/* ★申し送り (ユーザー判断 2026-08-12): **この切替ボタンはいずれ削除する**。
                付録D-1 §5.6.2 が「対局画面に切替 UI は持たない」と定めており、見せ方の切替は
                S02 / S10 の 2 か所に集約する。今回は消さずに新しい分岐へ揃えるところまで。
                削除するときは合わせて付録D-1 §5.6.2 の記述と本コメントを片付けること。

                v1.08: 量子 ON のときだけ出す。v1.24 で操作の可否を spec 駒UI v0.9 §4.4 に合わせた。
                対局中に動かせるのは自分の画面の値だけで、これは**全員に等しく効く**
                (ルールを決めた側も同じ)。部屋の値が重ねなら固定＝読みやすい側へは誰も逃げられない。 */}
            {currentQuantum && (() => {
              const stackFixed = roomQuantumDisplay === 'stack';
              const canEdit = !stackFixed;
              return (
                <div
                  className="qmode-toggle"
                  title={stackFixed ? t('qmode.stackFixed') : t('qmode.ownScreenOnly')}
                >
                  <button
                    type="button"
                    className={`qm${quantumDisplay === 'cycle' ? ' active' : ''}`}
                    disabled={!canEdit}
                    onClick={() => setQuantumDisplay('cycle')}
                  >
                    {t('qmode.cycle')}
                  </button>
                  <button
                    type="button"
                    className={`qm${quantumDisplay === 'stack' ? ' active' : ''}`}
                    disabled={!canEdit}
                    onClick={() => setQuantumDisplay('stack')}
                  >
                    {t('qmode.stack')}
                  </button>
                  {stackFixed && <span className="qm-lock" aria-hidden="true">🔒</span>}
                </div>
              );
            })()}
          </div>

          <div className="pinfo opp">
            {/* ★v1.55 (親 §6.8.4): 観戦者には「あなた／あいて」が無いので、
                配られた**対局者二人の名前**を側に合わせて出す。 */}
            <span className="nm">
              {spec.seatNames
                ? spec.seatNames[oppSide]
                : online.opponentName || t('player.opp')}
            </span>
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
              cycle={cycle}
              collapsingIds={collapsingIds}
            />
            <div className={`board-with-coords${flipped ? ' flipped' : ''}`}>
              <div className={`board-outer${isMyTurn ? ' myturn' : ''}`}>
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
                      // v1.22: 移動先ヒント (行き先マスのオレンジ) は S10 設定で消せる。
                      // 消えるのは色だけで、指せる場所が変わるわけではない。
                      hintOn && isHint(row, col) ? 'hint' : '',
                      isLastMove(row, col) ? 'lastmove' : '',
                      isEntangledBoard(row, col) ? 'entangled' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <div
                        key={i}
                        className={cls}
                        onClick={() => {
                          // タッチ端末にはマウスオーバーが無いので、触れた駒の候補は
                          // クリック (タップ) でも出す。自分の駒は選択でも出るので二重にならない。
                          setHoverSquare(`${row},${col}`);
                          onSquareClick(row, col);
                        }}
                        onMouseEnter={() => setHoverSquare(`${row},${col}`)}
                        onMouseLeave={() =>
                          setHoverSquare((cur) => (cur === `${row},${col}` ? null : cur))
                        }
                      >
                        {piece && (
                          <PieceView
                            piece={piece}
                            kinds={kinds}
                            locale={locale}
                            viewerSide={viewerSide}
                            mode={quantumDisplay}
                            cycle={cycle}
                            collapsing={collapsingIds.has(piece.pieceId)}
                          />
                        )}
                        {/* 未確定マーク。駒 (.pc) は clip-path で切り抜かれるのでマス直下に置く */}
                        {piece && unconfirmed && (
                          <span className={`qmark-b${piece.owner !== viewerSide ? ' gote' : ''}`}>？</span>
                        )}
                        {/* v1.24: 移動先ヒントを切ると、この「行き先で駒が確定する」予告も
                            一緒に消える (ユーザー判断 2026-08-13)。どちらも「そこへ動いたら
                            どうなるか」を先に教える手助けなので、片方だけ残ると中途半端になる。
                            消えるのは表示だけで、指せる場所も確定の結果も変わらない。 */}
                        {hintOn && foretellKind && (
                          <span className={`foretell${foretellFlipped ? ' gote' : ''}`}>
                            {pieceNameFor(foretellKind, locale)}
                          </span>
                        )}
                        {/* 候補ボックス: 未確定駒の右上に候補を文字だけで並べる。
                            v1.16: 選んだときに加えてマウスを乗せたときも出す (相手の駒も対象)。 */}
                        {piece && unconfirmed && (isSelected(row, col) || isHovered(row, col)) && (
                          <CandidateBox
                            kinds={kinds}
                            locale={locale}
                            onLeft={visualCol >= 6}
                            below={visualRow <= 1}
                          />
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
              cycle={cycle}
              collapsingIds={collapsingIds}
            />
          </div>

          <div className="pinfo you">
            <span className="nm">
              {spec.seatNames ? spec.seatNames[viewerSide] : online.myName || t('player.you')}
            </span>
            <span className="sub">
              {mySideLabel} · {0}
            </span>
            <ClockDisplay side={viewerSide} active={activeClockSide === viewerSide} t={t} />
          </div>

          <div className="command-bar">
            {/* ★v1.55 (親 §6.8.4): 観戦者には**手を出す操作を置かない**
                （投了・待った・引分・中断・威嚇・入玉宣言）。**灰色にして置くのではなく
                置かない**＝灰色は「押せない」だけを意味するので、そもそも自分に
                関係の無い操作は出さない。代わりに**盤の上下を入れ替える**を置く。 */}
            {spec.spectating ? (
              <button
                type="button"
                className={`act${specFlip ? ' on' : ''}`}
                aria-pressed={specFlip}
                onClick={() => setSpecFlip((v) => !v)}
              >
                {t('replay.flipBoard')}
              </button>
            ) : (
              <>
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
                <NyugyokuButton t={t} online={online} />
                <JishogiButton t={t} online={online} status={status} sideToMove={position.sideToMove} />
              </>
            )}
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
            {/* ★v1.55 (親 §6.8.4): v1.54 まではここが常に空だった。
                ★v1.61 (画面機能 §3 S06・付録D-3 §5): **ホストだけに「退室させる」を出す**
                （2026-08-22 実機のご報告＝**規定は v1.55 から在ったのに実装が無かった**）。
                **観戦者自身には出さない**（自分を追い出す押し方を置かない）。 */}
            {spec.watchers.length === 0 ? (
              <div className="spec-empty">{t('spec.empty')}</div>
            ) : (
              <div className="console">
                {spec.watchers.map((w) => (
                  <div
                    key={w.pid}
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {w.name}（{t('spec.role')}）
                    </span>
                    {canKick && (
                      <button
                        type="button"
                        className="spec-kick"
                        onClick={() => {
                          seButton();
                          pluginGet<OnlineGameConnector>('gameConnector')?.kickSpectator?.(w.pid);
                        }}
                      >
                        {t('spec.kick')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
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
      <PromotionModal locale={locale} t={t} viewerSide={viewerSide} mode={quantumDisplay} cycle={cycle} />
      <OpponentLeftModal t={t} />
      <GameEndModal t={t} online={online} />
      <OfferReceivedModal t={t} online={online} />
      <OfferSentPanel t={t} />
      {/* ★v1.84 (親 §4.4.1.3): 持将棋の提案。**別の部品にしてある**＝待つ側は画面を
          覆い、答える側は盤を覆わない＝**見せ方が正反対**なので、同じ部品に混ぜない。 */}
      <JishogiSentPanel t={t} />
      <JishogiReceivedModal t={t} />
      <JishogiSpectatorNotice t={t} />
      {/* ★v1.88 (親 v1.63 §4.4.2.2): 入玉宣言を尋ねる／相手と観戦者への「選択中」。
          **持将棋の提案と同じ並びに置く**＝同じ「盤が止まっている」出来事なので、
          出し方も置き場所もそろえる。 */}
      <NyugyokuPromptModal t={t} online={online} />
      <NyugyokuWaitNotice t={t} online={online} />
      {/* v1.47: 感想戦の打診と諾否 (親 §6.3.6)。**終局後に出る**ものなので、
          対局中の申し出とは別に置く。 */}
      <ReviewOfferReceivedModal t={t} />
      <ReviewOfferSentPanel t={t} />
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
    // Phase 5-15 (§Q17.8 `anomaly_action=notify_user`): 知らせるだけの設定では
    // 投票を開かない。バナーだけ出して盤は異常状態のまま残す。
    if (!anomaly.vote) return;
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
  // ★v1.84: 持将棋の提案中も「申し出中」＝他の申し出と同時に走らせない。
  const jishogi = useOffersStore((s) => s.jishogiOfferFrom);
  return draw !== null || undo !== null || resume !== null || jishogi !== null;
}

/**
 * 待った申し出ボタン（v0.42 改装）。
 * count 判定:
 *   - 自分の手番 (＝相手が指した後) → 2手戻す（相手の直前手＋自分の1手）
 *   - 相手の手番 (＝自分が指しただけ) → 1手戻す
 * challengerSide は自分の side。承諾されると承諾者の時計だけ復元される。
 * オフライン: 即実行（時計は両側巻き戻し）。
 * オンライン: 相手に申し出＋盤面中央パネル＋キャンセル可＋両者時計停止。
 *
 * ★v1.53: **対 AI は 1 回押すごとに 2 手戻す**（ユーザー判断 2026-08-18）。
 * 1 手だけ戻すと**戻るのは AI の指した手だけ**で、人の手は盤に残ったまま AI が
 * 考え直して指す＝**人は指し直せない**（待ったにならない）。**押すたびに 2 手ずつ、
 * 残っている限りどこまでも戻せる**（残りが 1 手ならその 1 手だけ戻る）。
 * 人どうしのオフライン対局は**どちらも人**なので今までどおり 1 手。
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
  const vsAi = useAiStore((s) => s.enabled);
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
    } else if (vsAi) {
      // ★対 AI は 2 手＝AI の手と自分の手（残りが 1 手ならその 1 手だけ戻る）。
      undoLastMove(2);
    } else {
      // 人どうしのオフラインは相手役もいないので単純に 1 手戻す（両側の時計も戻す）
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
/**
 * 持将棋を提案した側の画面 (親 v1.62 §4.4.1.3・付録D-1 v1.20 §7)。
 *
 * **画面を半透明で覆い**「相手の合意を待っています」と出す。**取り消すボタンは置かない**
 * ＝**10 秒で必ず決着する**ので、待つ側に操作を求めない。
 *
 * **★見切りを持つ**＝答える側は 10 秒で必ず答えを送るが、**その伝言が届かないことは
 * ある**（回線・離脱）。見切らないと**提案した側は永久に待ち、盤も時計も止まったまま**
 * になる。**答える側の締め切り (10 秒) より長い 15 秒**にしてあるのは、先に切ると
 * **届いた答えを捨ててしまう**ため。
 */
function JishogiSentPanel({ t }: { t: (key: string) => string }) {
  const from = useOffersStore((s) => s.jishogiOfferFrom);
  const waiting = from === 'me';
  useEffect(() => {
    if (!waiting) return;
    const id = setTimeout(() => {
      useOffersStore.getState().setJishogiOfferFrom(null);
      useOffersStore.getState().setNotice('jishogi', 'rejected');
    }, JISHOGI_WAIT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [waiting]);
  if (!waiting) return null;
  return (
    <>
      <div className="jishogi-veil" />
      <FloatingPanel
        className="floating-result floating-confirm jishogi"
        title={
          <>
            <span className="icon">🤝</span>
            {t('jishogi.sentWaiting')}
          </>
        }
      >
        <div className="body">{t('offer.waitingBody')}</div>
      </FloatingPanel>
    </>
  );
}

/**
 * 持将棋を提案された側の画面 (親 v1.62 §4.4.1.3)。
 *
 * **盤は覆わない**＝**受けるかどうかは盤を見なければ決められない**。
 * **残り秒数を 10 から 0 まで出す**＝**黙って消えると押し損ねる**ので、
 * **これを待っている人がいつ待つのをやめられるか**を示す。
 * **0 になったら自分から「不成立」を送る**＝送らないと相手が永久に待つ。
 */
function JishogiReceivedModal({ t }: { t: (key: string) => string }) {
  const from = useOffersStore((s) => s.jishogiOfferFrom);
  const deadline = useOffersStore((s) => s.jishogiDeadline);
  const [now, setNow] = useState(() => Date.now());
  const answering = from === 'opp';

  useEffect(() => {
    if (!answering) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [answering]);

  const remainMs = deadline === null ? JISHOGI_ANSWER_MS : Math.max(0, deadline - now);
  useEffect(() => {
    if (!answering || deadline === null || remainMs > 0) return;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) c.sendJishogiResponse(false);
    else useOffersStore.getState().setJishogiOfferFrom(null);
  }, [answering, deadline, remainMs]);

  if (!answering) return null;
  const send = (accepted: boolean) => {
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) c.sendJishogiResponse(accepted);
  };
  const remainSec = Math.ceil(remainMs / 1000);
  return (
    <FloatingPanel
      className="floating-result floating-confirm jishogi"
      title={
        <>
          <span className="icon">🤝</span>
          {t('jishogi.receivedTitle')}
        </>
      }
    >
      <div className="body">{t('jishogi.receivedBody')}</div>
      <div className="jishogi-countdown">
        <span className="num">{remainSec}</span>
        <span className="bar">
          <span style={{ width: `${(remainMs / JISHOGI_ANSWER_MS) * 100}%` }} />
        </span>
      </div>
      <div className="btn-row">
        {/* ★v1.85: **拒否は白文字・白枠**（付録D-1 v1.21 §7）＝薄い灰色にすると
            **押せるのに押せないボタンに見える**（実機のご報告）。
            **灰色は「押せない」だけを意味する。** */}
        <button type="button" className="btn ghost outline" onClick={() => send(false)}>
          {t('jishogi.rejectAction')}
        </button>
        <button type="button" className="btn" onClick={() => send(true)}>
          {t('jishogi.acceptAction')}
        </button>
      </div>
    </FloatingPanel>
  );
}

/**
 * 観戦者に「持将棋の提案中」であることだけを出す (親 v1.62 §4.4.1.3)。
 * **盤は覆わず、選ばせるものも置かない**＝**盤が止まるので、何も出さないと固まったように
 * 見える**というだけの理由で出している。
 */
function JishogiSpectatorNotice({ t }: { t: (key: string) => string }) {
  const on = useOffersStore((s) => s.jishogiSpectatorNotice);
  if (!on) return null;
  return <div className="jishogi-spectator-notice">{t('jishogi.spectatorNotice')}</div>;
}

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
            : // ★v1.84: **拒否と 10 秒経過を言い分けない**（親 §4.4.1.3＝どちらも
              // 同じ「不成立」であり、断ることは責められることではない）。
              kind === 'jishogi'
              ? 'jishogi.notAgreed'
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
  const mgf = useGameStore((s) => s.mgf);
  const reset = useGameStore((s) => s.reset);
  // v1.86: 折込みカードの駒名に要る (t は鍵を引くだけで言語を返さない)。
  const locale = useI18nStore((s) => s.locale);
  const [dismissed, setDismissed] = useState<string>('');
  /**
   * ★v1.55: 観戦者かどうか（親 §6.8.6）。**いまこの瞬間の事実を口に聞く**＝
   * この入れ物は終局のたびに作り直されるので、控えを持ち回る理由が無い。
   * **口が無いビルド・古い形の相手でも落ちない**ようにする（縮退互換）。
   */
  const conn = pluginGet<OnlineGameConnector>('gameConnector');
  const spectating = conn && typeof conn.isSpectating === 'function' ? conn.isSpectating() : false;

  useEffect(() => {
    setDismissed('');
  }, [status]);

  if (status === 'playing') return null;
  if (dismissed === status) return null;

  // 誰が勝ちで誰が負けか（絶対 side ベース）。読み替えは game-store の 1 か所に集約。
  const winnerSide = winnerOf(status, position.sideToMove);
  let reasonKey: string;
  switch (status) {
    case 'checkmate':
      reasonKey = 'result.reason.checkmate';
      break;
    case 'nyugyoku_win_p1':
    case 'nyugyoku_win_p2':
      reasonKey = 'result.reason.nyugyoku';
      break;
    case 'resigned_p1':
    case 'resigned_p2':
      reasonKey = 'result.reason.resign';
      break;
    case 'sennichite':
      reasonKey = 'result.reason.sennichite';
      break;
    case 'agreed_draw':
      reasonKey = 'result.reason.agreed_draw';
      break;
    case 'jishogi':
      reasonKey = 'result.reason.jishogi';
      break;
    case 'timeout_p1':
    case 'timeout_p2':
      reasonKey = 'result.reason.timeout';
      break;
    case 'nogame':
      // Phase 5-13: ノーゲーム (異常状態合意)。勝敗つかず・レート非変動 (親 §4.4)。
      reasonKey = 'result.reason.nogame';
      break;
    case 'annihilation_win_p1':
    case 'annihilation_win_p2':
      // Phase 6: 全滅 (はさみ将棋・親 §3.10)。相手の駒が規定枚数以下になった。
      reasonKey = 'result.reason.annihilation';
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

  /**
   * 敵陣内の大駒の内訳 (★v1.86・量子分冊 v0.9 §Q21.7・付録D-3 v1.10 §3.4)。
   *
   * **量子モードでは駒の名前を出さず、枚数だけを出す** (例「大駒 2 枚」)。点数は
   * 「**取りうる姿がすべて大駒なら 5 点**」で数えている (§Q21.3) ので、**5 点と
   * 分かっていても飛か角かは分からない**。名前を出すと**名札を正体として使う**ことに
   * なり、v1.48 で直した取り違えを見た目の側で繰り返す。
   *
   * **棋譜の「仮」は流用しない**＝あれは「もともとどのマスに置かれていた駒か」を指す
   * 呼び名であって、**大駒かどうかとは無関係** (2026-08-23 ユーザー指摘)。
   *
   * 量子モードかどうかは**駒が候補集合を持っているか**で判定する (棋譜の書き方と
   * 同じ既存の決まり)。通常将棋モードでは候補が 1 つなので必ず名前が出る。
   */
  const majorsText = (side: 'player1' | 'player2') => {
    const { total, byKind } = listEnterZoneMajors(mgf, position, side);
    if (hasCandidateSets(position) || byKind.length === 0) {
      return `${total}${t('result.detail.pieces')}`;
    }
    // 猫語のときの駒名は日本語を借りる (盤の駒と同じ扱い)。
    const nameLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
    return byKind
      .map((m) => `${pieceNameFor(m.kind, nameLocale)}${m.count}`)
      .join(t('result.detail.sep'));
  };

  /**
   * 補足詳細の折込みカード (★v1.87・付録D-3 v1.11 §3.4)。
   *
   * **該当する終局理由のときだけ現れる**。行は 2 種類で、**2 列の行**(左に項目名・
   * 右に値) と**1 行まるごとの行**(式・条件のように 2 列に収まらないもの)。
   * **どちらを使うかは「言うことが 2 列に収まるか」だけで決まる**＝終局理由ごとに
   * 勝手な見せ方を作ってよいという意味ではない。
   *
   * **★点数は合計だけでなく式で出す** (v1.87・ユーザー指示)＝**合計だけでは、
   * その数がどう出たのか読み手に確かめようがない**。とくに本アプリは**同じ「点」で
   * 数える範囲が 2 通りある**ので、合計だけ見て別の物差しと見比べられてしまう。
   */
  type DetailLine =
    | { kind: 'row'; label: string; value: string }
    | { kind: 'line'; text: string; ok?: boolean };
  const detailLines: DetailLine[] = [];

  /** 式の中の数を差し込む (語順は言語ごとに違うので、雛形の側を各言語が持つ)。 */
  const fill = (key: string, vars: Record<string, string | number>) =>
    Object.entries(vars).reduce(
      (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
      t(key),
    );

  /**
   * 「先手：入玉、大駒5点×2枚＋小駒1点×22枚（玉1枚を除く）＝31点」の 1 行。
   *
   * **王の分を引いていないときは「（玉1枚を除く）」を書かない**＝引いていない数を
   * 引いたと言うことになるため (雛形を 2 つ持つ)。
   */
  const pointLine = (side: 'player1' | 'player2', b: PointBreakdown, entered: boolean) => {
    const formula = fill(
      b.royalExcluded ? 'result.detail.formula' : 'result.detail.formulaNoKing',
      { M: b.major, m: b.minor, P: b.points },
    );
    return fill(entered ? 'result.detail.sideEntered' : 'result.detail.sideLine', {
      side: t(side === 'player1' ? 's07.senteLbl' : 's07.goteLbl'),
      formula,
    });
  };

  if (status === 'annihilation_win_p1' || status === 'annihilation_win_p2') {
    // 「あと何枚で終わりだったのか」が分からないと、なぜ終わったのかが伝わらない。
    const threshold = mgf.victory?.remaining_threshold ?? 0;
    detailLines.push(
      {
        kind: 'row',
        label: t('result.detail.remainingSente'),
        value: `${countBoardPieces(position, 'player1')}${t('result.detail.pieces')}`,
      },
      {
        kind: 'row',
        label: t('result.detail.remainingGote'),
        value: `${countBoardPieces(position, 'player2')}${t('result.detail.pieces')}`,
      },
      {
        kind: 'row',
        label: t('result.detail.winCondition'),
        value: `${threshold}${t('result.detail.piecesOrFewer')}`,
      },
    );
  } else if (status === 'nyugyoku_win_p1' || status === 'nyugyoku_win_p2') {
    // **宣言した側だけ**を出す (付録D-3 §3.4)＝入玉宣言はひとりで宣言するので、
    // 判定の材料は宣言した側の数字だけである。
    const side: 'player1' | 'player2' = status === 'nyugyoku_win_p1' ? 'player1' : 'player2';
    const breakdown = enterZonePointBreakdown(mgf, position, side);
    const entered = isEnteringKingEstablished(mgf, position, side);
    const zonePieces = countEnterZonePieces(mgf, position, side);
    // しきい値は先手・後手で違う (27 点法＝先手 28・後手 27)。**宣言した側のもの**を出す。
    const need = resolveSideThreshold(mgf.victory?.entering_king?.point_threshold, side, 24);
    // 点数法の呼び名はルール定義から取る。**しきい値の数から言い当てない**
    // (付録D-3 §3.4)。知らない呼び名なら何も添えない。
    const method = mgf.victory?.entering_king?.count_method;
    const methodName =
      method === '27point' || method === '24point' ? t(`result.detail.method.${method}`) : '';

    detailLines.push({ kind: 'line', text: pointLine(side, breakdown, entered) });
    // ★宣言の 3 条件を式で出し、達成の有無を印で示す (v1.87・ユーザー指示)。
    // **終局画面に出す時点では 3 つとも必ず達成済み**なので、役目は
    // 「どう達成したのかを見せる」こと。
    detailLines.push({ kind: 'line', text: t('result.detail.condEntered'), ok: entered });
    detailLines.push({
      kind: 'line',
      text: fill('result.detail.condPieces', { n: zonePieces, need: REQUIRED_PIECE_COUNT }),
      ok: zonePieces >= REQUIRED_PIECE_COUNT,
    });
    detailLines.push({
      kind: 'line',
      text: fill(methodName ? 'result.detail.condPointsMethod' : 'result.detail.condPoints', {
        p: breakdown.points,
        need,
        method: methodName,
      }),
      ok: breakdown.points >= need,
    });
    // **式の枚数 (持ち駒を含む) と、条件の枚数 (盤上だけ) は違う**ので、
    // 数える範囲を添えないと 2 つの数が食い違って見える。
    detailLines.push({
      kind: 'row',
      label: t('result.detail.scope'),
      value: t('result.detail.scopeEnter'),
    });
    detailLines.push({
      kind: 'row',
      label: t('result.detail.zoneMajors'),
      value: majorsText(side),
    });
  } else if (status === 'jishogi') {
    // **双方を出す** (付録D-3 §3.4)＝持将棋は双方の合意で成り立つので、
    // 両方の数字が揃って初めて「引き分けが妥当だった」と読める。
    for (const side of ['player1', 'player2'] as const) {
      detailLines.push({
        kind: 'line',
        text: pointLine(
          side,
          jishogiPointBreakdown(mgf, position, side),
          isEnteringKingEstablished(mgf, position, side),
        ),
      });
    }
    // **数える範囲が入玉宣言と違うことを添える**＝同じ「点」でも測っている
    // 対象が違うので、添えないと入玉宣言の点数と見比べられてしまう。
    detailLines.push({
      kind: 'row',
      label: t('result.detail.scope'),
      value: t('result.detail.scopeJishogi'),
    });
  }

  // 「対局準備に戻る」or「もう一度対局」— 同じ部屋で再対局を可能に
  const rematchLabel = online.isOnline ? t('result.rematch.online') : t('result.rematch.offline');
  // 「もう一度対局」も新しい対局の開始なので、未保存の棋譜があれば先に尋ねる
  // (親 §9.2.3 ②)。終局後に押す物なので一段 (二段はリセットだけ)。
  const onRematch = () => {
    requestNewGame(() => {
      const c = pluginGet<OnlineGameConnector>('gameConnector');
      if (online.isOnline && c) {
        c.returnToPreparation();
      } else {
        reset();
        setDismissed(status);
      }
    });
  };

  const verdictClass =
    winnerSide === null ? 'draw' : online.isOnline && online.mySide === winnerSide ? 'win' : online.isOnline ? 'lose' : '';

  return (
    <FloatingPanel key={status} className="floating-result" title={t('result.title')}>
      <div className={`verdict ${verdictClass}`}>{t(verdictKey)}</div>
      <div className="body">{t(reasonKey)}</div>
      {detailLines.length > 0 && (
        <div className="detail">
          {detailLines.map((d, i) =>
            d.kind === 'row' ? (
              <div className="drow" key={`r${i}`}>
                <span>{d.label}</span>
                <b>{d.value}</b>
              </div>
            ) : (
              <div className="dline" key={`l${i}`}>
                {d.text}
                {d.ok !== undefined && <b className="mark">{d.ok ? ' ✓' : ' ✗'}</b>}
              </div>
            ),
          )}
        </div>
      )}
      {/* v1.42: **押せるボタンは白文字・白枠**（付録D-3 §4.1）。灰色は「押せない」だけを
          意味する＝押せるのに灰色だと押せないボタンに見える。主動作の「もう一度対局」
          だけオレンジ地のまま＝主従の差は残す。 */}
      <div className="btn-row">
        <button
          type="button"
          className="btn ghost outline"
          onClick={() => setDismissed(status)}
        >
          {t('result.close')}
        </button>
        {/* ★v1.61 (親 §6.8.6・付録D-3 v1.8 §4.2): **観戦した棋譜は保存できる**。
            v1.60 まではこれも出していなかったが、**置かない根拠は「観戦者に棋譜は無い」
            だった**（v1.55 当時）。**その前提は親 v1.60 で消えている**＝観戦した対局も
            見ていた人の端末に記録が残るようになった。**分けている規定は、その理由と
            一緒に死ぬ**ので、置かない理由はもう無い（2026-08-22 実機のご報告＝
            **観戦した棋譜の保存手段が無かった**）。 */}
        <SaveKifuButton t={t} />
        {/* ★v1.55: **観戦者には残りの次アクションを出さない**（棋譜再生・感想戦・
            もう一度対局）。**他人の対局の始末**であり、とくに**感想戦は二人で決めるもの**
            なので、押せると二人の相談に割り込む。**勝敗と終局理由は今までどおり見える**。 */}
        {!spectating && (
          <>
            <ReplayKifuButton t={t} />
            <ReviewButton t={t} />
            <button type="button" className="btn" onClick={onRematch}>
              {rematchLabel}
            </button>
          </>
        )}
      </div>
    </FloatingPanel>
  );
}

/**
 * 終局パネルの「棋譜を保存」(親 §9.2.1・画面機能 §3 S07)。
 *
 * 押すとその場で 1 局 1 ファイルとして端末へ書き出す。**棋譜再生画面へは行かない**
 * (保存だけして再戦やトップへ進めるようにするため)。
 *
 * 棋譜の機能を積んでいないビルド (アプリ A) では書き出す口が無いので、
 * **ボタンごと出さない**。押せるのに何も起きない状態を作らないため。
 */
function SaveKifuButton({ t }: { t: (key: string) => string }) {
  const save = pluginGet<() => Promise<void>>('kifu:save');
  const [saving, setSaving] = useState(false);
  if (!save) return null;
  return (
    <button
      type="button"
      className="btn ghost outline"
      disabled={saving}
      onClick={() => {
        setSaving(true);
        void save().finally(() => setSaving(false));
      }}
    >
      {t('result.saveKifu')}
    </button>
  );
}

/**
 * 終局パネルの「棋譜再生」(画面機能 §3 S07)。
 *
 * 押すと棋譜再生画面 (S08) へ移り、**直前の対局が読み込まれた状態**で開く
 * (ファイルを選び直さなくてよい)。**保存とは別の動作**で、ここでは何も書き出さない。
 *
 * **再生は破棄の契機ではない**ので確認は挟まない (親 §9.2.3 ②)。
 * 棋譜の機能を積んでいないビルド (アプリ A) では画面そのものが無いので出さない。
 */
function ReplayKifuButton({ t }: { t: (key: string) => string }) {
  const open = pluginGet<(from: 'lobby' | 'game') => void>('kifu:open');
  const hasLast = pluginGet<() => boolean>('kifu:hasLast');
  if (!open || !hasLast?.()) return null;
  return (
    <button type="button" className="btn ghost outline" onClick={() => open('game')}>
      {t('result.replayKifu')}
    </button>
  );
}

/**
 * 終局パネルの「感想戦」(画面機能 v0.37 §3 S07・意味論＝親 §9.4)。
 *
 * 押すと**いま終わった対局**で感想戦 (S11) へ入る。**記録を作らない場**なので、
 * ここで何も書き出さず、記憶にも触らない (§9.4.3)。
 *
 * **相手が居るネット対戦では、まず打診する** (親 §6.3.6・v1.47)。同意が要るのは
 * **相手を巻き込むことだけ**なので、**断られてもひとりで入る**。対 AI・オフライン対人
 * ではその場でひとりで入る (打診しない)。
 */
function ReviewButton({ t }: { t: (key: string) => string }) {
  const open = pluginGet<(from: 'lobby' | 'game' | 'kifu-replay') => boolean>('review:open');
  const hasLast = pluginGet<() => boolean>('kifu:hasLast');
  const canOffer = pluginGet<() => boolean>('review:canOffer');
  const offer = pluginGet<() => void>('review:offer');
  if (!open || !hasLast?.()) return null;
  return (
    <button
      type="button"
      className="btn ghost outline"
      onClick={() => {
        if (canOffer?.() && offer) {
          offer();
          return;
        }
        open('game');
      }}
    >
      {t('result.review')}
    </button>
  );
}

/**
 * 感想戦を申し出ている間のパネル (付録D-12 §7・v1.47)。
 *
 * **返事を待つあいだ閉じ込めない**＝「ひとりで始める」を必ず置く。押せば申し出を
 * 取り下げてその場で感想戦へ入る。**相手が居なくなったら、待たずにひとりで入る**。
 */
function ReviewOfferSentPanel({ t }: { t: (key: string) => string }) {
  const from = useOffersStore((s) => s.reviewOfferFrom);
  const open = pluginGet<(from: 'lobby' | 'game' | 'kifu-replay') => boolean>('review:open');
  const withdraw = pluginGet<() => void>('review:withdrawOffer');
  const oppName = pluginGet<OnlineGameConnector>('gameConnector')?.getOpponentName() ?? '';

  const startAlone = () => {
    withdraw?.();
    open?.('game');
  };

  // 相手が居なくなったら待ち続けない (付録D-12 §7)。
  useEffect(() => {
    if (from === 'me' && oppName === '') startAlone();
    // startAlone は毎回作り直されるが、見たいのは「申し出中に相手が消えたか」だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, oppName]);

  if (from !== 'me') return null;
  return (
    <FloatingPanel
      className="floating-result floating-confirm review"
      title={
        <>
          <span className="icon">🔍</span>
          {t('review.sentTitle')}
        </>
      }
    >
      <div className="body">{t('review.sentBody')}</div>
      <div className="btn-row">
        <button type="button" className="btn ghost outline" onClick={startAlone}>
          {t('review.aloneAction')}
        </button>
      </div>
    </FloatingPanel>
  );
}

/**
 * 感想戦のお誘いを受けたときのモーダル (付録D-12 §7・v1.47)。
 *
 * **緑を使わない**・**断るボタンを灰色にしない** (灰色は「押せない」だけを意味する)。
 */
function ReviewOfferReceivedModal({ t }: { t: (key: string) => string }) {
  const from = useOffersStore((s) => s.reviewOfferFrom);
  const answer = pluginGet<(accepted: boolean) => void>('review:answerOffer');
  if (from !== 'opp' || !answer) return null;
  return (
    <FloatingPanel
      className="floating-result floating-confirm review"
      title={
        <>
          <span className="icon">🔍</span>
          {t('review.receivedTitle')}
        </>
      }
    >
      <div className="body">{t('review.receivedBody')}</div>
      <div className="btn-row">
        <button type="button" className="btn ghost outline" onClick={() => answer(false)}>
          {t('review.rejectAction')}
        </button>
        <button type="button" className="btn" onClick={() => answer(true)}>
          {t('review.acceptAction')}
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
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
}

/**
 * 入玉宣言ボタン (親 v1.63 §4.4.2.1)。
 *
 * **★宣言は勝つ側の権利**であり、**負ける側に押す権利は無い**。したがって
 * **出してよいのは「この画面を見ている本人の側」が条件を満たしているときだけ**で、
 * **「いま手番の側」で決めてはならない**。
 *
 * **v1.87 まではいま手番の側で決めていた**ので、**ネット対戦で相手の手番になった瞬間、
 * 相手の条件で自分の画面にもボタンが出ていた**（実機のご報告 2026-08-23）。
 * **押すと相手の勝ちを宣言してしまう。**
 * 投了・待った・引分・持将棋は元から自分の側で決めており、ここだけが揃っていなかった。
 *
 * **押せるのは自分の手番のときだけ**（§4.4.2.3）。自分の手で条件が揃った直後は、
 * このボタンではなく `NyugyokuPromptModal` が受け持つ。
 */
function NyugyokuButton({ t, online }: NyugyokuButtonProps) {
  const position = useGameStore((s) => s.position);
  const canP1 = useGameStore((s) => s.canNyugyokuP1);
  const canP2 = useGameStore((s) => s.canNyugyokuP2);
  const status = useGameStore((s) => s.status);
  const prompting = useGameStore((s) => s.nyugyokuPromptSide) !== null;
  const declareNyugyoku = useGameStore((s) => s.declareNyugyoku);
  const mySide = useMyDeclaringSide(online);
  const canMine = mySide !== null && (mySide === 'player1' ? canP1 : canP2);
  const canNow =
    status === 'playing' && !prompting && canMine && position.sideToMove === mySide;
  // 音は「押せるようになった」ことに対して鳴らす。**尋ねているモーダルが出ている間は
  // ボタンを出さない**が、そのときは鳴らす役目をモーダル側が持つ。
  useAppearedNotice(canNow);
  if (!canNow || !mySide) return null;
  return (
    <button type="button" className="act available" onClick={() => declareNyugyoku(mySide)}>
      {t('cmd.nyugyoku')}
    </button>
  );
}

/**
 * 「入玉宣言しますか？」(★v1.88・親 v1.63 §4.4.2.2・付録D-1 v1.22 §7)。
 *
 * **自分が指した直後に、それまで成立していなかった条件が成立したとき**に出る。
 * **両者の時計は止まり、選ぶまで駒は動かせない**（止める仕事は game-store と
 * 時計の tick が受け持つ）。
 *
 * **★残り秒数は出さない**＝**時間制限が無い**。**持将棋の諾否から残量表示を
 * 借りてこないこと**＝借りると**在りもしない締め切りを見せる**ことになる。
 *
 * **★覆いは盤・駒台・操作の行までで、チャットには掛けない**＝**止めるのは盤と
 * 時計だけ**で、**話す手段まで止めない**（ユーザー判断 2026-08-23）。
 */
function NyugyokuPromptModal({
  t,
  online,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
}) {
  const promptSide = useGameStore((s) => s.nyugyokuPromptSide);
  const declareNyugyoku = useGameStore((s) => s.declareNyugyoku);
  const setNyugyokuPrompt = useGameStore((s) => s.setNyugyokuPrompt);
  const mySide = useMyDeclaringSide(online);
  const vsAi = useAiStore((st) => st.enabled);
  const aiSide = useAiStore((st) => st.aiSide);
  // **AI には尋ねない**（親 §7.9.1＝できるときは必ず宣言するので迷わない）。
  const forAi = vsAi && promptSide === aiSide;
  // **同じ端末の二人**のときは、尋ねられているのはその手を指した側なので、
  // `useMyDeclaringSide` の「いま手番の側」とは食い違う。**尋ねられている側で判断する。**
  const mine = online.isOnline ? promptSide === mySide : !forAi;
  const notify = promptSide !== null && mine;
  useAppearedNotice(notify);
  useEffect(() => {
    if (!notify) return;
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.sendNyugyokuPrompt?.(true);
    return () => {
      c?.sendNyugyokuPrompt?.(false);
    };
  }, [notify]);
  if (promptSide === null || !mine) return null;
  const answer = (declare: boolean) => {
    if (declare) declareNyugyoku(promptSide);
    else setNyugyokuPrompt(null);
  };
  return (
    <>
      {/* **持将棋の覆いを流用しない**＝あちらの見張りは「覆いを出すのは提案した側だけ」を
          クラスの数で確かめている。**値は下の検査でそろえてある。** */}
      <div className="nyugyoku-veil" />
      <FloatingPanel
        className="floating-result floating-confirm nyugyoku"
        title={
          <>
            <span className="icon">🏁</span>
            {t('nyugyoku.askTitle')}
          </>
        }
      >
        <div className="body">{t('nyugyoku.askBody')}</div>
        <div className="btn-row">
          <button type="button" className="btn ghost outline" onClick={() => answer(false)}>
            {t('nyugyoku.askNo')}
          </button>
          <button type="button" className="btn" onClick={() => answer(true)}>
            {t('nyugyoku.askYes')}
          </button>
        </div>
      </FloatingPanel>
    </>
  );
}

/**
 * 「入玉宣言選択中」(★v1.88・親 v1.63 §4.4.2.2・付録D-1 v1.22 §7)。
 *
 * **相手と観戦者に出す**。**盤は覆わない**（見ていてよい）。
 * **答えるものは無いのでボタンは置かない。**
 *
 * **何も出さずに盤だけ効かなくすると、相手は壊れたと受け取る**＝
 * **「無い」は送るべき事実**という既存の決まりと同じ。
 */
function NyugyokuWaitNotice({
  t,
  online,
}: {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
}) {
  const promptSide = useGameStore((s) => s.nyugyokuPromptSide);
  const mySide = useMyDeclaringSide(online);
  const vsAi = useAiStore((st) => st.enabled);
  const aiSide = useAiStore((st) => st.aiSide);
  if (promptSide === null) return null;
  const forAi = vsAi && promptSide === aiSide;
  const mine = online.isOnline ? promptSide === mySide : !forAi;
  if (mine) return null;
  return <div className="nyugyoku-wait">{t('nyugyoku.waitNotice')}</div>;
}

/**
 * この画面の持ち主が宣言できる側 (★v1.88・親 v1.63 §4.4.2.1)。
 *
 * - **ネット対戦**＝自分の席。相手の側は決して返さない。
 * - **対 AI**＝AI ではないほうの側（AI は §7.9 で自分から宣言する）。
 * - **同じ端末の二人**＝どちらも自分なので、いま手番の側。
 *
 * **1 か所にまとめてあるのは、場面ごとに書き分けると必ずどれかで取り違えるため。**
 */
function useMyDeclaringSide(online: {
  isOnline: boolean;
  mySide: 'player1' | 'player2' | null;
}): 'player1' | 'player2' | null {
  const sideToMove = useGameStore((s) => s.position.sideToMove);
  const vsAi = useAiStore((st) => st.enabled);
  const aiSide = useAiStore((st) => st.aiSide);
  if (online.isOnline) return online.mySide;
  if (vsAi) return aiSide === 'player1' ? 'player2' : 'player1';
  return sideToMove;
}

/**
 * 「押せる手立てが現れた」ことを 1 度だけ音で知らせる (音響 v0.9 §2.3・付録D-1 v1.20 §7)。
 *
 * **現れた瞬間に 1 回だけ**＝**現れている間ずっとは鳴らさない／条件を満たしたまま手が
 * 進む間も鳴らし直さない**。**いったん条件から外れて再び満たしたときに、また 1 回**。
 *
 * **鳴らす理由**＝入玉宣言も持将棋も**自分の指し手だけでは条件が揃わない**（相手の駒の
 * 位置にも左右される）ので、**知らせないと現れたことに気づけない**。
 * **鳴らし続けない理由**＝どちらも**押さずに指し続けてよい**手立てなので、鳴り続けると
 * 急かしているように受け取られる。
 */
function useAppearedNotice(available: boolean): void {
  const prev = useRef(available);
  useEffect(() => {
    if (available && !prev.current) seNotify();
    prev.current = available;
  }, [available]);
}

interface JishogiButtonProps {
  t: (key: string) => string;
  online: { isOnline: boolean; mySide: 'player1' | 'player2' | null };
  status: string;
  sideToMove: 'player1' | 'player2';
}

/**
 * 持将棋の提案ボタン (親 v1.62 §4.4.1・画面機能 v0.54 §3 S06)。
 *
 * **双方が入玉していて双方が持将棋の点数以上のときだけ現れる**（揃わない間は灰色で
 * 置くのではなく置かない＝**灰色は「押せない」だけを意味する**ので、条件を説明しない
 * 灰色を並べても何も伝わらない）。**押せるのは自分の手番のときだけ。**
 *
 * **オフライン（対 AI・同じ端末の二人）では出さない**＝**相手が諾否を答えられない**。
 * 引き分けにしたいときは従来どおり「引分」が使える（親 §4.4.1.4＝両方残す）。
 */
function JishogiButton({ t, online, status, sideToMove }: JishogiButtonProps) {
  const canJishogi = useGameStore((s) => s.canJishogi);
  const paused = useGameStore((s) => s.paused);
  const anyOffer = useAnyOfferPending();
  const [blockedUntilMyNextTurn, setBlockedUntilMyNextTurn] = useState(false);
  const notice = useOffersStore((s) => s.lastNoticeKind);
  const noticeType = useOffersStore((s) => s.lastNoticeType);
  // ★v1.88 (親 v1.63 §7.9.2): **対 AI でも提案できる**＝**AI は自分から提案しないが、
  // 提案されたら必ず賛成する**と決めた（ユーザー判断 2026-08-23）。
  // **v1.87 の「オフラインでは出さない」は「相手が諾否を答えられない」ことを理由に
  // していた**ので、**その理由は対 AI については消えた**。
  // **同じ端末の二人のときは引き続き出さない**（答える相手が居ない）。
  const vsAi = useAiStore((st) => st.enabled);
  const aiSide = useAiStore((st) => st.aiSide);
  const mySide = online.isOnline
    ? online.mySide
    : vsAi
      ? aiSide === 'player1'
        ? 'player2'
        : 'player1'
      : null;
  const myTurn = mySide !== null && mySide === sideToMove;

  // ★不成立になったら、**次に自分の手番が来るまで**再提案できない (親 §4.4.1.3)。
  // 連打で相手を煩わせないため。手番が自分から離れた時点で解ける。
  useEffect(() => {
    if (notice === 'jishogi' && noticeType === 'rejected') setBlockedUntilMyNextTurn(true);
  }, [notice, noticeType]);
  useEffect(() => {
    if (!myTurn) setBlockedUntilMyNextTurn(false);
  }, [myTurn]);

  const visible = (online.isOnline || vsAi) && status === 'playing' && canJishogi;
  useAppearedNotice(visible);
  if (!visible) return null;

  const disabled = paused || anyOffer || !myTurn || blockedUntilMyNextTurn;
  const onClick = () => {
    if (!online.isOnline && vsAi) {
      // ★v1.88 (親 §7.9.2): **AI は必ず賛成する**。伝言を往復させる相手が居ないので、
      // **その場で成立**させる。**断る経路は AI 相手では起こらない。**
      useGameStore.getState().agreeJishogi();
      return;
    }
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    if (c) c.sendJishogiOffer();
  };
  return (
    <button type="button" className="act available" disabled={disabled} onClick={onClick}>
      {t('cmd.jishogi')}
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
  cycle: CycleReader;
}

/**
 * 成るかどうかの確認。**感想戦 (S11) からも同じものを出す**ので export する
 * （付録D-12 §1「発明し直さない」）。盤に触れる部品はここ 1 つに集めておかないと、
 * 片方だけ直った状態が生まれる。
 */
export function PromotionModal({ locale, t, viewerSide, mode, cycle }: PromotionModalProps) {
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
              <PieceView piece={nonPromotePiece} kinds={nonPromoteKinds} locale={locale} viewerSide={viewerSide} mode={mode} cycle={cycle} />
            </div>
          </button>
          <button type="button" className="promotion-card" onClick={() => confirmPromotion(true)}>
            <div className="label">{t('promote.confirm')}</div>
            <div className="promotion-card-piece">
              <PieceView piece={promotePiece} kinds={promoteKinds} locale={locale} viewerSide={viewerSide} mode={mode} cycle={cycle} />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

/** 駒台のカード 1 枚ぶん。棋譜再生画面 (S08) も同じ駒台を使うので外へ出す。 */
export interface HandGroup {
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
export function groupHand(hand: PieceInstance[], mgf: Mgf, kindMap: Map<PieceId, string>): HandGroup[] {
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
 * v1.45: 巡回表示で「今どの字を出すか」は `useQuantumCycle` が決める
 * (付録D-1 v1.14 §5.6.2)。**候補の何番目か、では選ばない**＝候補が減った拍子に
 * 前と同じ字を指し、その駒だけ止まって見えるため。詳しくは `quantum-cycle.ts`。
 */
function shownKind(cycle: CycleReader | undefined, key: string, kinds: string[]): string {
  return cycle ? cycle(key, kinds) : kinds[0];
}

/** 盤の駒 1 枚。棋譜再生画面 (S08) も同じ絵柄を使うので外へ出す（発明し直さない）。 */
export function PieceView({
  piece,
  kinds,
  locale,
  viewerSide = 'player1',
  mode = 'cycle',
  cycle,
  collapsing = false,
}: {
  piece: PieceInstance;
  /** 表示する駒種 (強さ降順)。本将棋モードは [piece.kind] の 1 個。 */
  kinds: string[];
  locale: LocaleCode;
  viewerSide?: 'player1' | 'player2';
  mode?: QuantumDisplay;
  /** 巡回表示で「いま出す字」を決める口 (付録D-1 §5.6.2)。渡さなければ先頭の字。 */
  cycle?: CycleReader;
  collapsing?: boolean;
}) {
  const isEn = locale === 'en';
  const unconfirmed = kinds.length >= 2;
  const stacked = unconfirmed && mode === 'stack';
  const shown = unconfirmed ? shownKind(cycle, piece.pieceId, kinds) : kinds[0];
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
 * 候補ボックス (spec 駒デザイン §4.5)。未確定駒の右上に候補の駒種を文字だけ並べる
 * (例「歩桂銀」)。説明文は付けない。盤の右端寄りでは左上へ回避する。
 * 英字表記のときは読みやすさのため空白区切りにする (例「P N S」)。
 *
 * v1.16 (ユーザー要望): 出す条件を「選んだとき」から「選んだとき **または** マウスを
 * 乗せたとき」に広げ、相手の駒・自分の手番でない駒も対象にした。あわせて、
 * **画面からはみ出さないように出す**。上端・下端・左右端では出す向きを変え、それでも
 * はみ出すぶんは測って画面内へ寄せる (盤の隅や駒台の端で切れていたため)。
 *
 * v1.17 (ユーザー報告): **他の駒の下に隠れることがあった**。相手の駒台のカードは
 * 器ごと 180 度回っており、回転は「重なり順の入れ物」を作るため、その中に置いた
 * 候補ボックスは**どれだけ手前指定をしても同じ駒台の後続カードに隠れて**しまう。
 * そこで**画面の一番外側に出して画面座標で置く**方式に変えた (常に最前面・切れない)。
 * 回転した器の外に出るので、文字を回し戻す必要も無くなった。
 * 出したまま窓の大きさが変わる/巻物が動く場合に備えて位置は測り直す。
 */
export function CandidateBox({
  kinds,
  locale,
  onLeft,
  below = false,
}: {
  kinds: string[];
  locale: LocaleCode;
  onLeft: boolean;
  /** 上端寄りで上に出すと画面外になる場合、下に出す */
  below?: boolean;
}) {
  // 置き場所の基準にする駒 (このしるしの親要素 = 盤のマス or 駒台のカード)。
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [recalc, setRecalc] = useState(0);

  const sep = locale === 'en' ? ' ' : '';
  const text = kinds.map((k) => pieceNameFor(k, locale)).join(sep);

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.parentElement;
    const el = tipRef.current;
    if (!anchor || !el) return;
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const margin = 4;
    // 従来と同じ位置関係 (駒の右上／右端寄りは左上／上端寄りは下側) を画面座標で組む。
    let left = onLeft ? a.left - w - margin : a.right + margin;
    let top = below ? a.top + a.height * 0.92 : a.top + a.height * 0.08 - h;
    // 画面内に収める。
    left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - w - margin));
    top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - h - margin));
    setPos((cur) => (cur && cur.left === left && cur.top === top ? cur : { left, top }));
  }, [text, onLeft, below, recalc]);

  // 出している間に窓の大きさが変わる/画面が動いたら測り直す。
  useEffect(() => {
    const onChange = () => setRecalc((n) => n + 1);
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  }, []);

  const style: CSSProperties = {
    position: 'fixed',
    left: pos ? pos.left : 0,
    top: pos ? pos.top : 0,
    // 盤・駒台 (最大 z-index 101) より手前、各種オーバーレイ (195 以上) より奥。
    zIndex: 150,
    // 測り終えるまでは出さない (一瞬だけ変な位置に見えるのを防ぐ)。
    visibility: pos ? 'visible' : 'hidden',
  };

  return (
    <>
      <span ref={anchorRef} style={{ display: 'none' }} />
      {createPortal(
        <span ref={tipRef} className="qtip" style={style}>
          {text}
        </span>,
        document.body,
      )}
    </>
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
  /**
   * ★v1.56: **駒台そのものを押したときの受け口**（感想戦の自由な操作・親 §9.4.2.1）。
   *
   * **駒を持って駒台を押したら、その駒台へ移す**（2026-08-19 ユーザーご指示）。
   * v1.55 は盤の上に浮く「的」を出していたが、**駒台が目の前にあるのに別の的を
   * 押させるのは遠回り**だった。対局画面では渡さないので、これまでどおり何も起きない。
   */
  onStandClick?: () => void;
  /** v1.08: 巡回表示の共有時計。 */
  cycle?: CycleReader;
  /** v1.08: 観測アニメ中の pieceId 群。 */
  collapsingIds?: ReadonlySet<string>;
}

/**
 * 駒が増えたときの詰め方 (付録D-1 §4.4.1・駒UI v0.11 §5.1)。
 *
 * **駒台の高さは盤に固定**し、下へ伸ばさない（伸ばすと対局画面の操作列・S08 の
 * 再生の操作帯を押し下げ、**同じボタンを続けて押せなくなる**）。
 *
 * 詰める順は **①間隔を詰める → ②2 列にする → ③駒を小さくする**。
 * **間隔は失っても読めるが、大きさは失うと読めなくなる**（縮小は画数の多い字から潰れる）
 * ので、間隔を先に使い切る。2 列は同じ枚数を 4 倍の面積で置けるため、縮めるより先。
 *
 * 枚数の境目は付録D-1 §4.4.1 の実測値（1 列 10 / 間隔 0 で 12 / 2 列 20 / 2 列間隔 0 で 24）。
 *
 * **量子でしか起きない**＝確定した駒は駒種ごとにまとまるので、本将棋では 7〜8 行で収まる。
 */
function standPacking(count: number): { cls: string; rows: number } {
  // **列は 2 つまで**（v1.43・2026-08-17 ユーザー判断）。3 列目を作ると駒台からはみ出す。
  // 1 列に積む枚数を返し、駒の大きさはそこから CSS が逆算する
  // （**入る大きさを先に決めてから並べる**ので、はみ出しようがない）。
  if (count <= 10) return { cls: '', rows: Math.max(7, count) };
  if (count <= 12) return { cls: 'tight', rows: count };
  if (count <= 20) return { cls: 'two', rows: Math.ceil(count / 2) };
  // ここから先は間隔を 0 にしたうえで、**駒台の中の駒だけ**が小さくなる（盤には触れない）。
  return { cls: 'two tight', rows: Math.ceil(count / 2) };
}

/** 駒台。棋譜再生画面 (S08) も同じものを使う（触れない＝`activePlayer` を false にする）。 */
export function PieceStandView({ side, pieces, onClick, onStandClick, selectedId, activePlayer, locale, label, entangledPieceIds, debugShowPieceIds, mode = 'cycle', cycle, collapsingIds }: PieceStandViewProps) {
  const isEn = locale === 'en';
  // v1.16 (ユーザー要望): 持ち駒もマウスを乗せただけで候補ボックスを出す。
  // 相手の駒台 (持てない側) も対象。
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // v0.89: spec D1 §4.4 「相手の持ち駒は先手と点対称：並び順も先手を逆順にする」
  // groupHand は DESC (大駒 上) で返すので、you 側はそのまま。opp 側は reverse して
  // 「相手視点での大駒上 = 盤面上では opp 駒台の下側 (盤に近い側)」に配置する。
  const orderedPieces = side === 'opp' ? [...pieces].reverse() : pieces;
  const pack = standPacking(orderedPieces.length);
  return (
    <div
      className={`stand ${side} ${pack.cls}${onStandClick ? ' droppable' : ''}`}
      style={{ '--stand-rows': pack.rows } as CSSProperties}
      onClick={onStandClick ? () => onStandClick() : undefined}
    >
      {/* v0.68 C4: 従来 'Gote'/'You' 固定で自分が後手のときも相手側が Gote になっていたのを、
          呼び出し側から先手/後手ラベルを注入して viewer 基準に合わせる。 */}
      <div className="stand-h">{label ?? (side === 'opp' ? 'Gote' : 'You')}</div>
      <div className="caps">
        {orderedPieces.map((g) => {
          // v1.08: 未確定の持ち駒は盤上と同じ扱い (? + 巡回/重ね)。確定駒は従来通り。
          const unconfirmed = g.kinds.length >= 2;
          const stacked = unconfirmed && mode === 'stack';
          // 駒台は束ねた 1 かたまりを単位に巡回する (付録D-1 §5.6.2)。
          const shown = unconfirmed ? shownKind(cycle, g.pieceIds[0], g.kinds) : g.kinds[0];
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
              onClick={() => {
                // 相手の駒台は持てないが、タップでも候補が読めるようにする (上と同じ理由)。
                setHoverKey(g.key);
                if (activePlayer) onClick(g.pieceIds[0]);
              }}
              onMouseEnter={() => setHoverKey(g.key)}
              onMouseLeave={() => setHoverKey((cur) => (cur === g.key ? null : cur))}
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
                  相手側の駒台は .cap ごと 180 度回っているので、文字が読めるよう回し戻す。
                  v1.16: 持ったときに加えてマウスを乗せたときも出す (相手の駒台も対象)。
                  v1.17: 候補ボックスは画面の一番外側に出すようになったので、器の回転を
                  打ち消す必要がなくなった。相手の駒台は画面の上寄りなので下側へ出す。
                  自分の駒台は右・相手の駒台は左にあるので、どちらも盤に近い側へ寄せる。 */}
              {unconfirmed &&
                ((selectedId && g.pieceIds.includes(selectedId)) || hoverKey === g.key) && (
                <CandidateBox
                  kinds={g.kinds}
                  locale={locale}
                  onLeft={side === 'you'}
                  below={side === 'opp'}
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
