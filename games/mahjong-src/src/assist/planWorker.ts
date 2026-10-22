// 役の候補一覧を画面とは別の働き手（Web Worker）で数える（アシストモード 段階2）。
// 全部数えると 0.1〜1.5 秒かかる手がある（日本式のあと 6〜7 枚の段・香港の 3 番に届く形が遠い手）。画面の側で数えると、そのあいだ卓が止まる。
// 受け取る：{ id, view, seat }／返す：{ id, list }（spare は Set のままでは送れないので配列にする）
// 数えているあいだに届いた頼みは、最後のものだけ数える（CPU が続けて切ると頼みがたまり、古い局面を数え続けて遅れる）
import type { GameState } from '../engine/state';
import type { Seat } from '../engine/events';
import { yakuPlan } from './yakuPlan';

/** 働き手で考える長さの上限（ミリ秒）。携帯でも「あと 6 枚」の段まで数えきれる長さ */
const WORKER_BUDGET_MS = 1500;

type Job = { id: number; view: GameState; seat: Seat };
let latest: Job | null = null;

self.onmessage = (e: MessageEvent<Job>) => {
  latest = e.data;
  // すぐには数えない：たまっている頼みを先に受け取り、最後のものだけ数える
  setTimeout(() => {
    const job = latest;
    if (!job || job.id !== e.data.id) return;
    latest = null;
    const list = yakuPlan(job.view, job.seat, { budgetMs: WORKER_BUDGET_MS }).map((p) => ({ ...p, spare: [...p.spare] }));
    self.postMessage({ id: job.id, list });
  }, 0);
};
