import { describe, expect, it } from 'vitest';
import { applyMove, colorAt, createSolved, cubieAt } from '../src/core/cubeState';
import { inverse, isEquivalent } from '../src/core/move';
import { parseMove } from '../src/core/notation';
import { FACES, FACE_NORMAL, type Face, type Vec3 } from '../src/core/types';
import {
  arrowMetrics, arrowsFor, arrowToAction, cellOf, dirFace, FACE_FRAME, IN_PLANE_DIRS, keyLabelFor, pickArrow,
  sameArrow, sameRotation, showsLabel, type ArrowId,
} from '../src/input/arrowActions';
import { pushAxis, pushToMove, sliceIndexOf } from '../src/input/dragToMove';
import { KeyboardInput, type KeyLike } from '../src/input/keyboard';
import { assignKey, DEFAULT_KEYMAP, KEY_ACTIONS, keyLabel, type Keymap } from '../src/input/keymap';
import { HOME_FRAME } from '../src/input/viewFrame';
import { panelFaceMove } from '../src/ui/panelModel';
import { SIZES } from './helpers';

// + 0 で −0 を 0 にそろえる
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0,
];
const strip = (face: Face, dir: 'up' | 'down' | 'left' | 'right', index: number): ArrowId =>
  ({ kind: 'strip', face, dir, index });
const moveOf = (id: ArrowId, n: number) => {
  const a = arrowToAction(id, n);
  if (a.kind !== 'move') throw new Error('not a move');
  return a.move;
};

/** 小キューブの位置 → そのマスの面の中の点（s, t）での世界座標 */
function worldPoint(face: Face, s: number, t: number, lift: number): Vec3 {
  const m = arrowMetrics(1);
  const n = FACE_NORMAL[face];
  const u = FACE_NORMAL[FACE_FRAME[face].u];
  const v = FACE_NORMAL[FACE_FRAME[face].v];
  const d = m.h + lift;
  return [0, 1, 2].map((i) => n[i] * d + u[i] * s + v[i] * t) as unknown as Vec3;
}

describe('矢印の置き場所（10 §2）', () => {
  it('AR1: 全 6 面で e_u × e_v = n', () => {
    for (const f of FACES) {
      const { u, v } = FACE_FRAME[f];
      expect(cross(FACE_NORMAL[u], FACE_NORMAL[v])).toEqual(FACE_NORMAL[f]);
    }
  });

  it('AR2: 矢印は 4n + 8 本（全 N・全 6 面）', () => {
    for (const n of SIZES) {
      for (const f of FACES) expect(arrowsFor(f, n)).toHaveLength(4 * n + 8);
    }
  });
});

describe('矢印 → 回転（10 §4）', () => {
  it('AR3: 正面を選んだときの検算 4 件', () => {
    expect(isEquivalent(moveOf(strip('F', 'up', 2), 3), parseMove('R', 3))).toBe(true);
    expect(isEquivalent(moveOf(strip('F', 'up', 0), 3), parseMove("L'", 3))).toBe(true);
    expect(isEquivalent(moveOf(strip('F', 'right', 2), 3), parseMove("U'", 3))).toBe(true);
    expect(isEquivalent(moveOf(strip('F', 'down', 1), 3), parseMove('M', 3))).toBe(true);
  });

  it('AR4: 列矢印は、同じマスを同じ向きへドラッグした手と同じ（全 N・全面・全向き・全マス）', () => {
    for (const n of SIZES) {
      const st = createSolved(n);
      for (const face of FACES) {
        const nv = FACE_NORMAL[face];
        for (const c of st.cubies) {
          // その面に出ている小キューブだけ
          const onFace = [0, 1, 2].every((i) => nv[i] === 0 || c.pos[i] === (nv[i] > 0 ? n - 1 : 0));
          if (!onFace) continue;
          const cell = cellOf(face, c.pos, n);
          for (const dir of IN_PLANE_DIRS) {
            const d = dirFace(face, dir);
            const drag = pushToMove(n, face, d, sliceIndexOf(c.pos, pushAxis(face, d).axis));
            const index = dir === 'up' || dir === 'down' ? cell.u : cell.v;
            expect(isEquivalent(moveOf(strip(face, dir, index), n), drag), `${n} ${face} ${dir} ${c.pos}`).toBe(true);
          }
        }
      }
    }
  });

  it('列矢印を押すと、その列のステッカーが矢印の向きの面へ移る（向きの確かめ。U-V1 の残り）', () => {
    const color = (st: ReturnType<typeof createSolved>, pos: Vec3, face: Face) => colorAt(cubieAt(st, pos)!, face);
    // 正面の上辺の右端の矢印：正面の右の列（緑）が上の面の右の列へ
    let st = createSolved(3);
    applyMove(st, moveOf(strip('F', 'up', 2), 3));
    expect(color(st, [2, 2, 2], 'U')).toBe('G');
    expect(color(st, [2, 2, 0], 'U')).toBe('G');
    // 正面の右辺の上端の矢印：正面の上の行（緑）が右の面の上の行へ
    st = createSolved(3);
    applyMove(st, moveOf(strip('F', 'right', 2), 3));
    expect(color(st, [2, 2, 2], 'R')).toBe('G');
    expect(color(st, [2, 2, 0], 'R')).toBe('G');
  });

  it('AR5: 向かい合う辺の列矢印（同じ列で逆向き）は互いに逆', () => {
    for (const n of SIZES) {
      for (const f of FACES) {
        for (let k = 0; k < n; k++) {
          expect(isEquivalent(moveOf(strip(f, 'down', k), n), inverse(moveOf(strip(f, 'up', k), n)))).toBe(true);
          expect(isEquivalent(moveOf(strip(f, 'left', k), n), inverse(moveOf(strip(f, 'right', k), n)))).toBe(true);
        }
      }
    }
  });

  it('AR6: 面回し矢印は、キー・パネルの同じ面の手と同じ', () => {
    for (const n of SIZES) {
      for (const f of FACES) {
        for (const cw of [true, false]) {
          const m = moveOf({ kind: 'faceTurn', face: f, cw }, n);
          const p = panelFaceMove(n, HOME_FRAME, f, cw ? 'cw' : 'ccw', { depth: 1, wide: false });
          expect(p && isEquivalent(m, p)).toBe(true);
        }
      }
    }
  });

  it('全体矢印は視点コマンド：正面の上向きは x（手前が上へ）、正面の時計回りは z と同じ', () => {
    const roll = arrowToAction({ kind: 'wholeRoll', face: 'F', dir: 'up' }, 3);
    expect(roll.kind === 'view' && sameRotation(roll.command, { kind: 'rotate', about: 'R', quarter: -1 })).toBe(true);
    const twist = arrowToAction({ kind: 'wholeTwist', face: 'F', cw: true }, 3);
    expect(twist.kind === 'view' && sameRotation(twist.command, { kind: 'rotate', about: 'F', quarter: -1 })).toBe(true);
  });
});

describe('当たり判定（10 §6.3）', () => {
  it('AR7: 各矢印の中心へ向けた視線はその矢印、面の内側は null（全 N・全面）', () => {
    for (const n of SIZES) {
      const m = arrowMetrics(n);
      for (const f of FACES) {
        const nv = FACE_NORMAL[f];
        const r: Vec3 = [-nv[0], -nv[1], -nv[2]];
        const from = (s: number, t: number): Vec3 => {
          const p = worldPoint(f, s, t, m.lift);
          return [p[0] + nv[0] * 5, p[1] + nv[1] * 5, p[2] + nv[2] * 5];
        };
        for (const a of arrowsFor(f, n)) {
          expect(sameArrow(pickArrow(from(a.s, a.t), r, f, n), a.id), `${n} ${f} ${JSON.stringify(a.id)}`).toBe(true);
        }
        expect(pickArrow(from(0, 0), r, f, n)).toBeNull();
        expect(pickArrow(from(m.h * 0.9, -m.h * 0.9), r, f, n)).toBeNull();
        // 裏から見ているときは当たらない
        expect(pickArrow(worldPoint(f, 0, m.corner, -10), nv, f, n)).toBeNull();
        // 遠く離れたところは当たらない
        expect(pickArrow(from(m.h * 3, m.h * 3), r, f, n)).toBeNull();
      }
    }
  });
});

/** 表示 `3 ⇧R` を、キーの押し方に直して KeyboardInput に通す */
function pressLabel(label: string, kb: KeyboardInput, keymap: Keymap) {
  const m = /^(?:(\d+) )?(⇧)?(.+)$/.exec(label)!;
  if (m[1]) kb.handle(key(`Digit${m[1]}`));
  const action = KEY_ACTIONS.find((a) => keyLabel(keymap[a]) === m[3])!;
  return kb.handle(key(keymap[action], { shiftKey: !!m[2] }));
}
const key = (code: string, mods: Partial<KeyLike> = {}): KeyLike =>
  ({ code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe('キー表示の逆引き（10 §5）', () => {
  it('AR8: 既定の割り当て・ホームの向きで、検算 4 件は R ⇧L ⇧U M', () => {
    const label = (id: ArrowId) => keyLabelFor(arrowToAction(id, 3), DEFAULT_KEYMAP, HOME_FRAME, 3);
    expect(label(strip('F', 'up', 2))).toBe('R');
    expect(label(strip('F', 'up', 0))).toBe('⇧L');
    expect(label(strip('F', 'right', 2))).toBe('⇧U');
    expect(label(strip('F', 'down', 1))).toBe('M');
    // 5×5×5 の右から 2 列目（左から 3 列目）
    expect(keyLabelFor(arrowToAction(strip('F', 'up', 3), 5), DEFAULT_KEYMAP, HOME_FRAME, 5)).toBe('2 R');
  });

  it('AR9: 割り当てを変えると表示も変わる（右の面を J へ）', () => {
    const k = assignKey(DEFAULT_KEYMAP, 'R', 'KeyJ').keymap;
    expect(keyLabelFor(arrowToAction(strip('F', 'up', 2), 3), k, HOME_FRAME, 3)).toBe('J');
  });

  it('どの向き（24 通り）でも、表示どおりにキーを押すと矢印と同じ回転になる', () => {
    for (let ori = 0; ori < 24; ori++) {
      const frame = { ori };
      for (const n of [1, 2, 3, 4, 5]) {
        const kb = new KeyboardInput({ getSize: () => n, getFrame: () => frame, now: () => 0 });
        for (const f of FACES) {
          for (const a of arrowsFor(f, n)) {
            const action = arrowToAction(a.id, n);
            const label = keyLabelFor(action, DEFAULT_KEYMAP, frame, n);
            expect(label, `${ori} ${n} ${JSON.stringify(a.id)}`).not.toBeNull();
            const r = pressLabel(label!, kb, DEFAULT_KEYMAP);
            if (action.kind === 'move') {
              expect(r.kind === 'move' && isEquivalent(r.move, action.move), `${ori} ${n} ${label}`).toBe(true);
            } else {
              expect(r.kind === 'view' && sameRotation(r.command, action.command), `${ori} ${label}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('N ≥ 4 の札は、カーソルの列・行と列矢印以外だけ', () => {
    const cursor = { u: 1, v: 3 };
    expect(showsLabel(strip('F', 'up', 1), 5, cursor, 'auto')).toBe(true);
    expect(showsLabel(strip('F', 'up', 2), 5, cursor, 'auto')).toBe(false);
    expect(showsLabel(strip('F', 'left', 3), 5, cursor, 'auto')).toBe(true);
    expect(showsLabel(strip('F', 'up', 2), 3, cursor, 'auto')).toBe(true);
    expect(showsLabel({ kind: 'faceTurn', face: 'F', cw: true }, 5, null, 'auto')).toBe(true);
    expect(showsLabel(strip('F', 'up', 1), 5, cursor, 'none')).toBe(false);
  });
});
