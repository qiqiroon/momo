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
  | 'nyugyoku_win_p2';

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

  selectSquare: (sq: Square) => void;
  selectHandPiece: (pieceId: string) => void;
  clearSelection: () => void;
  tryMove: (to: Square) => boolean;
  confirmPromotion: (promote: boolean) => void;
  cancelPromotion: () => void;
  declareNyugyoku: () => boolean;
  reset: () => void;
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
): void {
  const { position, mgf, moveHistory, positionCounts } = get();
  const formatted = formatMove(mgf, position, move);
  const nextPos = applyMove(mgf, position, move);
  const { status, positionCounts: nextCounts } = computeStatusAfterMove(mgf, nextPos, positionCounts);
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
    });
  },
}));

export { isInCheck };
