import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiSetupScreen } from './AiSetupScreen';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { useI18nStore } from '../store/i18n-store';
import { clear as clearPlugins } from '../plugin/registry';
import { registerEngine, clearEngines } from '../ai/engine-registry';

/**
 * Phase 3-3: 対AI設定画面 (S03) の手合い (駒落ち)。
 *
 * 決まりは付録 D-5 v1.3 §4.3／§5・意味論は親 §3.12.1:
 *   - 落とす側は AI でも自分でも選べる
 *   - 駒落ちのあいだ先後は選べない (駒を落とした側が先手)
 *   - 平手に戻すと先後をまた選べる
 */

function startGame() {
  fireEvent.click(screen.getByText('対局開始'));
}

describe('S03 手合い (駒落ち)', () => {
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

  it('手合いの選択が出る (既定は平手)', () => {
    render(<AiSetupScreen />);
    expect(screen.getByText('手合い')).toBeTruthy();
    expect(screen.getByText('平手')).toBeTruthy();
    expect(screen.getByText('駒落ち')).toBeTruthy();
    // 平手のうちは落とす側・落とす駒は出ない
    expect(screen.queryByText('落とす駒')).toBeNull();
  });

  it('駒落ちを選ぶと、落とす側と落とす駒が出る', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    expect(screen.getByText('AI が落とす')).toBeTruthy();
    expect(screen.getByText('あなたが落とす')).toBeTruthy();
    expect(screen.getByText('落とす駒')).toBeTruthy();
    // 種類はルール定義が持つ一覧から作る (本将棋は 6 種類)
    const select = screen.getByLabelText('落とす駒') as HTMLSelectElement;
    expect(select.options.length).toBe(6);
    expect(select.value).toBe('ni'); // 既定は二枚落ち
  });

  it('駒落ちのあいだ先後は選べず、理由が出る', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    expect(screen.getByText(/駒を落とした側が先手/)).toBeTruthy();
    const senteCard = screen.getByText('先手').closest('button') as HTMLButtonElement;
    expect(senteCard.disabled).toBe(true);
  });

  it('平手に戻せば先後をまた選べる', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    fireEvent.click(screen.getByText('平手'));
    const senteCard = screen.getByText('先手').closest('button') as HTMLButtonElement;
    expect(senteCard.disabled).toBe(false);
  });

  it('先後を選ばないと対局を始められない (平手)', () => {
    render(<AiSetupScreen />);
    const start = screen.getByText('対局開始').closest('button') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByText('先手'));
    expect(start.disabled).toBe(false);
  });

  it('駒落ちなら先後を選ばなくても始められる (手合いから決まるため)', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    const start = screen.getByText('対局開始').closest('button') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
  });

  it('AI が落とすと、AI が先手で二枚落ちの盤で始まる', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    startGame();
    const gs = useGameStore.getState();
    expect(gs.currentHandicap).toEqual({ typeId: 'ni', giver: 'player1' });
    expect(gs.position.sideToMove).toBe('player1');
    expect(useAiStore.getState().aiSide).toBe('player1'); // AI が先手＝上手
    const p1 = gs.position.board.flat().filter((c) => c && c.owner === 'player1');
    expect(p1).toHaveLength(18);
  });

  it('自分が落とすと、自分が先手で自分の駒が減る', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('駒落ち'));
    fireEvent.click(screen.getByText('あなたが落とす'));
    startGame();
    const gs = useGameStore.getState();
    expect(useAiStore.getState().aiSide).toBe('player2'); // あなたが先手＝上手
    const p1 = gs.position.board.flat().filter((c) => c && c.owner === 'player1');
    expect(p1).toHaveLength(18); // 先手＝自分の駒が落ちている
  });

  it('平手で始めれば手合いは残らない', () => {
    render(<AiSetupScreen />);
    fireEvent.click(screen.getByText('先手'));
    startGame();
    const gs = useGameStore.getState();
    expect(gs.currentHandicap).toBeNull();
    expect(gs.position.board.flat().filter((c) => c !== null)).toHaveLength(40);
  });
});
