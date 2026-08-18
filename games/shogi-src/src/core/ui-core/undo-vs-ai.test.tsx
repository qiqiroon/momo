import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { useI18nStore } from '../store/i18n-store';
import { registerEngine } from '../ai/engine-registry';
import { generateLegalMoves } from '../engine';
import type { EngineAdapter, EngineDescriptor } from '../ai/types';
import type { Move, Position } from '../engine/position/types';

/**
 * 対 AI の待った（ユーザー判断 2026-08-18）。
 *
 * **1 回押すごとに 2 手戻す**＝1 手だけ戻すと**戻るのは AI の指した手だけ**で、
 * 人の手は盤に残ったまま AI が考え直して指すので、**人は指し直せない**。
 * **残っている限りどこまでも戻せる**（残りが 1 手ならその 1 手だけ）。
 */

/** すぐ答える偽の思考ルーチン（合法手の先頭）。本物を走らせたくないだけ。 */
const quickEngine: EngineDescriptor = {
  id: 'test-quick',
  labelKey: 'ai.quick',
  descKey: 'ai.quick.desc',
  weights: { shogi: 1 },
  create(): EngineAdapter {
    let seen: Position | null = null;
    return {
      id: 'test-quick',
      init() {},
      setPosition(p) {
        seen = p;
      },
      async go(): Promise<Move | null> {
        if (!seen) return null;
        const legal = generateLegalMoves(useGameStore.getState().mgf, seen);
        return legal.length > 0 ? legal[0] : null;
      },
      stop() {},
      quit() {},
    };
  },
};
registerEngine(quickEngine);

const moves = () => useGameStore.getState().position.history.length;
const sideToMove = () => useGameStore.getState().position.sideToMove;

function humanMoves(): void {
  const s = useGameStore.getState();
  s.replayRecordedMove(generateLegalMoves(s.mgf, s.position)[0]);
}

async function pressUndo(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText('待った'));
  });
}

beforeEach(() => {
  useI18nStore.setState({ locale: 'ja' });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
  useAiStore.setState({ enabled: true, aiSide: 'player2', engineId: 'test-quick' });
});

afterEach(() => {
  useAiStore.setState({ enabled: false, engineId: null });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
});

describe('対 AI の待った', () => {
  it('★1 回押すと 2 手戻り、人が指し直せる（AI が指し直さない）', async () => {
    render(<App variant="b" />);
    await act(async () => {
      humanMoves();
    });
    expect(moves()).toBe(2); // 人 → AI

    await pressUndo();

    // **人の手まで戻る**＝戻ったあとは人の番のまま（AI は指し直さない）。
    expect(moves()).toBe(0);
    expect(sideToMove()).toBe('player1');
  });

  it('★押すたびに 2 手ずつ、どこまでも戻せる', async () => {
    render(<App variant="b" />);
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        humanMoves();
      });
    }
    expect(moves()).toBe(6); // 人と AI が 3 手ずつ

    await pressUndo();
    expect(moves()).toBe(4);
    await pressUndo();
    expect(moves()).toBe(2);
    await pressUndo();
    expect(moves()).toBe(0);
  });

  it('初手まで戻ったらそれ以上は押せない（戻しすぎない）', async () => {
    render(<App variant="b" />);
    await act(async () => {
      humanMoves();
    });
    await pressUndo();
    expect(moves()).toBe(0);
    expect((screen.getByText('待った') as HTMLButtonElement).disabled).toBe(true);
  });
});
