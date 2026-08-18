import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { registerEngine } from '../ai/engine-registry';
import type { EngineAdapter, EngineDescriptor } from '../ai/types';

/**
 * 盤枠のオレンジ＝**人が指す番であること**の合図（2026-08-18 ユーザー報告
 * 「AI 対戦で、どちらの番かを示すオレンジ色の枠が表示されない」）。
 *
 * v1.52 まではネット対戦のときだけ点けていたので、**対 AI では一度も出なかった**。
 *
 * ここで固定したいのは、**点きっぱなしにしないこと**もあわせて。
 *   - 対 AI ＝人の番だけ点く（AI が考えている間は消える）
 *   - 人どうしのオフライン＝出さない（どちらの番も人なので常時点灯になり区別しない）
 *   - 終わった盤では点けない（誰の番でもない）
 */

/** 検査中に本物の思考ルーチンを走らせない（答えない偽物を選ばせる）。 */
const idleEngine: EngineDescriptor = {
  id: 'test-idle',
  labelKey: 'ai.idle',
  descKey: 'ai.idle.desc',
  weights: { shogi: 1 },
  create(): EngineAdapter {
    return {
      id: 'test-idle',
      init() {},
      setPosition() {},
      go: () => new Promise(() => {}),
      stop() {},
      quit() {},
    };
  },
};
registerEngine(idleEngine);

const frames = (c: HTMLElement) => c.querySelectorAll('.board-outer.myturn').length;

beforeEach(() => {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
  useAiStore.setState({ enabled: false, engineId: 'test-idle' });
});

afterEach(() => {
  useAiStore.setState({ enabled: false, engineId: null });
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
});

describe('手番のオレンジ枠', () => {
  it('★対 AI で人の番なら盤枠が点く', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player2' });
    const { container } = render(<App variant="b" />);
    expect(frames(container)).toBe(1);
  });

  it('対 AI で AI の番なら点かない', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player1' });
    const { container } = render(<App variant="b" />);
    expect(frames(container)).toBe(0);
  });

  it('人どうしのオフラインでは点けない（どちらの番も人なので合図にならない）', () => {
    const { container } = render(<App variant="b" />);
    expect(frames(container)).toBe(0);
  });

  it('★終わった盤では点けない（誰の番でもない）', () => {
    useAiStore.setState({ enabled: true, aiSide: 'player2' });
    useGameStore.getState().resign('player2');
    const { container } = render(<App variant="b" />);
    expect(frames(container)).toBe(0);
  });
});
