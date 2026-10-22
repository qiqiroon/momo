// 役の候補一覧を画面とは別の働き手（Web Worker）で数える（アシストモード 段階2）。
// 全部数えると 0.1〜0.5 秒かかる手がある（あと 6〜7 枚の段）。画面の側で数えると、そのあいだ卓が止まる。
// 受け取る：{ id, view, seat }／返す：{ id, list }（spare は Set のままでは送れないので配列にする）
import type { GameState } from '../engine/state';
import type { Seat } from '../engine/events';
import { yakuPlan } from './yakuPlan';

/** 働き手で考える長さの上限（ミリ秒）。携帯でも「あと 6 枚」の段まで数えきれる長さ */
const WORKER_BUDGET_MS = 1500;

self.onmessage = (e: MessageEvent<{ id: number; view: GameState; seat: Seat }>) => {
  const { id, view, seat } = e.data;
  const list = yakuPlan(view, seat, { budgetMs: WORKER_BUDGET_MS }).map((p) => ({ ...p, spare: [...p.spare] }));
  self.postMessage({ id, list });
};
