import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { registerEngine } from '../ai/engine-registry';
import { generateLegalMoves } from '../engine';
import type { EngineAdapter, EngineDescriptor } from '../ai/types';
import type { Move, Position } from '../engine/position/types';
import { useAiOpponent } from './ai-driver';

/**
 * AI に手番を引き受けさせる係。
 *
 * ここで固定したいのは、**画面を見ているだけでは原因の分からない止まり方**。
 *   - **待ったで戻したら、AI はその局面をもう一度考える**
 *     （2026-08-18 ユーザー報告「待ったをかけると AI がその後指さなくなる」）
 *   - **戻される前に頼んだ答えは、戻った盤に指さない**（古い答えの取り違え）
 *
 * どちらも「いつ頼んだ手か」の合印だけで決まる。合印が手数と手番しか見ていないと、
 * **待ったで戻った先が直前とまったく同じ合印**になり、上の 2 つが同時に壊れる。
 */

/** 思考の中身は見たくないので、**合法手の先頭を返すだけ**の偽の思考ルーチンを使う。 */
let goCount = 0;
/** 頼まれてから答えるまでを検査側で握る（待ったの割り込みを作るため）。 */
let hold: (() => void) | null = null;

function firstLegalMove(position: Position): Move | null {
  const { mgf } = useGameStore.getState();
  const legal = generateLegalMoves(mgf, position);
  return legal.length > 0 ? legal[0] : null;
}

const fakeEngine: EngineDescriptor = {
  id: 'test-fake',
  labelKey: 'ai.fake',
  descKey: 'ai.fake.desc',
  weights: { shogi: 1 },
  create(): EngineAdapter {
    let seen: Position | null = null;
    return {
      id: 'test-fake',
      init() {},
      setPosition(p) {
        seen = p;
      },
      async go() {
        goCount++;
        const here = seen;
        if (hold) await new Promise<void>((resolve) => (hold = resolve));
        return here ? firstLegalMove(here) : null;
      },
      stop() {},
      quit() {},
    };
  },
};

registerEngine(fakeEngine);

/** 人が 1 手指す（合法手の先頭）。 */
function humanMoves(): void {
  const s = useGameStore.getState();
  const legal = generateLegalMoves(s.mgf, s.position);
  s.replayRecordedMove(legal[0]);
}

const moveCount = () => useGameStore.getState().position.history.length;

beforeEach(() => {
  goCount = 0;
  hold = null;
  useGameStore
    .getState()
    .reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  // 人が先手・AI が後手。オフライン（通信は挟まない）。
  useAiStore.setState({ enabled: true, aiSide: 'player2', engineId: 'test-fake' });
});

afterEach(() => {
  useAiStore.setState({ enabled: false, engineId: null });
});

describe('対 AI の手番（待ったで戻したとき）', () => {
  it('人が指したら AI が指す（土台の確認）', async () => {
    const { unmount } = renderHook(() => useAiOpponent(false));
    await act(async () => {
      humanMoves();
    });
    expect(moveCount()).toBe(2);
    expect(goCount).toBe(1);
    unmount();
  });

  it('★待ったで 1 手戻したら、AI はその局面をもう一度考えて指す', async () => {
    const { unmount } = renderHook(() => useAiOpponent(false));
    await act(async () => {
      humanMoves();
    });
    expect(moveCount()).toBe(2);

    // 待った（オフラインは 1 手戻す）。戻った先は AI の手番。
    await act(async () => {
      useGameStore.getState().undoLastMove(1);
    });

    // **ここが実機の症状**＝v1.52 までは「もう頼んだ手番だ」と見て二度と考えなかった。
    expect(goCount).toBe(2);
    expect(moveCount()).toBe(2);
    unmount();
  });

  it('★考えている最中に戻されたら、その答えは指さない（古い答えを新しい盤に置かない）', async () => {
    hold = () => {};
    const { unmount } = renderHook(() => useAiOpponent(false));
    await act(async () => {
      humanMoves();
    });
    // まだ答えていない（検査側が握っている）。
    expect(moveCount()).toBe(1);

    await act(async () => {
      useGameStore.getState().undoLastMove(1);
    });
    expect(moveCount()).toBe(0);

    // 握っていた答えを今ごろ返す。**戻された後の盤には指さない**。
    const release = hold;
    hold = null;
    await act(async () => {
      release?.();
    });
    expect(moveCount()).toBe(0);
    unmount();
  });
});
