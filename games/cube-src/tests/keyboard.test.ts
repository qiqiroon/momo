import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { isEquivalent } from '../src/core/move';
import { formatMove, parseMove } from '../src/core/notation';
import { KeyboardInput, PREFIX_TIMEOUT_MS, type KeyLike, type KeyResult } from '../src/input/keyboard';
import { ViewController } from '../src/input/viewController';
import { HOME_FRAME, type ViewFrame } from '../src/input/viewFrame';

const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike =>
  ({ code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

const setup = (n: number, frame: () => ViewFrame = () => HOME_FRAME) => {
  let t = 0;
  const kb = new KeyboardInput({ getSize: () => n, getFrame: frame, now: () => t });
  const press = (code: string, mods: Partial<KeyLike> = {}): KeyResult => kb.handle(key(code, mods));
  const notation = (r: KeyResult) => (r.kind === 'move' ? formatMove(r.move) : r.kind);
  return { kb, press, notation, advance: (ms: number) => (t += ms) };
};

describe('キーボード（04 §5.1）', () => {
  it('例の表（N=5、ホームの向き）', () => {
    const { press, notation } = setup(5);
    expect(notation(press('KeyR'))).toBe('R');
    expect(notation(press('KeyR', { shiftKey: true }))).toBe("R'");
    expect(notation(press('KeyR', { altKey: true }))).toBe('R2');
    press('Digit3');
    const r3 = press('KeyR');
    // N=5 の 3R は真ん中の層なので、表記は M'（同じ手）になる
    expect(r3.kind === 'move' && isEquivalent(r3.move, parseMove('3R', 5))).toBe(true);
    press('Digit2');
    expect(notation(press('KeyR'))).toBe('2R');
    press('KeyW');
    expect(notation(press('KeyR'))).toBe('Rw');
    press('Digit3');
    press('KeyW');
    expect(notation(press('KeyR'))).toBe('3Rw');
    expect(notation(press('KeyM'))).toBe('M');
    expect(notation(press('KeyE', { shiftKey: true }))).toBe("E'");
  });

  it('6 つの面のキーが記法と同じ手になる（I4 のキー側）', () => {
    const { press } = setup(3);
    for (const f of ['U', 'D', 'L', 'R', 'F', 'B']) {
      const r = press(`Key${f}`);
      expect(r.kind === 'move' && isEquivalent(r.move, parseMove(f, 3))).toBe(true);
    }
  });

  it('I5: 先行打鍵は 1.5 秒で失効し、以後 1 に戻る', () => {
    const { kb, press, notation, advance } = setup(5);
    press('Digit3');
    expect(kb.prefix.depth).toBe(3);
    advance(PREFIX_TIMEOUT_MS + 1);
    expect(kb.prefix.depth).toBe(1);
    expect(notation(press('KeyR'))).toBe('R');
  });

  it('深さが大きさを越えたら何もしない', () => {
    const { press } = setup(3);
    press('Digit4');
    expect(press('KeyR').kind).toBe('ignored');
  });

  it('N が偶数のとき M・E・S は何もしない', () => {
    const { press } = setup(4);
    expect(press('KeyM').kind).toBe('ignored');
  });

  it('x・y・z は視点コマンド（手数に数えない）。先行打鍵は消える', () => {
    const { kb, press } = setup(5);
    press('Digit3');
    const r = press('KeyY');
    expect(r).toEqual({ kind: 'view', command: { kind: 'rotate', about: 'U', quarter: -1 } });
    expect(kb.prefix.depth).toBe(1);
    expect(press('KeyX', { shiftKey: true })).toEqual({ kind: 'view', command: { kind: 'rotate', about: 'R', quarter: 1 } });
  });

  it('Ctrl / ⌘ の付いたキーは回さない。Ctrl+Z・Ctrl+Y・Ctrl+Shift+Z は Undo / Redo', () => {
    const { press } = setup(3);
    expect(press('KeyR', { ctrlKey: true }).kind).toBe('ignored');
    expect(press('KeyZ', { ctrlKey: true })).toEqual({ kind: 'command', command: 'undo' });
    expect(press('KeyZ', { ctrlKey: true, shiftKey: true })).toEqual({ kind: 'command', command: 'redo' });
    expect(press('KeyY', { metaKey: true })).toEqual({ kind: 'command', command: 'redo' });
    expect(press('Home')).toEqual({ kind: 'command', command: 'home' });
  });

  it('押しっぱなしの連続入力は無視する', () => {
    const { press } = setup(3);
    expect(press('KeyR', { repeat: true }).kind).toBe('ignored');
  });

  it('I7: ホームから y のあと、r は世界の奥の面を回す（axis z, turns +1, slice 0）', () => {
    const view = new ViewController(new PerspectiveCamera(), { viewGrid: 0 });
    view.setViewport(800, 600);
    const { press } = setup(3, () => view.frame);
    const y = press('KeyY');
    if (y.kind !== 'view') throw new Error('y は視点コマンドのはず');
    view.command(y.command);
    const r = press('KeyR');
    expect(r.kind === 'move' && r.move).toEqual({ n: 3, axis: 'z', slices: 1, turns: 1 });
  });
});
