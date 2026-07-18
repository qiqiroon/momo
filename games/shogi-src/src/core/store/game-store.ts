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
import { get as pluginGet } from '../plugin/registry';
import { useDebugStore, type DebugCandidateChangeEntry } from './debug-store';

/**
 * 対局開始オプション (Phase 5-2)。
 * quantum=true かつ 'quantum:init' が登録されていれば初期候補集合を割り当てる。
 * A ビルドでは quantum モジュール自体が tree-shake で除外されるため常に no-op となる。
 */
export interface ResetOptions {
  quantum?: boolean;
}
type QuantumInitFn = (pos: Position) => Position;
type QuantumCandidateUpdateFn = (
  pos: Position,
  mgf: Mgf,
  context?: { torusMode: 'none' | 'cylinder' | 'full' },
) => Position;

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
  /** 時計の履歴 (v0.42 追加): 手を指す前の {clocks, activeClockSide} を保持。待ったの時計巻き戻しに使う */
  clockHistory: { clocks: { player1: ClockState; player2: ClockState }; activeClockSide: 'player1' | 'player2' | null }[];
  /** 持ち時間設定（v0.35）。オフラインの既定は no_limit、ルームでは activeRoomConfig の値。 */
  timeControl: TimeControl;
  /** 各プレイヤーの時計状態（v0.35） */
  clocks: { player1: ClockState; player2: ClockState };
  /** 現在時計を動かしている側（v0.35）。null なら停止（対局終了・no_limit）。 */
  activeClockSide: 'player1' | 'player2' | null;
  /** 中断中フラグ（v0.41 追加）。true の間 ticker は tick しない。activeClockSide は保持されるため再開で継続 */
  paused: boolean;
  /**
   * v0.99 (Phase 5-6 拡張): 直近の候補集合更新で candidates が変化した駒の pieceId 一覧。
   * 動いた駒 (lastMove の pieceId) は除外し、量子もつれで巻き添えを食った駒のみ。
   * UI ハイライト (盤マス・持ち駒台に薄い水色半透明) の描画根拠として使う。
   */
  entangledPieceIds: string[];

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
  /**
   * 最後の n 手を巻き戻す。実際に戻せた手数を返す。段階 2-7 v0.33 / v0.42 で時計巻き戻し追加。
   * opts.restoreClockForSide が指定されたら、その side の時計を「戻される最古の手を指す前」の値に戻す。
   * 指定されなかった側の時計は現在値のまま（＝待った申し出者はペナルティで戻さない）。
   * opts 未指定なら両側とも clockHistory から復元（オフラインの即 undo など）。
   */
  undoLastMove: (count?: number, opts?: { restoreClockForSide?: 'player1' | 'player2' }) => number;
  /** 持ち時間設定を反映（オンライン game_start で呼ばれる）。clocks をこの設定で再初期化。v0.35。 */
  setTimeControl: (tc: TimeControl) => void;
  /** ticker 経由で active 側の残り時間を減らす。時間切れなら timeout 状態へ。v0.35。 */
  tickClock: (deltaMs: number) => void;
  /** 相手からの move メッセージで得た時計状態を反映（sync）。v0.35。 */
  syncClock: (side: 'player1' | 'player2', clock: ClockState) => void;
  /** 指定側を時間切れ負けにする（idempotent）。v0.35。 */
  timeout: (side: 'player1' | 'player2') => void;
  /** 対局を中断状態にする（両者合意成立後に呼ばれる）。v0.41。 */
  pauseGame: () => void;
  /** 中断状態を解除して対局再開する（両者合意成立後に呼ばれる）。v0.41。 */
  resumeGame: () => void;
  /**
   * 対局盤面をリセットする。options.quantum を渡さなかった場合は
   * currentQuantum (前回 reset で決まった値) を維持する。対局中の
   * 「リセット」ボタンから引数なしで呼んでも同じルールで再初期化される。
   */
  reset: (options?: ResetOptions) => void;
  /** 現局面が量子モードで初期化されたか。reset({quantum}) で更新される。v0.90 追加。 */
  currentQuantum: boolean;
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
  const { position, mgf, moveHistory, positionCounts, lastAppliedMove, positionHistory, positionCountsHistory, clockHistory, timeControl, clocks, activeClockSide, currentQuantum } = state;
  const formatted = formatMove(mgf, position, move);
  let nextPos = applyMove(mgf, position, move);
  // v0.96 (Phase 5-4): 量子モードなら着手直後に候補集合を再評価する。
  // v0.98 (Phase 5-6): torus モード情報を context として渡す。torus 実装は Phase 4
  // で完成予定なので現状は 'none' を渡す (C-103/C-104 は非 torus 環境で有効化)。
  if (currentQuantum) {
    const candidateUpdateFn = pluginGet<QuantumCandidateUpdateFn>('quantum:candidateUpdate');
    // Phase 5-6.5 移行後: context (infoMap 含む) は candidateUpdate 側で pos から自動生成。
    // torusMode 等の追加副次情報を渡したい場合はここで context を組み立てる。
    if (candidateUpdateFn) nextPos = candidateUpdateFn(nextPos, mgf);
  }
  // v0.99 (Phase 5-6 拡張): 動いた駒以外で candidates が変化した駒を「量子もつれ」として
  // 記録する。UI ハイライトと debug の候補変更履歴表示で使う。動いた駒 (move.pieceId) は
  // 除外し、その他で before/after の candidates が異なる駒のみ集める。
  const entangledPieceIds = currentQuantum
    ? diffEntangledPieceIds(position, nextPos, move)
    : [];
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
  // v0.42: clockHistory に「指す前の {clocks, activeClockSide}」を積む
  const preClockSnapshot = {
    clocks: { player1: { ...clocks.player1 }, player2: { ...clocks.player2 } },
    activeClockSide,
  };
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
    clockHistory: [...clockHistory, preClockSnapshot],
    clocks: nextClocks,
    activeClockSide: nextActiveSide,
    entangledPieceIds,
  });
  // v0.99 (Phase 5-6 拡張): デバッグモード有効なら候補変更履歴を debug-store にも積む。
  // 動いた駒自身の変化も含めて全部押し込む (UI ハイライトは動いた駒を除外するが、
  // デバッグ情報は全変化を時系列で見たい)。debug-store は core/store 内で
  // 直接 import する (プラグイン境界は不要・A ビルドでも enabled=false で自然に no-op)。
  if (currentQuantum) {
    const dbg = useDebugStore.getState();
    if (dbg.enabled) {
      const moveNumber = position.moveNumber;
      const changes: DebugCandidateChangeEntry[] = diffAllCandidateChanges(position, nextPos).map((c) => ({
        time: Date.now(),
        moveNumber,
        pieceId: c.pieceId,
        before: c.before,
        after: c.after,
        removed: c.removed,
        added: c.added,
      }));
      if (changes.length > 0) dbg.logCandidateChanges(changes);
    }
  }
}

/**
 * v0.99: before → after で candidates が変化した駒の pieceId を集める (動いた駒を除外)。
 * UI ハイライトで使う量子もつれ判定。
 */
function diffEntangledPieceIds(before: Position, after: Position, move: Move): string[] {
  const beforeMap = collectPieceInstances(before);
  const afterMap = collectPieceInstances(after);
  const movedId = move.pieceId;
  const ids: string[] = [];
  for (const [pid, afterPiece] of afterMap) {
    if (pid === movedId) continue;
    const beforePiece = beforeMap.get(pid);
    if (!beforePiece) continue; // 新規登場 (捕獲で hand に入った等) は対象外
    if (!candidatesChanged(beforePiece.candidates, afterPiece.candidates)) continue;
    ids.push(pid);
  }
  return ids;
}

/**
 * v0.99: デバッグログ用 (動いた駒も含む全変化)。時系列で candidates before/after を表現。
 */
function diffAllCandidateChanges(before: Position, after: Position): {
  pieceId: string;
  before: string[];
  after: string[];
  removed: string[];
  added: string[];
}[] {
  const beforeMap = collectPieceInstances(before);
  const afterMap = collectPieceInstances(after);
  const changes: {
    pieceId: string;
    before: string[];
    after: string[];
    removed: string[];
    added: string[];
  }[] = [];
  for (const [pid, afterPiece] of afterMap) {
    const beforePiece = beforeMap.get(pid);
    if (!beforePiece) continue;
    const beforeCands = beforePiece.candidates ? Array.from(beforePiece.candidates).sort() : [];
    const afterCands = afterPiece.candidates ? Array.from(afterPiece.candidates).sort() : [];
    if (!candidatesChanged(beforePiece.candidates, afterPiece.candidates)) continue;
    const beforeSet = new Set(beforeCands);
    const afterSet = new Set(afterCands);
    const removed = beforeCands.filter((x) => !afterSet.has(x));
    const added = afterCands.filter((x) => !beforeSet.has(x));
    changes.push({ pieceId: pid, before: beforeCands, after: afterCands, removed, added });
  }
  return changes;
}

/** 位置全体から pieceId → PieceInstance の map を作る (盤上+持ち駒両方)。 */
function collectPieceInstances(pos: Position): Map<string, import('../engine/position/types').PieceInstance> {
  const map = new Map<string, import('../engine/position/types').PieceInstance>();
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell) map.set(cell.pieceId, cell);
    }
  }
  for (const p of pos.hands.player1) map.set(p.pieceId, p);
  for (const p of pos.hands.player2) map.set(p.pieceId, p);
  return map;
}

/** 2 つの candidates 集合が実質的に異なるか (undefined 同士は同じ扱い)。 */
function candidatesChanged(
  a: ReadonlySet<string> | undefined,
  b: ReadonlySet<string> | undefined,
): boolean {
  if (a === undefined && b === undefined) return false;
  if (a === undefined || b === undefined) return true;
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
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
  clockHistory: [],
  timeControl: NO_LIMIT_TIME_CONTROL,
  clocks: {
    player1: initClockState(NO_LIMIT_TIME_CONTROL),
    player2: initClockState(NO_LIMIT_TIME_CONTROL),
  },
  activeClockSide: null,
  paused: false,
  currentQuantum: false,
  entangledPieceIds: [],

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
      paused: false,
    });
  },

  tickClock: (deltaMs) => {
    const state = get();
    if (state.status !== 'playing') return;
    if (!state.activeClockSide) return;
    if (state.paused) return; // v0.41: 中断中は tick しない
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

  pauseGame: () => {
    const state = get();
    if (state.status !== 'playing') return;
    if (state.paused) return;
    set({ paused: true });
  },

  resumeGame: () => {
    const state = get();
    if (!state.paused) return;
    set({ paused: false });
  },

  undoLastMove: (count = 1, opts) => {
    const state = get();
    const available = state.positionHistory.length;
    const actual = Math.min(count, available);
    if (actual <= 0) return 0;
    const restoredPos = state.positionHistory[state.positionHistory.length - actual];
    const restoredCounts = state.positionCountsHistory[state.positionCountsHistory.length - actual];
    // v0.42: 時計履歴も同じ位置から取り出す。restoreClockForSide が指定されたら
    // その side だけ復元、もう片方 (＝待った申し出者) は現在値のまま保持する。
    // 未指定なら両側とも復元（オフラインで即 undo する場合など）。
    const snapshotIdx = state.clockHistory.length - actual;
    const snap = state.clockHistory[snapshotIdx];
    let nextClocks = state.clocks;
    let nextActiveClockSide = state.activeClockSide;
    if (snap) {
      const restoreSide = opts?.restoreClockForSide;
      if (restoreSide) {
        nextClocks = { ...state.clocks, [restoreSide]: snap.clocks[restoreSide] };
      } else {
        nextClocks = snap.clocks;
      }
      nextActiveClockSide = snap.activeClockSide;
    }
    set({
      position: restoredPos,
      positionCounts: restoredCounts,
      positionHistory: state.positionHistory.slice(0, state.positionHistory.length - actual),
      positionCountsHistory: state.positionCountsHistory.slice(0, state.positionCountsHistory.length - actual),
      clockHistory: state.clockHistory.slice(0, snapshotIdx),
      moveHistory: state.moveHistory.slice(0, state.moveHistory.length - actual),
      clocks: nextClocks,
      activeClockSide: nextActiveClockSide,
      selectedSquare: null,
      selectedHandPieceId: null,
      legalDestinations: [],
      pendingPromotion: null,
      status: 'playing',
      canNyugyokuP1: canDeclareNyugyoku(state.mgf, restoredPos, 'player1'),
      canNyugyokuP2: canDeclareNyugyoku(state.mgf, restoredPos, 'player2'),
      // v0.33 バグ修正: lastAppliedMove を触らない。触ると対局画面の
      // 「自分の手を相手に送信」useEffect が発火して直前の着手が再送信されてしまい、
      // 相手の巻き戻しが直後に上書きされる。
    });
    return actual;
  },

  reset: (options?: ResetOptions) => {
    const state = get();
    // 明示指定があればそれを、なければ前回 reset の値を引き継ぐ (対局中「リセット」ボタン用)
    const quantum = options?.quantum ?? state.currentQuantum;
    let pos = initPosition(state.mgf);
    if (quantum) {
      const quantumInitFn = pluginGet<QuantumInitFn>('quantum:init');
      if (quantumInitFn) pos = quantumInitFn(pos);
    }
    const tc = state.timeControl;
    set({
      currentQuantum: quantum,
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
      clockHistory: [],
      // v0.35: timeControl は保持しつつ clocks を再初期化、先手の時計を動かす
      clocks: {
        player1: initClockState(tc),
        player2: initClockState(tc),
      },
      activeClockSide: tc.mode === 'no_limit' ? null : 'player1',
      paused: false,
      entangledPieceIds: [],
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
