// CPU の強さ（段階7の5・Q4=A）。3 人まとめて 1 つ。呼び名は MOMO Works 共通の Easy / Hard / Apocalypse（訳さない・既定は Hard）。
// 一人用は端末に覚える。オンラインはホストが待合で選ぶ（空き席の CPU はホストの端末が打つ）。
// 同じ山で勝負のリンクと牌譜にも残す。

import type { Seat } from '../engine/events';
import type { Action } from '../engine/round';
import type { GameState } from '../engine/state';
import { easyCpu } from './easy';
import { APOCALYPSE, HARD, makeThinker } from './thinker';

export type Strength = 'easy' | 'hard' | 'apocalypse';
export const STRENGTHS: readonly Strength[] = ['easy', 'hard', 'apocalypse'];
export const DEFAULT_STRENGTH: Strength = 'hard';
export const STRENGTH_LABEL: Record<Strength, string> = { easy: 'Easy', hard: 'Hard', apocalypse: 'Apocalypse' };

export type Cpu = (view: GameState, seat: Seat) => Action;

const CPUS: Record<Strength, Cpu> = {
  easy: easyCpu,
  hard: makeThinker(HARD),
  apocalypse: makeThinker(APOCALYPSE),
};

export const cpuOf = (s: Strength): Cpu => CPUS[s];

/** 知らない値は既定（Hard）にする（古いリンク・牌譜・控えには入っていない） */
export const strengthOf = (raw: unknown): Strength => (STRENGTHS as readonly unknown[]).includes(raw) ? (raw as Strength) : DEFAULT_STRENGTH;

const KEY = 'momo-mahjong.cpuStrength';

/** 端末に覚えた強さ（読めなければ Hard） */
export function loadStrength(): Strength {
  try {
    return strengthOf(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_STRENGTH;
  }
}

export function saveStrength(s: Strength): void {
  try {
    localStorage.setItem(KEY, s);
  } catch {
    // 覚えられなくても遊べる
  }
}
