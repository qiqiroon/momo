/**
 * 自作の読み筋を「差し替えられる AI」として登録する (Phase 3・親 §7.3.1)。
 *
 * 考えるのは重い仕事なので、**別スレッド (Web Worker) があればそちらで考える**
 * (親 §7.4 / §2.2 = 画面を固まらせない)。別スレッドを用意できない場面
 * (テスト・A ビルド) では同じスレッドで考える。答えは同じで、待っている間に
 * 画面が止まるかどうかだけが違う。
 *
 * 別スレッドの作り方そのものは B の組み立て側 (main-b) が登録する。ここで直接
 * 作らないのは、思考ルーチンがトーラスや量子といった機能モジュールを知らずに済む
 * ようにするため (どれを積むかは組み立て側が決める)。
 */

import { registerEngine } from '../../core/ai/engine-registry';
import type { EngineAdapter, ThinkLimits, ThinkProgress } from '../../core/ai/types';
import { get as pluginGet } from '../../core/plugin/registry';
import type { Mgf } from '../../core/engine/mgf/types';
import type { Move, Position } from '../../core/engine/position/types';
import { searchBestMove } from './search';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

export const SELFMADE_ENGINE_ID = 'selfmade-alphabeta';

/** main-b が登録する「思考用の別スレッドを作る関数」。 */
export type AiWorkerFactory = () => Worker;

class SelfmadeAdapter implements EngineAdapter {
  readonly id = SELFMADE_ENGINE_ID;
  private mgf: Mgf | null = null;
  private position: Position | null = null;
  private worker: Worker | null = null;
  private seq = 0;
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

    const movetimeMs = limits.movetimeMs ?? 2000;
    const maxDepth = limits.depth ?? 6;

    const worker = this.ensureWorker();
    if (worker) {
      return this.goInWorker(worker, mgf, position, movetimeMs, maxDepth, onProgress);
    }

    // 同じスレッドで考える。開始を 1 度画面に返してから走らせ、「考え中」の表示が
    // 出ないまま固まるのを防ぐ。
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = searchBestMove(mgf, position, {
      movetimeMs,
      maxDepth,
      shouldStop: () => this.stopped,
      onProgress: (p) => onProgress?.({ depth: p.depth, nodes: p.nodes, elapsedMs: p.elapsedMs }),
    });
    return result.move;
  }

  stop(): void {
    this.stopped = true;
    // 考えている最中の別スレッドは受信できないので、止めるには捨てるしかない。
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  quit(): void {
    this.stop();
    this.mgf = null;
    this.position = null;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    const factory = pluginGet<AiWorkerFactory>('ai:workerFactory');
    if (!factory) return null;
    try {
      this.worker = factory();
      return this.worker;
    } catch {
      return null; // 別スレッドが作れない環境ではそのまま同じスレッドで考える
    }
  }

  private goInWorker(
    worker: Worker,
    mgf: Mgf,
    position: Position,
    movetimeMs: number,
    maxDepth: number,
    onProgress?: (p: ThinkProgress) => void,
  ): Promise<Move | null> {
    const id = ++this.seq;
    return new Promise<Move | null>((resolve) => {
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
      };
      const onMessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data;
        if (!msg || msg.id !== id) return;
        if (msg.type === 'progress') {
          onProgress?.({ depth: msg.depth, nodes: msg.nodes, elapsedMs: msg.elapsedMs });
          return;
        }
        cleanup();
        resolve(msg.move);
      };
      const onError = () => {
        cleanup();
        // 別スレッドが落ちたら捨てて、次回は同じスレッドで考え直す
        this.worker = null;
        worker.terminate();
        resolve(searchBestMove(mgf, position, { movetimeMs, maxDepth }).move);
      };
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      const req: WorkerRequest = { type: 'go', id, mgf, position, movetimeMs, maxDepth };
      worker.postMessage(req);
    });
  }
}

registerEngine({
  id: SELFMADE_ENGINE_ID,
  labelKey: 'ai.selfmade.name',
  descKey: 'ai.selfmade.desc',
  weight: 10,
  create: () => new SelfmadeAdapter(),
});

export { searchBestMove } from './search';
export { evaluate } from './evaluate';
