/**
 * ★v1.93: 段の表に書いた読み方の改良が、**対局で実際に考える道まで届いている**か。
 *
 * 表 (levels.ts) を書き換えても、思考ルーチンの窓口 (index.ts) や別スレッド
 * (ai-worker-b.ts) が受け渡しを忘れれば、対局の AI は今までどおりに読む。検査で
 * 表だけを見ても分からない。ここでは **Easy (読む深さの上限 2)** に 3 手詰めを解かせる＝
 * 深さ 2 では見えないので、**詰み探索が届いているときだけ**詰ませる手を指す。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import { isInCheck } from '../../core/engine/moves/check';
import type { Move, PieceInstance, Position } from '../../core/engine/position/types';
import { findEngine } from '../../core/ai/engine-registry';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';
import { SELFMADE_ENGINE_ID } from './index';
import { resolveLevel } from './levels';

function pc(id: string, kind: string, owner: 'player1' | 'player2', row = 0, col = 0): PieceInstance {
  return { pieceId: id, kind, owner, initialOwner: owner, initialKind: kind, initialSquare: { row, col }, promoted: false };
}

/** 3 手詰め (search.features.test.ts と同じ局面)。 */
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

/** その手で 3 手詰めになっているか (王手で、どう受けても次に 1 手で詰む)。 */
function matesIn3(pos: Position, m: Move | null): boolean {
  if (!m) return false;
  const after = applyMove(hondou, pos, m);
  if (!isInCheck(hondou, after, 'player2')) return false;
  return generateLegalMoves(hondou, after).every((reply) => {
    const n = applyMove(hondou, after, reply);
    return generateLegalMoves(hondou, n).some((fin) => {
      const done = applyMove(hondou, n, fin);
      return isInCheck(hondou, done, 'player2') && generateLegalMoves(hondou, done).length === 0;
    });
  });
}

describe('段の表の改良が、対局で考える道まで届く (★v1.93)', { timeout: 120_000 }, () => {
  it('同じスレッドで考える道: Easy でも 3 手詰めを指す', async () => {
    const engine = findEngine(SELFMADE_ENGINE_ID)!.create();
    engine.init(hondou);
    engine.setPosition(tsume3());
    const move = await engine.go({ level: 'Easy' });
    expect(matesIn3(tsume3(), move)).toBe(true);
  });

  describe('別スレッドの道', () => {
    type Listener = (ev: { data: WorkerRequest }) => void;
    const listeners: Listener[] = [];
    const posted: WorkerResponse[] = [];
    beforeAll(async () => {
      (globalThis as unknown as { self: unknown }).self = {
        addEventListener: (_type: string, fn: Listener) => listeners.push(fn),
        postMessage: (msg: WorkerResponse) => posted.push(msg),
      };
      await import('../../ai-worker-b');
    });

    it('Easy の設定を頼まれたら、3 手詰めを指す', () => {
      const lv = resolveLevel({ level: 'Easy' });
      for (const fn of listeners) {
        fn({
          data: {
            type: 'go',
            id: 9,
            mgf: hondou,
            position: tsume3(),
            rules: { quantum: false },
            movetimeMs: lv.movetimeMs,
            maxDepth: lv.maxDepth,
            jitter: 0,
            features: lv.features,
          },
        });
      }
      const res = posted.find((m) => m.type === 'result' && m.id === 9);
      expect(res && res.type === 'result' && matesIn3(tsume3(), res.move)).toBe(true);
    });
  });
});
