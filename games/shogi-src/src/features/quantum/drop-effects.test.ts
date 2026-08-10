import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { applyUchifuTsumeExclusion } from './drop-effects';
import './index';

/**
 * 詰み判定に必要な駒だけを置いた検証用の盤面を組み立てる。
 *
 * 注意: この盤面は候補の個数のつじつま (同じ身元を複数の駒が候補に持つ等) は合わせていない。
 * applyUchifuTsumeExclusion が見るのは「詰みかどうか」と「候補の中身」だけなので、
 * ここではそれで足りる。個数のつじつまは C-002 / C-302 側のテストの担当。
 */
function pieceOfKind(pos: Position, owner: 'player1' | 'player2', kind: string): PieceInstance {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === owner && cell.initialKind === kind) return cell;
    }
  }
  throw new Error(`no ${owner} piece with initialKind=${kind}`);
}

interface Placed {
  pos: Position;
  fuPid: PieceId;
  kinPid: PieceId;
}

function buildMatePosition(opts: { withKyo: boolean }): Placed {
  const src = initPosition(hondou);
  const goteOu = pieceOfKind(src, 'player2', 'ou');
  const goteFu = pieceOfKind(src, 'player2', 'fu');
  const goteKin = pieceOfKind(src, 'player2', 'kin');
  const senteKin = pieceOfKind(src, 'player1', 'kin');
  const senteKyo = pieceOfKind(src, 'player1', 'kyo');

  const confirmed = (p: PieceInstance, owner: 'player1' | 'player2'): PieceInstance => ({
    ...p,
    owner,
    candidates: new Set([p.pieceId]),
    confirmed: true,
  });

  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as PieceInstance | null),
  );

  // 後手玉 1一 (0,0)
  board[0][0] = confirmed(goteOu, 'player2');
  // 先手金 1三 (2,0): 打った駒 (1,0) を支え、逃げ場 (1,1) も塞ぐ
  board[2][0] = confirmed(senteKin, 'player1');
  // 先手香 2五 (4,1): 2 筋を上に利かせて逃げ場 (0,1) を塞ぐ
  if (opts.withKyo) board[4][1] = confirmed(senteKyo, 'player1');

  // 候補 PieceID の解決先として、遠くに後手駒を 2 枚置く (詰みには関与しない位置)
  const shared = new Set([goteFu.pieceId, goteKin.pieceId]);
  board[0][8] = { ...goteFu, owner: 'player2', candidates: shared, confirmed: false };
  board[1][8] = { ...goteKin, owner: 'player2', candidates: shared, confirmed: false };

  // 打った駒 1二 (1,0): 先手が取った後手駒。歩とも金とも決まっていない
  board[1][0] = {
    ...goteFu,
    pieceId: 'DROPPED',
    owner: 'player1',
    kind: 'fu',
    initialSquare: { row: -1, col: -1 },
    promoted: false,
    candidates: new Set([goteFu.pieceId, goteKin.pieceId]),
    confirmed: false,
  };

  return {
    pos: {
      ...src,
      board,
      hands: { player1: [], player2: [] },
      sideToMove: 'player2',
    },
    fuPid: goteFu.pieceId,
    kinPid: goteKin.pieceId,
  };
}

describe('features/quantum/drop-effects (v1.09 打ち歩詰めからの絞り込み)', () => {
  it('詰みになる手が打てた = 打ち歩詰めではない = その駒は歩ではない', () => {
    const { pos, fuPid, kinPid } = buildMatePosition({ withKyo: true });

    const next = applyUchifuTsumeExclusion(pos, hondou, 'DROPPED', { row: 1, col: 0 });

    const after = next.board[1][0]!.candidates!;
    expect(after.has(fuPid)).toBe(false);
    expect(after.has(kinPid)).toBe(true);
  });

  it('詰みでなければ何も絞られない', () => {
    // 香を外すと 2 一 (0,1) へ逃げられるので詰みではない
    const { pos, fuPid } = buildMatePosition({ withKyo: false });

    const next = applyUchifuTsumeExclusion(pos, hondou, 'DROPPED', { row: 1, col: 0 });

    expect(next).toBe(pos);
    expect(next.board[1][0]!.candidates!.has(fuPid)).toBe(true);
  });

  it('歩の可能性が無い駒には何もしない', () => {
    const { pos, kinPid } = buildMatePosition({ withKyo: true });
    const dropped = pos.board[1][0]!;
    const staged: Position = {
      ...pos,
      board: pos.board.map((r, ri) =>
        ri === 1 ? r.map((c, ci) => (ci === 0 ? { ...dropped, candidates: new Set([kinPid]) } : c)) : r,
      ),
    };

    expect(applyUchifuTsumeExclusion(staged, hondou, 'DROPPED', { row: 1, col: 0 })).toBe(staged);
  });

  it('本将棋モード (候補集合なし) では何もしない', () => {
    const { pos } = buildMatePosition({ withKyo: true });
    const dropped = pos.board[1][0]!;
    const staged: Position = {
      ...pos,
      board: pos.board.map((r, ri) =>
        ri === 1
          ? r.map((c, ci) => (ci === 0 ? { ...dropped, candidates: undefined, confirmed: undefined } : c))
          : r,
      ),
    };

    expect(applyUchifuTsumeExclusion(staged, hondou, 'DROPPED', { row: 1, col: 0 })).toBe(staged);
  });
});
