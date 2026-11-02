import { describe, expect, it } from 'vitest';
import { isEquivalent } from '../src/core/move';
import { parseMove } from '../src/core/notation';
import type { Face } from '../src/core/types';
import { KeyboardInput, type KeyLike } from '../src/input/keyboard';
import { assignKey, DEFAULT_KEYMAP } from '../src/input/keymap';
import type { Variant } from '../src/input/screenMoves';
import { HOME_FRAME } from '../src/input/viewFrame';
import {
  clampLayer, depthChoices, motionOf, PANEL_FACES, panelFaceMove, panelMiddleMove, panelWholeCommand, showMiddle,
  VARIANTS,
} from '../src/ui/panelModel';
import { SIZES } from './helpers';

const SUFFIX: Record<Variant, string> = { cw: '', ccw: "'", double: '2' };
const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike =>
  ({ code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });
const MODS: Record<Variant, Partial<KeyLike>> = { cw: {}, ccw: { shiftKey: true }, double: { altKey: true } };

describe('操作パネル（04 §6）', () => {
  it('層の選択肢は N ≥ 4 で 1..ceil(N/2)、真ん中の行は 3×3×3 だけ', () => {
    expect(depthChoices(3)).toEqual([]);
    expect(depthChoices(4)).toEqual([1, 2]);
    expect(depthChoices(5)).toEqual([1, 2, 3]);
    expect(depthChoices(10)).toEqual([1, 2, 3, 4, 5]);
    expect(SIZES.filter(showMiddle)).toEqual([3]);
  });

  it('大きさを変えたら、選べない層は選べる範囲へ寄る。1 枚目の「まとめて」は外れる', () => {
    expect(clampLayer(4, { depth: 5, wide: true })).toEqual({ depth: 2, wide: true });
    expect(clampLayer(3, { depth: 3, wide: true })).toEqual({ depth: 1, wide: false });
  });

  it('I4: パネルの面ボタンの手は、記法を読んだ手と同じ（全 N・全層・まとめて・全向き）', () => {
    for (const n of SIZES) {
      const depths = depthChoices(n).length ? depthChoices(n) : [1];
      for (const depth of depths) {
        for (const wide of depth > 1 ? [false, true] : [false]) {
          for (const face of PANEL_FACES) {
            for (const v of VARIANTS) {
              const m = panelFaceMove(n, HOME_FRAME, face, v, { depth, wide });
              const text = depth === 1 ? `${face}${SUFFIX[v]}` : `${depth}${face}${wide ? 'w' : ''}${SUFFIX[v]}`;
              expect(m && isEquivalent(m, parseMove(text, n)), `${n} ${text}`).toBe(true);
            }
          }
        }
      }
    }
    for (const s of ['M', 'E', 'S'] as const) {
      for (const v of VARIANTS) {
        const m = panelMiddleMove(3, HOME_FRAME, s, v);
        expect(m && isEquivalent(m, parseMove(`${s}${SUFFIX[v]}`, 3))).toBe(true);
      }
    }
  });

  it('I4: どの向き（24 通り）でも、パネルとキーは同じ手・同じ視点コマンドになる', () => {
    for (let ori = 0; ori < 24; ori++) {
      const frame = { ori };
      for (const n of [3, 5]) {
        const kb = new KeyboardInput({ getSize: () => n, getFrame: () => frame, now: () => 0 });
        for (const face of PANEL_FACES) {
          for (const v of VARIANTS) {
            const r = kb.handle(key(`Key${face}`, MODS[v]));
            const m = panelFaceMove(n, frame, face, v, { depth: 1, wide: false });
            expect(r.kind === 'move' && m && isEquivalent(r.move, m)).toBe(true);
          }
        }
        for (const s of ['M', 'E', 'S'] as const) {
          for (const v of VARIANTS) {
            const r = kb.handle(key(`Key${s}`, MODS[v]));
            const m = panelMiddleMove(n, frame, s, v);
            expect(r.kind === 'move' && m && isEquivalent(r.move, m)).toBe(true);
          }
        }
        for (const a of ['x', 'y', 'z'] as const) {
          for (const v of VARIANTS) {
            const r = kb.handle(key(`Key${a.toUpperCase()}`, MODS[v]));
            expect(r).toEqual({ kind: 'view', command: panelWholeCommand(frame, a, v) });
          }
        }
      }
    }
  });

  it('ボタンの絵の向き：右は手前が上へ、上は手前が左へ、奥は前から見て反時計回り', () => {
    const cw = Object.fromEntries(PANEL_FACES.map((f) => [f, motionOf(f, 'cw')])) as Record<Face, string>;
    expect(cw).toEqual({ R: 'up', L: 'down', U: 'left', D: 'right', F: 'cw', B: 'ccw' });
    expect(motionOf('R', 'ccw')).toBe('down');
    expect(motionOf('R', 'double')).toBeNull();
  });
});

describe('割り当てを変えたキー（04 §5.2）', () => {
  it('変えたキーで同じ手になり、元のキーは入れ替えた相手の操作になる', () => {
    const { keymap, swapped } = assignKey(DEFAULT_KEYMAP, 'R', 'KeyJ');
    expect(swapped).toBeNull();
    const kb = new KeyboardInput({ getSize: () => 3, getFrame: () => HOME_FRAME, getKeymap: () => keymap, now: () => 0 });
    const r = kb.handle(key('KeyJ'));
    expect(r.kind === 'move' && isEquivalent(r.move, parseMove('R', 3))).toBe(true);
    expect(kb.handle(key('KeyR')).kind).toBe('ignored');

    const swap = assignKey(keymap, 'U', 'KeyF');
    expect(swap.swapped).toBe('F');
    const kb2 = new KeyboardInput({ getSize: () => 3, getFrame: () => HOME_FRAME, getKeymap: () => swap.keymap, now: () => 0 });
    const u = kb2.handle(key('KeyF'));
    const f = kb2.handle(key('KeyU'));
    expect(u.kind === 'move' && isEquivalent(u.move, parseMove('U', 3))).toBe(true);
    expect(f.kind === 'move' && isEquivalent(f.move, parseMove('F', 3))).toBe(true);
  });

  it('ホームとまとめての先行打鍵も、変えたキーで効く', () => {
    let k = assignKey(DEFAULT_KEYMAP, 'home', 'KeyH').keymap;
    k = assignKey(k, 'wide', 'KeyQ').keymap;
    const kb = new KeyboardInput({ getSize: () => 5, getFrame: () => HOME_FRAME, getKeymap: () => k, now: () => 0 });
    expect(kb.handle(key('KeyH'))).toEqual({ kind: 'command', command: 'home' });
    expect(kb.handle(key('Home')).kind).toBe('ignored');
    expect(kb.handle(key('KeyQ')).kind).toBe('prefix');
    const r = kb.handle(key('KeyR'));
    expect(r.kind === 'move' && isEquivalent(r.move, parseMove('Rw', 5))).toBe(true);
  });
});
