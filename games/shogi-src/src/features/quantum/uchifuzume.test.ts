import { describe, it, expect } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import type { Move, PieceInstance, Position } from '../../core/engine/position/types';
import { applyMove } from '../../core/engine/position/apply';
import { isCheckmate, isMoveLegal } from '../../core/engine/moves/legal';
import { candidateUpdate } from './candidate-update';
import './index';

/**
 * Phase 5-15 打ち歩詰めの候補依存判定 (§Q15)。
 *
 * ★この段にも専用モジュール (計画書が挙げていた uchifuzume.ts) は作っていない。
 * 打ち歩詰めの禁止は core/engine/moves/legal.ts、そこから引き出す絞り込み (C-110) は
 * drop-effects.ts に既にあり、5-15 で直したのは**判定を行う局面**だけだから。
 *
 * §Q15.5 は「打たれた歩が確定歩となった**安定状態**」で詰みを見よ、と定めている。
 * 候補更新は候補を減らすだけなので相手の逃げ道は減る方向にしか動かない。よって
 * 通さない判定は**打ち歩詰めを見逃す側**にだけ外れる (打てるはずの手を禁じる誤りは
 * 起きない)。この検査はその差が実際に出る盤面を 1 つ固定する。
 */

/** 元の駒から身元・初期情報を引き継いだ検査用の駒を作る。 */
function from(
  src: PieceInstance,
  owner: 'player1' | 'player2',
  candidates: string[],
): PieceInstance {
  return {
    ...src,
    owner,
    promoted: false,
    candidates: new Set(candidates),
    confirmed: candidates.length === 1,
  };
}

function pieceOfKind(pos: Position, owner: 'player1' | 'player2', kind: string): PieceInstance {
  for (const row of pos.board) {
    for (const cell of row) {
      if (cell && cell.initialOwner === owner && cell.initialKind === kind) return cell;
    }
  }
  throw new Error(`no ${owner} piece with initialKind=${kind}`);
}

/**
 * 「候補更新を通すかどうかで詰みかが変わる」盤面。
 *
 * 後手玉 1一(0,0) に先手が 1二(1,0) へ歩を打って王手。玉の逃げ場は
 * 先手金 1三(2,0) と先手香 2五(4,1) で塞いである。残る逃げ道は
 * **後手 X (3,2) がその歩を取ること**だけ。
 *
 * X の候補は {角, 桂}。角なら (2,1) を通って (1,0) の歩を取れるが、桂では届かない。
 * ところが後手 Y は角に確定しているので、**候補更新を通せば X から角が落ちる**
 * (C-107 確定除外 / C-303 割り当て整合)。つまり:
 *   - 通さない → X が角として歩を取れる → 詰みではない → 打ててしまう
 *   - 通す → X は桂しかない → 逃げ道なし → 詰み → 打ち歩詰めで打てない
 *
 * 身元の数のつじつまも合わせてある (元後手 3 枚=玉/角/桂の 3 身元、
 * 元先手 3 枚=歩/金/香の 3 身元)。合っていないと C-303 が矛盾として弾く。
 */
function buildPosition(): { pos: Position; drop: Move } {
  const src = initPosition(hondou);
  const goteOu = pieceOfKind(src, 'player2', 'ou');
  const goteKaku = pieceOfKind(src, 'player2', 'kaku');
  const goteKei = pieceOfKind(src, 'player2', 'kei');
  const senteFu = pieceOfKind(src, 'player1', 'fu');
  const senteKin = pieceOfKind(src, 'player1', 'kin');
  const senteKyo = pieceOfKind(src, 'player1', 'kyo');

  const board: (PieceInstance | null)[][] = Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => null as PieceInstance | null),
  );

  board[0][0] = from(goteOu, 'player2', [goteOu.pieceId]);
  // X: 角か桂か決まっていない。角なら (1,0) の歩を取れる
  board[3][2] = from(goteKei, 'player2', [goteKaku.pieceId, goteKei.pieceId]);
  // Y: 角に確定。X から角の可能性を落とす引き金 (詰みには直接関与しない位置)
  board[8][8] = from(goteKaku, 'player2', [goteKaku.pieceId]);

  board[2][0] = from(senteKin, 'player1', [senteKin.pieceId]);
  board[4][1] = from(senteKyo, 'player1', [senteKyo.pieceId]);

  return {
    pos: {
      ...src,
      board,
      hands: { player1: [from(senteFu, 'player1', [senteFu.pieceId])], player2: [] },
      sideToMove: 'player1',
      history: [],
    },
    drop: { type: 'drop', pieceId: senteFu.pieceId, to: { row: 1, col: 0 } },
  };
}

describe('Phase 5-15 打ち歩詰めの候補依存判定 (§Q15)', () => {
  it('候補更新を通して初めて詰みになる盤面で、打ち歩詰めとして弾く', () => {
    const { pos, drop } = buildPosition();
    const after = applyMove(hondou, pos, drop);

    // 通さないと「逃げ道がある」ように見える = 以前はここを見ていたので打ててしまった
    expect(isCheckmate(hondou, after)).toBe(false);

    // 通すと逃げ道が消えて詰み
    const settled = candidateUpdate(after, hondou);
    expect(isCheckmate(hondou, settled)).toBe(true);

    // よってこの歩は打てない (§Q15.3)
    expect(isMoveLegal(hondou, pos, drop)).toBe(false);
  });

  it('同じ盤面でも、逃げ道を持つ駒が角に確定していれば打てる (裏取り)', () => {
    // X を角に確定させると歩を取れるので詰みではなく、打ち歩詰めにもならない。
    // 「弾いたのは詰みだからだ」を裏から確かめる (Y は桂に回す=身元の数は保つ)。
    const { pos, drop } = buildPosition();
    const x = pos.board[3][2]!;
    const y = pos.board[8][8]!;
    const kakuId = y.pieceId;
    const keiId = x.pieceId;
    const board = pos.board.map((r) => r.slice());
    board[3][2] = { ...x, candidates: new Set([kakuId]), confirmed: true };
    board[8][8] = { ...y, candidates: new Set([keiId]), confirmed: true };
    const swapped: Position = { ...pos, board };

    expect(isMoveLegal(hondou, swapped, drop)).toBe(true);
  });
});
