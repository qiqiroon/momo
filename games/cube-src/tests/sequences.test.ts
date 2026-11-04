// 手順の記録・再生とドラッグの判定（2026-11-04 作者の指示）
import { describe, expect, it } from 'vitest';
import { applyMove, createSolved } from '../src/core/cubeState';
import { isEquivalent } from '../src/core/move';
import { FACES, type Face, type Move } from '../src/core/types';
import { GameSession } from '../src/engine/gameSession';
import { layerDragOf, LAYER_THRESHOLD, TOUCH_LAYER_THRESHOLD } from '../src/input/pointerRouter';
import { faceMove, type Variant } from '../src/input/screenMoves';
import { HOME_FRAME, type ViewFrame } from '../src/input/viewFrame';
import type { StorageLike } from '../src/ui/records';
import { fromSeqMark, markAt, MarkSet, onSurface, spotBefore, spotOf, toSeqMark } from '../src/ui/marks';
import {
  adaptMark, adaptStep, moveOf, playableOn, SEQUENCES_KEY, SequenceRecorder, SequenceStore, stepOf,
} from '../src/ui/sequences';
import { mulberry32 } from './helpers';

const VARIANTS: Variant[] = ['cw', 'ccw', 'double'];

/** 入力から作れる形の手（画面の面から数えて from〜to 枚目）をでたらめに */
function inputMove(n: number, frame: ViewFrame, rng: () => number): Move {
  const face = FACES[Math.floor(rng() * 6)] as Face;
  const from = 1 + Math.floor(rng() * n);
  const to = from + Math.floor(rng() * (n - from + 1));
  return faceMove(n, frame, face, VARIANTS[Math.floor(rng() * 3)], from, to)!;
}

/** 回っている手を最後まで進める（1 回の tick で進む時間には上限がある） */
function flush(s: GameSession): void {
  for (let i = 0; i < 200 && (s.getAnimation() || s.queueLength > 0); i++) s.tick(16);
}

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('層を回すドラッグの判定', () => {
  it('要る距離は前の 1.5 倍（マウス 9px・指 21px）', () => {
    expect(LAYER_THRESHOLD).toBe(9);
    expect(TOUCH_LAYER_THRESHOLD).toBe(21);
    expect(layerDragOf(false, 8, 0)).toBeNull();
    expect(layerDragOf(false, 9, 0)).toEqual({ x: 9, y: 0 });
    expect(layerDragOf(true, 14, 14)).toBeNull();
    expect(layerDragOf(true, 0, -21)).toEqual({ x: 0, y: -21 });
  });

  it('向きは押した所と離した所の差だけで決まる（途中の道筋は渡さない）', () => {
    // 右へ大きく回り込んでから上で離しても、差（上へ 30px）だけが向きになる
    expect(layerDragOf(true, 2, -30)).toEqual({ x: 2, y: -30 });
  });
});

describe('手順の 1 手（画面の言葉）', () => {
  it('入力から作れる手は、24 通りのどの向きでも、言葉に直して戻すと同じ手', () => {
    const rng = mulberry32(11);
    for (let n = 1; n <= 6; n++) {
      for (let ori = 0; ori < 24; ori++) {
        const frame = { ori };
        for (let k = 0; k < 20; k++) {
          const m = inputMove(n, frame, rng);
          const step = stepOf(n, frame, m);
          expect(step).not.toBeNull();
          expect(isEquivalent(moveOf(n, frame, step!)!, m)).toBe(true);
        }
      }
    }
  });

  it('記録したときと同じ向きなら、同じ動き。別の向きで再生すると、画面で見て同じ動き', () => {
    const n = 3;
    const step = stepOf(n, HOME_FRAME, faceMove(n, HOME_FRAME, 'R', 'cw', 1, 1)!)!;
    expect(step).toEqual(['R', 'cw', 1, 1]);
    const other = { ori: 5 };
    expect(isEquivalent(moveOf(n, other, step)!, faceMove(n, other, 'R', 'cw', 1, 1)!)).toBe(true);
  });
});

describe('記録（戻すと、戻した手を忘れる）', () => {
  const n = 3;
  const R = faceMove(n, HOME_FRAME, 'R', 'cw', 1, 1)!;
  const U = faceMove(n, HOME_FRAME, 'U', 'cw', 1, 1)!;
  const F = faceMove(n, HOME_FRAME, 'F', 'ccw', 1, 1)!;

  it('回した手を覚え、戻すと最後の手を忘れ、やり直すとまた覚える', () => {
    const r = new SequenceRecorder(n, HOME_FRAME);
    r.committed(R, 'user');
    r.committed(U, 'user');
    expect(r.steps.length).toBe(2);
    r.committed(U, 'undo');
    expect(r.steps).toEqual([['R', 'cw', 1, 1]]);
    r.committed(U, 'redo');
    expect(r.steps.length).toBe(2);
    r.committed(U, 'undo');
    r.committed(F, 'user');
    expect(r.steps).toEqual([['R', 'cw', 1, 1], ['F', 'ccw', 1, 1]]);
  });

  it('記録を始める前の手を戻してやり直しても、記録には入らない', () => {
    const r = new SequenceRecorder(n, HOME_FRAME);
    r.committed(R, 'user');
    r.committed(R, 'undo'); // 記録した R を忘れる
    r.committed(U, 'undo'); // 記録の前の手を戻す
    expect(r.steps.length).toBe(0);
    r.committed(U, 'redo'); // 記録の前の手が戻ってくる → 入れない
    expect(r.steps.length).toBe(0);
    r.committed(R, 'redo'); // 記録した R が戻ってくる → また覚える
    expect(r.steps).toEqual([['R', 'cw', 1, 1]]);
  });

  it('本物のゲームで：記録 → 戻す → 再生すると、戻さなかった手だけが回る', () => {
    const rng = mulberry32(3);
    for (let size = 2; size <= 5; size++) {
      const s = new GameSession(size);
      const frame = { ori: Math.floor(rng() * 24) };
      const rec = new SequenceRecorder(size, frame);
      s.on('move:committed', ({ move, origin }) => rec.committed(move, origin));
      const kept: Move[] = [];
      for (let k = 0; k < 12; k++) {
        const m = inputMove(size, frame, rng);
        s.enqueue({ kind: 'move', move: m, origin: 'user' });
        flush(s);
        if (k % 3 === 2) {
          s.enqueue({ kind: 'undo' });
          flush(s);
        } else {
          kept.push(m);
        }
      }
      // 覚えた手だけで、そろった姿から同じ姿になる
      const st = createSolved(size);
      for (const step of rec.steps) applyMove(st, moveOf(size, frame, step)!);
      const expected = createSolved(size);
      for (const m of kept) applyMove(expected, m);
      expect(rec.steps.length).toBe(kept.length);
      expect(JSON.stringify(st.cubies)).toBe(JSON.stringify(expected.cubies));
      expect(JSON.stringify(st.cubies)).toBe(JSON.stringify(s.state.cubies));
    }
  });
});

describe('手順の保存（ブラウザとファイル）', () => {
  it('足す・名前・記録・消すがブラウザに残り、開き直すと同じ', () => {
    const mem = new MemoryStorage();
    const a = new SequenceStore(mem);
    const s1 = a.add('手順 1', 3);
    const s2 = a.add('手順 2', 4);
    a.rename(s1.id, 'Sune');
    a.setSteps(s1.id, 3, [['R', 'cw', 1, 1], ['U', 'double', 1, 1]]);
    a.remove(s2.id);
    const b = new SequenceStore(mem);
    expect(b.all).toEqual([{ id: s1.id, name: 'Sune', n: 3, steps: [['R', 'cw', 1, 1], ['U', 'double', 1, 1]], marks: [] }]);
  });

  it('ファイルに書いて読み込むと、後ろに足される（同じファイルを 2 回読んでも id がぶつからない）', () => {
    const a = new SequenceStore(new MemoryStorage());
    const s = a.add('A', 5);
    a.setSteps(s.id, 5, [['L', 'ccw', 2, 3]]);
    const text = a.toFile();
    const b = new SequenceStore(new MemoryStorage());
    expect(b.importFile(text)).toBe(1);
    expect(b.importFile(text)).toBe(1);
    expect(b.all.map((q) => [q.name, q.n, q.steps])).toEqual([['A', 5, [['L', 'ccw', 2, 3]]], ['A', 5, [['L', 'ccw', 2, 3]]]]);
    expect(new Set(b.all.map((q) => q.id)).size).toBe(2);
  });

  it('おかしなファイル・中身は読まない（大きさを越える層・知らない面・ほかのファイル）', () => {
    const b = new SequenceStore(new MemoryStorage());
    expect(b.importFile('not json')).toBe(-1);
    expect(b.importFile(JSON.stringify({ kind: 'other', sequences: [] }))).toBe(-1);
    const bad = JSON.stringify({
      kind: 'momo-cube-sequences', version: 1, sequences: [
        { name: 'x', n: 3, steps: [['R', 'cw', 1, 4]] },
        { name: 'y', n: 11, steps: [] },
        { name: 'z', n: 3, steps: [['Q', 'cw', 1, 1]] },
        { name: 'ok', n: 2, steps: [['F', 'double', 1, 2]] },
      ],
    });
    expect(b.importFile(bad)).toBe(1);
    expect(b.all[0].name).toBe('ok');
  });

  it('保存先が壊れていても・書けなくても止まらない', () => {
    const mem = new MemoryStorage();
    mem.setItem(SEQUENCES_KEY, '{broken');
    expect(new SequenceStore(mem).all).toEqual([]);
    const full: StorageLike = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    const s = new SequenceStore(full);
    s.add('A', 3);
    expect(s.all.length).toBe(1);
    expect(s.saveFailed).toBe(true);
  });
});

describe('マーキング（印）', () => {
  it('印は回すと一緒に動き、「回す前の位置」は手を逆にたどった位置', () => {
    const rng = mulberry32(21);
    for (let n = 2; n <= 5; n++) {
      const st = createSolved(n);
      for (let k = 0; k < 30; k++) {
        const c = st.cubies[Math.floor(rng() * st.cubies.length)];
        const body = c.base.findIndex((b) => b !== null);
        const mark = { cubie: c.id, body };
        const before = spotOf(st, mark)!;
        const m = inputMove(n, HOME_FRAME, rng);
        applyMove(st, m);
        const after = spotOf(st, mark)!;
        expect(spotBefore(n, after, m)).toEqual(before);
        expect(markAt(st, after)).toEqual(mark);
      }
    }
  });

  it('画面の向きの位置に直して戻すと、同じ位置（24 通りの向きすべて）', () => {
    for (let n = 1; n <= 4; n++) {
      const st = createSolved(n);
      for (let ori = 0; ori < 24; ori++) {
        for (const c of st.cubies) {
          c.base.forEach((b, body) => {
            if (b === null) return;
            const spot = spotOf(st, { cubie: c.id, body })!;
            const sm = toSeqMark(n, { ori }, spot);
            expect(onSurface(n, { pos: [sm[1], sm[2], sm[3]], face: sm[0] })).toBe(true);
            expect(fromSeqMark(n, { ori }, sm)).toEqual(spot);
          });
        }
      }
    }
  });

  it('付けた順に番号、同じセルは 2 度付かない、消すのは番号の大きいほうから', () => {
    const set = new MarkSet();
    expect(set.add({ cubie: 1, body: 0 })).toBe(true);
    expect(set.add({ cubie: 2, body: 3 })).toBe(true);
    expect(set.add({ cubie: 1, body: 0 })).toBe(false);
    expect(set.add({ cubie: 5, body: 4 })).toBe(true);
    set.removeLast();
    expect(set.all).toEqual([{ cubie: 1, body: 0 }, { cubie: 2, body: 3 }]);
  });

  it('記録中に付けたマークは、記録した手を逆にたどった「始めの姿」の位置になる', () => {
    const n = 3;
    const s = new GameSession(n);
    const frame = { ori: 7 };
    const rec = new SequenceRecorder(n, frame);
    s.on('move:committed', ({ move, origin }) => rec.committed(move, origin));
    const start = createSolved(n);
    for (const [f, v] of [['R', 'cw'], ['U', 'ccw'], ['F', 'double']] as const) {
      s.enqueue({ kind: 'move', move: faceMove(n, frame, f, v, 1, 1)!, origin: 'user' });
      flush(s);
    }
    // いまの姿でマークを付けたピース → 始めの姿での位置へ戻すと、そこに同じピースがある
    const mark = markAt(s.state, { pos: [2, 2, 2], face: 'U' })!;
    const now = spotOf(s.state, mark)!;
    const back = rec.moves().reduceRight((q, m) => spotBefore(n, q, m), now);
    expect(markAt(start, back)).toEqual(mark);
  });
  it('マークは手の中ではなく手順の別のデータ。保存・ファイルで往復し、おかしなマークのファイルは読まない', () => {
    const mem = new MemoryStorage();
    const a = new SequenceStore(mem);
    const q = a.add('A', 3);
    a.setSteps(q.id, 3, [['R', 'cw', 1, 1]]);
    a.setMarks(q.id, [['U', 2, 2, 2], ['F', 1, 1, 2]]);
    expect(new SequenceStore(mem).all[0]).toMatchObject({ steps: [['R', 'cw', 1, 1]], marks: [['U', 2, 2, 2], ['F', 1, 1, 2]] });
    const b = new SequenceStore(new MemoryStorage());
    expect(b.importFile(a.toFile())).toBe(1);
    expect(b.all[0].marks).toEqual([['U', 2, 2, 2], ['F', 1, 1, 2]]);
    // 手順を消すとマークも一緒に消える
    b.remove(b.all[0].id);
    expect(b.all).toEqual([]);
    const file = (marks: unknown) => JSON.stringify({
      kind: 'momo-cube-sequences', version: 1, sequences: [{ name: 'x', n: 3, steps: [['R', 'cw', 1, 1]], marks }],
    });
    expect(b.importFile(file([['U', 1, 1, 1]]))).toBe(0);
    expect(b.importFile(file([['Q', 2, 2, 2]]))).toBe(0);
    expect(b.importFile(file('x'))).toBe(0);
    expect(b.importFile(file([['U', 0, 2, 0]]))).toBe(1);
    // マークの無い前の形のファイルも読める
    expect(b.importFile(JSON.stringify({ kind: 'momo-cube-sequences', version: 1, sequences: [{ name: 'y', n: 3, steps: [] }] }))).toBe(1);
    expect(b.all.map((x) => x.marks)).toEqual([[['U', 0, 2, 0]], []]);
  });
});

describe('別の大きさの手順を回す（外から何段目かを合わせる）', () => {
  const seq = (n: number, steps: [Face, Variant, number, number][]) =>
    ({ id: 'x', name: 'x', n, steps, marks: [] });

  it('3×3×3 の一番上の段は、5×5×5 でも 10×10×10 でも一番上の段', () => {
    expect(adaptStep(['U', 'cw', 1, 1], 3, 5)).toEqual(['U', 'cw', 1, 1]);
    expect(adaptStep(['U', 'cw', 1, 1], 3, 10)).toEqual(['U', 'cw', 1, 1]);
    expect(playableOn(seq(3, [['U', 'cw', 1, 1], ['R', 'ccw', 1, 1]]), 10)).toBe(true);
  });

  it('大きい手順を小さいキューブへ：半分を超える段があれば再生できない', () => {
    // 4×4×4 の上から 2 段目は 2×2×2 では回せない。1 段目だけなら回せる
    expect(playableOn(seq(4, [['U', 'cw', 1, 1], ['U', 'cw', 2, 2]]), 2)).toBe(false);
    expect(playableOn(seq(4, [['U', 'cw', 1, 1], ['R', 'double', 1, 1]]), 2)).toBe(true);
    // 5×5×5 の 2 段目は 4×4×4 では回せる（2 は 4 の半分まで）が、3×3×3 では回せない（真ん中は半分を超える）
    expect(playableOn(seq(5, [['R', 'cw', 2, 2]]), 4)).toBe(true);
    expect(playableOn(seq(5, [['R', 'cw', 2, 2]]), 3)).toBe(false);
    // 手の無い手順は再生できない
    expect(playableOn(seq(3, []), 3)).toBe(false);
  });

  it('小さい手順を大きいキューブへ：段数はそのまま。全体を回す手は全体のまま', () => {
    expect(adaptStep(['R', 'cw', 2, 2], 3, 5)).toEqual(['R', 'cw', 2, 2]);
    expect(adaptStep(['R', 'cw', 1, 3], 3, 6)).toEqual(['R', 'cw', 1, 6]);
    expect(adaptStep(['R', 'cw', 1, 6], 6, 3)).toEqual(['R', 'cw', 1, 3]);
  });

  it('マークも、近いほうの外側から何段目かで移す（真ん中は真ん中、移せないものは外す）', () => {
    // 3×3×3 の上の面の右手前の角 → 5×5×5 の同じ角
    expect(adaptMark(['U', 2, 2, 2], 3, 5)).toEqual(['U', 4, 4, 4]);
    // 3×3×3 の前の面の真ん中 → 5×5×5 の前の面の真ん中。4×4×4 には真ん中が無い
    expect(adaptMark(['F', 1, 1, 2], 3, 5)).toEqual(['F', 2, 2, 4]);
    expect(adaptMark(['F', 1, 1, 2], 3, 4)).toBeNull();
    // 5×5×5 の 2 段目 → 2×2×2 には無い。角は角
    expect(adaptMark(['U', 1, 4, 4], 5, 2)).toBeNull();
    expect(adaptMark(['U', 0, 4, 4], 5, 2)).toEqual(['U', 0, 1, 1]);
  });
});
