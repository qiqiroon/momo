// ヒントの計算を、画面とは別のところ（Web Worker）で動かす（仕様書 §8.3）。
// 全力で回さず、少し計算しては休む（計算 12ms・休み 24ms ＝ CPU はおよそ 3 分の 1）。発熱・電池の減りを抑えるため。
// 画面が見えない間は、画面側から pause が来るので止まる

import { type HintProblem, type HintResult, solveSteps } from '../core/hintSolver';

const WORK_MS = 12;
const REST_MS = 24;

type In =
  | { type: 'start'; id: number; problem: HintProblem }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

export type HintWorkerOut = { type: 'done'; id: number; result: HintResult };

// Worker の中の self（型は DOM の window と違うので、使う分だけ書く）
const ctx = self as unknown as {
  postMessage(m: HintWorkerOut): void;
  onmessage: ((e: MessageEvent<In>) => void) | null;
};

let job: { id: number; it: Generator<void, HintResult> } | null = null;
let paused = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function schedule(delay: number): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run(): void {
  timer = null;
  if (!job || paused) return;
  const t0 = performance.now();
  while (performance.now() - t0 < WORK_MS) {
    const r = job.it.next();
    if (r.done) {
      const msg: HintWorkerOut = { type: 'done', id: job.id, result: r.value };
      job = null;
      ctx.postMessage(msg);
      return;
    }
  }
  schedule(REST_MS);
}

ctx.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'start') {
    job = { id: m.id, it: solveSteps(m.problem, 500) };
    paused = false;
    schedule(0);
  } else if (m.type === 'pause') {
    paused = true;
  } else if (m.type === 'resume') {
    paused = false;
    if (job) schedule(0);
  } else if (m.type === 'stop') {
    job = null;
  }
};
