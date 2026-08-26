/**
 * 手を伝言に載せる形と、届いた伝言から手を見分けるやり方 (v1.90・9-4c・親 §3.7.1)。
 *
 * ★ここで守りたいのは 1 つ＝**同じ「どの駒が・どこから・どこへ」で中身の違う手が
 * 2 通りあるとき、取り違えない**こと。量子モードでは王のマスの駒が王かクイーンか
 * 決まっていないので、「キャスリングして 2 マス動く」と「クイーンとして 2 マス滑る」が
 * まったく同じ項目になる。**並びを載せて初めて見分けられる。**
 */

import { describe, it, expect } from 'vitest';
import { chess } from '../engine/mgf/loader';
import { generateLegalMoves } from '../engine/moves/legal';
import type { BoardMove, PieceInstance, Position } from '../engine/position/types';
import { isSameWireMove, wireFieldsOf, wireMoveOf } from './wire-move';

const E1 = { row: 7, col: 4 };
const H1 = { row: 7, col: 7 };
const G1 = { row: 7, col: 6 };
const F1 = { row: 7, col: 5 };
const E8 = { row: 0, col: 4 };

function qp(
  kind: string,
  owner: 'player1' | 'player2',
  row: number,
  col: number,
  id: string,
  candidates?: string[],
): PieceInstance {
  return {
    pieceId: id,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
    ...(candidates ? { candidates: new Set(candidates), confirmed: false } : {}),
  };
}

/** e1 の駒が「王かルーク」・h1 の駒も「王かルーク」＝どちらとも決まっていない盤。 */
function ambiguousBoard(): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of [
    qp('king', 'player1', E1.row, E1.col, 'wk', ['wk', 'wrh']),
    qp('rook', 'player1', H1.row, H1.col, 'wrh', ['wk', 'wrh']),
    qp('king', 'player2', E8.row, E8.col, 'bk', ['bk']),
  ]) {
    board[p.initialSquare.row][p.initialSquare.col] = p;
  }
  return {
    width: 8,
    height: 8,
    board,
    hands: { player1: [], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

describe('9-4c 伝言に載せる手', () => {
  it('並びを持つ手は、並びも載せて運ばれる', () => {
    const p = ambiguousBoard();
    const castling = generateLegalMoves(chess, p).find(
      (m): m is BoardMove => m.type === 'move' && m.extra_steps !== undefined,
    );
    expect(castling).toBeDefined();
    const wire = wireMoveOf(castling!);
    expect(wire.extra_steps).toEqual([
      { pieceId: 'wrh', from: H1, dest: { kind: 'square', square: F1 } },
    ]);
  });

  it('並びを持たない手は、これまでどおり並びの欄を持たない', () => {
    const p = ambiguousBoard();
    const plain = generateLegalMoves(chess, p).find(
      (m): m is BoardMove => m.type === 'move' && m.extra_steps === undefined,
    );
    expect(plain).toBeDefined();
    expect('extra_steps' in wireMoveOf(plain!)).toBe(false);
  });

  it('★同じ「どこからどこへ」の手が 2 通りあっても、並びで見分けられる', () => {
    const p = ambiguousBoard();
    // e1 の駒は王でもルークでもありうるので、g1 へは 2 通りで行ける。
    const toG1 = generateLegalMoves(chess, p).filter(
      (m): m is BoardMove =>
        m.type === 'move' && m.pieceId === 'wk' && m.to.row === G1.row && m.to.col === G1.col,
    );
    expect(toG1).toHaveLength(2);

    const castling = toG1.find((m) => m.extra_steps)!;
    const slide = toG1.find((m) => !m.extra_steps)!;

    // 並びを載せた伝言はキャスリングだけに合う。
    expect(toG1.filter((m) => isSameWireMove(m, wireMoveOf(castling)))).toEqual([castling]);
    // 並びを載せない伝言は滑る手だけに合う。
    expect(toG1.filter((m) => isSameWireMove(m, wireMoveOf(slide)))).toEqual([slide]);
  });

  it('★並びを載せ忘れた伝言は「見つからない」側に転ぶ (黙って別の手を指さない)', () => {
    const p = ambiguousBoard();
    const castling = generateLegalMoves(chess, p).find(
      (m): m is BoardMove => m.type === 'move' && m.extra_steps !== undefined,
    )!;
    const { extra_steps: _dropped, ...withoutSteps } = wireMoveOf(castling);
    expect(isSameWireMove(castling, withoutSteps)).toBe(false);
  });

  it('伝言に載せる項目だけを取り出す (時計や局面の印は落とす)', () => {
    const wire = wireFieldsOf({
      kind: 'move',
      pieceId: 'wk',
      from: E1,
      to: G1,
      promote: false,
      extra_steps: [{ pieceId: 'wrh', from: H1, dest: { kind: 'square', square: F1 } }],
      // 伝言の外側の事情。ここには残らないこと。
      ...({ time: { mainMs: 1, byoyomiMs: 2, inByoyomi: false }, hash: 'x' } as object),
    });
    expect(Object.keys(wire).sort()).toEqual(
      ['extra_steps', 'from', 'kind', 'pieceId', 'promote', 'to'].sort(),
    );
  });
});
