// 手の履歴：シャッフル由来と利用者由来の 2 系統、Undo / Redo（設計 02 §4）
import { inverse } from '../core/move';
import type { Move } from '../core/types';

export class MoveHistory {
  private scrambleLog: Move[] = [];
  private userLog: Move[] = [];
  private redoStack: Move[] = [];

  /** userLog と redoStack も消す */
  setScramble(moves: readonly Move[]): void {
    this.scrambleLog = [...moves];
    this.userLog = [];
    this.redoStack = [];
  }

  push(move: Move): void {
    this.userLog.push(move);
    this.redoStack = [];
  }

  /** 打ち消すために実行すべき手（＝逆手）。userLog に逆手は積まない（INV3） */
  undo(): Move | null {
    const m = this.userLog.pop();
    if (!m) return null;
    this.redoStack.push(m);
    return inverse(m);
  }

  redo(): Move | null {
    const m = this.redoStack.pop();
    if (!m) return null;
    this.userLog.push(m);
    return m;
  }

  clear(): void {
    this.setScramble([]);
  }

  get moveCount(): number {
    return this.userLog.length;
  }

  get canUndo(): boolean {
    return this.userLog.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 完成状態から現在までに適用された手の列 */
  get fullHistory(): readonly Move[] {
    return [...this.scrambleLog, ...this.userLog];
  }

  guaranteedSolution(): Move[] {
    return [...this.fullHistory].reverse().map(inverse);
  }
}
