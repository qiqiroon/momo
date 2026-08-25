import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { App } from '../../App';
import { useGameStore } from '../store/game-store';
import { useAiStore } from '../store/ai-store';
import { chess } from '../engine';

/**
 * 第 9 段 9-4a②：盤の枡描画を 9×9 決め打ちから外し、チェス (8×8) を正しく描く。
 * 親 v1.65 §5.5.6・§4.2.1。将棋 (9×9) は同じ見た目のまま (無回帰) であることも固定する。
 */

const texts = (nodes: NodeListOf<Element>) => [...nodes].map((n) => n.textContent);

beforeEach(() => {
  useAiStore.setState({ enabled: false, engineId: null });
});
afterEach(() => {
  useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
  useAiStore.setState({ enabled: false, engineId: null });
});

describe('9-4a② チェス盤の描画 (8×8)', () => {
  it('枡は 64・星は出さない', () => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none' });
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.board .sq')).toHaveLength(64);
    expect(container.querySelectorAll('.board .stars')).toHaveLength(0);
  });

  it('筋は a〜h・段は 8〜1 (先手から見て左下が a1)', () => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none' });
    const { container } = render(<App variant="b" />);
    expect(texts(container.querySelectorAll('.col-coords span'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(texts(container.querySelectorAll('.row-coords span'))).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
  });

  it('外枠に接する枡の印は、右端列 8・下端行 8', () => {
    useGameStore.getState().reset({ gameType: 'custom', customMgf: chess, quantum: false, torusMode: 'none' });
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.board .sq.edge-r')).toHaveLength(8);
    expect(container.querySelectorAll('.board .sq.edge-b')).toHaveLength(8);
  });
});

describe('9-4a② 将棋盤は無回帰 (9×9)', () => {
  it('枡は 81・星は 1 組・筋は 9〜1', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.board .sq')).toHaveLength(81);
    expect(container.querySelectorAll('.board .stars')).toHaveLength(1);
    expect(texts(container.querySelectorAll('.col-coords span'))).toEqual(['9', '8', '7', '6', '5', '4', '3', '2', '1']);
  });

  it('外枠に接する枡の印は、右端列 9・下端行 9', () => {
    useGameStore.getState().reset({ gameType: 'shogi', quantum: false, torusMode: 'none' });
    const { container } = render(<App variant="b" />);
    expect(container.querySelectorAll('.board .sq.edge-r')).toHaveLength(9);
    expect(container.querySelectorAll('.board .sq.edge-b')).toHaveLength(9);
  });
});
