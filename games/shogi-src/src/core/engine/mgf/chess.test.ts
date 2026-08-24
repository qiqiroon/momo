import { describe, it, expect } from 'vitest';
import { chess, hondou } from './loader';
import { initPosition } from '../position/init';
import { applyMove } from '../position/apply';
import { generatePieceMoves, generateAllBoardMoves } from '../moves/generator';
import { generateLegalMoves } from '../moves/legal';
import { isInCheck } from '../moves/check';
import { placementLetterMap } from '../piece-rules';
import type { BoardMove, PieceInstance, Position, Square } from '../position/types';

/**
 * 第 9 段 9-4a：チェスのルール定義が「決め打ちを足さずに」動くことの検査。
 * 親 v1.65 §5.5。特殊な手 (初手 2 マス・アンパッサン・キャスリング) と引き分けは後段。
 */

function pieceMovesTo(moves: BoardMove[], to: Square): BoardMove[] {
  return moves.filter((m) => m.to.row === to.row && m.to.col === to.col);
}

function mk(
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
  id: string,
): PieceInstance {
  return {
    pieceId: id,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function boardOf(): (PieceInstance | null)[][] {
  return Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null as PieceInstance | null));
}

function posWith(pieces: PieceInstance[], sideToMove: 'player1' | 'player2'): Position {
  const board = boardOf();
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

describe('9-4a placementLetterMap は決め打ちを定義から作る', () => {
  it('本将棋の対応は、以前の決め打ち表と一字一句同じ', () => {
    // これが崩れたら「将棋が無回帰」の約束が破れる (9-1 と同じ意図の錠)。
    expect(placementLetterMap(hondou)).toEqual({
      p: 'fu',
      l: 'kyo',
      n: 'kei',
      s: 'gin',
      g: 'kin',
      b: 'kaku',
      r: 'hi',
      k: 'ou',
    });
  });

  it('チェスは FEN の文字 (k/q/r/b/n/p) を正しい駒へ結ぶ', () => {
    expect(placementLetterMap(chess)).toEqual({
      k: 'king',
      q: 'queen',
      r: 'rook',
      b: 'bishop',
      n: 'knight',
      p: 'pawn',
    });
  });
});

describe('9-4a チェスの初期局面 (FEN)', () => {
  const pos = initPosition(chess);

  it('8×8・先手 (白) から', () => {
    expect(pos.width).toBe(8);
    expect(pos.height).toBe(8);
    expect(pos.sideToMove).toBe('player1');
    expect(pos.hands.player1).toHaveLength(0);
    expect(pos.hands.player2).toHaveLength(0);
  });

  it('先手 (白) は下側・後手 (黒) は上側', () => {
    // 下の段 (row7) = 白の駒列、row6 = 白のポーン
    expect(pos.board[7][4]).toMatchObject({ kind: 'king', owner: 'player1' });
    expect(pos.board[7][3]).toMatchObject({ kind: 'queen', owner: 'player1' });
    expect(pos.board[7][0]).toMatchObject({ kind: 'rook', owner: 'player1' });
    expect(pos.board[6][0]).toMatchObject({ kind: 'pawn', owner: 'player1' });
    // 上の段 (row0) = 黒の駒列
    expect(pos.board[0][4]).toMatchObject({ kind: 'king', owner: 'player2' });
    expect(pos.board[1][0]).toMatchObject({ kind: 'pawn', owner: 'player2' });
  });
});

describe('9-4a 駒の動き', () => {
  it('ポーンは前へ 1 マス・まっすぐでは取れない', () => {
    // 初手 2 マス (9-4b) と混ざらないよう、一度動いた白ポーン (初期マス row6 → いま row5)
    // で見る。前 (row4col0) が空なら 1 マスだけ。
    const pos = posWith([mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 4, 'p0')], 'player1');
    pos.board[5][0] = {
      pieceId: 'P0', kind: 'pawn', owner: 'player1', initialOwner: 'player1',
      initialKind: 'pawn', initialSquare: { row: 6, col: 0 }, promoted: false,
    };
    const moves = generatePieceMoves(chess, pos, { row: 5, col: 0 });
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 4, col: 0 });
  });

  it('ポーンの前に敵がいると、まっすぐには進めない', () => {
    const pos = posWith(
      [mk('pawn', 'player1', 6, 0, 'P0'), mk('pawn', 'player2', 5, 0, 'p9'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 4, 'p0')],
      'player1',
    );
    const moves = generatePieceMoves(chess, pos, { row: 6, col: 0 });
    expect(moves).toHaveLength(0);
  });

  it('ポーンは前斜めの敵だけ取れる', () => {
    // 一度動いたポーン (初期マス row6 → いま row5col1) で見る (初手 2 マスと分ける)。
    const pos = posWith(
      [mk('pawn', 'player2', 4, 0, 'p9'), mk('pawn', 'player2', 4, 2, 'p8'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 4, 'p0')],
      'player1',
    );
    pos.board[5][1] = {
      pieceId: 'P0', kind: 'pawn', owner: 'player1', initialOwner: 'player1',
      initialKind: 'pawn', initialSquare: { row: 6, col: 1 }, promoted: false,
    };
    const moves = generatePieceMoves(chess, pos, { row: 5, col: 1 });
    const dests = moves.map((m) => m.to).sort((a, b) => a.col - b.col);
    // 前 (row4col1) へ 1 マス＋斜め 2 つ (row4col0・row4col2) を取る
    expect(dests).toEqual([
      { row: 4, col: 0 },
      { row: 4, col: 1 },
      { row: 4, col: 2 },
    ]);
  });

  it('ナイトは八方桂で駒を飛び越す', () => {
    const pos = posWith([mk('knight', 'player1', 7, 1, 'P0'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 4, 'p0')], 'player1');
    const moves = generatePieceMoves(chess, pos, { row: 7, col: 1 });
    const dests = moves.map((m) => `${m.to.row},${m.to.col}`).sort();
    // b1(row7col1) から a3(row5col0)・c3(row5col2)・d2(row6col3)
    expect(dests).toEqual(['5,0', '5,2', '6,3']);
  });

  it('ビショップは斜めへ滑る', () => {
    const pos = posWith([mk('bishop', 'player1', 4, 4, 'P0'), mk('king', 'player1', 7, 0, 'P1'), mk('king', 'player2', 0, 7, 'p0')], 'player1');
    const moves = generatePieceMoves(chess, pos, { row: 4, col: 4 });
    // 4 方向の斜めすべて。盤の隅まで届く数を数える (13 マス)。
    expect(moves).toHaveLength(13);
    expect(moves.every((m) => Math.abs(m.to.row - 4) === Math.abs(m.to.col - 4))).toBe(true);
  });
});

describe('9-4a 捕獲は盤から取り除く (駒台に溜めない)', () => {
  it('取った駒は駒台へ入らず、盤から消える', () => {
    const pos = posWith(
      [mk('rook', 'player1', 4, 0, 'P0'), mk('pawn', 'player2', 4, 5, 'p9'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 4, 'p0')],
      'player1',
    );
    const move: BoardMove = { type: 'move', pieceId: 'P0', from: { row: 4, col: 0 }, to: { row: 4, col: 5 }, promote: false };
    const next = applyMove(chess, pos, move);
    expect(next.board[4][5]).toMatchObject({ kind: 'rook', owner: 'player1' });
    expect(next.hands.player1).toHaveLength(0);
    expect(next.hands.player2).toHaveLength(0);
  });
});

describe('9-4a ポーンの昇格 (最奥で 4 択・入れ替わる)', () => {
  it('最奥に着くと必ず昇格し、4 つの駒が生成される', () => {
    const pos = posWith([mk('pawn', 'player1', 1, 0, 'P0'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 7, 'p0')], 'player1');
    const moves = pieceMovesTo(generatePieceMoves(chess, pos, { row: 1, col: 0 }), { row: 0, col: 0 });
    const choices = moves.map((m) => m.promoteTo).sort();
    expect(choices).toEqual(['bishop', 'knight', 'queen', 'rook']);
    // 昇格しない手 (promote:false) は出ない (必ず成る)
    expect(moves.every((m) => m.promote)).toBe(true);
  });

  it('昇格を適用すると別の駒になる (裏の印は立たない)', () => {
    const pos = posWith([mk('pawn', 'player1', 1, 0, 'P0'), mk('king', 'player1', 7, 4, 'P1'), mk('king', 'player2', 0, 7, 'p0')], 'player1');
    const move: BoardMove = { type: 'move', pieceId: 'P0', from: { row: 1, col: 0 }, to: { row: 0, col: 0 }, promote: true, promoteTo: 'queen' };
    const next = applyMove(chess, pos, move);
    expect(next.board[0][0]).toMatchObject({ kind: 'queen', owner: 'player1', promoted: false });
  });
});

describe('9-4a 王の詰み (capture_royalty)', () => {
  it('隅の王が逃げ場なく王手されていれば、合法手ゼロ＋王手＝詰み', () => {
    // 後手王 a8(row0col0)・先手クイーン b7(row1col1・先手王 c6(row2col2) が守る)。
    const pos = posWith(
      [
        mk('king', 'player2', 0, 0, 'p0'),
        mk('queen', 'player1', 1, 1, 'P0'),
        mk('king', 'player1', 2, 2, 'P1'),
      ],
      'player2',
    );
    expect(isInCheck(chess, pos, 'player2')).toBe(true);
    expect(generateLegalMoves(chess, pos)).toHaveLength(0);
  });

  it('王手されていなければ、まだ合法手がある', () => {
    const pos = posWith([mk('king', 'player2', 0, 0, 'p0'), mk('king', 'player1', 7, 7, 'P1')], 'player2');
    expect(isInCheck(chess, pos, 'player2')).toBe(false);
    expect(generateLegalMoves(chess, pos).length).toBeGreaterThan(0);
  });
});

describe('9-4a 将棋が無回帰', () => {
  it('本将棋の初期局面はこれまでどおり先手・9×9', () => {
    const pos = initPosition(hondou);
    expect(pos.width).toBe(9);
    expect(pos.sideToMove).toBe('player1');
    // 初期局面の合法手が生成できる (数は問わない)
    expect(generateAllBoardMoves(hondou, pos).length).toBeGreaterThan(0);
  });
});
