/**
 * 量子モードのキャスリング (量子分冊 §Q23.3・親 v1.65 §5.5.4・第 9 段 9-4c)。
 *
 * ★ユーザーの要望 (2026-08-26)＝**王の可能性を持つ駒が王の座標にあり、ルークの可能性を
 * 持つ駒がルークの座標にあれば、キャスリングできる**。仕様書 §Q23.3 の規定そのもの。
 *
 * ここで固定するのは 3 つ。
 * 1. **正体が未確定でもキャスリングできる**（「一度も動いていない」は正体と無関係に言える）
 * 2. **可能性が残っていなければできない**（王候補が落ちた駒・ルーク候補を持たない相方）
 * 3. **指した時点で 2 枚とも正体が確定する**（昇格がポーンを確定させるのと同じ形）
 *
 * ★3 が効くには C-101 を止める必要がある＝**王は横へ 2 マス動けない**ので、
 * 「その正体でこの動きを説明できるか」だけを見ると**王の候補が落ちてしまう**。
 */

import { describe, it, expect } from 'vitest';
import { chess } from '../../core/engine/mgf/loader';
import { applyMove } from '../../core/engine/position/apply';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { buildInitialKindMap, resolveCandidateKinds } from '../../core/engine/candidate-kinds';
import type { BoardMove, PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate } from './candidate-update';
import './index';

const E1 = { row: 7, col: 4 };
const H1 = { row: 7, col: 7 };
const G1 = { row: 7, col: 6 };
const F1 = { row: 7, col: 5 };
const E8 = { row: 0, col: 4 };

/** 候補集合を持つ駒。`kind` は「そのマスに最初に置かれていた駒種」であって正体ではない。 */
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

/**
 * 王のマス (e1)・ルークのマス (h1)・クイーンのマス (d1) に 1 枚ずつ。
 * 候補はすべて「この 3 枚の身元のどれか」＝どれがどれかは決まっていない。
 */
function quantumBoard(
  eCandidates: string[],
  hCandidates: string[],
): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  const pieces = [
    qp('king', 'player1', E1.row, E1.col, 'wk', eCandidates),
    qp('rook', 'player1', H1.row, H1.col, 'wrh', hCandidates),
    // 候補 id を駒種へ読み替えるための実体。d1 に置いてキャスリングの道は塞がない。
    qp('queen', 'player1', 7, 3, 'wq', ['wq']),
    qp('king', 'player2', E8.row, E8.col, 'bk', ['bk']),
  ];
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
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

/**
 * e1 の駒が `to` へ動くキャスリング。
 *
 * ★**並びを持つことで見分ける**＝量子では e1 の駒がクイーンでもありうるので、**同じ
 * 行き先へ「クイーンとして横に滑る手」も生まれる**。行き先だけで数えると取り違える。
 */
function castlingTo(position: Position, to: { row: number; col: number }): BoardMove[] {
  return generateLegalMoves(chess, position).filter(
    (m): m is BoardMove =>
      m.type === 'move' &&
      m.pieceId === 'wk' &&
      m.to.row === to.row &&
      m.to.col === to.col &&
      m.extra_steps !== undefined,
  );
}

/** その駒がいま名乗りうる駒種 (1 つなら確定)。 */
function kindsOf(position: Position, pieceId: string): string[] {
  const kindMap = buildInitialKindMap(position);
  for (const row of position.board) {
    for (const cell of row) {
      if (cell?.pieceId === pieceId) {
        return cell.candidates
          ? resolveCandidateKinds(chess, cell.candidates, cell.promoted, kindMap).sort()
          : [cell.kind];
      }
    }
  }
  return [];
}

describe('§Q23.3 量子モードのキャスリング', () => {
  it('★正体が未確定でも、王の可能性とルークの可能性が残っていれば指せる', () => {
    const p = quantumBoard(['wk', 'wq'], ['wrh', 'wq']);
    expect(kindsOf(p, 'wk')).toEqual(['king', 'queen']); // まだ確定していない
    expect(kindsOf(p, 'wrh')).toEqual(['queen', 'rook']);

    const moves = castlingTo(p, G1);
    expect(moves).toHaveLength(1);
    expect(moves[0].extra_steps).toEqual([
      { pieceId: 'wrh', from: H1, dest: { kind: 'square', square: F1 } },
    ]);
  });

  it('王の可能性が残っていない駒はキャスリングできない', () => {
    const p = quantumBoard(['wq'], ['wrh']);
    expect(castlingTo(p, G1)).toHaveLength(0);
  });

  it('★相方にルークの可能性が残っていなければできない (クイーンの可能性しか無い駒とは組まない)', () => {
    const p = quantumBoard(['wk'], ['wq']);
    expect(castlingTo(p, G1)).toHaveLength(0);
  });

  it('★指した時点で 2 枚とも正体が確定する', () => {
    const p = quantumBoard(['wk', 'wq'], ['wrh', 'wq']);
    const after = candidateUpdate(applyMove(chess, p, castlingTo(p, G1)[0]), chess);
    expect(kindsOf(after, 'wk')).toEqual(['king']);
    expect(kindsOf(after, 'wrh')).toEqual(['rook']);
  });

  it('★C-101 が王の候補を落とさない (王は横へ 2 マス動けないため、素通りさせている)', () => {
    // これが無いと候補が空になって量子異常で止まる＝「確定する」どころではない。
    const p = quantumBoard(['wk', 'wq'], ['wrh', 'wq']);
    expect(() => candidateUpdate(applyMove(chess, p, castlingTo(p, G1)[0]), chess)).not.toThrow();
  });

  it('王が確定していないうちは、王手にまつわる条件で止まらない (§Q13.1)', () => {
    // 王が通る f1 を狙う後手のルークを置いても、王が未確定なら王手は成立しない。
    const p = quantumBoard(['wk', 'wq'], ['wrh', 'wq']);
    p.board[3][F1.col] = qp('rook', 'player2', 3, F1.col, 'br', ['br']);
    expect(castlingTo(p, G1)).toHaveLength(1);
  });

  it('王が確定していれば、通り抜けるマスが狙われている side は出ない', () => {
    const p = quantumBoard(['wk'], ['wrh', 'wq']);
    p.board[3][F1.col] = qp('rook', 'player2', 3, F1.col, 'br', ['br']);
    expect(castlingTo(p, G1)).toHaveLength(0);
  });
});
