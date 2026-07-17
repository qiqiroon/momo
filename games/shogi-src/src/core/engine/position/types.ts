import type { Player } from '../mgf/types';

export type PieceId = string;

export interface PieceInstance {
  pieceId: PieceId;
  kind: string;
  owner: Player;
  initialOwner: Player;
  promoted: boolean;
  /**
   * 量子モード時の候補集合 (§Q4.1)。
   * undefined = 本将棋モード (縮退・candidates == {kind} と同等)。
   * 初期実装 (Phase 5-1〜5-8) は駒種集合ベース (kickoff §5.3)。
   * 5-15 以降で PieceID ベースに移行する余地あり。
   */
  candidates?: ReadonlySet<string>;
  /**
   * 確定状態 (§Q4.4)。
   * undefined = 本将棋モード = 常に確定扱い。
   * 量子モード時のみ意味を持ち、候補集合が 1 種に収縮した時点で true になる。
   */
  confirmed?: boolean;
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
