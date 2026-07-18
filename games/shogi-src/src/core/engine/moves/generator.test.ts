import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from '../position/init';
import type { PieceInstance, Position, Square } from '../position/types';
import { generateAllBoardMoves, generatePieceMoves } from './generator';

function emptyPos(): Position {
  return {
    width: 9,
    height: 9,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null)),
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

function placePiece(
  pos: Position,
  row: number,
  col: number,
  piece: PieceInstance,
): Position {
  const board = pos.board.map((r) => r.slice());
  board[row][col] = piece;
  return { ...pos, board };
}

describe('generatePieceMoves (initial hondou position)', () => {
  const pos: Position = initPosition(hondou);

  it('sente 歩 at 77 (row6col2) has 1 forward move to 76', () => {
    const from: Square = { row: 6, col: 2 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 5, col: 2 });
    expect(moves[0].promote).toBe(false);
  });

  it('sente 香 at 99 (row8col0) has 1 forward move to 98', () => {
    const from: Square = { row: 8, col: 0 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 7, col: 0 });
  });

  it('sente 桂 at 89 (row8col1) has 0 moves at initial (own pieces block)', () => {
    const from: Square = { row: 8, col: 1 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });

  it('sente 角 at 88 (row7col1) has 0 moves at initial (all diagonals blocked)', () => {
    const from: Square = { row: 7, col: 1 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });

  it('sente 飛 at 28 (row7col7) has 6 sideways moves', () => {
    const from: Square = { row: 7, col: 7 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(6);
  });

  it('sente 王 at 59 (row8col4) has 3 moves at initial (to 68/58/48)', () => {
    const from: Square = { row: 8, col: 4 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(3);
  });

  it('sente 銀 at 79 (row8col6) has 2 moves at initial', () => {
    const from: Square = { row: 8, col: 6 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(2);
  });

  it('sente 金 at 69 (row8col3) has 3 moves at initial', () => {
    const from: Square = { row: 8, col: 3 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(3);
  });

  it('does not generate moves for opponent (gote) pieces on sente turn', () => {
    const from: Square = { row: 0, col: 4 };
    const moves = generatePieceMoves(hondou, pos, from);
    expect(moves).toHaveLength(0);
  });
});

describe('generateAllBoardMoves (initial hondou position)', () => {
  it('sente has exactly 30 pseudo-legal moves at initial (matches known count)', () => {
    // 9歩×1 + 2香×1 + 0桂 + 2銀×2 + 2金×3 + 0角 + 1飛×6 + 1王×3
    // = 9 + 2 + 0 + 4 + 6 + 0 + 6 + 3 = 30
    const pos: Position = initPosition(hondou);
    const moves = generateAllBoardMoves(hondou, pos);
    expect(moves).toHaveLength(30);
  });

  it('gote also has 30 pseudo-legal moves (symmetric)', () => {
    const pos: Position = initPosition(hondou);
    const goteTurn: Position = { ...pos, sideToMove: 'player2' };
    const moves = generateAllBoardMoves(hondou, goteTurn);
    expect(moves).toHaveLength(30);
  });
});

describe('generatePieceMoves — quantum candidate union (Phase 5-3)', () => {
  it('candidates == {fu, gin}: 前進が重複せず union は 5 手', () => {
    // 空盤上の (5, 4) に候補 {fu, gin} の駒を置く。
    // fu 前進 = (4, 4)、gin 前進 = (4, 4) (重複)、gin 斜前 = (4, 3)/(4, 5)、gin 斜後 = (6, 3)/(6, 5)。
    // 全て promo 範囲外 (player1 zone = rank 1-3 = row 0-2)。dedup 後 5 手。
    const piece: PieceInstance = {
      pieceId: 'Q1',
      kind: 'fu',
      owner: 'player1',
      initialOwner: 'player1',
      initialKind: 'fu',
      initialSquare: { row: 5, col: 4 },
      promoted: false,
      candidates: new Set(['Q1', 'Q_ref_gin']),
      confirmed: false,
    };
    const refGin: PieceInstance = {
      pieceId: 'Q_ref_gin', kind: 'gin', owner: 'player1', initialOwner: 'player1',
      initialKind: 'gin', initialSquare: { row: -1, col: -1 }, promoted: false,
    };
    let pos = placePiece(emptyPos(), 5, 4, piece);
    pos = { ...pos, hands: { ...pos.hands, player1: [refGin] } };
    const moves = generatePieceMoves(hondou, pos, { row: 5, col: 4 });
    const dests = moves.map((m) => `${m.to.row},${m.to.col},${m.promote ? 1 : 0}`).sort();
    expect(dests).toEqual([
      '4,3,0',
      '4,4,0',
      '4,5,0',
      '6,3,0',
      '6,5,0',
    ]);
  });

  it('candidates == {fu, ou}: 八方 union が 8 手 (fu の前進が ou と重複)', () => {
    // (5, 4) に候補 {fu, ou} → 八方の全マス。fu 前進 (4,4) は ou の (4,4) と重複、dedup で 8 手に収まる。
    const piece: PieceInstance = {
      pieceId: 'Q2',
      kind: 'fu',
      owner: 'player1',
      initialOwner: 'player1',
      initialKind: 'fu',
      initialSquare: { row: 5, col: 4 },
      promoted: false,
      candidates: new Set(['Q2', 'Q_ref_ou']),
      confirmed: false,
    };
    const refOu: PieceInstance = {
      pieceId: 'Q_ref_ou', kind: 'ou', owner: 'player1', initialOwner: 'player1',
      initialKind: 'ou', initialSquare: { row: -1, col: -1 }, promoted: false,
    };
    let pos = placePiece(emptyPos(), 5, 4, piece);
    pos = { ...pos, hands: { ...pos.hands, player1: [refOu] } };
    const moves = generatePieceMoves(hondou, pos, { row: 5, col: 4 });
    const dests = new Set(moves.map((m) => `${m.to.row},${m.to.col},${m.promote ? 1 : 0}`));
    expect(dests.size).toBe(8);
    for (const d of ['4,3,0', '4,4,0', '4,5,0', '5,3,0', '5,5,0', '6,3,0', '6,4,0', '6,5,0']) {
      expect(dests.has(d)).toBe(true);
    }
  });

  it('candidates == {fu, gin, hi}: 縦・横・斜め全てに動ける (kickoff §5.3 の例)', () => {
    // (7, 4) に候補 {fu, gin, hi}。空盤。
    // hi の縦横スライドで縦列と横列を制圧、gin で斜め 4 方向を追加、fu は最前進が hi/gin と重複。
    // hi 前スライド (2,4)/(1,4)/(0,4) は player1 promo 範囲 → promote=true 変種が追加される。
    const piece: PieceInstance = {
      pieceId: 'Q3',
      kind: 'fu',
      owner: 'player1',
      initialOwner: 'player1',
      initialKind: 'fu',
      initialSquare: { row: 7, col: 4 },
      promoted: false,
      candidates: new Set(['Q3', 'Q_ref_gin', 'Q_ref_hi']),
      confirmed: false,
    };
    const refGin: PieceInstance = {
      pieceId: 'Q_ref_gin', kind: 'gin', owner: 'player1', initialOwner: 'player1',
      initialKind: 'gin', initialSquare: { row: -1, col: -1 }, promoted: false,
    };
    const refHi: PieceInstance = {
      pieceId: 'Q_ref_hi', kind: 'hi', owner: 'player1', initialOwner: 'player1',
      initialKind: 'hi', initialSquare: { row: -1, col: -1 }, promoted: false,
    };
    let pos = placePiece(emptyPos(), 7, 4, piece);
    pos = { ...pos, hands: { ...pos.hands, player1: [refGin, refHi] } };
    const moves = generatePieceMoves(hondou, pos, { row: 7, col: 4 });
    const dests = new Set(moves.map((m) => `${m.to.row},${m.to.col}`));
    // 縦 (col=4 全 8 マス) + 横 (row=7 の col!=4 の 8 マス) + 斜め前 (6,3)(6,5) + 斜め後 (8,3)(8,5)
    // = 8 + 8 + 2 + 2 = 20 マス
    expect(dests.size).toBe(20);
    // promo 範囲 (row 0-2) の 3 マスは promote=true/false の 2 変種で合計 6 手、他 17 マスは 1 手ずつ
    // = 20 + 3 = 23 手
    expect(moves).toHaveLength(23);
    // 横 (row 7 の全マス)
    for (let c = 0; c < 9; c++) if (c !== 4) expect(dests.has(`7,${c}`)).toBe(true);
    // 縦 (col 4 の全マス)
    for (let r = 0; r < 9; r++) if (r !== 7) expect(dests.has(`${r},4`)).toBe(true);
    // 斜め
    for (const d of ['6,3', '6,5', '8,3', '8,5']) expect(dests.has(d)).toBe(true);
    // promo 変種の存在
    const promoteVariants = moves.filter((m) => m.promote);
    expect(promoteVariants.map((m) => `${m.to.row},${m.to.col}`).sort()).toEqual(['0,4', '1,4', '2,4']);
  });

  it('candidates === undefined (縮退互換): 従来の生成結果と一致', () => {
    // 初期本将棋盤で sente 歩 at (6, 2) は前進 1 手 (regression)
    const pos = initPosition(hondou);
    const moves = generatePieceMoves(hondou, pos, { row: 6, col: 2 });
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toEqual({ row: 5, col: 2 });
  });

  it('candidates == {fu} 単体は kind=fu と同じ結果 (単一集合の一貫性)', () => {
    // 空盤の (6, 4) に fu を 2 個並べて、片方は candidates 有・片方は無で結果を比較
    const pieceA: PieceInstance = {
      pieceId: 'A', kind: 'fu', owner: 'player1', initialOwner: 'player1',
      initialKind: 'fu', initialSquare: { row: 6, col: 4 }, promoted: false,
    };
    const pieceB: PieceInstance = {
      ...pieceA, pieceId: 'B', candidates: new Set(['B']), confirmed: false,
    };
    const posA = placePiece(emptyPos(), 6, 4, pieceA);
    const posB = placePiece(emptyPos(), 6, 4, pieceB);
    const movesA = generatePieceMoves(hondou, posA, { row: 6, col: 4 });
    const movesB = generatePieceMoves(hondou, posB, { row: 6, col: 4 });
    expect(movesA).toHaveLength(movesB.length);
    expect(movesA[0].to).toEqual(movesB[0].to);
    expect(movesA[0].promote).toEqual(movesB[0].promote);
  });
});
