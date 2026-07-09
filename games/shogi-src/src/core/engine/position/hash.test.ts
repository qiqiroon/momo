import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';
import { applyMove } from './apply';
import type { BoardMove } from './types';
import { positionHash } from './hash';

describe('positionHash', () => {
  it('is deterministic (same position → same hash)', () => {
    const pos1 = initPosition(hondou);
    const pos2 = initPosition(hondou);
    expect(positionHash(pos1)).toBe(positionHash(pos2));
  });

  it('changes after a move', () => {
    const pos0 = initPosition(hondou);
    const h0 = positionHash(pos0);
    const move: BoardMove = {
      type: 'move',
      pieceId: pos0.board[6][2]!.pieceId,
      from: { row: 6, col: 2 },
      to: { row: 5, col: 2 },
      promote: false,
    };
    const pos1 = applyMove(hondou, pos0, move);
    const h1 = positionHash(pos1);
    expect(h1).not.toBe(h0);
  });

  it('includes sideToMove: 76歩 and reverse resets both need different hashes even if board equal', () => {
    const pos0 = initPosition(hondou);
    const fakeReverse = { ...pos0, sideToMove: 'player2' as const };
    expect(positionHash(pos0)).not.toBe(positionHash(fakeReverse));
  });

  it('includes hand pieces: distinguishes empty hand vs non-empty', () => {
    const pos0 = initPosition(hondou);
    const withHand = {
      ...pos0,
      hands: {
        player1: [
          {
            pieceId: 'X',
            kind: 'fu',
            owner: 'player1' as const,
            initialOwner: 'player2' as const,
            promoted: false,
          },
        ],
        player2: [],
      },
    };
    expect(positionHash(pos0)).not.toBe(positionHash(withHand));
  });
});
