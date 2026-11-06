import { describe, expect, it } from 'vitest';
import { holesOf, keyOf, normalize, orient, type Cell } from '../src/core/geometry';
import { boardCells, LEVELS, piecesOf } from '../src/core/levels';

describe('解データ（製造機の出力を写した levels.json）', () => {
  it('レベル1〜6の9面がそろっている（4・5・6 はシンプルとレガシー）', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['1', '2', '3', '4-simple', '4-legacy', '5-simple', '5-legacy', '6-simple', '6-legacy']);
  });

  it('アプリの orient で並べ直しても、盤面の全マスがちょうど1回ずつ覆われる（製造機と向きの定義が一致）', () => {
    for (const lv of LEVELS) {
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
