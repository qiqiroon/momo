/**
 * ★v1.93: 読み方の改良 (置換表・キラー手と履歴・王手の延長・詰み探索)。
 *
 * どれも「同じ手を同じ点数で読む」ための工夫なので、ここで固定するのは
 *   - 改良を入れても**指す手が合法**で、**詰みの点の付け方が狂わない**こと
 *   - 詰み探索が**本物の詰み**を見つけること (見つけた手で本当に詰むかを総当たりで確かめる)
 * 強くなったかどうかは検査ではなく強さ比べ (src/selfplay) で測る。
 */

import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import { isInCheck } from '../../core/engine/moves/check';
import type { PieceInstance, Position } from '../../core/engine/position/types';
import { fromTt, searchBestMove, toTt, type SearchFeatures } from './search';
import { MATE_VALUE } from './evaluate';

const ALL: SearchFeatures = { tt: true, killers: true, checkExtension: true, mateSearch: true };
const FIXED = { jitter: 0, random: () => 0, movetimeMs: 600000 };

function pc(id: string, kind: string, owner: 'player1' | 'player2', row = 0, col = 0): PieceInstance {
  return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}

/**
 * 3 手詰め (1 手では詰まない)。後手玉 1 一・先手の歩 1 四・先手の持ち駒 角と金。
 * 2026-10-01 に総当たりで「1 手詰めは無く、3 手詰めはある」ことを確かめて選んだ局面。
 */
function tsume3(): Position {
  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
  board[0][8] = pc('k', 'ou', 'player2', 0, 8);
  board[8][0] = pc('K', 'ou', 'player1', 8, 0);
  board[3][8] = pc('F', 'fu', 'player1', 3, 8);
  return {
    width: 9,
    height: 9,
    board,
    hands: { player1: [pc('H0', 'kaku', 'player1'), pc('H1', 'kin', 'player1')], player2: [] },
    sideToMove: 'player1',
    moveNumber: 1,
    history: [],
  };
}

/** 総当たり: 手番の側が王手だけで `plies` 手以内に詰ませられるか。 */
function mateIn(pos: Position, plies: number): boolean {
  for (const m of generateLegalMoves(hondou, pos)) {
    const n = applyMove(hondou, pos, m);
    if (!isInCheck(hondou, n, n.sideToMove)) continue;
    const replies = generateLegalMoves(hondou, n);
    if (replies.length === 0) return true;
    if (plies >= 3 && replies.every((r) => mateIn(applyMove(hondou, n, r), plies - 2))) return true;
  }
  return false;
}

/** 中盤の局面をいくつか (決まった手順で進める)。 */
function middles(): Position[] {
  const out: Position[] = [];
  for (const step of [7, 11, 13]) {
    let pos = initPosition(hondou);
    for (let i = 0; i < 24; i++) {
      const ms = generateLegalMoves(hondou, pos);
      pos = applyMove(hondou, pos, ms[(i * step) % ms.length]);
    }
    out.push(pos);
  }
  return out;
}

describe('読み方の改良 (★v1.93)', { timeout: 120_000 }, () => {
  it('前提: 選んだ局面は 1 手では詰まず、3 手で詰む', () => {
    expect(mateIn(tsume3(), 1)).toBe(false);
    expect(mateIn(tsume3(), 3)).toBe(true);
  });

  it('詰み探索は、浅くしか読まない設定でも 3 手詰めを見つけ、その手で本当に詰む', () => {
    const pos = tsume3();
    const r = searchBestMove(hondou, pos, { ...FIXED, maxDepth: 2, features: { mateSearch: true } });
    expect(r.score).toBe(MATE_VALUE - 3);
    const after = applyMove(hondou, pos, r.move!);
    expect(isInCheck(hondou, after, 'player2')).toBe(true);
    for (const reply of generateLegalMoves(hondou, after)) {
      expect(mateIn(applyMove(hondou, after, reply), 1)).toBe(true);
    }
    // 詰み探索を切ると、同じ深さでは見つからない (効き目の見本)
    const off = searchBestMove(hondou, pos, { ...FIXED, maxDepth: 2 });
    expect(off.score).toBeLessThan(MATE_VALUE - 1000);
  });

  it('置換表を入れても、詰みまでの手数が狂わない (手数の直し方の確かめ)', () => {
    for (const features of [{}, { tt: true }, { tt: true, killers: true }, { tt: true, checkExtension: true }]) {
      const r = searchBestMove(hondou, tsume3(), { ...FIXED, maxDepth: 5, features });
      expect(r.score).toBe(MATE_VALUE - 3);
    }
  });

  it('置換表の詰みの点は「その局面から何手で詰むか」に直して入れ、取り出すときに戻す', () => {
    // 根から 7 手目で詰ませる点 (MATE - 7) を、根から 3 手目の局面で覚えた＝その局面からは 4 手。
    const stored = toTt(MATE_VALUE - 7, 3);
    expect(stored).toBe(MATE_VALUE - 4);
    // 同じ局面に根から 5 手目で来たら、根から 9 手目で詰む。
    expect(fromTt(stored, 5)).toBe(MATE_VALUE - 9);
    // 詰まされる側も同じ (向きだけ逆)。
    expect(fromTt(toTt(-MATE_VALUE + 6, 2), 4)).toBe(-MATE_VALUE + 8);
    // 詰みでない点はそのまま。
    expect(fromTt(toTt(321, 3), 7)).toBe(321);
  });

  it('置換表を入れても、読み切った点は入れないときと同じ (結論が窓の外のときだけ使う)', () => {
    // 2026-10-01 実測: 置換表の「これ以上」を正確な値として使うと、(5, 30) の深さ 4 で点が変わる。
    for (const [step, plies, depth] of [[5, 30, 4], [7, 16, 3], [11, 30, 3], [13, 44, 3]] as const) {
      let pos = initPosition(hondou);
      for (let i = 0; i < plies; i++) {
        const ms = generateLegalMoves(hondou, pos);
        pos = applyMove(hondou, pos, ms[(i * step) % ms.length]);
      }
      const off = searchBestMove(hondou, pos, { ...FIXED, maxDepth: depth });
      const on = searchBestMove(hondou, pos, { ...FIXED, maxDepth: depth, features: { tt: true } });
      expect(on.score).toBe(off.score);
    }
  });

  it('どの改良を入れても、指す手は合法', () => {
    for (const pos of [initPosition(hondou), ...middles()]) {
      const legal = generateLegalMoves(hondou, pos).map((m) => JSON.stringify(m));
      for (const features of [{ tt: true }, { killers: true }, { checkExtension: true }, { mateSearch: true }, ALL]) {
        const r = searchBestMove(hondou, pos, { ...FIXED, maxDepth: 64, maxNodes: 4000, features });
        expect(legal).toContain(JSON.stringify(r.move));
      }
    }
  });

  it('置換表は、同じ深さまで読むのに要る局面の数を減らす', () => {
    let base = 0;
    let tt = 0;
    for (const pos of middles()) {
      base += searchBestMove(hondou, pos, { ...FIXED, maxDepth: 4 }).nodes;
      tt += searchBestMove(hondou, pos, { ...FIXED, maxDepth: 4, features: { tt: true } }).nodes;
    }
    expect(tt).toBeLessThan(base);
  });
});
