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

  /**
   * v1.49 (ユーザー判断 2026-08-18)。
   *
   * 金・王のマスから来た駒は、名札の側に成った姿が無い。v1.48 までは名札をそのまま出して
   * いたので、成っているのに `仮金` `仮王` と成っていない字になり盤と食い違って見えた。
   * 名札を差し替える先が無いので、末尾に 成 を添えて区別する。
   */
  it('名札に成った姿が無い駒 (金・王のマス) が成ると呼び名の末尾に成が付く', () => {
    const base = quantumInit(initPosition(hondou));
    const cands = new Set([pidOfKind(base, 'fu'), pidOfKind(base, 'hi')]);

    // 4 九 = 先手金の初期位置。正体は別なので成れるが、名札の金には成った姿が無い
    const kinSquare = base.board[8][5]!;
    expect(kinSquare.initialKind).toBe('kin');
    const posKin = withBoardPiece(base, 8, 5, { ...kinSquare, promoted: true, candidates: cands });
    expect(kifuPieceName(hondou, posKin, posKin.board[8][5]!)).toBe('仮金成');

    // 5 九 = 先手王の初期位置。同じ理由で 仮王成
    const ouSquare = base.board[8][4]!;
    expect(ouSquare.initialKind).toBe('ou');
    const posOu = withBoardPiece(base, 8, 4, { ...ouSquare, promoted: true, candidates: cands });
    expect(kifuPieceName(hondou, posOu, posOu.board[8][4]!)).toBe('仮王成');
  });

  it('呼び名の成と、成る手の成は位置で見分けられる (v1.49)', () => {
    const base = quantumInit(initPosition(hondou));
    const kinSquare = base.board[8][5]!;
    const pos = withBoardPiece(base, 8, 5, {
      ...kinSquare,
      promoted: true,
      candidates: new Set([pidOfKind(base, 'fu'), pidOfKind(base, 'hi')]),
    });

    const text = formatMove(hondou, pos, {
      type: 'move',
      pieceId: kinSquare.pieceId,
      from: { row: 8, col: 5 },
      to: { row: 7, col: 5 },
      promote: false,
    });

    // 呼び名の 成 は行き先座標の前・成る手の 成 は行き先座標の後ろ
    expect(text).toBe('▲4九仮金成4八');
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
