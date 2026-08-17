import { useRef } from 'react';

/**
 * 量子の巡回表示で「いま何の字を出すか」を決める（付録D-1 v1.14 §5.6.2・駒UI v0.14 §4.2）。
 *
 * **候補の並びの何番目か、では選ばない。**
 * v1.44 までは `kinds[tick % kinds.length]` だった。候補は対局が進むと**減る**ので、
 * 減った拍子に**前と同じ字を指す**ことがある（候補 4 つの 3 番目「金」を出している駒が、
 * 上位 2 つを失って候補 3 つになると、余りが 0 に戻って**また「金」**）。
 * **棋譜再生の自動再生は 1 秒ごとに手が進んで候補が減る**ため、巡回の切り替えと同じ
 * 間隔でこれが起き、**その駒だけ止まって見えていた**（2026-08-17 ユーザー報告）。
 *
 * ここでは**駒ごとに「いま出している字」を覚え、その次の候補へ送る**。
 * 候補が増えても減っても順送りが途切れず、**同じ字が続くのは候補が 1 つになったとき
 * （＝確定して「？」も消えるとき）だけ**になる。
 */
export type CycleReader = (key: string, kinds: string[]) => string;

/** いま出している字の「次」を返す。候補から消えていたら先頭へ。 */
export function nextShown(prev: string | undefined, kinds: string[]): string {
  if (kinds.length === 0) return '';
  if (prev === undefined) return kinds[0];
  const at = kinds.indexOf(prev);
  if (at < 0) return kinds[0];
  return kinds[(at + 1) % kinds.length];
}

type CycleState = { tick: number; shown: Map<string, string>; done: Set<string> };

/**
 * `tick` が 1 つ進むごとに、駒ごとの表示を 1 つ送る読み取り口を返す。
 *
 * **同じ tick では何度呼んでも同じ答え**（描画が 2 回走っても 2 つ先へ飛ばない）。
 * 巡回表示でないときは先頭の字を返すだけで、覚えている字も進めない。
 */
export function useQuantumCycle(tick: number, enabled = true): CycleReader {
  const ref = useRef<CycleState>({ tick: -1, shown: new Map(), done: new Set() });
  if (ref.current.tick !== tick) {
    ref.current = { tick, shown: ref.current.shown, done: new Set() };
  }
  return (key: string, kinds: string[]): string => {
    if (!enabled || kinds.length === 0) return kinds[0] ?? '';
    const st = ref.current;
    if (st.done.has(key)) return st.shown.get(key) ?? kinds[0];
    const now = nextShown(st.shown.get(key), kinds);
    st.shown.set(key, now);
    st.done.add(key);
    return now;
  };
}
