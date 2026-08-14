/**
 * 手合い (駒落ち) — 親仕様 §3.12.1 (Phase 3-3)。
 *
 * 落とすのは上手側の駒だけ・番号は落としたあとに詰めて振る・先手は落とした側、
 * の 3 点を局面の側から確かめる。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from './mgf/loader';
import { initPosition } from './position/init';
import { listHandicaps, supportsHandicap, findHandicap } from './handicap';
import { quantumInit } from '../../features/quantum/init';
import type { PieceInstance, Position } from './position/types';
import type { Player } from './mgf/types';

function piecesOf(pos: Position, owner: Player): PieceInstance[] {
  const out: PieceInstance[] = [];
  for (const row of pos.board) for (const cell of row) if (cell && cell.owner === owner) out.push(cell);
  return out;
}

describe('手合いの一覧 (ルール定義側)', () => {
  it('本将棋は 6 種類の駒落ちを持つ', () => {
    expect(supportsHandicap(hondou)).toBe(true);
    expect(listHandicaps(hondou).map((h) => h.id)).toEqual(['kyo', 'kaku', 'hi', 'ni', 'yon', 'roku']);
  });

  it('落とす駒はすべて実在する駒種で、枚数は 1 枚以上', () => {
    const ids = new Set(hondou.pieces.map((p) => p.id));
    for (const type of listHandicaps(hondou)) {
      expect(type.remove.length).toBeGreaterThan(0);
      for (const entry of type.remove) {
        expect(ids.has(entry.piece)).toBe(true);
        expect(entry.count ?? 1).toBeGreaterThan(0);
      }
    }
  });

  it('無い手合いを指定したら弾く', () => {
    expect(findHandicap(hondou, 'nanamai')).toBeUndefined();
    expect(() => initPosition(hondou, undefined, { typeId: 'nanamai', giver: 'player1' })).toThrow();
  });
});

describe('駒落ちの初期局面', () => {
  it('平手は 40 枚・先手から (従来どおり)', () => {
    const pos = initPosition(hondou);
    expect(piecesOf(pos, 'player1')).toHaveLength(20);
    expect(piecesOf(pos, 'player2')).toHaveLength(20);
    expect(pos.sideToMove).toBe('player1');
  });

  it('二枚落ちは上手の飛車と角だけが消える', () => {
    const pos = initPosition(hondou, undefined, { typeId: 'ni', giver: 'player1' });
    const p1 = piecesOf(pos, 'player1');
    const p2 = piecesOf(pos, 'player2');
    expect(p1).toHaveLength(18);
    expect(p2).toHaveLength(20); // 下手は減らない
    expect(p1.some((p) => p.kind === 'hi')).toBe(false);
    expect(p1.some((p) => p.kind === 'kaku')).toBe(false);
    expect(p2.some((p) => p.kind === 'hi')).toBe(true);
    expect(p2.some((p) => p.kind === 'kaku')).toBe(true);
  });

  it('落とす側は相手にもできる (自分落ち)', () => {
    const pos = initPosition(hondou, undefined, { typeId: 'ni', giver: 'player2' });
    expect(piecesOf(pos, 'player1')).toHaveLength(20);
    expect(piecesOf(pos, 'player2')).toHaveLength(18);
  });

  it('先手は駒を落とした側 (上手)', () => {
    expect(initPosition(hondou, undefined, { typeId: 'ni', giver: 'player1' }).sideToMove).toBe('player1');
    expect(initPosition(hondou, undefined, { typeId: 'ni', giver: 'player2' }).sideToMove).toBe('player2');
  });

  it('香落ちは上手から見て左の香が消える', () => {
    // player1 は盤の下側を向くので、左は列番号の小さい側 (9 筋)
    const p1 = initPosition(hondou, undefined, { typeId: 'kyo', giver: 'player1' });
    expect(p1.board[8][0]).toBeNull();
    expect(p1.board[8][8]?.kind).toBe('kyo');
    // player2 は逆を向くので、左は列番号の大きい側 (1 筋)
    const p2 = initPosition(hondou, undefined, { typeId: 'kyo', giver: 'player2' });
    expect(p2.board[0][8]).toBeNull();
    expect(p2.board[0][0]?.kind).toBe('kyo');
  });

  it('六枚落ちは飛角と両香・両桂の 6 枚が消える', () => {
    const pos = initPosition(hondou, undefined, { typeId: 'roku', giver: 'player1' });
    const p1 = piecesOf(pos, 'player1');
    expect(p1).toHaveLength(14);
    for (const kind of ['hi', 'kaku', 'kyo', 'kei']) {
      expect(p1.some((p) => p.kind === kind)).toBe(false);
    }
  });

  it('通し番号は落としたあとに詰めて振る (欠番を作らない)', () => {
    const pos = initPosition(hondou, undefined, { typeId: 'yon', giver: 'player1' });
    const ids = piecesOf(pos, 'player1').map((p) => p.pieceId).sort();
    expect(ids).toHaveLength(16);
    const numbers = ids.map((id) => Number(id.slice(1))).sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 16 }, (_, i) => i));
    // 下手側は 20 枚のまま
    expect(piecesOf(pos, 'player2')).toHaveLength(20);
  });
});

describe('駒落ち × 量子', () => {
  it('候補は落としたあとの駒から作られる (その分だけ減る)', () => {
    const pos = quantumInit(initPosition(hondou, undefined, { typeId: 'ni', giver: 'player1' }));
    const p1 = piecesOf(pos, 'player1');
    const p2 = piecesOf(pos, 'player2');
    expect(p1[0].candidates?.size).toBe(18);
    expect(p2[0].candidates?.size).toBe(20);
  });
});
