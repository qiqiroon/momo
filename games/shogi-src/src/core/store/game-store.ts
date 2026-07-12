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
  | 'resigned_p2';

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

  selectSquare: (sq: Square) => void;
  selectHandPiece: (pieceId: string) => void;
  clearSelection: () => void;
  tryMove: (to: Square) => boolean;
  confirmPromotion: (promote: boolean) => void;
  cancelPromotion: () => void;
  declareNyugyoku: () => boolean;
  /** 指定側を投了させる。既に対局が終わっているときは何もしない。段階 2-7 v0.30。 */
  resign: (side: 'player1' | 'player2') => void;
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
  const { position, mgf, moveHistory, positionCounts, lastAppliedMove } = get();
  const formatted = formatMove(mgf, position, move);
  const nextPos = applyMove(mgf, position, move);
  const { status, positionCounts: nextCounts } = computeStatusAfterMove(mgf, nextPos, positionCounts);
  const nextSeq = (lastAppliedMove?.seq ?? 0) + 1;
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
  });
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

  reset: () => {
    const pos = initPosition(get().mgf);
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
