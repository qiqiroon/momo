import { describe, it, expect, beforeEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { useGameStore } from '../../core/store/game-store';
import { DEFAULT_QUANTUM_PARAMS } from '../../core/store/quantum-params';
import { candidateUpdate } from './candidate-update';
import { quantumInit } from './init';
import './index';

/**
 * Phase 5-15 量子モードの実行時パラメータ (§Q17.8)。
 *
 * それまで実装のあちこちに固定値として散らばっていた 4 つを対局設定に載せた。
 * **既定値のままなら従来と同じ挙動**であることも一緒に固定する。
 */
describe('Phase 5-15 実行時パラメータ (§Q17.8)', () => {
  beforeEach(() => {
    useGameStore.getState().setQuantumParams(DEFAULT_QUANTUM_PARAMS);
    useGameStore.getState().reset({ quantum: false });
  });

  describe('max_iterations (反復上限)', () => {
    it('上限を 1 まで下げると「反復が終わらない」異常になる', () => {
      const pos = quantumInit(initPosition(hondou));
      let caught: unknown = null;
      try {
        candidateUpdate(pos, hondou, { maxIterations: 1 });
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect((caught as { anomalyCause?: string }).anomalyCause).toBe('iteration_limit');
    });

    it('既定値なら異常にならず安定状態に収束する', () => {
      const pos = quantumInit(initPosition(hondou));
      expect(() => candidateUpdate(pos, hondou)).not.toThrow();
      expect(() =>
        candidateUpdate(pos, hondou, { maxIterations: DEFAULT_QUANTUM_PARAMS.maxIterations }),
      ).not.toThrow();
    });
  });

  describe('initial_propagation (開始時の絞り込み)', () => {
    /** 先手玉の初期位置に居る駒の候補の個数。開始時の絞り込みが効くと 20 より減る。 */
    function candidateCountAt84(): number {
      return useGameStore.getState().position.board[8][4]!.candidates!.size;
    }

    it('既定 (オン) では対局開始時に候補が絞られている', () => {
      useGameStore.getState().reset({ quantum: true });
      expect(candidateCountAt84()).toBeLessThan(20);
    });

    it('オフにすると絞られないまま始まる (全 20 候補)', () => {
      useGameStore.getState().setQuantumParams({ initialPropagation: false });
      useGameStore.getState().reset({ quantum: true });
      expect(candidateCountAt84()).toBe(20);
    });
  });

  describe('anomaly_action (異常時の挙動)', () => {
    it('既定 (投票) では投票を出す状態で異常が立つ', () => {
      useGameStore.getState().reset({ quantum: true });
      useGameStore.getState().raiseAnomaly('empty_candidates');
      const a = useGameStore.getState().anomaly;
      expect(a).not.toBeNull();
      expect(a!.vote).toBe(true);
      expect(useGameStore.getState().status).toBe('playing');
    });

    it('「知らせるだけ」では異常は立つが投票を出さない', () => {
      useGameStore.getState().setQuantumParams({ anomalyAction: 'notify_user' });
      useGameStore.getState().reset({ quantum: true });
      useGameStore.getState().raiseAnomaly('empty_candidates');
      const a = useGameStore.getState().anomaly;
      expect(a).not.toBeNull();
      expect(a!.vote).toBe(false);
      // 盤は異常状態のまま残る (対局は終わらない)
      expect(useGameStore.getState().status).toBe('playing');
    });

    it('「即ノーゲーム」では投票を挟まずその場で不成立になる', () => {
      useGameStore.getState().setQuantumParams({ anomalyAction: 'no_game' });
      useGameStore.getState().reset({ quantum: true });
      useGameStore.getState().raiseAnomaly('iteration_limit');
      expect(useGameStore.getState().anomaly).toBeNull();
      expect(useGameStore.getState().status).toBe('nogame');
    });
  });
});
