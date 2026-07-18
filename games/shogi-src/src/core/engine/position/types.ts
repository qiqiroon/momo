import type { Player } from '../mgf/types';

export type PieceId = string;

export interface PieceInstance {
  pieceId: PieceId;
  kind: string;
  owner: Player;
  initialOwner: Player;
  /** 対局開始時の駒種 (§Q4.1)。捕獲や成りで kind は変わるが initialKind は不変。 */
  initialKind: string;
  /** 対局開始時の盤上位置 (§Q4.1)。持ち駒で生成された駒はスコープ外 = row/col=-1。 */
  initialSquare: Square;
  promoted: boolean;
  /**
   * 量子モード時の候補集合 (§Q4.1・Phase 5-6.5 移行後)。
   * undefined = 本将棋モード (縮退・candidates == {pieceId} と同等)。
   * 中身は「初期 PieceID の集合」(自陣営 20 駒の PieceID 集合が初期値)。
   * 各 PieceID は buildInitialInfoMap で初期 kind / 初期 square に resolve できる。
   */
  candidates?: ReadonlySet<PieceId>;
  /**
   * 確定状態 (§Q4.4)。
   * undefined = 本将棋モード = 常に確定扱い。
   * 量子モード時のみ意味を持ち、候補集合が 1 個に収縮した時点で true になる。
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
