import { describe, expect, it } from 'vitest';
import { Game, refKey } from '../src/core/game';
import { holesOf, orient, type Cell } from '../src/core/geometry';
import { levelById, LEVELS, piecesOf } from '../src/core/levels';
import { formatTime, type KV, loadSave, pieceColors, recordBest, SAVE_KEY, Stopwatch, writeSave } from '../src/core/progress';

function memKV(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('色分け', () => {
  it('完成形で辺を接する駒どうしは、どのレベルでも違う色になる', () => {
    for (const lv of LEVELS.filter((l) => l.solution.length)) {
      const colors = pieceColors(lv);
      const pieces = piecesOf(lv);
      const owner = new Map<string, string>();
      for (const pl of lv.solution) {
        const s = orient(pieces[pl.piece].cells, pl.o);
        for (const [x, y] of [...s, ...holesOf(s)] as Cell[]) owner.set(`${x + pl.x},${y + pl.y}`, refKey(pl));
      }
      for (const [ck, k] of owner) {
        const [x, y] = ck.split(',').map(Number);
        for (const n of [owner.get(`${x + 1},${y}`), owner.get(`${x},${y + 1}`)]) {
          if (n && n !== k) expect(colors.get(n), `${lv.id} ${k}/${n}`).not.toBe(colors.get(k));
        }
      }
      expect(colors.size).toBe(lv.solution.length);
    }
  });
});

describe('タイム', () => {
  it('止めている間は進まず、再開後は続きから足す', () => {
    const w = new Stopwatch(1000);
    w.start(0);
    expect(w.value(500)).toBe(1500);
    w.stop(500);
    expect(w.value(9999)).toBe(1500);
    w.start(10000);
    expect(w.value(10250)).toBe(1750);
  });

  it('表示：1時間までは m:ss', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(83_900)).toBe('1:23');
    expect(formatTime(3_725_000)).toBe('1:02:05');
  });
});

describe('保存', () => {
  it('書いて読めば戻る。壊れたデータは空から始める', () => {
    const kv = memKV();
    expect(loadSave(kv).best).toEqual({});
    const d = loadSave(kv);
    expect(recordBest(d, '5-legacy', 90_000)).toBe(true);
    expect(recordBest(d, '5-legacy', 95_000)).toBe(false);
    expect(recordBest(d, '5-legacy', 80_000)).toBe(true);
    d.games['3'] = { placements: [], elapsed: 1234 };
    writeSave(kv, d);
    expect(loadSave(kv)).toEqual({ v: 1, best: { '5-legacy': 80_000 }, games: { '3': { placements: [], elapsed: 1234 } }, iosNoticeClosed: false });
    kv.setItem(SAVE_KEY, '{oops');
    expect(loadSave(kv).best).toEqual({});
    expect(loadSave(null).games).toEqual({});
  });

  it('置き場所を戻す：おかしな値・同じ駒の2つ目・アンカーが盤面の外のものは捨てる。重なりは戻す（PC では置けるため）', () => {
    const lv = levelById('5-legacy')!;
    const g = new Game(lv);
    const [a, b] = lv.solution;
    const c = lv.solution[2];
    g.restore([a, b, { ...a }, { ...b, piece: 99 }, { piece: 3, copy: 0, o: 0, x: -5, y: 0 }, null, 'x', { ...c, x: a.x, y: a.y }]);
    expect([...g.placements.keys()].sort()).toEqual([refKey(a), refKey(b), refKey(c)].sort());
    expect(g.conflictCells().size).toBeGreaterThan(0);
    expect(g.isComplete()).toBe(false);
    const full = new Game(lv);
    full.restore(lv.solution);
    expect(full.isComplete()).toBe(true);
  });
});
