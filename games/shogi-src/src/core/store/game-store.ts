import { create } from 'zustand';
import {
  applyMove,
  canDeclareNyugyoku,
  generateLegalMoves,
  hondou,
  initPosition,
  isCheckmate,
  isInCheck,
  positionHash,
} from '../engine';
import type { BoardMove, Mgf, Move, Player, Position, Square } from '../engine';
import { formatMove } from '../engine/kifu/format';
import { NO_LIMIT_TIME_CONTROL, initClockState, type ClockState, type TimeControl } from '../engine/time-control';

export interface PendingPromotion {
  nonPromoteMove: BoardMove;
  promoteMove: BoardMove;
  pieceKind: string;
  promotedKind: string;
  owner: Player;
  heading: string;
}

type GameStatus =
  | 'playing'
  | 'checkmate'
  | 'sennichite'
  | 'nyugyoku_win_p1'
  | 'nyugyoku_win_p2'
  | 'resigned_p1'
  | 'resigned_p2'
  | 'agreed_draw'
  /** v0.35: 持ち時間切れ。timeout_p1 = 先手が時間切れ(＝後手勝ち) */
  | 'timeout_p1'
  | 'timeout_p2';

/**
 * 着手発生元:
 * - 'local'  : 自分の操作で盤面に反映（オンライン対戦では相手にも送る対象）
 * - 'remote' : 相手からの受信で反映（送り返さない）
 */
export type MoveSource = 'local' | 'remote';

/**
 * 直近適用された着手の記録（対局画面が自分の手を検知して送信するのに使う）。
 * オブジェクト参照が変わるだけで React が反応するように、apply の度に新しい
 * オブジェクトを作る。
 */
export interface LastAppliedMove {
  move: Move;
  source: MoveSource;
  /** 単調増加する連番。同じ move 値でも参照を変えて subscribe 側に通知するため */
  seq: number;
}

interface GameState {
  mgf: Mgf;
  position: Position;
  selectedSquare: Square | null;
  selectedHandPieceId: string | null;
  legalDestinations: Square[];
  moveHistory: string[];
  status: GameStatus;
  pendingPromotion: PendingPromotion | null;
  positionCounts: Record<string, number>;
  canNyugyokuP1: boolean;
  canNyugyokuP2: boolean;
  /** 直近適用された着手（着手送信を検知したい画面が subscribe する） */
  lastAppliedMove: LastAppliedMove | null;
  /** 待ったのための着手前局面スタック（v0.33 追加）。着手のたびに現在局面を push、undoLastMove で pop。 */
  positionHistory: Position[];
  /** positionCounts の履歴も同期して保持（千日手判定を巻き戻せるように） */
  positionCountsHistory: Record<string, number>[];
  /** 持ち時間設定（v0.35）。オフラインの既定は no_limit、ルームでは activeRoomConfig の値。 */
  timeControl: TimeControl;
  /** 各プレイヤーの時計状態（v0.35） */
  clocks: { player1: ClockState; player2: ClockState };
  /** 現在時計を動かしている側（v0.35）。null なら停止（対局終了・no_limit・pause 予定）。 */
  activeClockSide: 'player1' | 'player2' | null;

  selectSquare: (sq: Square) => void;
  selectHandPiece: (pieceId: string) => void;
  clearSelection: () => void;
  tryMove: (to: Square) => boolean;
  confirmPromotion: (promote: boolean) => void;
  cancelPromotion: () => void;
  declareNyugyoku: () => boolean;
  /** 指定側を投了させる。既に対局が終わっているときは何もしない。段階 2-7 v0.30。 */
  resign: (side: 'player1' | 'player2') => void;
  /** 引分に合意した状態にする。段階 2-7 v0.33。 */
  agreeDraw: () => void;
  /** 最後の n 手を巻き戻す。実際に戻せた手数を返す。段階 2-7 v0.33。 */
  undoLastMove: (count?: number) => number;
  /** 持ち時間設定を反映（オンライン game_start で呼ばれる）。clocks をこの設定で再初期化。v0.35。 */
  setTimeControl: (tc: TimeControl) => void;
  /** ticker 経由で active 側の残り時間を減らす。時間切れなら timeout 状態へ。v0.35。 */
  tickClock: (deltaMs: number) => void;
  /** 相手からの move メッセージで得た時計状態を反映（sync）。v0.35。 */
  syncClock: (side: 'player1' | 'player2', clock: ClockState) => void;
  /** 指定側を時間切れ負けにする（idempotent）。v0.35。 */
  timeout: (side: 'player1' | 'player2') => void;
  reset: () => void;
  /**
   * 相手から受信した着手を盤面に反映する。
   * pieceId / from / to / promote に完全一致する合法手を探して適用。
   * 対応する合法手が見つからなければ false を返す（同期ずれ）。
   */
  applyRemoteMove: (msg: {
    kind: 'move' | 'drop';
    pieceId: string;
    from?: Square;
    to: Square;
    promote?: boolean;
  }) => boolean;
}

function computeLegalDestinationsFromBoard(mgf: Mgf, position: Position, from: Square): Square[] {
  const legal = generateLegalMoves(mgf, position);
  const dests: Square[] = [];
  const seen = new Set<string>();
  for (const m of legal) {
    if (m.type !== 'move') continue;
    if (m.from.row !== from.row || m.from.col !== from.col) continue;
    const key = `${m.to.row},${m.to.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dests.push(m.to);
  }
  return dests;
}

function computeLegalDestinationsFromHand(mgf: Mgf, position: Position, pieceId: string): Square[] {
  const legal = generateLegalMoves(mgf, position);
  const dests: Square[] = [];
  const seen = new Set<string>();
  for (const m of legal) {
    if (m.type !== 'drop') continue;
    if (m.pieceId !== pieceId) continue;
    const key = `${m.to.row},${m.to.col}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dests.push(m.to);
  }
  return dests;
}

function computeStatusAfterMove(
  mgf: Mgf,
  position: Position,
  positionCounts: Record<string, number>,
): { status: GameStatus; positionCounts: Record<string, number> } {
  if (isCheckmate(mgf, position)) {
    return { status: 'checkmate', positionCounts };
  }
  const hash = positionHash(position);
  const count = (positionCounts[hash] ?? 0) + 1;
  const nextCounts = { ...positionCounts, [hash]: count };
  const threshold = mgf.repetition?.detection_threshold ?? 4;
  if (count >= threshold) {
    return { status: 'sennichite', positionCounts: nextCounts };
  }
  return { status: 'playing', positionCounts: nextCounts };
}

function applyAndCommit(
  set: (partial: Partial<GameState>) => void,
  get: () => GameState,
  move: Move,
  source: MoveSource = 'local',
): void {
  const state = get();
  const { position, mgf, moveHistory, positionCounts, lastAppliedMove, positionHistory, positionCountsHistory, timeControl, clocks } = state;
  const formatted = formatMove(mgf, position, move);
  const nextPos = applyMove(mgf, position, move);
  const { status, positionCounts: nextCounts } = computeStatusAfterMove(mgf, nextPos, positionCounts);
  const nextSeq = (lastAppliedMove?.seq ?? 0) + 1;
  // v0.35: 時計の更新。指し終わった側は byoyomi なら秒読みリセット / fischer なら加算
  const moverSide = position.sideToMove;
  const nextClocks = updateClocksAfterMove(clocks, moverSide, timeControl);
  const isTerminal = status !== 'playing';
  const nextActiveSide =
    isTerminal || timeControl.mode === 'no_limit'
      ? null
      : moverSide === 'player1'
        ? 'player2'
        : 'player1';
  set({
    position: nextPos,
    selectedSquare: null,
    selectedHandPieceId: null,
    legalDestinations: [],
    pendingPromotion: null,
    moveHistory: [...moveHistory, formatted],
    status,
    positionCounts: nextCounts,
    canNyugyokuP1: canDeclareNyugyoku(mgf, nextPos, 'player1'),
    canNyugyokuP2: canDeclareNyugyoku(mgf, nextPos, 'player2'),
    lastAppliedMove: { move, source, seq: nextSeq },
    // v0.33: 待ったの巻き戻し用に、着手前の局面と positionCounts を履歴に積む
    positionHistory: [...positionHistory, position],
    positionCountsHistory: [...positionCountsHistory, positionCounts],
    clocks: nextClocks,
    activeClockSide: nextActiveSide,
  });
}

/** v0.35: 指し終わった側の時計を、時間モードに応じて調整（byoyomi リセット / fischer 加算） */
function updateClocksAfterMove(
  clocks: { player1: ClockState; player2: ClockState },
  moverSide: 'player1' | 'player2',
  tc: TimeControl,
): { player1: ClockState; player2: ClockState } {
  const cur = clocks[moverSide];
  let nextMover: ClockState = { ...cur };
  if (tc.mode === 'byoyomi') {
    if (cur.inByoyomi) {
      // 秒読み中に指したので秒読みを満タンに戻す
      nextMover.byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
    }
  } else if (tc.mode === 'fischer') {
    // フィッシャー: 一手ごとに加算
    nextMover.mainMs = cur.mainMs + (tc.incrementSeconds ?? 0) * 1000;
  }
  // sudden_death / no_limit は変化なし
  return { ...clocks, [moverSide]: nextMover };
}

const initialMgf: Mgf = hondou;
const initialPos = initPosition(initialMgf);
const initialHash = positionHash(initialPos);

export const useGameStore = create<GameState>((set, get) => ({
  mgf: initialMgf,
  position: initialPos,
  selectedSquare: null,
  selectedHandPieceId: null,
  legalDestinations: [],
  moveHistory: [],
  status: 'playing',
  pendingPromotion: null,
  positionCounts: { [initialHash]: 1 },
  canNyugyokuP1: false,
  canNyugyokuP2: false,
  lastAppliedMove: null,
  positionHistory: [],
  positionCountsHistory: [],
  timeControl: NO_LIMIT_TIME_CONTROL,
  clocks: {
    player1: initClockState(NO_LIMIT_TIME_CONTROL),
    player2: initClockState(NO_LIMIT_TIME_CONTROL),
  },
  activeClockSide: null,

  selectSquare: (sq) => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return;
    const piece = position.board[sq.row][sq.col];
    if (!piece || piece.owner !== position.sideToMove) {
      set({ selectedSquare: null, selectedHandPieceId: null, legalDestinations: [] });
      return;
    }
    set({
      selectedSquare: sq,
      selectedHandPieceId: null,
      legalDestinations: computeLegalDestinationsFromBoard(mgf, position, sq),
    });
  },

  selectHandPiece: (pieceId) => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return;
    const piece = position.hands[position.sideToMove].find((p) => p.pieceId === pieceId);
    if (!piece) return;
    set({
      selectedSquare: null,
      selectedHandPieceId: pieceId,
      legalDestinations: computeLegalDestinationsFromHand(mgf, position, pieceId),
    });
  },

  clearSelection: () => {
    set({ selectedSquare: null, selectedHandPieceId: null, legalDestinations: [] });
  },

  tryMove: (to) => {
    const { position, mgf, selectedSquare, selectedHandPieceId, status } = get();
    if (status !== 'playing') return false;

    if (selectedSquare) {
      const piece = position.board[selectedSquare.row][selectedSquare.col];
      if (!piece) return false;
      const legal = generateLegalMoves(mgf, position);
      const candidates: BoardMove[] = legal.filter(
        (m): m is BoardMove =>
          m.type === 'move' &&
          m.from.row === selectedSquare.row &&
          m.from.col === selectedSquare.col &&
          m.to.row === to.row &&
          m.to.col === to.col,
      );
      if (candidates.length === 0) return false;
      if (candidates.length === 1) {
        applyAndCommit(set, get, candidates[0]);
        return true;
      }
      const nonPromote = candidates.find((m) => !m.promote);
      const promote = candidates.find((m) => m.promote);
      if (!nonPromote || !promote) {
        applyAndCommit(set, get, candidates[0]);
        return true;
      }
      const def = mgf.pieces.find((p) => p.id === piece.kind);
      const promotedKind = def?.promoted_id ?? piece.kind;
      set({
        pendingPromotion: {
          nonPromoteMove: nonPromote,
          promoteMove: promote,
          pieceKind: piece.kind,
          promotedKind,
          owner: piece.owner,
          heading: formatMove(mgf, position, nonPromote),
        },
      });
      return true;
    }

    if (selectedHandPieceId) {
      const legal = generateLegalMoves(mgf, position);
      const found = legal.find(
        (m) => m.type === 'drop' && m.pieceId === selectedHandPieceId && m.to.row === to.row && m.to.col === to.col,
      );
      if (!found) return false;
      applyAndCommit(set, get, found);
      return true;
    }

    return false;
  },

  confirmPromotion: (promote) => {
    const { pendingPromotion } = get();
    if (!pendingPromotion) return;
    const move = promote ? pendingPromotion.promoteMove : pendingPromotion.nonPromoteMove;
    applyAndCommit(set, get, move);
  },

  cancelPromotion: () => {
    const { pendingPromotion, position, mgf } = get();
    if (!pendingPromotion) return;
    const from = pendingPromotion.nonPromoteMove.from;
    set({
      pendingPromotion: null,
      selectedSquare: from,
      selectedHandPieceId: null,
      legalDestinations: computeLegalDestinationsFromBoard(mgf, position, from),
    });
  },

  declareNyugyoku: () => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return false;
    const player = position.sideToMove;
    if (!canDeclareNyugyoku(mgf, position, player)) return false;
    set({
      status: player === 'player1' ? 'nyugyoku_win_p1' : 'nyugyoku_win_p2',
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
    return true;
  },

  resign: (side) => {
    const { status } = get();
    if (status !== 'playing') return;
    set({
      status: side === 'player1' ? 'resigned_p1' : 'resigned_p2',
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
  },

  agreeDraw: () => {
    const { status } = get();
    if (status !== 'playing') return;
    set({
      status: 'agreed_draw',
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      activeClockSide: null,
    });
  },

  setTimeControl: (tc) => {
    // 対局開始時（game_start）に呼ばれる。時計を初期化して先手の時計を動かす。
    set({
      timeControl: tc,
      clocks: {
        player1: initClockState(tc),
        player2: initClockState(tc),
      },
      activeClockSide: tc.mode === 'no_limit' ? null : 'player1',
    });
  },

  tickClock: (deltaMs) => {
    const state = get();
    if (state.status !== 'playing') return;
    if (!state.activeClockSide) return;
    if (state.timeControl.mode === 'no_limit') return;
    const side = state.activeClockSide;
    const cur = state.clocks[side];
    const tc = state.timeControl;
    let nextClock: ClockState = { ...cur };
    if (cur.inByoyomi) {
      // 秒読みフェーズ: byoyomiMs を減らす
      nextClock.byoyomiMs = Math.max(0, cur.byoyomiMs - deltaMs);
      if (nextClock.byoyomiMs <= 0) {
        // 時間切れ負け
        set({
          clocks: { ...state.clocks, [side]: nextClock },
          status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
          activeClockSide: null,
          selectedSquare: null,
          selectedHandPieceId: null,
          legalDestinations: [],
          pendingPromotion: null,
        });
        return;
      }
    } else {
      // 本時間フェーズ: mainMs を減らす
      nextClock.mainMs = Math.max(0, cur.mainMs - deltaMs);
      if (nextClock.mainMs <= 0) {
        if (tc.mode === 'byoyomi') {
          // 本時間切れ→秒読みフェーズへ移行
          nextClock.mainMs = 0;
          nextClock.inByoyomi = true;
          nextClock.byoyomiMs = (tc.byoyomiSeconds ?? 0) * 1000;
        } else {
          // sudden_death or fischer: 時間切れ負け
          set({
            clocks: { ...state.clocks, [side]: nextClock },
            status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
            activeClockSide: null,
            selectedSquare: null,
            selectedHandPieceId: null,
            legalDestinations: [],
            pendingPromotion: null,
          });
          return;
        }
      }
    }
    set({ clocks: { ...state.clocks, [side]: nextClock } });
  },

  syncClock: (side, clock) => {
    const state = get();
    set({ clocks: { ...state.clocks, [side]: clock } });
  },

  timeout: (side) => {
    const state = get();
    if (state.status !== 'playing') return;
    // v0.38: 敗者の時計を明示的に 0 にゼロクリア。
    // 勝者側で相手時計が「1秒残る」ような drift 表示にならないよう、
    // ローカルの tick と外部から受け取った timeout どちらの経路でも同じ最終状態を保つ。
    const tc = state.timeControl;
    const zeroed: ClockState = {
      mainMs: 0,
      byoyomiMs: 0,
      inByoyomi: tc.mode === 'byoyomi',
    };
    set({
      status: side === 'player1' ? 'timeout_p1' : 'timeout_p2',
      activeClockSide: null,
      clocks: { ...state.clocks, [side]: zeroed },
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
    });
  },

  undoLastMove: (count = 1) => {
    const state = get();
    const available = state.positionHistory.length;
    const actual = Math.min(count, available);
    if (actual <= 0) return 0;
    const restoredPos = state.positionHistory[state.positionHistory.length - actual];
    const restoredCounts = state.positionCountsHistory[state.positionCountsHistory.length - actual];
    set({
      position: restoredPos,
      positionCounts: restoredCounts,
      positionHistory: state.positionHistory.slice(0, state.positionHistory.length - actual),
      positionCountsHistory: state.positionCountsHistory.slice(0, state.positionCountsHistory.length - actual),
      moveHistory: state.moveHistory.slice(0, state.moveHistory.length - actual),
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      status: 'playing',
      canNyugyokuP1: canDeclareNyugyoku(state.mgf, restoredPos, 'player1'),
      canNyugyokuP2: canDeclareNyugyoku(state.mgf, restoredPos, 'player2'),
      // v0.33 バグ修正: lastAppliedMove を触らない。触ると対局画面の
      // 「自分の手を相手に送信」useEffect が発火して直前の着手が再送信されてしまい、
      // 相手の巻き戻しが直後に上書きされる（両者 undo の再現バグ）。
      // undo は subscribe しなくても状態変化で盤面が再描画されるので通知不要。
    });
    return actual;
  },

  reset: () => {
    const state = get();
    const pos = initPosition(state.mgf);
    const tc = state.timeControl;
    set({
      position: pos,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      moveHistory: [],
      status: 'playing',
      pendingPromotion: null,
      positionCounts: { [positionHash(pos)]: 1 },
      canNyugyokuP1: false,
      canNyugyokuP2: false,
      lastAppliedMove: null,
      positionHistory: [],
      positionCountsHistory: [],
      // v0.35: timeControl は保持しつつ clocks を再初期化、先手の時計を動かす
      clocks: {
        player1: initClockState(tc),
        player2: initClockState(tc),
      },
      activeClockSide: tc.mode === 'no_limit' ? null : 'player1',
    });
  },

  applyRemoteMove: (msg) => {
    const { position, mgf, status } = get();
    if (status !== 'playing') return false;
    const legal = generateLegalMoves(mgf, position);
    let target: Move | null = null;
    if (msg.kind === 'move') {
      if (!msg.from) return false;
      const found = legal.find(
        (m): m is BoardMove =>
          m.type === 'move' &&
          m.pieceId === msg.pieceId &&
          m.from.row === msg.from!.row &&
          m.from.col === msg.from!.col &&
          m.to.row === msg.to.row &&
          m.to.col === msg.to.col &&
          m.promote === (msg.promote ?? false),
      );
      if (found) target = found;
    } else {
      const found = legal.find(
        (m) =>
          m.type === 'drop' &&
          m.pieceId === msg.pieceId &&
          m.to.row === msg.to.row &&
          m.to.col === msg.to.col,
      );
      if (found) target = found;
    }
    if (!target) return false;
    applyAndCommit(set, get, target, 'remote');
    return true;
  },
}));

export { isInCheck };
