import { describe, expect, it } from 'vitest';
import { parseMove } from '../src/core/notation';
import { GameSession, type GameSessionEvents } from '../src/engine/gameSession';
import { formatTime, KEEP_PER_SIZE, RECORDS_KEY, RecordStore, type StorageLike } from '../src/ui/records';
import { mulberry32 } from './helpers';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};
const rec = (n: number, timeMs: number, moves = 20) => ({ n, timeMs, moves, scrambleLength: 25, completedAt: 0 });

const fakeClock = () => {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};
const drain = (s: GameSession, clock?: { advance: (ms: number) => void }) => {
  for (let i = 0; i < 10000 && s.getAnimation(); i++) {
    clock?.advance(16);
    s.tick(16);
  }
};
const play = (s: GameSession, moves: string[], clock?: { advance: (ms: number) => void }) => {
  for (const m of moves) {
    s.enqueue({ kind: 'move', move: parseMove(m, s.state.n), origin: 'user' });
    drain(s, clock);
  }
};

describe('記録（05 §4）', () => {
  it('ベストタイム・最少手数・平均・件数。新記録の判定', () => {
    const st = new RecordStore(memory());
    const a = st.add(rec(3, 60_000, 50));
    expect(a.newBestTime).toBe(true);
    expect(a.newBestMoves).toBe(false);
    expect(a.previousBest).toBeNull();
    const b = st.add(rec(3, 70_000, 40));
    expect(b.newBestTime).toBe(false);
    expect(b.newBestMoves).toBe(true);
    expect(b.previousBest?.timeMs).toBe(60_000);
    const c = st.add(rec(3, 50_000, 45));
    expect(c.newBestTime).toBe(true);
    st.add(rec(4, 10_000));
    expect(st.bestTime(3)?.timeMs).toBe(50_000);
    expect(st.bestMoves(3)?.moves).toBe(40);
    expect(st.count(3)).toBe(3);
    expect(st.averageTime(3, 2)).toBe(60_000);
    expect(st.averageTime(5, 5)).toBeNull();
    expect(st.bestTime(4)?.timeMs).toBe(10_000);
  });

  it('自動解答を使った記録はベストに数えない', () => {
    const st = new RecordStore(memory());
    st.add(rec(3, 60_000));
    const r = st.add({ ...rec(3, 1_000), usedSolver: true });
    expect(r.newBestTime).toBe(false);
    expect(st.bestTime(3)?.timeMs).toBe(60_000);
    expect(st.averageTime(3, 10)).toBe(60_000);
  });

  it('保存して読み直せる。大きさごとに新しい 100 件だけ残す', () => {
    const mem = memory();
    const st = new RecordStore(mem);
    for (let i = 0; i < KEEP_PER_SIZE + 5; i++) st.add(rec(3, 1000 + i));
    st.add(rec(2, 5));
    const again = new RecordStore(mem);
    expect(again.count(3)).toBe(KEEP_PER_SIZE);
    expect(again.count(2)).toBe(1);
    // 古い 5 件（1000〜1004）が消えている
    expect(again.bestTime(3)?.timeMs).toBe(1005);
  });

  it('版が違う・壊れている・おかしな値は捨てて続ける', () => {
    const mem = memory();
    mem.data.set(RECORDS_KEY, JSON.stringify({ version: 2, records: [rec(3, 1)] }));
    expect(new RecordStore(mem).count(3)).toBe(0);
    mem.data.set(RECORDS_KEY, '{oops');
    expect(new RecordStore(mem).count(3)).toBe(0);
    const good = { ...rec(3, 10), usedHint: false, usedSolver: false };
    mem.data.set(RECORDS_KEY, JSON.stringify({ version: 1, records: [good, { ...good, n: 11 }, { ...good, timeMs: 'x' }, null] }));
    expect(new RecordStore(mem).count(3)).toBe(1);
  });

  it('保存できなくても（容量・プライベートモード）ゲームは止めない', () => {
    const broken: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    const st = new RecordStore(broken);
    expect(() => st.add(rec(3, 1))).not.toThrow();
    expect(st.count(3)).toBe(1);
    expect(new RecordStore(null).count(3)).toBe(0);
  });

  it('時間の表示は mm:ss.d、1 時間からは h:mm:ss', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(12_449)).toBe('00:12.4');
    expect(formatTime(72_400)).toBe('01:12.4');
    expect(formatTime(3_599_999)).toBe('59:59.9');
    expect(formatTime(3_600_000)).toBe('1:00:00');
    expect(formatTime(-5)).toBe('00:00.0');
  });
});

describe('ゲームの流れ（07 §2 の 13・16〜18）', () => {
  it('シャッフルから計ってそろえると、solved は timed で 1 回、シャッフルの手数つき', () => {
    const clock = fakeClock();
    const s = new GameSession(3, { clock: clock.now, rng: mulberry32(7) });
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    s.scramble(6);
    expect(s.scrambleLength).toBe(6);
    for (const m of s.guaranteedSolution()) {
      s.enqueue({ kind: 'move', move: m, origin: 'user' });
      drain(s, clock);
    }
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ timed: true, n: 3, moves: 6, scrambleLength: 6 });
    expect(events[0].timeMs).toBeGreaterThan(0);
    // そろったあとも回せる。崩して戻しても、もう計らない
    play(s, ['R', "R'"], clock);
    expect(events).toHaveLength(2);
    expect(events[1].timed).toBe(false);
    expect(s.elapsedMs).toBe(events[0].timeMs);
  });

  it('シャッフルせずに崩して戻しても、記録の対象にならない', () => {
    const s = new GameSession(3);
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    play(s, ['R', 'U', "U'", "R'"]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ timed: false, scrambleLength: 0 });
    expect(s.phase).toBe('solved');
  });

  it('全体を回しただけの姿も、そろったと数える（13）', () => {
    const s = new GameSession(3, { rng: mulberry32(1) });
    const events: GameSessionEvents['solved'][] = [];
    s.on('solved', (e) => events.push(e));
    // R M' L' は全体を x 回したのと同じ。色の向きは最初と違うが、どの面も 1 色
    play(s, ['R', "M'"]);
    expect(events).toHaveLength(0);
    play(s, ["L'"]);
    expect(events).toHaveLength(1);
    expect(s.state.cubies.some((c) => c.ori !== 0)).toBe(true);
  });

  it('手数は戻すで減り、やり直すで増える。シャッフルの手は数えない（16・18）', () => {
    const s = new GameSession(3, { rng: mulberry32(4) });
    s.scramble(10);
    expect(s.moveCount).toBe(0);
    play(s, ['R', 'U', 'F']);
    expect(s.moveCount).toBe(3);
    s.enqueue({ kind: 'undo' });
    s.enqueue({ kind: 'undo' });
    drain(s);
    expect(s.moveCount).toBe(1);
    s.enqueue({ kind: 'redo' });
    drain(s);
    expect(s.moveCount).toBe(2);
    expect(s.canRedo).toBe(true);
    play(s, ['D']);
    expect(s.canRedo).toBe(false);
    expect(s.moveCount).toBe(3);
  });

  it('リセット・大きさの変更でゲームは終わり、時間は 0 に戻る', () => {
    const clock = fakeClock();
    const s = new GameSession(3, { clock: clock.now, rng: mulberry32(5) });
    s.scramble(8);
    play(s, ['R'], clock);
    clock.advance(1000);
    expect(s.phase).toBe('playing');
    s.reset();
    expect(s.phase).toBe('solved');
    expect(s.elapsedMs).toBe(0);
    expect(s.scrambleLength).toBe(0);
    s.scramble(8);
    play(s, ['R'], clock);
    s.setSize(4);
    expect(s.phase).toBe('solved');
    expect(s.elapsedMs).toBe(0);
  });
});
