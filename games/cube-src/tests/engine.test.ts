import { describe, expect, it } from 'vitest';
import { applyMove, createSolved, isSolved, snapshot } from '../src/core/cubeState';
import { parseMove, parseSequence } from '../src/core/notation';
import { durationFor, phiAt } from '../src/engine/animator';
import { GameSession } from '../src/engine/gameSession';
import { MoveHistory } from '../src/engine/history';
import { MoveQueue } from '../src/engine/moveQueue';
import { SIZES, mulberry32, randomMove } from './helpers';

/** 手で進める時計 */
const fakeClock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

const userMove = (text: string, n = 3) =>
  ({ kind: 'move', move: parseMove(text, n), origin: 'user' }) as const;

const drain = (s: GameSession, clock?: { advance: (ms: number) => void }) => {
  for (let i = 0; i < 10000 && s.getAnimation(); i++) {
    clock?.advance(16);
    s.tick(16);
  }
};

describe('MoveQueue（02 §3.2）', () => {
  it('上限 8、溢れたら捨てる、先入れ先出し', () => {
    const q = new MoveQueue();
    for (let i = 0; i < 8; i++) expect(q.push({ kind: 'undo' })).toBe(true);
    expect(q.push({ kind: 'redo' })).toBe(false);
    expect(q.length).toBe(8);
    expect(q.shift()).toEqual({ kind: 'undo' });
    q.clear();
    expect(q.shift()).toBeNull();
  });
});

describe('アニメーションの時間と角度（02 §3.4・§3.5）', () => {
  const s = { baseQuarterMs: 180, solverPlaybackScale: 1 };
  it('180° は 1.45 倍、全体は 1.2 倍、シャッフルは 0.33 倍', () => {
    expect(durationFor(parseMove('R', 3), 'user', s)).toBe(180);
    expect(durationFor(parseMove('R2', 3), 'user', s)).toBeCloseTo(261, 9);
    expect(durationFor(parseMove('x', 3), 'user', s)).toBeCloseTo(216, 9);
    expect(durationFor(parseMove('R', 3), 'shuffle', s)).toBeCloseTo(59.4, 9);
  });

  it('φ は −θ から 0 へ単調に進み、途中で目標を越えない', () => {
    for (const text of ['R', "R'", 'R2', "R2'"]) {
      const m = parseMove(text, 3);
      const target = m.turns * (Math.PI / 2);
      expect(phiAt(m, 0, 180)).toBeCloseTo(-target, 12);
      expect(phiAt(m, 180, 180)).toBeCloseTo(0, 15);
      let prev = phiAt(m, 0, 180);
      for (let t = 10; t <= 180; t += 10) {
        const p = phiAt(m, t, 180);
        expect(Math.sign(target) * (p - prev)).toBeGreaterThanOrEqual(0);
        expect(Math.abs(p)).toBeLessThanOrEqual(Math.abs(target) + 1e-12);
        prev = p;
      }
    }
  });
});

describe('MoveHistory（02 §4）', () => {
  it('undo は逆手を返し、userLog に逆手を積まない（INV3）', () => {
    const h = new MoveHistory();
    const r = parseMove('R', 3);
    h.push(r);
    expect(h.undo()).toEqual(parseMove("R'", 3));
    expect(h.moveCount).toBe(0);
    expect(h.fullHistory).toEqual([]);
    expect(h.redo()).toEqual(r);
    expect(h.undo()).not.toBeNull();
    expect(h.undo()).toBeNull();
  });

  it('新しい手で redo は消える', () => {
    const h = new MoveHistory();
    h.push(parseMove('R', 3));
    h.undo();
    h.push(parseMove('U', 3));
    expect(h.canRedo).toBe(false);
  });
});

describe('GameSession（02 §3・§6）', () => {
  it('D1: 論理はアニメーションの開始時に確定し、その間 φ は −θ から始まる', () => {
    const s = new GameSession(3);
    s.enqueue(userMove('R'));
    const expected = createSolved(3);
    applyMove(expected, parseMove('R', 3));
    expect(snapshot(s.state)).toEqual(snapshot(expected));
    const a = s.getAnimation()!;
    expect(a.phi).toBeCloseTo(Math.PI / 2, 12);
    expect(a.axis).toBe('x');
    drain(s);
    expect(s.getAnimation()).toBeNull();
  });

  it('M3: R を 4 回連打しても、順に回って元に戻る（同時に動くのは 1 本）', () => {
    const s = new GameSession(3);
    const committed: string[] = [];
    s.on('move:committed', () => committed.push('c'));
    for (let i = 0; i < 4; i++) expect(s.enqueue(userMove('R'))).toBe(true);
    expect(committed.length).toBe(1);
    expect(s.queueLength).toBe(3);
    drain(s);
    expect(committed.length).toBe(4);
    expect(isSolved(s.state)).toBe(true);
    expect(s.moveCount).toBe(4);
  });

  it('待ち行列が満杯なら捨てて queue:full を出す', () => {
    const s = new GameSession(3);
    let full = 0;
    s.on('queue:full', () => full++);
    // 1 手目はすぐ動き出すので、待ち行列には 8 手まで入る
    for (let i = 0; i < 9; i++) expect(s.enqueue(userMove('U'))).toBe(true);
    expect(s.enqueue(userMove('U'))).toBe(false);
    expect(full).toBe(1);
  });

  it('大きさの違う手は受けない', () => {
    const s = new GameSession(3);
    expect(s.enqueue(userMove('R', 4))).toBe(false);
  });

  it('Undo / Redo は取り出した時点の履歴で解決する', () => {
    const s = new GameSession(3);
    s.enqueue(userMove('R'));
    s.enqueue(userMove('U'));
    s.enqueue({ kind: 'undo' });
    s.enqueue({ kind: 'undo' });
    s.enqueue({ kind: 'redo' });
    drain(s);
    const expected = createSolved(3);
    applyMove(expected, parseMove('R', 3));
    expect(snapshot(s.state)).toEqual(snapshot(expected));
    expect(s.moveCount).toBe(1);
    expect(s.canRedo).toBe(true);
  });

  it('シャッフルより前には戻れない', () => {
    const s = new GameSession(3, { rng: mulberry32(1) });
    s.scramble();
    const after = snapshot(s.state);
    s.enqueue({ kind: 'undo' });
    drain(s);
    expect(snapshot(s.state)).toEqual(after);
    expect(s.moveCount).toBe(0);
  });

  it('タイマー：シャッフル後の最初の手で始まり、そろった瞬間に止まる。solved は 1 回だけ', () => {
    const clock = fakeClock();
    const s = new GameSession(3, { clock: clock.now, rng: mulberry32(2) });
    let solvedEvents = 0;
    s.on('solved', () => solvedEvents++);
    s.scramble(5);
    expect(s.phase).toBe('scrambled');
    clock.advance(5000);
    expect(s.elapsedMs).toBe(0);
    const solution = s.guaranteedSolution();
    for (const m of solution) {
      s.enqueue({ kind: 'move', move: m, origin: 'user' });
      drain(s, clock);
    }
    expect(s.phase).toBe('solved');
    expect(solvedEvents).toBe(1);
    const t = s.elapsedMs;
    expect(t).toBeGreaterThan(0);
    clock.advance(3000);
    expect(s.elapsedMs).toBe(t);
    expect(s.moveCount).toBe(solution.length);
  });

  it('タブが隠れていても実時間で進む（時計の差分）', () => {
    const clock = fakeClock();
    const s = new GameSession(3, { clock: clock.now, rng: mulberry32(3) });
    s.scramble(10);
    s.enqueue(userMove('R'));
    clock.advance(60_000);
    expect(s.elapsedMs).toBe(60_000);
  });

  it('reset・setSize は待ち行列と履歴を消す', () => {
    const s = new GameSession(3);
    s.enqueue(userMove('R'));
    s.enqueue(userMove('U'));
    s.setSize(5);
    expect(s.state.n).toBe(5);
    expect(s.getAnimation()).toBeNull();
    expect(s.moveCount).toBe(0);
    s.enqueue(userMove('R', 5));
    s.reset();
    expect(isSolved(s.state)).toBe(true);
    expect(s.canUndo).toBe(false);
  });

  it('V1: シャッフル＋手＋Undo/Redo を乱数で 500 回やっても、確実解で必ずそろう（N=1..10）', () => {
    for (const n of SIZES) {
      const rng = mulberry32(100 + n);
      const s = new GameSession(n, { rng });
      s.scramble();
      for (let i = 0; i < 500; i++) {
        const r = rng();
        if (r < 0.6) s.enqueue({ kind: 'move', move: randomMove(n, rng), origin: 'user' });
        else if (r < 0.8) s.enqueue({ kind: 'undo' });
        else s.enqueue({ kind: 'redo' });
        drain(s);
      }
      const st = createSolved(n);
      // 現在の状態に確実解を当てるとそろう
      for (const m of s.guaranteedSolution()) applyMove(s.state, m);
      expect(isSolved(s.state)).toBe(true);
      expect(isSolved(st)).toBe(true);
    }
  });

  it('T6 をエンジン経由で：(R U R\' U\') × 6 でそろう', () => {
    const s = new GameSession(3);
    for (let i = 0; i < 6; i++) {
      for (const m of parseSequence("R U R' U'", 3)) s.enqueue({ kind: 'move', move: m, origin: 'user' });
      drain(s);
    }
    expect(isSolved(s.state)).toBe(true);
    expect(s.moveCount).toBe(24);
  });
});
