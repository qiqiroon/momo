import { describe, expect, it } from 'vitest';
import { anchorOf, flipO, Game, refKey, rotateO } from '../src/core/game';
import { keyOf, normalize, orient, type Cell } from '../src/core/geometry';
import { levelById, LEVELS } from '../src/core/levels';

const F: Cell[] = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];

describe('向きの計算', () => {
  it('回す：時計回りと反時計回りは打ち消し合い、裏返した組の中で回る', () => {
    for (let o = 0; o < 8; o++) {
      expect(rotateO(rotateO(o, 1), -1)).toBe(o);
      expect(rotateO(o, 1) >= 4).toBe(o >= 4);
      expect(keyOf(orient(F, rotateO(o, 1)))).toBe(keyOf(orient(orient(F, o), 1)));
    }
  });

  it('裏返す：画面の上で左右の鏡うつしになり、2回で元に戻る', () => {
    for (let o = 0; o < 8; o++) {
      const mirrored = normalize(orient(F, o).map(([x, y]) => [-x, y] as Cell));
      expect(keyOf(orient(F, flipO(o)))).toBe(keyOf(mirrored));
      expect(flipO(flipO(o))).toBe(o);
    }
  });

  it('アンカー：囲む長方形の中心に近い駒のマス。同じ近さなら左上寄り', () => {
    expect(anchorOf([[0, 0], [1, 0], [0, 1], [1, 1]])).toEqual([0, 0]); // O
    expect(anchorOf([[0, 0], [1, 0], [2, 0], [3, 0]])).toEqual([1, 0]); // I（4）
    expect(anchorOf(F)).toEqual([1, 1]);
    expect(anchorOf([[0, 0], [2, 0], [0, 1], [1, 1], [2, 1]])).toEqual([1, 1]); // U
  });
});

describe('駒の操作', () => {
  const lv = levelById('5-legacy')!;

  it('完成形をそのまま置くと完成になる', () => {
    for (const level of LEVELS) {
      const g = new Game(level);
      for (const pl of level.solution) g.placements.set(refKey(pl), pl);
      expect(g.isComplete(), level.id).toBe(true);
    }
  });

  it('リストから選び、盤面に触れて置き、確定する。重なりとはみ出しは確定できない', () => {
    const g = new Game(lv);
    g.select({ piece: 9, copy: 0 }); // X
    expect(g.selPlacement()).toBeNull();
    expect(g.isPlaced('9:0')).toBe(false);
    g.moveTo([1, 1]);
    expect(g.selPlacement()).toEqual({ piece: 9, copy: 0, o: 0, x: 0, y: 0 });
    expect(g.canConfirm()).toBe(true);
    expect(g.confirm()).toBe(true);
    expect(g.isPlaced('9:0')).toBe(true);

    g.select({ piece: 1, copy: 0 }); // I
    g.moveTo([1, 2]);
    expect(g.canConfirm()).toBe(false); // X と重なる
    g.moveTo([0, 2]);
    expect(g.problemCells().size).toBeGreaterThan(0); // 左へはみ出す
    g.moveTo([4, 2]);
    expect(g.canConfirm()).toBe(true);
  });

  it('PC（force）では重なっていても置ける。重なりは conflictCells に出て、完成にはならない', () => {
    const g = new Game(lv);
    g.select({ piece: 9, copy: 0 });
    g.moveTo([1, 1]);
    g.confirm();
    g.select({ piece: 1, copy: 0 });
    g.moveTo([1, 2]);
    expect(g.confirm()).toBe(false);
    expect(g.confirm(true)).toBe(true);
    expect(g.conflictCells().has('1,1')).toBe(true);
    expect(g.placedAt([1, 1])).toBe('1:0'); // 重なっていれば後から置いた駒
  });

  it('置いた駒を選んで動かし、取り消すと元の場所へ戻る。動かすまではリストで「置いた」のまま', () => {
    const g = new Game(lv);
    g.select({ piece: 9, copy: 0 });
    g.moveTo([1, 1]);
    g.confirm();
    expect(g.placedAt([1, 2])).toBe('9:0');
    g.select({ piece: 9, copy: 0 });
    expect(g.sel!.at).toEqual([1, 1]);
    expect(g.isPlaced('9:0')).toBe(true);
    g.rotate(1);
    expect(g.isPlaced('9:0')).toBe(false);
    g.moveTo([5, 3]);
    g.cancel();
    expect(g.placements.get('9:0')).toEqual({ piece: 9, copy: 0, o: 0, x: 0, y: 0 });
  });

  it('リストへ戻す：置いてあった駒を選んで戻すと、盤面から外れてリストへ', () => {
    const g = new Game(lv);
    g.select({ piece: 9, copy: 0 });
    g.moveTo([1, 1]);
    g.confirm();
    g.select({ piece: 9, copy: 0 });
    expect(g.returnToList()).toBe(true);
    expect(g.placements.size).toBe(0);
    expect(g.sel).toBeNull();
    expect(g.isPlaced('9:0')).toBe(false);
    expect(g.returnToList()).toBe(false);
  });

  it('別の駒を選ぶと、いまの仮置きは取り消される。リセットで空に戻る', () => {
    const g = new Game(lv);
    g.select({ piece: 0, copy: 0 });
    g.moveTo([3, 3]);
    g.select({ piece: 2, copy: 0 });
    expect(g.placements.size).toBe(0);
    expect(refKey(g.sel!.ref)).toBe('2:0');
    g.moveTo([3, 3]);
    g.confirm();
    g.reset();
    expect(g.placements.size).toBe(0);
    expect(g.sel).toBeNull();
  });

  it('回す・裏返すときは、アンカーのマスが動かない', () => {
    const g = new Game(lv);
    g.select({ piece: 0, copy: 0 });
    g.moveTo([4, 3]);
    for (let i = 0; i < 6; i++) {
      if (i % 2) g.flip(); else g.rotate(1);
      const pl = g.selPlacement()!;
      const a = anchorOf(orient(g.pieces[0].cells, pl.o));
      expect([pl.x + a[0], pl.y + a[1]]).toEqual([4, 3]);
    }
  });
});
