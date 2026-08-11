import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import { quantumInit } from '../../../features/quantum/init';
import { kifuPieceName, formatMove } from './format';
import type { PieceId, PieceInstance, Position } from '../position/types';

function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? piece : c)) : r)),
  };
}

function pidOfKind(pos: Position, kind: string): PieceId {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === 'player1' && cell.initialKind === kind) return cell.pieceId;
    }
  }
  throw new Error(`no player1 piece with initialKind=${kind}`);
}

describe('棋譜の駒名 (v1.09 量子将棋対応)', () => {
  it('本将棋モードは従来どおりの駒名', () => {
    const pos = initPosition(hondou);
    expect(kifuPieceName(hondou, pos, pos.board[6][4]!)).toBe('歩');
    expect(kifuPieceName(hondou, pos, pos.board[8][4]!)).toBe('王');
  });

  it('未確定の駒は「元の場所の駒名」に仮を付けて呼ぶ', () => {
    const pos = quantumInit(initPosition(hondou));
    // 5 九 = 先手玉の初期位置。まだ何者か決まっていないので 仮王
    expect(kifuPieceName(hondou, pos, pos.board[8][4]!)).toBe('仮王');
    expect(kifuPieceName(hondou, pos, pos.board[6][4]!)).toBe('仮歩');
  });

  it('候補が 1 駒種に絞れたらその駒名で呼ぶ (仮が外れる)', () => {
    const base = quantumInit(initPosition(hondou));
    const target = base.board[6][2]!;
    const pos = withBoardPiece(base, 6, 2, {
      ...target,
      candidates: new Set([pidOfKind(base, 'kin')]),
      confirmed: true,
    });

    expect(kifuPieceName(hondou, pos, pos.board[6][2]!)).toBe('金');
  });

  it('成っている未確定の駒は成った側の名前に仮を付ける', () => {
    const base = quantumInit(initPosition(hondou));
    const target = base.board[6][2]!;
    const pos = withBoardPiece(base, 6, 2, {
      ...target,
      promoted: true,
      candidates: new Set([pidOfKind(base, 'fu'), pidOfKind(base, 'hi')]),
    });

    expect(kifuPieceName(hondou, pos, pos.board[6][2]!)).toBe('仮と');
  });

  it('量子将棋の指し手は「元の座標 + 駒名 + 行き先座標」で書く (v1.14)', () => {
    const pos = quantumInit(initPosition(hondou));
    const piece = pos.board[6][2]!;

    const text = formatMove(hondou, pos, {
      type: 'move',
      pieceId: piece.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    });

    // 7 七に居た仮歩が 7 六へ。行き先だけだとどの駒が動いたか読み取れないため元の座標も書く
    expect(text).toBe('▲7七仮歩7六');
  });

  it('成るときは行き先座標のうしろに成が付く (v1.14)', () => {
    const pos = quantumInit(initPosition(hondou));
    const piece = pos.board[6][7]!;

    const text = formatMove(hondou, pos, {
      type: 'move',
      pieceId: piece.pieceId,
      from: { row: 6, col: 7 },
      to: { row: 5, col: 7 },
      promote: true,
    });

    expect(text).toBe('▲2七仮歩2六成');
  });

  it('本将棋モードは従来どおり行き先だけを書く (縮退互換)', () => {
    const pos = initPosition(hondou);
    const piece = pos.board[6][2]!;

    const text = formatMove(hondou, pos, {
      type: 'move',
      pieceId: piece.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    });

    expect(text).toBe('▲7六歩');
  });
});
