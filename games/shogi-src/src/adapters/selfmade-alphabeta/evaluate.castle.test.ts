/**
 * ★v1.85 §7.3.6.7: 美濃の仲間の形の加点。
 *
 * 美濃 (玉 2 八・銀 3 八・金 4 九) で、玉が 3 九へ潜ると守り駒が 1 枚増えて得に見えていた。
 * 形がそろっているときは定位置の玉に加点し、危ないマスが 2 つ以上なら付けない。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { KING_SAFETY_WEIGHTS as W, buildValueBook, evaluate, inCastleShape } from './evaluate';

function pc(id: string, kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}
/** 先手から見た筋・段 → 内部の座標。 */
const at = (x: number, y: number) => ({ row: y - 1, col: 9 - x });
const P = (id: string, kind: string, owner: 'player1' | 'player2', x: number, y: number) => pc(id, kind, owner, at(x, y).row, at(x, y).col);

function make(pieces: PieceInstance[]): Position {
  const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return { width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove: 'player1', moveNumber: 1, history: [] };
}
const ev = (pos: Position, castle = W.castle) =>
  evaluate(hondou, pos, buildValueBook(hondou, pos, { kingSafetyStandard: { castle } }));

/** 先手の美濃 (玉の位置だけ変える)。香・桂・歩もいる実戦の形＝周りの駒はどちらの位置でも上限 (3 枚) に届く。後手の玉は遠くに置く。 */
const mino = (kx: number, ky: number, extra: PieceInstance[] = []) =>
  make([P('K', 'ou', 'player1', kx, ky), P('S', 'gin', 'player1', 3, 8), P('G', 'kin', 'player1', 4, 9), P('L', 'kyo', 'player1', 1, 9), P('N', 'kei', 'player1', 2, 9), P('F', 'fu', 'player1', 2, 7), P('k', 'ou', 'player2', 9, 1), ...extra]);

describe('美濃の形の加点 (★v1.85 §7.3.6.7)', () => {
  it('美濃で玉が 2 八にいれば、そのぶん加点される', () => {
    expect(ev(mino(2, 8)) - ev(mino(2, 8), 0)).toBe(W.castle);
  });

  it('玉が 3 九へ潜ると加点は無い (定位置ではない)', () => {
    expect(ev(mino(3, 9)) - ev(mino(3, 9), 0)).toBe(0);
  });

  it('加点があると、2 八のほうが 3 九より高い (加点が無いと 3 九が守り駒 1 枚ぶん高い)', () => {
    expect(ev(mino(3, 9), 0) - ev(mino(2, 8), 0)).toBe(W.defender);
    expect(ev(mino(2, 8))).toBeGreaterThan(ev(mino(3, 9)));
  });

  it('玉の周りの危ないマスが 2 つ以上なら加点しない (1 つなら加点する)', () => {
    // 後手の香を 1 筋に置くと 1 七・1 八 (玉の周り) に利く＝危ないマス 2 つ。
    const two = mino(2, 8, [P('l', 'kyo', 'player2', 1, 5)]);
    expect(ev(two) - ev(two, 0)).toBe(0);
    // 後手の歩 1 枚が 2 七の手前 (2 六) にいる＝2 七だけが危ない。
    const one = mino(2, 8, [P('p', 'fu', 'player2', 2, 6)]);
    expect(ev(one) - ev(one, 0)).toBe(W.castle);
  });

  it('後手の美濃 (玉 8 二・銀 7 二・金 6 一) も同じに数える', () => {
    const pos = make([P('k', 'ou', 'player2', 8, 2), P('s', 'gin', 'player2', 7, 2), P('g', 'kin', 'player2', 6, 1), P('K', 'ou', 'player1', 1, 9)]);
    // 手番＝先手から見た点なので、後手の加点は先手から見て減点。
    expect(ev(pos) - ev(pos, 0)).toBe(-W.castle);
  });

  it('銀冠・左美濃・居飛車の銀冠も形として見分け、形が欠ければ見分けない', () => {
    const k = (x: number, y: number) => at(x, y);
    const ginkan = make([P('K', 'ou', 'player1', 2, 8), P('S', 'gin', 'player1', 2, 7), P('G', 'kin', 'player1', 3, 8)]);
    expect(inCastleShape(ginkan, k(2, 8), 'player1')).toBe(true);
    const hidari = make([P('K', 'ou', 'player1', 8, 8), P('S', 'gin', 'player1', 7, 8), P('G', 'kin', 'player1', 6, 9)]);
    expect(inCastleShape(hidari, k(8, 8), 'player1')).toBe(true);
    const ibisha = make([P('K', 'ou', 'player1', 8, 8), P('S', 'gin', 'player1', 8, 7), P('G', 'kin', 'player1', 7, 8)]);
    expect(inCastleShape(ibisha, k(8, 8), 'player1')).toBe(true);
    // 金が無い美濃は形ではない。
    const noKin = make([P('K', 'ou', 'player1', 2, 8), P('S', 'gin', 'player1', 3, 8)]);
    expect(inCastleShape(noKin, k(2, 8), 'player1')).toBe(false);
    // 相手の銀では形にならない。
    const enemy = make([P('K', 'ou', 'player1', 2, 8), P('s', 'gin', 'player2', 3, 8), P('G', 'kin', 'player1', 4, 9)]);
    expect(inCastleShape(enemy, k(2, 8), 'player1')).toBe(false);
  });
});
