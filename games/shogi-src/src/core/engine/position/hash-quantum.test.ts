import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';
import { quantumInit } from '../../../features/quantum/init';
import { positionHash } from './hash';
import type { PieceInstance, Position } from './types';

function withBoardPiece(pos: Position, row: number, col: number, piece: PieceInstance): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) => (ri === row ? r.map((c, ci) => (ci === col ? piece : c)) : r)),
  };
}

describe('局面ハッシュの量子対応 (v1.09)', () => {
  it('本将棋モードのハッシュは従来と同じ形 (候補の印が付かない)', () => {
    const pos = initPosition(hondou);
    expect(positionHash(pos)).not.toContain('{');
  });

  it('駒の配置が同じでも候補が違えば別の局面として扱う', () => {
    const base = quantumInit(initPosition(hondou));
    const target = base.board[6][2]!;
    const narrowed = withBoardPiece(base, 6, 2, {
      ...target,
      candidates: new Set(Array.from(target.candidates!).slice(0, 3)),
    });

    // 盤の見た目 (駒の位置・持ち駒・手番) は完全に同じ
    expect(positionHash(narrowed)).not.toBe(positionHash(base));
  });

  it('候補まで含めて完全に同じなら同じハッシュ', () => {
    const a = quantumInit(initPosition(hondou));
    const b = quantumInit(initPosition(hondou));
    expect(positionHash(a)).toBe(positionHash(b));
  });

  it('候補の並び順が違っても同じハッシュ (集合として比べる)', () => {
    const base = quantumInit(initPosition(hondou));
    const target = base.board[6][2]!;
    const ids = Array.from(target.candidates!);
    const a = withBoardPiece(base, 6, 2, { ...target, candidates: new Set(ids) });
    const b = withBoardPiece(base, 6, 2, { ...target, candidates: new Set([...ids].reverse()) });

    expect(positionHash(a)).toBe(positionHash(b));
  });
});
