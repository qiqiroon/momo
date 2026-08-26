/**
 * 量子モードのチェスで**駒が盤から取り除かれる**こと（量子分冊 §Q23.4／§Q23.5・第 9 段 9-5）。
 *
 * ★仕様書が申し送りを残している箇所である＝割り当ての制約（C-303）は「**駒は盤外へ
 * 消えない**（取られても駒台に残る）」という将棋の性質に乗っている。**チェスの捕獲は
 * 駒台へ移るのではなく盤から取り除く**ので、この前提に触れる。§Q23.5 は「**取り除かれた
 * 駒も身元の勘定には残す**」と定め、**実装時に実測で確かめること**と申し送っている。
 * 本ファイルはその実測である。
 */

import { describe, it, expect } from 'vitest';
import { chess } from '../../core/engine/mgf/loader';
import { applyMove } from '../../core/engine/position/apply';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { buildInitialKindMap, resolveCandidateKinds } from '../../core/engine/candidate-kinds';
import type { BoardMove, PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate } from './candidate-update';
import './index';

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

function board8(pieces: PieceInstance[], sideToMove: 'player1' | 'player2' = 'player1'): Position {
  const board = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => null as PieceInstance | null),
  );
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return { width: 8, height: 8, board, hands: { player1: [], player2: [] }, sideToMove, moveNumber: 1, history: [] };
}

function kindsOf(position: Position, pieceId: string): string[] {
  const kindMap = buildInitialKindMap(position);
  for (const row of position.board) {
    for (const cell of row) {
      if (cell?.pieceId === pieceId) {
        return cell.candidates && !cell.replaced
          ? resolveCandidateKinds(chess, cell.candidates, cell.promoted, kindMap).sort()
          : [cell.kind];
      }
    }
  }
  return [];
}

function squareOf(position: Position, pieceId: string): { row: number; col: number } | null {
  for (let r = 0; r < position.height; r++) {
    for (let c = 0; c < position.width; c++) {
      if (position.board[r][c]?.pieceId === pieceId) return { row: r, col: c };
    }
  }
  return null;
}

describe('§Q23.5 取られて盤から消えても、身元の勘定は崩れない', () => {
  it('★取り除かれた駒が居ても、残った駒の候補が空にならない', () => {
    // 後手の 2 枚（どちらがポーンでどちらがルークか未確定）のうち 1 枚を取る。
    const p = board8(
      [
        qp('rook', 'player1', 4, 4, 'wR', ['wR']),
        qp('king', 'player1', 7, 4, 'wk', ['wk']),
        qp('pawn', 'player2', 4, 0, 'bA', ['bA', 'bB']),
        qp('rook', 'player2', 2, 0, 'bB', ['bA', 'bB']),
        qp('king', 'player2', 0, 4, 'bk', ['bk']),
      ],
      'player1',
    );
    const capture = generateLegalMoves(chess, p).find(
      (m): m is BoardMove => m.type === 'move' && m.pieceId === 'wR' && m.to.row === 4 && m.to.col === 0,
    );
    expect(capture).toBeTruthy();

    const after = candidateUpdate(applyMove(chess, p, capture as BoardMove), chess);
    // 取られた駒は盤から消える（駒台へは行かない＝チェスには持ち駒が無い）
    expect(squareOf(after, 'bA')).toBeNull();
    expect(after.hands.player1).toHaveLength(0);
    expect(after.hands.player2).toHaveLength(0);
    // ★残った駒の候補が空になっていない＝身元の勘定が崩れていない
    expect(kindsOf(after, 'bB').length).toBeGreaterThan(0);
  });
});

describe('§Q23.4 アンパッサンは、取られた側に絞り込みを起こさない', () => {
  it('★取った側はポーンに確定し、取られた駒は消える（異常で止まらない）', () => {
    // 後手の駒が 2 マス進み、その隣に居た先手の駒が斜めへ進んで取り除く。
    const p = board8(
      [
        qp('pawn', 'player1', 3, 1, 'wA', ['wA', 'wB']), // b5（アンパッサンする側）
        qp('rook', 'player1', 6, 7, 'wB', ['wA', 'wB']),
        qp('king', 'player1', 7, 4, 'wk', ['wk']),
        qp('pawn', 'player2', 1, 0, 'bP', ['bP']), // a7
        qp('king', 'player2', 0, 4, 'bk', ['bk']),
      ],
      'player2',
    );
    // a7 → a5 の 2 マス進み
    const doubleStep = generateLegalMoves(chess, p).find(
      (m): m is BoardMove => m.type === 'move' && m.pieceId === 'bP' && m.to.row === 3,
    );
    expect(doubleStep).toBeTruthy();
    const mid = candidateUpdate(applyMove(chess, p, doubleStep as BoardMove), chess);

    // b5 → a6（通り過ぎたマス）へ進んで、a5 の駒を取り除く
    const ep = generateLegalMoves(chess, { ...mid, sideToMove: 'player1' }).find(
      (m): m is BoardMove => m.type === 'move' && m.pieceId === 'wA' && m.to.row === 2 && m.to.col === 0,
    );
    expect(ep).toBeTruthy();

    const after = candidateUpdate(applyMove(chess, { ...mid, sideToMove: 'player1' }, ep as BoardMove), chess);
    // 取られた駒は盤にも駒台にも居ない
    expect(squareOf(after, 'bP')).toBeNull();
    expect(after.hands.player1).toHaveLength(0);
    // ★取った側は「斜めへ進んで取った」ことを説明できる候補＝ポーンに確定する
    expect(kindsOf(after, 'wA')).toEqual(['pawn']);
  });
});
