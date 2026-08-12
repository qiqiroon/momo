import { describe, it, expect } from 'vitest';
import { hondou } from '../mgf/loader';
import { initPosition } from './init';
import { pieceIdListDigest } from './piece-id-hash';

/**
 * Phase 5-12: 駒の身元の並びの突き合わせ (親 §6.5.2)。
 */
describe('pieceIdListDigest', () => {
  it('同じルール定義からは何度作っても同じ値になる', () => {
    expect(pieceIdListDigest(hondou)).toBe(pieceIdListDigest(hondou));
  });

  it('本将棋なら 40 枚ぶん並ぶ', () => {
    expect(pieceIdListDigest(hondou).split('|')).toHaveLength(40);
  });

  it('盤上の全駒が 1 回ずつ現れる (取りこぼし・重複がない)', () => {
    const digest = pieceIdListDigest(hondou);
    const pos = initPosition(hondou);
    const ids: string[] = [];
    for (let row = 0; row < pos.height; row++) {
      for (let col = 0; col < pos.width; col++) {
        const cell = pos.board[row][col];
        if (cell) ids.push(cell.pieceId);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(digest.split('|').filter((e) => e.startsWith(`${id}:`))).toHaveLength(1);
    }
  });

  it('並べ替えても値が変わらない (辞書順に正規化している)', () => {
    // 走査順の実装差で値が変わってしまうと、同じ盤なのに食い違いと誤判定する。
    const entries = pieceIdListDigest(hondou).split('|');
    const shuffled = [...entries].reverse().sort();
    expect(shuffled.join('|')).toBe(pieceIdListDigest(hondou));
  });
});
