/**
 * 思考用の別スレッド (B ビルド・Phase 3)。
 *
 * 画面と同じルールで考えさせるため、**画面側と同じ機能モジュールをここでも積む**。
 * トーラスの回り込みや量子の絞り込みは起動時の自己登録で効くようになる仕組みなので、
 * 別スレッドでも同じ登録をしておかないと、こちらだけ平面・通常将棋として読んでしまう。
 *
 * A ビルド (本将棋のみ) はこのファイルを読み込まない。必要になったら A 側の
 * 組み立てファイルを別に作る (機能モジュールを積まない版になる)。
 */

import './features/torus';
import './features/quantum';
import { searchBestMove } from './adapters/selfmade-alphabeta/search';
import type { WorkerRequest, WorkerResponse } from './adapters/selfmade-alphabeta/worker-protocol';

self.addEventListener('message', (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  if (!req || req.type !== 'go') return;

  const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

  const result = searchBestMove(req.mgf, req.position, {
    movetimeMs: req.movetimeMs,
    maxDepth: req.maxDepth,
    jitter: req.jitter,
    onProgress: (p) => {
      post({ type: 'progress', id: req.id, depth: p.depth, nodes: p.nodes, elapsedMs: p.elapsedMs });
    },
  });

  post({
    type: 'result',
    id: req.id,
    move: result.move,
    score: result.score,
    depth: result.depth,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  });
});
