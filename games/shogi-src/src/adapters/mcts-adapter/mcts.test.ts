/**
 * 汎用MCTS (親 §7.3・Phase 3-3)。
 *
 * ここで固定したいのは「破綻なく相手ができる」こと＝**必ず合法手を返す**・
 * **将棋が終わらなくても止まる**・**持ち時間を食い破らない**の 3 点。
 * 強さ (どの手を選ぶか) は回数まかせなので、細かい着手は検査しない。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { searchBestMoveMcts } from './mcts';
import { MCTS_LEVEL_TABLE, resolveMctsLevel } from './levels';

function piece(pieceId: string, kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return { pieceId, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}

function buildPos(
  placed: Array<{ row: number; col: number; piece: PieceInstance }>,
  sideToMove: 'player1' | 'player2' = 'player1',
): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const { row, col, piece: p } of placed) board[row][col] = p;
  return { width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove, moveNumber: 1, history: [] };
}

/** 毎回同じ結果になるようにした乱数 (検査を揺らさないため)。 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

describe('汎用MCTS', () => {
  it('初期局面で合法手を 1 つ返す', () => {
    const pos = initPosition(hondou);
    const r = searchBestMoveMcts(hondou, pos, { playouts: 60, movetimeMs: 3000, random: seeded(1) });
    expect(r.move).not.toBeNull();
    const legal = generateLegalMoves(hondou, pos);
    expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(r.move))).toBe(true);
  });

  it('★終局しなくても止まる (将棋はランダムに指し継いでも終わらない)', () => {
    // 玉だけの局面。取り合いが起きないので放っておけば永久に続く。
    const pos = buildPos([
      { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      { row: 0, col: 4, piece: piece('k', 'ou', 'player2', 0, 4) },
    ]);
    const r = searchBestMoveMcts(hondou, pos, { playouts: 40, movetimeMs: 3000, random: seeded(2) });
    expect(r.move).not.toBeNull();
    expect(r.playouts).toBeGreaterThan(0);
  });

  it('指す手が無ければ null を返す (勝敗の判定は対局側の仕事)', () => {
    // 後手玉が 1 一で、先手の飛 2 枚に詰まされている形。
    const pos = buildPos(
      [
        { row: 0, col: 0, piece: piece('k', 'ou', 'player2', 0, 0) },
        { row: 1, col: 8, piece: piece('R', 'hi', 'player1', 1, 8) },
        { row: 8, col: 1, piece: piece('R2', 'hi', 'player1', 8, 1) },
        { row: 8, col: 4, piece: piece('K', 'ou', 'player1', 8, 4) },
      ],
      'player2',
    );
    expect(generateLegalMoves(hondou, pos).length).toBe(0);
    const r = searchBestMoveMcts(hondou, pos, { playouts: 10, movetimeMs: 500, random: seeded(3) });
    expect(r.move).toBeNull();
  });

  it('★時間で打ち切れる (回数を使い切る前でも返す)', () => {
    const pos = initPosition(hondou);
    // 回数は膨大だが時間は 1ms。時間側で止まって手は返る。
    const r = searchBestMoveMcts(hondou, pos, { playouts: 1_000_000, movetimeMs: 1, random: seeded(4) });
    expect(r.move).not.toBeNull();
    expect(r.playouts).toBeLessThan(1_000_000);
  });

  it('外から止められる', () => {
    const pos = initPosition(hondou);
    const r = searchBestMoveMcts(hondou, pos, {
      playouts: 100_000,
      movetimeMs: 10_000,
      shouldStop: () => true,
      random: seeded(5),
    });
    expect(r.move).not.toBeNull();
    expect(r.playouts).toBeLessThan(100);
  });

  it('★試し打ちの途中でも打ち切れる (量子のように 1 手が重い場面の備え)', () => {
    // 時計が 1 回読むごとに 50ms 進む＝1 手進めるだけで重い場面の代わり。
    let clock = 0;
    const now = () => (clock += 50);
    const pos = initPosition(hondou);
    const r = searchBestMoveMcts(hondou, pos, {
      playouts: 1000,
      movetimeMs: 200, // 4 回ぶんの時計で尽きる
      now,
      random: seeded(6),
    });
    expect(r.move).not.toBeNull(); // 手は必ず返る
    expect(r.playouts).toBeLessThan(5); // 予定の 1000 回はまわらない
  });

  it('段を上げるほど試す回数が増える', () => {
    expect(MCTS_LEVEL_TABLE.Easy.playouts).toBeLessThan(MCTS_LEVEL_TABLE.Hard.playouts);
    expect(MCTS_LEVEL_TABLE.Hard.playouts).toBeLessThan(MCTS_LEVEL_TABLE.Apocalypse.playouts);
  });

  it('★持ち時間の予算より長くは考えない', () => {
    expect(resolveMctsLevel({ level: 'Apocalypse', movetimeMs: 250 }).movetimeMs).toBe(250);
    expect(resolveMctsLevel({}).playouts).toBe(MCTS_LEVEL_TABLE.Hard.playouts);
  });
});
