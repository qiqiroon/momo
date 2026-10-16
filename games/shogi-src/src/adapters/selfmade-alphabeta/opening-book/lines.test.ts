/**
 * ★v1.84 §7.3.7: 定石の手順が全部、本将棋の平手で指せる手かを確かめる。
 *
 * 1 本でも指せない手・どの駒か決まらない手があれば、どの手順の何手目かを出して赤にする。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../../../core/engine/mgf/loader';
import { initPosition } from '../../../core/engine/position/init';
import { BOOK_LINES } from './lines';
import { parseLine, parseMoveToken, NotationError } from './notation';

describe('定石の手順 (★v1.84 §7.3.7)', () => {
  it('名前が重ならない', () => {
    const names = BOOK_LINES.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const line of BOOK_LINES) {
    it(`${line.name} は全部指せる手`, () => {
      const parsed = parseLine(hondou, initPosition(hondou), line.moves);
      expect(parsed.moves.length).toBe(line.moves.trim().split(/\s+/).length);
    });
  }

  it('指せない手・決まらない手は誤りとして止める (読み取り役そのものの確かめ)', () => {
    const init = initPosition(hondou);
    // 指せない手 (歩は 2 マス進めない)
    expect(() => parseMoveToken(hondou, init, '75歩', null)).toThrow(NotationError);
    // どの駒か決まらない (5 八へは 6 九と 4 九の金が行ける)
    expect(() => parseMoveToken(hondou, init, '58金', null)).toThrow(/決まらない/);
    // 書き分ければ決まる
    const right = parseMoveToken(hondou, init, '58金右', null);
    expect(right.type === 'move' && right.from).toEqual({ row: 8, col: 5 });
    const left = parseMoveToken(hondou, init, '58金左', null);
    expect(left.type === 'move' && left.from).toEqual({ row: 8, col: 3 });
  });
});
