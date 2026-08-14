/**
 * 使える AI の目録 (Phase 3)。
 *
 * 思考ルーチン (adapters/*) が起動時に自己登録し、画面側は「いま選べるもの」を
 * ここから受け取る。**core は個々の思考ルーチンを知らない**ので、
 * A ビルド (思考ルーチンを積まない) では目録が空になり、対 AI の入口が出ないだけになる。
 *
 * 並び順と既定選択は **モードごと** (親 §7.1.1・付録 D-5 §6.3)。
 * 同じ 1 本の重みで全モードを決めると、「本将棋では外部エンジンが最強・
 * 量子では汎用MCTS が最強」のように**モードによって最強が入れ替わる状況**を
 * 表せないため。
 */

import type { AiMode, EngineChoice, EngineDescriptor } from './types';

const engines: EngineDescriptor[] = [];

export function registerEngine(descriptor: EngineDescriptor): void {
  const existing = engines.findIndex((e) => e.id === descriptor.id);
  if (existing >= 0) {
    engines[existing] = descriptor;
    return;
  }
  engines.push(descriptor);
}

/** そのモードでの重み。名乗っていなければ null (=対応しない)。 */
export function weightOf(descriptor: EngineDescriptor, mode: AiMode): number | null {
  const w = descriptor.weights[mode];
  return typeof w === 'number' ? w : null;
}

export function supports(descriptor: EngineDescriptor, mode: AiMode): boolean {
  return weightOf(descriptor, mode) !== null;
}

/**
 * そのモードで一覧に並べる順。
 *
 * 対応するものを重み降順で先に、対応しないものを登録順で後ろに置く。
 * 対応しないものも**行としては出す**(理由を添えて選べなくする=付録 D-5 §6.2)。
 * 重みが同じなら登録順を保つ (安定な並べ替え)。
 */
export function listEngines(mode: AiMode): EngineChoice[] {
  const rows = engines.map((descriptor) => {
    const weight = weightOf(descriptor, mode);
    return { descriptor, weight, supported: weight !== null };
  });
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.supported !== b.row.supported) return a.row.supported ? -1 : 1;
      if (a.row.supported && b.row.supported && a.row.weight !== b.row.weight) {
        return (b.row.weight as number) - (a.row.weight as number);
      }
      return a.index - b.index;
    })
    .map((x) => x.row);
}

export function findEngine(id: string): EngineDescriptor | undefined {
  return engines.find((e) => e.id === id);
}

/** そのモードで既定に選ばれる AI (対応するもののうち重み最大)。1 つも無ければ undefined。 */
export function defaultEngine(mode: AiMode): EngineDescriptor | undefined {
  return listEngines(mode).find((c) => c.supported)?.descriptor;
}

/**
 * モードが変わったときに選び直す (親 §7.1.1)。
 *
 * いま選んでいるものが新しいモードにも対応しているなら**その選択を尊重して残す**。
 * 対応しなくなったときだけ、新しいモードの既定へ移す。
 */
export function resolveEngineId(currentId: string | null, mode: AiMode): string | null {
  if (currentId) {
    const current = findEngine(currentId);
    if (current && supports(current, mode)) return current.id;
  }
  return defaultEngine(mode)?.id ?? null;
}

/** テスト用。 */
export function clearEngines(): void {
  engines.length = 0;
}
