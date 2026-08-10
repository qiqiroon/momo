import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { register, clear } from '../../core/plugin/registry';
import type { PieceId, PieceInstance, Position } from '../../core/engine/position/types';
import { candidateUpdate, type QuantumConstraint } from './candidate-update';
import { applyC201 } from './capture-effects';
import { quantumInit } from './init';
import { buildInitialInfoMap } from './piece-lookup';
import { applyC301SingleConfirm } from './single-confirm';

/** 盤上の 1 マスの駒を差し替えた Position を返す (null で取り除き)。 */
function withBoardPiece(
  pos: Position,
  row: number,
  col: number,
  piece: PieceInstance | null,
): Position {
  return {
    ...pos,
    board: pos.board.map((r, ri) =>
      ri === row ? r.map((cell, ci) => (ci === col ? piece : cell)) : r,
    ),
  };
}

describe('features/quantum/single-confirm (Phase 5-8 §Q8.7 C-301)', () => {
  afterEach(() => {
    clear();
  });

  it('候補が 1 個の未確定駒は confirmed=true になる', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][4]!;
    const staged = withBoardPiece(pos, 6, 4, {
      ...target,
      candidates: new Set([target.pieceId]),
      confirmed: false,
    });

    const { next, changed } = applyC301SingleConfirm(staged);

    expect(changed).toBe(true);
    expect(next.board[6][4]!.confirmed).toBe(true);
    expect(next.board[6][4]!.candidates!.size).toBe(1);
  });

  it('候補が 2 個以上の駒は確定しない', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][4]!;
    const twoIds = Array.from(target.candidates!).slice(0, 2) as PieceId[];
    const staged = withBoardPiece(pos, 6, 4, { ...target, candidates: new Set(twoIds) });

    const { next, changed } = applyC301SingleConfirm(staged);

    expect(changed).toBe(false);
    expect(next).toBe(staged);
    expect(staged.board[6][4]!.confirmed).toBe(false);
  });

  it('通常将棋モード (候補を持たない駒) は触らない — 縮退互換', () => {
    const pos = initPosition(hondou);

    const { next, changed } = applyC301SingleConfirm(pos);

    expect(changed).toBe(false);
    expect(next).toBe(pos);
    for (const row of next.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates).toBeUndefined();
        expect(cell.confirmed).toBeUndefined();
      }
    }
  });

  it('既に確定済みの駒は作り直さない (identity 保存)', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][4]!;
    const staged = withBoardPiece(pos, 6, 4, {
      ...target,
      candidates: new Set([target.pieceId]),
      confirmed: true,
    });

    const { next, changed } = applyC301SingleConfirm(staged);

    expect(changed).toBe(false);
    expect(next).toBe(staged);
    expect(next.board[6][4]).toBe(staged.board[6][4]);
  });

  it('持ち駒も対象になる', () => {
    const pos = quantumInit(initPosition(hondou));
    const captured: PieceInstance = {
      ...pos.board[6][4]!,
      candidates: new Set([pos.board[6][4]!.pieceId]),
      confirmed: false,
    };
    const staged: Position = {
      ...pos,
      hands: { ...pos.hands, player1: [...pos.hands.player1, captured] },
    };

    const { next, changed } = applyC301SingleConfirm(staged);

    expect(changed).toBe(true);
    expect(next.hands.player1[next.hands.player1.length - 1].confirmed).toBe(true);
  });

  it('確定は一方向 — 候補が 1 個のまま何度回しても false に戻らない (冪等)', () => {
    const pos = quantumInit(initPosition(hondou));
    const target = pos.board[6][4]!;
    const staged = withBoardPiece(pos, 6, 4, {
      ...target,
      candidates: new Set([target.pieceId]),
      confirmed: false,
    });

    const once = applyC301SingleConfirm(staged);
    const twice = applyC301SingleConfirm(once.next);

    expect(twice.changed).toBe(false);
    expect(twice.next).toBe(once.next);
    expect(twice.next.board[6][4]!.confirmed).toBe(true);
  });

  describe('candidate_update への組み込み', () => {
    it('制約ループの外で 1 個に絞られた駒も確定する (C-201 捕獲後の取りこぼし修正)', () => {
      // 「何も狭めない」制約を 1 個だけ登録して量子モードを有効にする。
      // C-301 が制約側の副作用ではなく独立パスであることを確かめるため。
      const noop: QuantumConstraint = (piece) => new Set(piece.candidates ?? []);
      register<QuantumConstraint[]>('quantum:constraints', [noop]);

      // 王候補 + 玉以外の候補 1 個だけを持つ駒を作り、player2 の手駒へ置く。
      // C-201 が王候補を除去すると候補は 1 個になるが、C-201 自身は確定フラグを立てない。
      const pos = quantumInit(initPosition(hondou));
      const infoMap = buildInitialInfoMap(pos);
      let ouId: PieceId | null = null;
      let otherId: PieceId | null = null;
      for (const [pid, info] of infoMap) {
        if (info.initialOwner !== 'player1') continue;
        if (info.initialKind === 'ou' && ouId === null) ouId = pid;
        if (info.initialKind === 'fu' && otherId === null) otherId = pid;
      }
      expect(ouId).not.toBeNull();
      expect(otherId).not.toBeNull();

      const capturedPiece: PieceInstance = {
        ...pos.board[6][4]!,
        candidates: new Set([ouId!, otherId!]),
        confirmed: false,
      };
      // 盤からは取り除いて手駒へ移す (同じ駒が 2 箇所に居ると C-002 の検査に引っかかる)
      const removed = withBoardPiece(pos, 6, 4, null);
      const withHand: Position = {
        ...removed,
        hands: { ...removed.hands, player2: [...removed.hands.player2, capturedPiece] },
      };

      const afterCapture = applyC201(withHand, capturedPiece.pieceId, hondou);
      const handIndex = afterCapture.hands.player2.length - 1;
      // C-201 単体では「候補 1 個・未確定」という中途半端な状態になる
      expect(afterCapture.hands.player2[handIndex].candidates!.size).toBe(1);
      expect(afterCapture.hands.player2[handIndex].confirmed).toBe(false);

      const stable = candidateUpdate(afterCapture, hondou);

      expect(stable.hands.player2[handIndex].candidates!.size).toBe(1);
      expect(stable.hands.player2[handIndex].confirmed).toBe(true);
    });
  });
});
