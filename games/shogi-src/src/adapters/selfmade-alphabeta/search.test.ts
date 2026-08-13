import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { searchBestMove } from './search';
import { evaluate, MATE_VALUE } from './evaluate';

function piece(
  pieceId: string,
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
): PieceInstance {
  return {
    pieceId,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

function buildPos(
  placed: Array<{ row: number; col: number; piece: PieceInstance }>,
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null),
  );
  for (const { row, col, piece: p } of placed) board[row][col] = p;
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 1,
    history: [],
  };
}

const FIXED = { jitter: 0, random: () => 0 };

describe('駒得の評価', () => {
  it('初期局面は互角 (どちらから見ても 0)', () => {
    const pos = initPosition(hondou);
    expect(evaluate(hondou, pos)).toBe(0);
  });

  it('駒を多く持っている側から見て有利になる', () => {
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 4, piece: piece('k', 'ou', 'player2', 0, 4) },
      { row: 4, col: 4, piece: piece('R', 'hi', 'player1', 4, 4) },
    ]);
    expect(evaluate(hondou, pos)).toBeGreaterThan(500);
    expect(evaluate(hondou, { ...pos, sideToMove: 'player2' })).toBeLessThan(-500);
  });
});

describe('読み筋', () => {
  it('ただで取れる飛車があれば取る', () => {
    // 先手の飛が 5五、後手の飛が 5三 (取り返す駒は無い)。
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 4, col: 4, piece: piece('R', 'hi', 'player1', 4, 4) },
      { row: 2, col: 4, piece: piece('r', 'hi', 'player2', 2, 4) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 3000, maxDepth: 3, ...FIXED });
    expect(r.move).not.toBeNull();
    expect(r.move?.type).toBe('move');
    if (r.move?.type === 'move') {
      expect(r.move.to).toEqual({ row: 2, col: 4 });
    }
  });

  it('取り返される駒には手を出さない (取り合いの先まで読む)', () => {
    // 5三の後手の歩は、取ると 5二の金に取り返される。飛を歩と刺し違えるのは損。
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 3, col: 4, piece: piece('R', 'hi', 'player1', 3, 4) },
      { row: 2, col: 4, piece: piece('p', 'fu', 'player2', 2, 4) },
      { row: 1, col: 4, piece: piece('g', 'kin', 'player2', 1, 4) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 3000, maxDepth: 3, ...FIXED });
    expect(r.move?.type).toBe('move');
    if (r.move?.type === 'move') {
      expect(r.move.to).not.toEqual({ row: 2, col: 4 });
    }
  });

  it('1 手で詰むなら詰ます', () => {
    // 後手玉 1一。先手の金 1三・飛 9二 → 金 1二 で詰み。
    const pos = buildPos([
      { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
      { row: 8, col: 8, piece: piece('K', 'ou', 'player1', 8, 8) },
      { row: 2, col: 0, piece: piece('G', 'kin', 'player1', 2, 0) },
      { row: 1, col: 8, piece: piece('R', 'hi', 'player1', 1, 8) },
    ]);
    const r = searchBestMove(hondou, pos, { movetimeMs: 5000, maxDepth: 4, ...FIXED });
    expect(r.move).not.toBeNull();
    // 実際に指してみて、後手に指す手が無くなる (詰んでいる) ことを確かめる
    const after = applyMove(hondou, pos, r.move!);
    expect(generateLegalMoves(hondou, after)).toHaveLength(0);
    expect(r.score).toBeGreaterThan(MATE_VALUE - 1000);
  });

  it('指す手が無ければ null を返す', () => {
    // 後手玉 1一が先手の金 1二・飛 9二で詰んでいる状態から、後手の手番で読ませる
    const pos = buildPos(
      [
        { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
        { row: 8, col: 8, piece: piece('K', 'ou', 'player1', 8, 8) },
        { row: 1, col: 0, piece: piece('G', 'kin', 'player1', 1, 0) },
        { row: 1, col: 8, piece: piece('R', 'hi', 'player1', 1, 8) },
      ],
      'player2',
    );
    const r = searchBestMove(hondou, pos, { movetimeMs: 1000, maxDepth: 3, ...FIXED });
    expect(r.move).toBeNull();
  });

  it('初期局面から返る手は必ず合法手', () => {
    const pos = initPosition(hondou);
    const legal = generateLegalMoves(hondou, pos);
    const r = searchBestMove(hondou, pos, { movetimeMs: 800, maxDepth: 6 });
    expect(r.move).not.toBeNull();
    expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(r.move))).toBe(true);
  });

  it('時間の上限を守る (深さは時間で決まる)', () => {
    const pos = initPosition(hondou);
    const budget = 400;
    const r = searchBestMove(hondou, pos, { movetimeMs: budget, maxDepth: 20, ...FIXED });
    expect(r.move).not.toBeNull();
    // 打ち切りは節目でしか見ないので多少はみ出す。倍を超えないことを見る。
    expect(r.elapsedMs).toBeLessThan(budget * 2);
    expect(r.depth).toBeGreaterThanOrEqual(1);
  });

  it('外から打ち切られても 1 手は返す', () => {
    const pos = initPosition(hondou);
    const r = searchBestMove(hondou, pos, {
      movetimeMs: 10000,
      maxDepth: 20,
      shouldStop: () => true,
      ...FIXED,
    });
    expect(r.move).not.toBeNull();
  });
});
