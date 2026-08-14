/**
 * 汎用MCTS を「差し替えられる AI」として登録する (Phase 3-3・親 §7.3)。
 *
 * 自作探索 (αβ) と並べて選べるようにする。順位は自作探索より下 (付録 D-5 §6.3)＝
 * 既定では選ばれず、画面で選んだときだけ動く。**量子での順位は実際に対局させて
 * 評価してから決める**ので、それまでは暫定で下位に置く。
 *
 * 別スレッドはまだ持たせていない (自作探索の別スレッドは αβ 専用の窓口なので、
 * そのままでは使えない)。1 手ぶんの回数を段で抑えているため、画面が止まる時間は
 * 段が求める考慮時間までで収まる。
 */

import { registerEngine } from '../../core/ai/engine-registry';
import type { EngineAdapter, ThinkLimits, ThinkProgress } from '../../core/ai/types';
import type { Mgf } from '../../core/engine/mgf/types';
import type { Move, Position } from '../../core/engine/position/types';
import { searchBestMoveMcts } from './mcts';
import { resolveMctsLevel } from './levels';

export const MCTS_ENGINE_ID = 'mcts';

class MctsAdapter implements EngineAdapter {
  readonly id = MCTS_ENGINE_ID;
  private mgf: Mgf | null = null;
  private position: Position | null = null;
  private stopped = false;

  init(mgf: Mgf): void {
    this.mgf = mgf;
  }

  setPosition(position: Position): void {
    this.position = position;
  }

  async go(limits: ThinkLimits, onProgress?: (p: ThinkProgress) => void): Promise<Move | null> {
    const mgf = this.mgf;
    const position = this.position;
    if (!mgf || !position) return null;
    this.stopped = false;

    // 段の解釈はこの思考ルーチンの仕事 (親 §7.5.3)。MCTS は回数で強弱を作る。
    const { playouts, movetimeMs } = resolveMctsLevel(limits);

    // 開始を 1 度画面に返してから走らせ、「考え中」が出ないまま固まるのを防ぐ。
    await new Promise((resolve) => setTimeout(resolve, 0));

    const result = searchBestMoveMcts(mgf, position, {
      playouts,
      movetimeMs,
      shouldStop: () => this.stopped,
      onProgress: (p) => onProgress?.(p),
    });
    return result.move;
  }

  stop(): void {
    this.stopped = true;
  }

  quit(): void {
    this.stop();
    this.mgf = null;
    this.position = null;
  }
}

registerEngine({
  id: MCTS_ENGINE_ID,
  labelKey: 'ai.mcts.name',
  descKey: 'ai.mcts.desc',
  // 全モードで動く (合法手を出す・手を進める、しかエンジンに頼っていないため)。
  // 数値は付録 D-5 §6.3 の順位表と対で管理する。**量子の 5 は暫定**で、
  // 自作探索とどちらが強いかを実測してから確定する。
  weights: { shogi: 5, variant: 5, torus: 5, quantum: 5 },
  create: () => new MctsAdapter(),
});

export { searchBestMoveMcts } from './mcts';
export { MCTS_LEVEL_TABLE, resolveMctsLevel } from './levels';
