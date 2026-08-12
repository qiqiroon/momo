import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { applyUchifuTsumeExclusion } from './drop-effects';
import './index';

/**
 * 詰み判定に必要な駒だけを置いた検証用の盤面を組み立てる。
 *
 * ★v1.19 (Phase 5-15): 身元の個数のつじつまを合わせる必要ができた。
 * 打ち歩詰めの判定が「候補更新を通した安定状態」で行われるようになった (§Q15.5) ため、
 * この盤面自体が候補更新にかけられる。駒と身元は元の所属ごとに 1 対 1 対応しなければ
 * ならない (C-303) ので、つじつまが合っていないと矛盾として弾かれ、検査したい所まで
 * 到達しない。**元後手 3 枚 = 身元 3 個 / 元先手 2 枚 = 身元 2 個**で組む。
 *
 * あわせて「歩は元の筋を離れない」(C-108) にも配慮する。打った駒は履歴に打つ手を
 * 入れて縛りの対象外にし (v1.15)、もう一方の担い手は歩の身元の元の筋に置く。
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

  // 打った駒 1二 (1,0): 先手が取った後手駒。歩とも金とも決まっていない。
  // 身元は後手歩そのもの (pieceId=goteFu) を使う。別の名前を付けると身元が 1 個増えて
  // 駒数と合わなくなる。
  const shared = new Set([goteFu.pieceId, goteKin.pieceId]);
  board[1][0] = { ...goteFu, owner: 'player1', kind: 'fu', candidates: shared, confirmed: false };

  // もう一方の担い手 (後手金の身元)。歩の身元も担えるよう、その歩の元の筋に置く
  // (別の筋に置くと C-108 でここから歩の可能性が落ち、打った駒が歩に確定してしまう)。
  board[5][goteFu.initialSquare.col] = {
    ...goteKin,
    owner: 'player2',
    candidates: shared,
    confirmed: false,
  };

  return {
    pos: {
      ...src,
      board,
      hands: { player1: [], player2: [] },
      sideToMove: 'player2',
      // 打った駒は「歩は元の筋を離れない」の対象外 (v1.15)。履歴に打つ手を入れて明示する。
      history: [{ type: 'drop', pieceId: goteFu.pieceId, to: { row: 1, col: 0 } }],
    },
    fuPid: goteFu.pieceId,
    kinPid: goteKin.pieceId,
  };
}

describe('features/quantum/drop-effects (v1.09 打ち歩詰めからの絞り込み)', () => {
  it('詰みになる手が打てた = 打ち歩詰めではない = その駒は歩ではない', () => {
    const { pos, fuPid, kinPid } = buildMatePosition({ withKyo: true });

    const next = applyUchifuTsumeExclusion(pos, hondou, fuPid, { row: 1, col: 0 });

    const after = next.board[1][0]!.candidates!;
    expect(after.has(fuPid)).toBe(false);
    expect(after.has(kinPid)).toBe(true);
  });

  it('詰みでなければ何も絞られない', () => {
    // 香を外すと 2 一 (0,1) へ逃げられるので詰みではない
    const { pos, fuPid } = buildMatePosition({ withKyo: false });

    const next = applyUchifuTsumeExclusion(pos, hondou, fuPid, { row: 1, col: 0 });

    expect(next).toBe(pos);
    expect(next.board[1][0]!.candidates!.has(fuPid)).toBe(true);
  });

  it('歩の可能性が無い駒には何もしない', () => {
    const { pos, fuPid, kinPid } = buildMatePosition({ withKyo: true });
    const dropped = pos.board[1][0]!;
    const staged: Position = {
      ...pos,
      board: pos.board.map((r, ri) =>
        ri === 1 ? r.map((c, ci) => (ci === 0 ? { ...dropped, candidates: new Set([kinPid]) } : c)) : r,
      ),
    };

    expect(applyUchifuTsumeExclusion(staged, hondou, fuPid, { row: 1, col: 0 })).toBe(staged);
  });

  it('本将棋モード (候補集合なし) では何もしない', () => {
    const { pos, fuPid } = buildMatePosition({ withKyo: true });
    const dropped = pos.board[1][0]!;
    const staged: Position = {
      ...pos,
      board: pos.board.map((r, ri) =>
        ri === 1
          ? r.map((c, ci) => (ci === 0 ? { ...dropped, candidates: undefined, confirmed: undefined } : c))
          : r,
      ),
    };

    expect(applyUchifuTsumeExclusion(staged, hondou, fuPid, { row: 1, col: 0 })).toBe(staged);
  });
});
