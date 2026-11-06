import { describe, expect, it } from 'vitest';
import { flipO, Game, refKey, rotateO } from '../src/core/game';
import { type Cell, normalize, orient } from '../src/core/geometry';
import { levelById, type Placement } from '../src/core/levels';
import { buildProblem } from '../src/core/hint';
import { fromKnownSolution, pickHint, solidCells, solveAll } from '../src/core/hintSolver';

/** 長方形の盤面で、置き方全体を 180° 回したもの（完成形とは違うが、正しい置き方） */
function rotated180(g: Game, sol: readonly Placement[]): Placement[] {
  const { w, h } = g.size;
  return sol.map((pl) => {
    const o = rotateO(rotateO(pl.o, 1), 1);
    const cells = solidCells(g.pieces[pl.piece].cells, pl.o, pl.x, pl.y).map(([x, y]) => [w - 1 - x, h - 1 - y] as Cell);
    const minX = Math.min(...cells.map((c) => c[0])), minY = Math.min(...cells.map((c) => c[1]));
    return { ...pl, o, x: minX, y: minY };
  });
}

describe('ヒント', () => {
  const lv = levelById('5-legacy')!;

  it('180° 回した置き方も正しい（テストの前提）', () => {
    const g = new Game(lv);
    g.restore(rotated180(g, lv.solution));
    expect(g.isComplete()).toBe(true);
  });

  it('近道：完成形どおりに置いた駒だけなら、計算せず完成形の残りを返す', () => {
    const g = new Game(lv);
    const placed = lv.solution.slice(0, 4);
    const rest = fromKnownSolution(lv.solution, placed, (p) => g.pieces[p].cells)!;
    expect(rest).toHaveLength(lv.solution.length - 4);
    const other = rotated180(g, lv.solution).slice(0, 4);
    expect(fromKnownSolution(lv.solution, other, (p) => g.pieces[p].cells)).toBeNull();
  });

  it('近道：同じ形が2個ずつのレベルでも、個の番号が入れ替わっていてよい', () => {
    const l4 = levelById('4-legacy')!;
    const g = new Game(l4);
    const [a] = l4.solution;
    const swapped = { ...a, copy: 1 - a.copy };
    const rest = fromKnownSolution(l4.solution, [swapped], (p) => g.pieces[p].cells)!;
    expect(rest).toHaveLength(l4.solution.length - 1);
    expect(rest.some((r) => r.piece === a.piece && r.copy === swapped.copy)).toBe(false);
  });

  it('計算：完成形と違う置き方の途中からでも、置いた駒を動かさずに残りを見つける', () => {
    const g = new Game(lv);
    g.restore(rotated180(g, lv.solution).slice(0, 5));
    const prob = buildProblem(g);
    const r = solveAll(prob);
    expect(r.status).toBe('solved');
    if (r.status !== 'solved') return;
    g.restore([...g.placements.values(), ...r.placements]);
    expect(g.isComplete()).toBe(true);
  });

  it('計算：完成できない置き方なら none', () => {
    const g = new Game(lv);
    // X を左上の角に寄せて置くと、角の 1 マスが囲まれて埋まらない
    const x = g.pieces.findIndex((p) => p.name === 'X');
    g.restore([{ piece: x, copy: 0, o: 0, x: 0, y: 0 }]);
    expect(g.placements.size).toBe(1);
    expect(solveAll(buildProblem(g)).status).toBe('none');
  });

  it('ヒントに出す駒は、左上から読んで最初の空きマスを埋める駒', () => {
    const g = new Game(lv);
    const empty = buildProblem(g).empty;
    const pl = pickHint(lv.solution, empty, (p) => g.pieces[p].cells)!;
    expect(solidCells(g.pieces[pl.piece].cells, pl.o, pl.x, pl.y).some(([x, y]) => x === 0 && y === 0)).toBe(true);
  });

  it('裏返しの向きでも、穴あき駒が無ければ solidCells は orient と同じ', () => {
    const g = new Game(lv);
    for (let o = 0; o < 8; o++) {
      expect(normalize(solidCells(g.pieces[0].cells, flipO(o), 0, 0))).toEqual(orient(g.pieces[0].cells, flipO(o)));
    }
    expect(refKey({ piece: 1, copy: 0 })).toBe('1:0');
  });
});
