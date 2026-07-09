import type { Player } from '../mgf/types';

export type PieceId = string;

export interface PieceInstance {
  pieceId: PieceId;
  kind: string;
  owner: Player;
  initialOwner: Player;
  promoted: boolean;
}

export interface Square {
  row: number;
  col: number;
}

export type BoardCell = PieceInstance | null;

export type MoveKind = 'move' | 'drop';

export interface BoardMove {
  type: 'move';
  pieceId: PieceId;
  from: Square;
  to: Square;
  promote: boolean;
  capturedPieceId?: PieceId;
}

export interface DropMove {
  type: 'drop';
  pieceId: PieceId;
  to: Square;
}

export type Move = BoardMove | DropMove;

export interface Position {
  width: number;
  height: number;
  board: BoardCell[][];
  hands: {
    player1: PieceInstance[];
    player2: PieceInstance[];
  };
  sideToMove: Player;
  moveNumber: number;
  history: Move[];
}
