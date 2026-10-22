// アシストモードの数えものを画面とは別の働き手（Web Worker）で行う（段階2・段階4）。
//  - plan：役の候補一覧（全部数えると 0.1〜0.5 秒かかる手がある）
//  - calls：鳴く前の注意（鳴きの選び方ごとに、鳴いたあとの候補を数え直す＝1 通り最大 0.15 秒）
//  - advice：行動の助言（Apocalypse の CPU の考えを使う＝先読みで重いことがある）
// 画面の側で数えると、そのあいだ卓が止まる。
// 受け取る：{ id, kind, ... }／返す：{ id, result }（Set は構造化複製でそのまま送れる）
// 数えているあいだに届いた同じ種類の頼みは、最後のものだけ数える（CPU が続けて切ると頼みがたまり、古い局面を数え続けて遅れる）
import type { Action } from '../engine/round';
import type { GameState } from '../engine/state';
import type { Seat } from '../engine/events';
import { adviceOf } from './advice';
import { callLoss } from './callCheck';
import { yakuPlan, type YakuPlan } from './yakuPlan';

/** 働き手で考える長さの上限（ミリ秒）。携帯でも「あと 6 枚」の段まで数えきれる長さ */
const WORKER_BUDGET_MS = 1500;

export type Job =
  | { id: number; kind: 'plan'; view: GameState; seat: Seat }
  | { id: number; kind: 'calls'; view: GameState; seat: Seat; calls: Action[]; before: YakuPlan[] }
  | { id: number; kind: 'advice'; view: GameState; seat: Seat; legal: Action[]; plan: YakuPlan[] };

const latest = new Map<Job['kind'], Job>();

function run(job: Job): unknown {
  if (job.kind === 'plan') return yakuPlan(job.view, job.seat, { budgetMs: WORKER_BUDGET_MS });
  if (job.kind === 'advice') return adviceOf(job.view, job.seat, job.legal, job.plan);
  return job.calls.flatMap((a) => {
    const loss = callLoss(job.view, job.seat, a, job.before);
    return loss ? [{ a, loss }] : [];
  });
}

self.onmessage = (e: MessageEvent<Job>) => {
  latest.set(e.data.kind, e.data);
  // すぐには数えない：たまっている頼みを先に受け取り、最後のものだけ数える
  setTimeout(() => {
    const job = latest.get(e.data.kind);
    if (!job || job.id !== e.data.id) return;
    latest.delete(job.kind);
    self.postMessage({ id: job.id, result: run(job) });
  }, 0);
};
