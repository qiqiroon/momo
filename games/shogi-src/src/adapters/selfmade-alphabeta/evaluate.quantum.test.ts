import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { quantumInit } from '../../features/quantum/init';
import { evaluate, buildValueBook, pieceValue, PIECE_VALUE } from './evaluate';
import type { PieceId, Position } from '../../core/engine/position/types';

function pidOfKind(pos: Position, kind: string, owner: 'player1' | 'player2'): PieceId {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === owner && cell.initialKind === kind) return cell.pieceId;
    }
  }
  throw new Error(`no ${owner} piece with initialKind=${kind}`);
}

function withCandidates(pos: Position, row: number, col: number, pids: PieceId[]): Position {
  const target = pos.board[row][col]!;
  return {
    ...pos,
    board: pos.board.map((r, ri) =>
      ri === row ? r.map((c, ci) => (ci === col ? { ...target, candidates: new Set(pids) } : c)) : r,
    ),
  };
}

/**
 * v1.49 (ユーザー判断 2026-08-18)。
 *
 * v1.48 まで値打ちは piece.kind (名札＝対局開始時にその位置に置かれていた駒種) から
 * 引いていた。名札は正体ではなく、**正体が判明しても書き換わらない**ので、量子モードでは
 * 盤上の駒も持ち駒も全部 (確定した駒も含めて) 実態と違う値で数えていた。
 */
describe('量子モードの駒の値打ち (v1.49)', () => {
  it('候補が 1 つに絞れた駒は、名札ではなくその駒種の値で数える', () => {
    const base = quantumInit(initPosition(hondou));
    // 4 九 = 先手金の初期位置 (名札は金)。正体が桂に確定した状態にする。
    const kinSquare = base.board[8][5]!;
    expect(kinSquare.initialKind).toBe('kin');
    const pos = withCandidates(base, 8, 5, [pidOfKind(base, 'kei', 'player1')]);
    const book = buildValueBook(hondou, pos);

    expect(pieceValue(pos.board[8][5]!, book)).toBe(PIECE_VALUE.kei);
    expect(pieceValue(pos.board[8][5]!, book)).not.toBe(PIECE_VALUE.kin);
  });

  it('候補が複数ある駒は、いちばん強い候補の値で数える', () => {
    const base = quantumInit(initPosition(hondou));
    const pos = withCandidates(base, 6, 2, [
      pidOfKind(base, 'fu', 'player1'),
      pidOfKind(base, 'hi', 'player1'),
    ]);
    const book = buildValueBook(hondou, pos);

    expect(pieceValue(pos.board[6][2]!, book)).toBe(PIECE_VALUE.hi);
  });

  it('王は材料に数えない (数えると開始局面で全駒が王の値になる)', () => {
    const base = quantumInit(initPosition(hondou));
    const book = buildValueBook(hondou, base);

    // 開始時はどの駒も 8 駒種すべてを候補に持つ (実測)。王を混ぜると全部 20000 になる。
    for (const piece of [base.board[6][4]!, base.board[8][4]!, base.board[8][0]!]) {
      expect(pieceValue(piece, book)).toBe(PIECE_VALUE.hi);
    }

    // 王だけが候補＝王と確定した駒は 0 点。
    const confirmed = withCandidates(base, 8, 4, [pidOfKind(base, 'ou', 'player1')]);
    expect(pieceValue(confirmed.board[8][4]!, buildValueBook(hondou, confirmed))).toBe(0);
  });

  it('開始局面は互角のまま (両者同じ候補なので)', () => {
    const pos = quantumInit(initPosition(hondou));
    expect(evaluate(hondou, pos)).toBe(0);
  });

  it('候補が減った側は、その駒のぶんだけ点数が下がる', () => {
    const base = quantumInit(initPosition(hondou));
    // 先手の 1 枚から飛の可能性が消える＝その駒は最強でも角どまりになる。
    const narrowed = withCandidates(base, 6, 2, [
      pidOfKind(base, 'fu', 'player1'),
      pidOfKind(base, 'kaku', 'player1'),
    ]);

    const before = evaluate(hondou, base);
    const after = evaluate(hondou, narrowed);
    expect(after).toBeLessThan(before);
    expect(before - after).toBe(PIECE_VALUE.hi - PIECE_VALUE.kaku);
  });
});
