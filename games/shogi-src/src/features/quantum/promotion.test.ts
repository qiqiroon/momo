import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { applyMove } from '../../core/engine/position/apply';
import { buildInitialKindMap, displayKindsFor } from '../../core/engine/candidate-kinds';
import type { BoardMove, PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate } from './candidate-update';
import './index';

/**
 * v1.48 (ユーザー報告 2026-08-18): **成るかどうかを名札 (piece.kind) で決めていた**ため、
 * 金・王のマスから来た駒は正体が桂でも成れなかった (量子分冊 §Q11.3)。
 *
 * 報告された局面: 後手が取った「4九のマスの駒 (正体は桂)」を 6六 へ打ち、6六 → 5八 と
 * 跳ねて成ったところ、成らずに着地したため C-104 (行き所のない駒) / C-105 (強制成り) が
 * 桂の候補を全部落とし、候補が空になって量子異常になった。
 */

const mgf = hondou;

function emptyPos(sideToMove: 'player1' | 'player2'): Position {
  return {
    width: 9,
    height: 9,
    board: Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null as PieceInstance | null)),
    hands: { player1: [], player2: [] },
    sideToMove,
    moveNumber: 30,
    history: [],
  };
}

/**
 * 後手が持っている「元は先手の駒」。名札 (kind/initialKind) は slotKind (報告では 4九 = 金)、
 * 候補は**先手の桂 2 枚の身元** = 駒種としては桂に確定しているが、どちらの桂かは未確定。
 */
function makeCapturedMover(slotKind: string, quantum = true): PieceInstance {
  return {
    pieceId: 'P16',
    kind: slotKind,
    owner: 'player2',
    initialOwner: 'player1',
    initialKind: slotKind,
    initialSquare: { row: 8, col: 5 },
    promoted: false,
    ...(quantum ? { candidates: new Set(['P12', 'P18']), confirmed: false } : {}),
  };
}

/** 桂のマスの駒 2 枚。候補 P12/P18 を resolve するために盤に置く。 */
function makeKeiSlotPiece(pieceId: string, col: number): PieceInstance {
  return {
    pieceId,
    kind: 'kei',
    owner: 'player1',
    initialOwner: 'player1',
    initialKind: 'kei',
    initialSquare: { row: 8, col },
    promoted: false,
    candidates: new Set(['P16', 'P12', 'P18']),
    confirmed: false,
  };
}

function setup(mover: PieceInstance, at: { row: number; col: number }): Position {
  const pos = emptyPos('player2');
  const board = pos.board.map((r) => r.slice());
  board[at.row][at.col] = mover;
  board[3][1] = makeKeiSlotPiece('P12', 1);
  board[3][7] = makeKeiSlotPiece('P18', 7);
  return { ...pos, board };
}

function moveOf(from: { row: number; col: number }, to: { row: number; col: number }, promote: boolean): BoardMove {
  return { type: 'move', pieceId: 'P16', from, to, promote };
}

describe('量子モードの成り (§Q11.3)', () => {
  it('名札に成った姿が無い駒 (金のマス) でも成る', () => {
    // 6六 (row5,col3) → 5八 (row7,col4) = 後手の桂の跳び。5八 は強制成り圏。
    const pos = setup(makeCapturedMover('kin'), { row: 5, col: 3 });
    const next = applyMove(mgf, pos, moveOf({ row: 5, col: 3 }, { row: 7, col: 4 }, true));
    expect(next.board[7][4]?.promoted).toBe(true);
  });

  it('報告された局面: 6六 → 5八 成 で候補が空にならない', () => {
    const pos = setup(makeCapturedMover('kin'), { row: 5, col: 3 });
    const next = applyMove(mgf, pos, moveOf({ row: 5, col: 3 }, { row: 7, col: 4 }, true));
    const settled = candidateUpdate(next, mgf);
    const moved = settled.board[7][4]!;
    expect(moved.candidates?.size).toBe(2);
    // 成った桂として表示される (名札の金ではない)
    expect(displayKindsFor(mgf, moved, buildInitialKindMap(settled))).toEqual(['narikei']);
  });

  it('成りが任意の場所でも「成る」が効く (6五 → 5七)', () => {
    // 5七 (row6) は後手の成れる段だが強制ではないので、成る/成らずの両方が指せる。
    const pos = setup(makeCapturedMover('kin'), { row: 4, col: 3 });
    const promoted = applyMove(mgf, pos, moveOf({ row: 4, col: 3 }, { row: 6, col: 4 }, true));
    const plain = applyMove(mgf, pos, moveOf({ row: 4, col: 3 }, { row: 6, col: 4 }, false));
    expect(promoted.board[6][4]?.promoted).toBe(true);
    expect(plain.board[6][4]?.promoted).toBe(false);
    // 成る/成らずで見え方が変わる (v1.47 まではどちらも同じだった)
    const a = displayKindsFor(mgf, promoted.board[6][4]!, buildInitialKindMap(promoted));
    const b = displayKindsFor(mgf, plain.board[6][4]!, buildInitialKindMap(plain));
    expect(a).not.toEqual(b);
  });

  it('通常将棋モードでは従来どおり金は成らない (縮退互換)', () => {
    const pos = setup(makeCapturedMover('kin', false), { row: 5, col: 3 });
    const next = applyMove(mgf, pos, moveOf({ row: 5, col: 3 }, { row: 7, col: 4 }, true));
    expect(next.board[7][4]?.promoted).toBe(false);
    expect(next.board[7][4]?.kind).toBe('kin');
  });

  it('名札に成った姿がある駒は従来どおり名札も差し替わる', () => {
    const pos = setup(makeCapturedMover('kei'), { row: 5, col: 3 });
    const next = applyMove(mgf, pos, moveOf({ row: 5, col: 3 }, { row: 7, col: 4 }, true));
    expect(next.board[7][4]?.promoted).toBe(true);
    expect(next.board[7][4]?.kind).toBe('narikei');
  });
});
