// キーボード入力（設計 04 §5）。割り当ては keymap.ts（変えられて保存される）
// 面のキーは画面基準：r は「いま画面の右に見えている面」を回す（決定 D13）
import type { Move } from '../core/types';
import { actionOf, DEFAULT_KEYMAP, type Keymap } from './keymap';
import { faceMove, middleMove, WHOLE_FACE, wholeCommand } from './screenMoves';
import type { ViewCommand } from './viewController';
import type { ViewFrame } from './viewFrame';

export type CommandName = 'undo' | 'redo' | 'home';

export type KeyResult =
  | { kind: 'move'; move: Move }
  | { kind: 'view'; command: ViewCommand }
  | { kind: 'command'; command: CommandName }
  | { kind: 'prefix' }
  | { kind: 'ignored' };

/** KeyboardEvent のうち使うところだけ（テストで偽物を渡せるように） */
export interface KeyLike {
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
}

export const PREFIX_TIMEOUT_MS = 1500;



export interface KeyboardContext {
  getSize: () => number;
  getFrame: () => ViewFrame;
  /** 省略時は既定の割り当て */
  getKeymap?: () => Keymap;
  now?: () => number;
}

export class KeyboardInput {
  private readonly ctx: KeyboardContext;
  private depth = 1;
  private wide = false;
  private prefixAt = 0;

  constructor(ctx: KeyboardContext) {
    this.ctx = ctx;
  }

  /** HUD 表示用。失効していれば既定（深さ 1・ワイドなし） */
  get prefix(): { depth: number; wide: boolean } {
    this.expire();
    return { depth: this.depth, wide: this.wide };
  }

  handle(e: KeyLike): KeyResult {
    // Undo / Redo だけは Ctrl を使う（ブラウザ標準の編集の操作と同じ）
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyZ') return { kind: 'command', command: e.shiftKey ? 'redo' : 'undo' };
      if (e.code === 'KeyY') return { kind: 'command', command: 'redo' };
      return { kind: 'ignored' };
    }
    const action = actionOf(this.ctx.getKeymap?.() ?? DEFAULT_KEYMAP, e.code);
    if (action === 'home') return { kind: 'command', command: 'home' };
    if (e.repeat) return { kind: 'ignored' };
    this.expire();
    const now = this.now();

    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      this.depth = digit[1] === '0' ? 10 : Number(digit[1]);
      this.prefixAt = now;
      return { kind: 'prefix' };
    }
    if (!action) return { kind: 'ignored' };
    if (action === 'wide') {
      this.wide = true;
      this.prefixAt = now;
      return { kind: 'prefix' };
    }

    const variant = e.altKey ? 'double' : e.shiftKey ? 'ccw' : 'cw';
    const n = this.ctx.getSize();
    const frame = this.ctx.getFrame();
    const { depth, wide } = this;
    // ここから先はどれも先行打鍵を使い切る（全体回転・真ん中の層は無視して消す）
    this.clearPrefix();

    if (action === 'x' || action === 'y' || action === 'z') {
      return { kind: 'view', command: wholeCommand(frame, WHOLE_FACE[action], variant) };
    }
    if (action === 'M' || action === 'E' || action === 'S') {
      const move = middleMove(n, frame, action, variant);
      return move ? { kind: 'move', move } : { kind: 'ignored' };
    }
    // w だけ（深さ 1）は外側 2 枚（Rw）
    const to = wide && depth === 1 ? 2 : depth;
    const move = faceMove(n, frame, action, variant, wide ? 1 : depth, to);
    return move ? { kind: 'move', move } : { kind: 'ignored' };
  }

  private now(): number {
    return (this.ctx.now ?? (() => performance.now()))();
  }

  private expire(): void {
    if ((this.depth !== 1 || this.wide) && this.now() - this.prefixAt > PREFIX_TIMEOUT_MS) this.clearPrefix();
  }

  private clearPrefix(): void {
    this.depth = 1;
    this.wide = false;
  }
}
