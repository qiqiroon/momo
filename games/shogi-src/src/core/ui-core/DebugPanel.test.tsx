import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DebugPanel } from './DebugPanel';
import { useDebugStore } from '../store/debug-store';
import { useGameStore } from '../store/game-store';
import { DEFAULT_QUANTUM_PARAMS } from '../store/quantum-params';

/**
 * Phase 5-15: デバッグパネルに足した実行時パラメータ (§Q17.8) の操作。
 *
 * パネル自体は `?debug=1` のときだけ開くので、確認環境 (プレビュー) では歯車 →
 * リンクの 2 段クリックが必要で不安定だった。ここで描画そのものを固定しておく。
 */
describe('DebugPanel 実行時パラメータ (Phase 5-15)', () => {
  beforeEach(() => {
    useGameStore.getState().setQuantumParams(DEFAULT_QUANTUM_PARAMS);
    useDebugStore.setState({ enabled: true, panelOpen: true });
  });

  it('4 つのパラメータが既定値で並ぶ', () => {
    render(<DebugPanel />);
    // 「反復上限」「異常時」はデバッグの発火ボタンや注意書きにも出るので、
    // パラメータ名の付いた行だけを狙う。
    expect(screen.getByText(/反復上限 \(max_iterations\)/)).toBeTruthy();
    expect(screen.getByText(/初期絞り込み|開始時に絞り込みを 1 回 \(initial_propagation\)/)).toBeTruthy();
    expect(screen.getByText(/異常時 \(anomaly_action\)/)).toBeTruthy();
    expect(screen.getByText(/観測タイミング \(observation_timing\)/)).toBeTruthy();

    expect((screen.getByRole('spinbutton') as HTMLInputElement).value).toBe(
      String(DEFAULT_QUANTUM_PARAMS.maxIterations),
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('vote_to_annul');
  });

  it('反復上限を書き換えると対局設定に反映される', () => {
    render(<DebugPanel />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '3' } });
    expect(useGameStore.getState().quantumParams.maxIterations).toBe(3);
  });

  it('異常時の挙動を「即ノーゲーム」に変えられる', () => {
    render(<DebugPanel />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no_game' } });
    expect(useGameStore.getState().quantumParams.anomalyAction).toBe('no_game');
  });

  it('開始時の絞り込みを切れる', () => {
    render(<DebugPanel />);
    const boxes = screen.getAllByRole('checkbox');
    // 1 つ目は PieceID 表示、2 つ目が開始時の絞り込み
    fireEvent.click(boxes[boxes.length - 1]);
    expect(useGameStore.getState().quantumParams.initialPropagation).toBe(false);
  });
});
