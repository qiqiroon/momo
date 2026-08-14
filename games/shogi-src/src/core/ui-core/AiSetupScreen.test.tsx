import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiSetupScreen } from './AiSetupScreen';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { useI18nStore } from '../store/i18n-store';
import { register, clear as clearPlugins } from '../plugin/registry';
import { registerEngine, clearEngines } from '../ai/engine-registry';
import { DEFAULT_TIME_CONTROL } from '../engine/time-control';
import type { HandicapChoice } from '../engine';

/**
 * 対AI設定画面 (S03) と手合い (駒落ち)。
 *
 * v1.33 で**手合いを選ぶ場所はルール選択画面 (S02) へ移った**ので、この画面に
 * 手合いのカードは無い。ここで固定したいのは、S02 で決まった手合いを受け取って
 *   - 先後が自動で決まり、変えられなくなること (付録 D-5 v1.4 §4.3)
 *   - 落とした側が先手で、その側の駒が減った盤で始まること (親 §3.12.1)
 * の 2 点。
 */

/** S02 で決まったルール (手合いを含む) を返す口を差し込む。 */
function mockConnector(handicap: HandicapChoice | null) {
  register('gameConnector', {
    isRuleSetter: () => true,
    getPendingRules: () => ({
      gameType: 'shogi' as const,
      torusMode: 'none' as const,
      quantum: false,
      quantumDisplayMode: 'cycle' as const,
      handicap,
    }),
    getPendingTimeControl: () => DEFAULT_TIME_CONTROL,
    commitPendingToActive: () => {},
  });
}

function startGame() {
  fireEvent.click(screen.getByText('対局開始'));
}

describe('S03 手合い (駒落ち) の受け取り', () => {
  beforeEach(() => {
    clearPlugins();
    clearEngines();
    // 対局開始が押せる状態にするため、どのモードにも対応する思考ルーチンを 1 つ積む
    registerEngine({
      id: 'test-engine',
      labelKey: 'ai.test',
      descKey: 'ai.testDesc',
      weights: { shogi: 10, variant: 10, torus: 10, quantum: 10 },
      create: () => ({
        id: 'test-engine',
        init: () => {},
        setPosition: () => {},
        go: async () => null,
        stop: () => {},
        quit: () => {},
      }),
    });
    useI18nStore.setState({ locale: 'ja' });
    useGameStore.getState().reset({ handicap: null, quantum: false, torusMode: 'none' });
    useAiStore.setState({ enabled: false, aiSide: 'player2', engineId: null });
  });
  afterEach(() => {
    clearPlugins();
    clearEngines();
  });

  it('手合いを選ぶ操作はこの画面に無い (S02 へ移った)', () => {
    mockConnector(null);
    render(<AiSetupScreen />);
    expect(screen.queryByText('駒落ち')).toBeNull();
    expect(screen.queryByText('落とす駒')).toBeNull();
    expect(screen.queryByText('AI が落とす')).toBeNull();
  });

  it('平手なら先後を選ばないと対局を始められない', () => {
    mockConnector(null);
    render(<AiSetupScreen />);
    const start = screen.getByText('対局開始').closest('button') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByText('先手'));
    expect(start.disabled).toBe(false);
  });

  it('駒落ちなら先後は自動で決まり、選び直せない', () => {
    mockConnector({ typeId: 'ni', giver: 'opponent' });
    render(<AiSetupScreen />);
    expect(screen.getByText(/駒を落とした側が先手/)).toBeTruthy();
    const senteCard = screen.getByText('先手').closest('button') as HTMLButtonElement;
    expect(senteCard.disabled).toBe(true);
    // 先後を触らなくても始められる (手合いから決まっているため)
    const start = screen.getByText('対局開始').closest('button') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
  });

  it('AI が落とすと、AI が先手で二枚落ちの盤で始まる', () => {
    mockConnector({ typeId: 'ni', giver: 'opponent' });
    render(<AiSetupScreen />);
    startGame();
    const gs = useGameStore.getState();
    expect(gs.currentHandicap).toEqual({ typeId: 'ni', giver: 'player1' });
    expect(gs.position.sideToMove).toBe('player1');
    expect(useAiStore.getState().aiSide).toBe('player1'); // AI が先手＝上手
    const p1 = gs.position.board.flat().filter((c) => c && c.owner === 'player1');
    expect(p1).toHaveLength(18);
  });

  it('自分が落とすと、自分が先手で自分の駒が減る', () => {
    mockConnector({ typeId: 'ni', giver: 'self' });
    render(<AiSetupScreen />);
    startGame();
    const gs = useGameStore.getState();
    expect(useAiStore.getState().aiSide).toBe('player2'); // あなたが先手＝上手
    const p1 = gs.position.board.flat().filter((c) => c && c.owner === 'player1');
    expect(p1).toHaveLength(18); // 先手＝自分の駒が落ちている
  });

  it('平手で始めれば手合いは残らない', () => {
    mockConnector(null);
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('先手'));
    startGame();
    const gs = useGameStore.getState();
    expect(gs.currentHandicap).toBeNull();
    expect(gs.position.board.flat().filter((c) => c !== null)).toHaveLength(40);
  });
});
