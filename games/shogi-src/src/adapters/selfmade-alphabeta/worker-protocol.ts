/**
 * 思考用の別スレッドとのやりとりの決まり (Phase 3)。
 *
 * 局面もルール定義も**ただのデータ**なので、そのまま渡せる (関数を持っていない)。
 * 量子モードの候補集合は Set だが、これも構造化複製でそのまま渡る。
 */

import type { Mgf } from '../../core/engine/mgf/types';
import type { Move, Position } from '../../core/engine/position/types';

export interface WorkerGoRequest {
  type: 'go';
  /** 依頼の通し番号。古い依頼の答えが遅れて届いたときに捨てるため。 */
  id: number;
  mgf: Mgf;
  position: Position;
  movetimeMs: number;
  maxDepth: number;
  /** 同点崩しの幅 (段から決まる=levels.ts)。省略時は search 側の既定。 */
  jitter?: number;
}

export type WorkerRequest = WorkerGoRequest;

export interface WorkerProgressResponse {
  type: 'progress';
  id: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
}

export interface WorkerResultResponse {
  type: 'result';
  id: number;
  move: Move | null;
  score: number;
  depth: number;
  nodes: number;
  elapsedMs: number;
}

export type WorkerResponse = WorkerProgressResponse | WorkerResultResponse;
