// 回転要求の待ち行列（設計 02 §3.1・§3.2）
// Undo/Redo は取り出した時点の履歴で解決するため、Move ではなく要求を並べる
import type { Move, MoveOrigin } from '../core/types';

export type MoveRequest =
  | { kind: 'move'; move: Move; origin: MoveOrigin }
  | { kind: 'undo' }
  | { kind: 'redo' };

export const QUEUE_CAPACITY = 8;

export class MoveQueue {
  readonly capacity: number;
  private readonly items: MoveRequest[] = [];

  constructor(capacity = QUEUE_CAPACITY) {
    this.capacity = capacity;
  }

  get length(): number {
    return this.items.length;
  }

  /** false＝満杯（要求は捨てる） */
  push(req: MoveRequest): boolean {
    if (this.items.length >= this.capacity) return false;
    this.items.push(req);
    return true;
  }

  shift(): MoveRequest | null {
    return this.items.shift() ?? null;
  }

  clear(): void {
    this.items.length = 0;
  }
}
