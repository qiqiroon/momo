/**
 * ★v1.98: 王の安全 (evaluate.ts kingSafetyScore) の点の付け方。
 *
 * 作り物の局面で、**入りと切りの点の差がちょうど手で数えた値になる**ことを確かめる
 * (駒の損得は両方に同じだけ入るので、差は王の安全の点だけ)。
 * 重みは既定 (KING_SAFETY_WEIGHTS) を使う＝重みを変えたら期待値も直す。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { hondou, hasami } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { Mgf } from '../../core/engine/mgf/types';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { clear as clearPlugins } from '../../core/plugin/registry';
import { KING_SAFETY_WEIGHTS as W, buildValueBook, evaluate } from './evaluate';

afterEach(() => clearPlugins());

function pc(id: string, kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}

function make(pieces: PieceInstance[], hand2: PieceInstance[] = []): Position {
  const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  for (const p of pieces) board[p.initialSquare.row][p.initialSquare.col] = p;
  return { width: 9, height: 9, board, hands: { player1: [], player2: hand2 }, sideToMove: 'player1', moveNumber: 1, history: [] };
}

/** 王の安全の入り − 切り (手番＝先手から見た点)。 */
function ks(mgf: Mgf, pos: Position): number {
  const on = buildValueBook(mgf, pos, { kingSafetyStandard: true });
  const off = buildValueBook(mgf, pos);
  return evaluate(mgf, pos, on) - evaluate(mgf, pos, off);
}

describe('王の安全の点', () => {
  it('相手の飛車が玉の周り 2 マスに利く＝危ないマス 2 つぶん減点', () => {
    // 先手玉 9 段 5 筋 (8,4)。後手の飛車 (5,3) が 3 列目を下まで利かせる＝(7,3)(8,3) が危ない。
    const pos = make([pc('K', 'ou', 'player1', 8, 4), pc('k', 'ou', 'player2', 0, 0), pc('r', 'hi', 'player2', 5, 3)]);
    expect(ks(hondou, pos)).toBe(-2 * W.danger);
  });

  it('相手の持ち駒が多いほど、危ないマスの減点が重くなる', () => {
    const hand = [pc('h1', 'fu', 'player2', -1, -1), pc('h2', 'fu', 'player2', -1, -1)];
    const pos = make([pc('K', 'ou', 'player1', 8, 4), pc('k', 'ou', 'player2', 0, 0), pc('r', 'hi', 'player2', 5, 3)], hand);
    expect(ks(hondou, pos)).toBeCloseTo(-2 * W.danger * (1 + 2 * W.handPerPiece), 6);
  });

  it('逃げ道が 1 つ＝その減点、0＝もっと大きな減点', () => {
    // 先手玉を隅 (8,8) に。後手の飛車 (7,0) が 7 段目を横に利かせる＝(7,7)(7,8) が危ない。
    const one = make([pc('K', 'ou', 'player1', 8, 8), pc('k', 'ou', 'player2', 0, 0), pc('r', 'hi', 'player2', 7, 0)]);
    expect(ks(hondou, one)).toBe(-(2 * W.danger + W.oneEscape));
    // もう 1 枚の飛車 (1,7) で 7 列目も＝(8,7) も危ない＝逃げ道 0。
    const none = make([
      pc('K', 'ou', 'player1', 8, 8),
      pc('k', 'ou', 'player2', 0, 0),
      pc('r', 'hi', 'player2', 7, 0),
      pc('r2', 'hi', 'player2', 1, 7),
    ]);
    expect(ks(hondou, none)).toBe(-(3 * W.danger + W.noEscape));
  });

  it('玉の周りの金・銀は守り駒として加点 (乗っているマスは逃げ道に数えない)', () => {
    // ★v2.07: 金・銀は守り駒の加点と、囲いの駒 1 枚ぶんの加点の両方をもらう。
    const pos = make([pc('K', 'ou', 'player1', 8, 4), pc('k', 'ou', 'player2', 0, 0), pc('G', 'kin', 'player1', 7, 4)]);
    expect(ks(hondou, pos)).toBe(W.defender + W.shell);
  });

  it('★v2.07 玉の周りの自分の駒は、種類を問わず 1 枚ごとに加点 (囲いを保つ力)', () => {
    const pos = make([
      pc('K', 'ou', 'player1', 8, 4),
      pc('k', 'ou', 'player2', 0, 0),
      pc('P', 'fu', 'player1', 7, 4),
      pc('N', 'kei', 'player1', 8, 3),
    ]);
    expect(W.shell).toBeGreaterThan(0);
    expect(ks(hondou, pos)).toBe(2 * W.shell);
  });

  it('★v2.08 囲いの加点は上限の枚数まで (それより多く固めても増えない)', () => {
    // 先手玉 (8,4) の周り 5 マスを自分の歩で埋める (金銀ではないので守り駒の加点は無い)。相手の利きは無い。
    const pos = make([
      pc('K', 'ou', 'player1', 8, 4),
      pc('k', 'ou', 'player2', 0, 0),
      pc('P1', 'fu', 'player1', 7, 3),
      pc('P2', 'fu', 'player1', 7, 4),
      pc('P3', 'fu', 'player1', 7, 5),
      pc('P4', 'fu', 'player1', 8, 3),
      pc('P5', 'fu', 'player1', 8, 5),
    ]);
    expect(W.shellCap).toBe(3);
    expect(ks(hondou, pos)).toBe(W.shellCap * W.shell);
  });

  it('★v2.07 自分の駒で固めた玉は、相手の利きが無いうちは逃げ道 0 でも減点しない', () => {
    // 先手玉を隅 (8,8) に置き、周り 3 マスを自分の歩で埋める (逃げ道 0)。相手の利きは無い。
    const pos = make([
      pc('K', 'ou', 'player1', 8, 8),
      pc('k', 'ou', 'player2', 0, 0),
      pc('P1', 'fu', 'player1', 7, 7),
      pc('P2', 'fu', 'player1', 7, 8),
      pc('P3', 'fu', 'player1', 8, 7),
    ]);
    expect(ks(hondou, pos)).toBe(3 * W.shell);
  });

  it('★v2.07 固めた玉でも、周りに相手の利きが届けば逃げ道 0 の減点が付く', () => {
    // 上と同じ囲いに、後手の飛車 (1,8) が 8 列目を下へ利かせる＝(7,8) の歩に利きが届く。
    const pos = make([
      pc('K', 'ou', 'player1', 8, 8),
      pc('k', 'ou', 'player2', 0, 0),
      pc('P1', 'fu', 'player1', 7, 7),
      pc('P2', 'fu', 'player1', 7, 8),
      pc('P3', 'fu', 'player1', 8, 7),
      pc('r', 'hi', 'player2', 1, 8),
    ]);
    expect(ks(hondou, pos)).toBe(3 * W.shell - W.danger - W.noEscape);
  });

  it('相手の玉の危なさは加点になる (先後で符号が逆)', () => {
    // 上の 1 件目を盤ごと 180 度回して先後を入れ替えた局面。手番は先手のまま。
    const pos = make([pc('k', 'ou', 'player2', 0, 4), pc('K', 'ou', 'player1', 8, 8), pc('R', 'hi', 'player1', 3, 5)]);
    expect(ks(hondou, pos)).toBe(2 * W.danger);
  });

  it('初期局面は先後同じ形なので 0', () => {
    expect(ks(hondou, initPosition(hondou))).toBe(0);
  });

  it('はさみ将棋 (王がいない) は効かない', () => {
    expect(ks(hasami, initPosition(hasami))).toBe(0);
  });

  it('量子 (王がどの駒か決まっていない) は効かない', async () => {
    await import('../../features/quantum');
    const { quantumInit } = await import('../../features/quantum/init');
    const pos = quantumInit(initPosition(hondou));
    // 先手の玉の隣の金をどけて形を崩しても (守り駒・逃げ道が先後で変わる)、量子では数えない。
    const board = pos.board.map((r) => r.slice());
    board[8][3] = null;
    expect(ks(hondou, { ...pos, board })).toBe(0);
  }, 60_000);
});
