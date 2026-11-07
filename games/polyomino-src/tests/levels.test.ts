import { describe, expect, it } from 'vitest';
import { holesOf, keyOf, normalize, orient, type Cell } from '../src/core/geometry';
import { Game } from '../src/core/game';
import { autoRows, boardCells, boardRuns, levelById, LEVELS, loadPieces, piecesOf, piecesReady } from '../src/core/levels';

describe('解データ（製造機の出力を写した levels.json）', () => {
  it('レベル1〜7の10面と、見本なしの 8、解の保証なしの 9・10 がそろっている（4・5・6 はレガシーが先、バリエーションがあと。7 は額縁形）', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['1', '2', '3', '4-legacy', '4-simple', '5-legacy', '5-simple', '6-legacy', '6-simple', '7', '8', '9', '10']);
    expect(LEVELS.filter((l) => l.unproven).map((l) => l.id)).toEqual(['9', '10']);
    // 8 以上は、はじめの完成形の見本を置かない（2026-11-07 利用者の指示）。8 は完成できる形と分かっている
    expect(LEVELS.filter((l) => !l.solution.length).map((l) => l.id)).toEqual(['8', '9', '10']);
  });

  it('アプリの orient で並べ直しても、盤面の全マスがちょうど1回ずつ覆われる（製造機と向きの定義が一致）', () => {
    for (const lv of LEVELS.filter((l) => l.solution.length)) {
      const pieces = piecesOf(lv);
      const need = new Map(boardCells(lv).map(([x, y]) => [x + ',' + y, 0]));
      const used = pieces.map(() => 0);
      for (const pl of lv.solution) {
        used[pl.piece]++;
        const shape = orient(pieces[pl.piece].cells, pl.o);
        const cells = [...shape, ...holesOf(shape)].map(([x, y]) => [x + pl.x, y + pl.y] as Cell);
        for (const [x, y] of cells) {
          const k = x + ',' + y;
          expect(need.has(k), `${lv.id} ${k}`).toBe(true);
          need.set(k, need.get(k)! + 1);
        }
      }
      expect([...need.values()].every((v) => v === 1), lv.id).toBe(true);
      expect(used.every((u) => u === lv.count), lv.id).toBe(true);
    }
  });

  it('駒の数と名前：n=4 は I O T S L、n=5 は F〜Z の12種、ほかは番号', () => {
    const byN = (n: number) => piecesOf(LEVELS.find((l) => l.n === n)!).map((p) => p.name);
    expect(byN(4)).toEqual(['I', 'O', 'T', 'S', 'L']);
    expect(byN(5)).toEqual(['F', 'I', 'L', 'N', 'P', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']);
    expect(byN(6)).toHaveLength(35);
    expect(byN(6)[0]).toBe('1');
  });

  it('orient：8つの向きは、裏返しと回転の組で、4回まわすと元に戻る', () => {
    const f: Cell[] = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];
    expect(keyOf(orient(orient(orient(orient(f, 1), 1), 1), 1))).toBe(keyOf(normalize(f)));
    const all = new Set(Array.from({ length: 8 }, (_, o) => keyOf(orient(f, o))));
    expect(all.size).toBe(8);
  });
});

describe('見本を置かないレベル（8・9・10。§2.4）', () => {
  it('駒は遊ぶときに読み込む。種類・穴あきの数が数学の数と合い、盤面のマス数は駒＋穴と同じ', async () => {
    const want: Record<string, { kinds: number; holey: number; w: number; h: number; top: number }> = {
      '8': { kinds: 369, holey: 6, w: 58, h: 51, top: 0 },
      '9': { kinds: 1285, holey: 37, w: 108, h: 107, top: 47 },
      '10': { kinds: 4655, holey: 195, w: 217, h: 215, top: 103 },
    };
    for (const [id, x] of Object.entries(want)) {
      const lv = levelById(id)!;
      expect(lv.kinds).toBe(x.kinds);
      expect(lv.board).toEqual(autoRows(x));
      await loadPieces(lv);
      expect(piecesReady(lv)).toBe(true);
      const ps = piecesOf(lv);
      expect(ps).toHaveLength(x.kinds);
      expect(ps.filter((p) => p.holes.length).length).toBe(x.holey);
      expect(ps.every((p) => p.cells.length === lv.n)).toBe(true);
      expect(new Set(ps.map((p) => p.name)).size).toBe(x.kinds);
      const area = ps.reduce((a, p) => a + p.cells.length + p.holes.length, 0);
      expect(boardCells(lv)).toHaveLength(area);
      expect(boardRuns(lv).reduce((a, [, x0, x1]) => a + x1 - x0, 0)).toBe(area);
      expect(lv.solution).toEqual([]);
    }
  });

  it('大きい盤面でも、置く・選ぶ・重なりの判定が速い（マスごとの置き場所を覚えておく）', async () => {
    const lv = levelById('10')!;
    await loadPieces(lv);
    const g = new Game(lv);
    // 駒を全部、左上から横に詰めて（重なりもかまわず）置く
    const t0 = performance.now();
    g.pieces.forEach((_, i) => {
      g.select({ piece: i, copy: 0 });
      g.moveTo([(i * 3) % 200, Math.floor((i * 3) / 200) * 4]);
      g.confirm(true);
    });
    expect(g.placements.size).toBe(lv.kinds);
    for (let i = 0; i < 500; i++) g.placedAt([i % 200, i % 150]);
    g.conflictCells();
    g.isComplete();
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});
