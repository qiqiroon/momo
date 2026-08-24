import { describe, it, expect } from 'vitest';
import { chess, hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { formatMove } from './format';
import type { BoardMove, PieceInstance, Position } from '../position/types';

/**
 * 第 9 段 9-4a②-2：チェスの手数リストは長い記法 (親 §5.5.6)。
 * e2-e4 (ポーンは駒文字なし)・Ng1-f3 (駒文字＋出発点-着地点)・e7-e8=Q (昇格)。
 * 先後の印 (▲△) は付けない。将棋の記法は不変。
 */

const chessPos = () => initPosition(chess);

describe('9-4a②-2 チェスの手数記法', () => {
  it('ポーンは駒文字なしで e2-e4', () => {
    const pos = chessPos();
    // e2 = row6 col4 (初期のポーン)、e4 = row4 col4
    const from = { row: 6, col: 4 };
    const pieceId = pos.board[from.row][from.col]!.pieceId;
    const move: BoardMove = { type: 'move', pieceId, from, to: { row: 4, col: 4 }, promote: false };
    expect(formatMove(chess, pos, move)).toBe('e2-e4');
  });

  it('ナイトは駒文字つきで Ng1-f3', () => {
    const pos = chessPos();
    // g1 = row7 col6 (初期のナイト)、f3 = row5 col5
    const from = { row: 7, col: 6 };
    const pieceId = pos.board[from.row][from.col]!.pieceId;
    const move: BoardMove = { type: 'move', pieceId, from, to: { row: 5, col: 5 }, promote: false };
    expect(formatMove(chess, pos, move)).toBe('Ng1-f3');
  });

  it('昇格は着地点のあとに =Q を添える (e7-e8=Q)', () => {
    // e7 = row1 col4 のポーンを 1 枚だけ置いた局面
    const board: (PieceInstance | null)[][] = Array.from({ length: 8 }, () =>
      Array.from({ length: 8 }, () => null as PieceInstance | null),
    );
    const pawn: PieceInstance = {
      pieceId: 'P0',
      kind: 'pawn',
      owner: 'player1',
      initialOwner: 'player1',
      initialKind: 'pawn',
      initialSquare: { row: 1, col: 4 },
      promoted: false,
    };
    board[1][4] = pawn;
    const pos: Position = {
      width: 8,
      height: 8,
      board,
      hands: { player1: [], player2: [] },
      sideToMove: 'player1',
      moveNumber: 1,
      history: [],
    };
    const move: BoardMove = {
      type: 'move',
      pieceId: 'P0',
      from: { row: 1, col: 4 },
      to: { row: 0, col: 4 },
      promote: true,
      promoteTo: 'queen',
    };
    expect(formatMove(chess, pos, move)).toBe('e7-e8=Q');
  });
});

describe('9-4a②-2 将棋の記法は不変', () => {
  it('先手の歩は ▲ つきの漢字表記のまま', () => {
    const pos = initPosition(hondou);
    // 7七の歩 (row6 col2) を 7六 (row5 col2) へ
    const from = { row: 6, col: 2 };
    const pieceId = pos.board[from.row][from.col]!.pieceId;
    const move: BoardMove = { type: 'move', pieceId, from, to: { row: 5, col: 2 }, promote: false };
    expect(formatMove(hondou, pos, move)).toBe('▲7六歩');
  });
});
