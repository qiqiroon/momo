/**
 * 使える AI の目録 (Phase 3)。
 *
 * 思考ルーチン (adapters/*) が起動時に自己登録し、画面側は「いま選べるもの」を
 * ここから受け取る。**core は個々の思考ルーチンを知らない**ので、
 * A ビルド (思考ルーチンを積まない) では目録が空になり、対 AI の入口が出ないだけになる。
 *
 * 並び順は重み降順 (付録 D-5 §6.3)。同じ重みなら登録順。
 */

import type { EngineDescriptor } from './types';

const engines: EngineDescriptor[] = [];

export function registerEngine(descriptor: EngineDescriptor): void {
  const existing = engines.findIndex((e) => e.id === descriptor.id);
  if (existing >= 0) {
    engines[existing] = descriptor;
    return;
  }
  engines.push(descriptor);
}

/** 重み降順で全件返す。 */
export function listEngines(): EngineDescriptor[] {
  return [...engines].sort((a, b) => b.weight - a.weight);
}

export function findEngine(id: string): EngineDescriptor | undefined {
  return engines.find((e) => e.id === id);
}

/** 既定で選ばれる AI (重み最大)。1 つも積まれていなければ undefined。 */
export function defaultEngine(): EngineDescriptor | undefined {
  return listEngines()[0];
}

/** テスト用。 */
export function clearEngines(): void {
  engines.length = 0;
}
