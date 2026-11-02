import { describe, expect, it } from 'vitest';
import { applyMove, isSolved } from '../src/core/cubeState';
import { isEquivalent, makeMove } from '../src/core/move';
import { formatSequence, parseMove, parseSequence } from '../src/core/notation';
import { AXES } from '../src/core/types';
import { AutoSolver } from '../src/engine/autoSolver';
import { GameSession, type GameSessionEvents } from '../src/engine/gameSession';
import { describeMove, faceMove } from '../src/input/screenMoves';
import { simplify } from '../src/solver/historySolver';
import { SIZES, mulberry32, randomMove } from './helpers';

const drain = (s: GameSession, solver?: AutoSolver) => {
  for (let i = 0; i < 100000 && (s.getAnimation() || solver?.running); i++) {
    solver?.update();
    s.tick(16);
  }
};

describe('冗長手の除去（06 §3・V3）', () => {
  it('同じ層の手をまとめ、打ち消し合う手は消える（続けて消える場合も）', () => {
    const seq = (t: string) => formatSequence(simplify(parseSequence(t, 3)));
    expect(seq('R R')).toBe('R2');
    expect(seq("R R'")).toBe('');
    expect(seq("R U U' R'")).toBe('');
    expect(seq('R R R')).toBe("R'");
    expect(seq('R2 R2 U')).toBe('U');
    expect(seq('R L R')).toBe('R L R');
  });
});

describe('解答（06 §3・§6）', () => {
  it('V1・V2・V3：シャッフル＋手＋戻す・やり直すのあと、解答でそろい、確実解より長くない（N=1..10）', () => {
    for (const n of SIZES) {
      const rng = mulberry32(100 + n);
      const s = new GameSession(n, { rng });
      s.scramble();
      for (let i = 0; i < 60; i++) {
        const r = rng();
        if (r < 0.15) s.enqueue({ kind: 'undo' });
        else if (r < 0.25) s.enqueue({ kind: 'redo' });
        else s.enqueue({ kind: 'move', move: randomMove(n, rng), origin: 'user' });
        drain(s);
      }
      const sol = s.solution();
      expect(sol.length).toBeLessThanOrEqual(s.guaranteedSolution().length);
      // 試しの最後なので、セッションの状態にそのまま当てる
      sol.forEach((m) => applyMove(s.state, m));
      expect(isSolved(s.state), `n=${n}`).toBe(true);
    }
  });

  it('自動の解答：目の前で 1 手ずつ回してそろえ、そのゲームは「解答を使った」になる', () => {
    let t = 0;
    const s = new GameSession(4, { rng: mulberry32(9), clock: () => (t += 5) });
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    const auto = new AutoSolver(s);
    s.scramble();
    s.enqueue({ kind: 'move', move: parseMove('R', 4), origin: 'user' });
    drain(s);
    expect(s.phase).toBe('playing');
    auto.start();
    expect(auto.running).toBe(true);
    drain(s, auto);
    expect(auto.running).toBe(false);
    expect(isSolved(s.state)).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ timed: true, usedSolver: true, usedHint: false });
  });

  it('自動の解答は、利用者がほかの手を指すと止まる', () => {
    const s = new GameSession(3, { rng: mulberry32(10) });
    const auto = new AutoSolver(s);
    s.scramble();
    auto.start();
    auto.update();
    s.tick(16);
    expect(auto.running).toBe(true);
    s.enqueue({ kind: 'move', move: parseMove('U', 3), origin: 'user' });
    drain(s);
    expect(auto.running).toBe(false);
    expect(isSolved(s.state)).toBe(false);
    // シャッフルし直しても止まる
    auto.start();
    s.scramble();
    expect(auto.running).toBe(false);
  });

  it('計り始める前に自動でそろえると、ゲームは終わる（記録の対象ではない）', () => {
    const s = new GameSession(3, { rng: mulberry32(11) });
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    const auto = new AutoSolver(s);
    s.scramble();
    auto.start();
    drain(s, auto);
    expect(s.phase).toBe('solved');
    expect(events[0]).toMatchObject({ timed: false, usedSolver: true });
  });

  it('ヒントを見たゲームは「ヒントを使った」になる。リセットで消える', () => {
    const s = new GameSession(3, { rng: mulberry32(12) });
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    s.scramble(4);
    s.noteHint();
    for (const m of s.solution()) {
      s.enqueue({ kind: 'move', move: m, origin: 'user' });
      drain(s);
    }
    expect(events[0]).toMatchObject({ timed: true, usedHint: true, usedSolver: false });
    s.scramble(4);
    for (const m of s.solution()) {
      s.enqueue({ kind: 'move', move: m, origin: 'user' });
      drain(s);
    }
    expect(events[1]).toMatchObject({ usedHint: false });
  });
});

describe('ヒントの言葉（画面の面と層）', () => {
  it('どの向き（24 通り）・どの層の手も、画面の言葉に直して同じ手に戻る。外から近い面で言う', () => {
    for (let ori = 0; ori < 24; ori++) {
      const frame = { ori };
      for (const n of [1, 2, 3, 4, 5]) {
        for (const axis of AXES) {
          for (let k = 0; k < n; k++) {
            for (const turns of [1, -1, 2] as const) {
              const m = makeMove(n, axis, 1 << k, turns);
              const d = describeMove(n, frame, m);
              expect(d, `${ori} ${n} ${axis} ${k}`).not.toBeNull();
              expect(isEquivalent(faceMove(n, frame, d!.face, d!.variant, d!.from, d!.to)!, m)).toBe(true);
              expect(d!.to).toBeLessThanOrEqual(Math.ceil(n / 2));
            }
          }
        }
      }
    }
  });

  it('ホームの向きで R は「右の面を時計回り」、5×5×5 の 2R は「右から 2 枚目」', () => {
    expect(describeMove(3, { ori: 0 }, parseMove('R', 3))).toEqual({ face: 'R', variant: 'cw', from: 1, to: 1 });
    expect(describeMove(5, { ori: 0 }, parseMove('2R', 5))).toEqual({ face: 'R', variant: 'cw', from: 2, to: 2 });
    expect(describeMove(4, { ori: 0 }, parseMove('Rw', 4))).toEqual({ face: 'R', variant: 'cw', from: 1, to: 2 });
  });
});
