import { describe, expect, it } from 'vitest';
import { isEquivalent, makeMove } from '../src/core/move';
import {
  ParseError, formatMove, formatSequence, parseMove, parseSequence, tryParseMove,
} from '../src/core/notation';
import { AXES, type Axis, type Move } from '../src/core/types';
import { SIZES } from './helpers';

const mv = (n: number, axis: Axis, slices: number, turns: Move['turns']) =>
  makeMove(n, axis, slices, turns);

describe('記法の意味（02 §2.2）', () => {
  it('基本の面', () => {
    expect(parseMove('R', 5)).toEqual(mv(5, 'x', 1 << 4, -1));
    expect(parseMove("R'", 5)).toEqual(mv(5, 'x', 1 << 4, 1));
    expect(parseMove('R2', 5)).toEqual(mv(5, 'x', 1 << 4, -2));
    expect(parseMove("R2'", 5)).toEqual(mv(5, 'x', 1 << 4, 2));
    expect(parseMove("R'2", 5)).toEqual(mv(5, 'x', 1 << 4, 2));
    expect(parseMove('L', 5)).toEqual(mv(5, 'x', 1, 1));
    expect(parseMove('U', 3)).toEqual(mv(3, 'y', 4, -1));
    expect(parseMove('D', 3)).toEqual(mv(3, 'y', 1, 1));
    expect(parseMove('F', 3)).toEqual(mv(3, 'z', 4, -1));
    expect(parseMove('B', 3)).toEqual(mv(3, 'z', 1, 1));
  });

  it('深さ・ワイド', () => {
    expect(parseMove('3R', 5)).toEqual(mv(5, 'x', 1 << 2, -1));
    expect(parseMove('Rw', 5)).toEqual(mv(5, 'x', (1 << 4) | (1 << 3), -1));
    expect(parseMove('r', 5)).toEqual(parseMove('Rw', 5));
    expect(parseMove('3Rw', 5)).toEqual(mv(5, 'x', 0b11100, -1));
    expect(parseMove('10L', 10)).toEqual(mv(10, 'x', 1 << 9, 1));
  });

  it('全体回転と中央', () => {
    expect(parseMove('x', 5)).toEqual(mv(5, 'x', 0b11111, -1));
    expect(parseMove('y', 5)).toEqual(mv(5, 'y', 0b11111, -1));
    expect(parseMove("z'", 5)).toEqual(mv(5, 'z', 0b11111, 1));
    expect(parseMove('M', 5)).toEqual(mv(5, 'x', 1 << 2, 1));
    expect(parseMove('E', 3)).toEqual(mv(3, 'y', 1 << 1, 1));
    expect(parseMove('S', 3)).toEqual(mv(3, 'z', 1 << 1, -1));
    expect(parseMove('M', 1)).toEqual(mv(1, 'x', 1, 1));
  });

  it('エラー', () => {
    const reason = (t: string, n: number) => {
      try {
        parseMove(t, n);
      } catch (e) {
        return (e as ParseError).reason;
      }
      return null;
    };
    expect(reason('4R', 3)).toBe('depth-out-of-range');
    expect(reason('4Rw', 3)).toBe('depth-out-of-range');
    expect(reason('Rw', 1)).toBe('width-out-of-range');
    expect(reason('r', 1)).toBe('width-out-of-range');
    expect(reason('M', 4)).toBe('middle-needs-odd');
    expect(reason('Q', 3)).toBe('unknown-token');
    expect(reason('0R', 3)).toBe('unknown-token');
    expect(reason('R3', 3)).toBe('unknown-token');
    expect(tryParseMove('Q', 3)).toBeNull();
  });

  it('手順と位置つきエラー', () => {
    expect(parseSequence("  R U  R' U' ", 3).length).toBe(4);
    try {
      parseSequence('R U Q', 3);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).position).toBe(4);
    }
  });
});

describe('フォーマッタ（02 §2.3）', () => {
  it('短い表記を選ぶ', () => {
    expect(formatMove(mv(3, 'x', 4, -1))).toBe('R');
    expect(formatMove(mv(3, 'x', 4, 1))).toBe("R'");
    expect(formatMove(mv(3, 'x', 1, 1))).toBe('L');
    expect(formatMove(mv(3, 'x', 1, -1))).toBe("L'");
    expect(formatMove(mv(3, 'x', 4, -2))).toBe('R2');
    expect(formatMove(mv(3, 'x', 1, 2))).toBe('L2');
    expect(formatMove(mv(3, 'x', 7, -1))).toBe('x');
    expect(formatMove(mv(3, 'x', 2, 1))).toBe('M');
    expect(formatMove(mv(5, 'x', 0b11000, -1))).toBe('Rw');
    expect(formatMove(mv(5, 'x', 0b11100, -1))).toBe('3Rw');
    expect(formatMove(mv(5, 'x', 0b00010, 1))).toBe('2L');
    expect(formatMove(mv(5, 'x', 0b00100, 1))).toBe('M');
    expect(formatMove(mv(4, 'x', 0b0100, -1))).toBe('2R');
    expect(formatMove(mv(5, 'x', 0b10001, -1))).toBe('x:17:-1');
  });

  it('往復：全 N・全スライス組・全 turns で parse(format(m)) ≡ m（P5）', () => {
    for (const n of SIZES) {
      for (const axis of AXES) {
        for (let s = 1; s < 1 << n; s++) {
          for (const t of [-2, -1, 1, 2] as const) {
            const m = mv(n, axis, s, t);
            const back = parseMove(formatMove(m), n);
            expect(isEquivalent(back, m)).toBe(true);
            expect(back.turns).toBe(m.turns);
          }
        }
      }
    }
  });

  it('formatSequence', () => {
    const seq = parseSequence("R U R' U'", 3);
    expect(formatSequence(seq)).toBe("R U R' U'");
    expect(formatSequence(seq, 2)).toBe("R U\nR' U'");
  });
});
