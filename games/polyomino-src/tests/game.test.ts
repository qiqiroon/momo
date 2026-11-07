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
    for (const level of LEVELS.filter((l) => l.solution.length)) {
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

  it('盤面の外に逃がせる：盤面に1マスもかからない駒は、はみ出しにならず、置いた数にも入らない', () => {
    const g = new Game(lv);
    expect(g.pad).toBe(5);
    g.select({ piece: 9, copy: 0 }); // X（3×3）
    g.moveTo([-50, -50]); // 置ける範囲（盤面のまわり 5 マス）の左上の角に寄る
    expect(g.selPlacement()).toMatchObject({ x: -5, y: -5 });
    expect(g.problemCells().size).toBe(0);
    expect(g.confirm()).toBe(true);
    expect(g.stateOf('9:0')).toBe('parked');
    expect(g.isPlaced('9:0')).toBe(false);
    expect(g.placedCount()).toBe(0);
    expect(g.conflictCells().size).toBe(0);
    expect(g.placedAt([-4, -4])).toBe('9:0'); // 外の駒も押してつかめる

    // 一部だけ盤面にかかる駒は、これまで通りはみ出し
    g.select({ piece: 9, copy: 0 });
    g.moveTo([-1, 4]); // X の中心が盤面の1つ左：右の腕だけ盤面にかかる
    expect(g.problemCells().size).toBeGreaterThan(0);
    g.cancel();

    // 外の駒を選んだだけ（動かす前）は、リストでも外の駒のまま
    g.select({ piece: 9, copy: 0 });
    expect(g.stateOf('9:0')).toBe('parked');
    g.cancel();

    // 保存から戻しても外の駒のまま。全部置いても外の駒があれば完成にならない
    const g2 = new Game(lv);
    g2.restore([...g.placements.values()]);
    expect(g2.stateOf('9:0')).toBe('parked');
    for (const pl of lv.solution) if (refKey(pl) !== '9:0') g2.placements.set(refKey(pl), pl);
    expect(g2.isComplete()).toBe(false);
    g2.placements.set('9:0', lv.solution.find((p) => refKey(p) === '9:0')!);
    expect(g2.isComplete()).toBe(true);
  });

  it('回すと置ける範囲からはみ出すときは、範囲の中へ寄る', () => {
    const g = new Game(lv);
    g.select({ piece: 1, copy: 0 }); // I（向き0 は横長か縦長のどちらか）
    g.moveTo([-50, -50]);
    g.rotate(1);
    const pl = g.selPlacement()!;
    const b = g.boxOf(pl);
    expect(b.x).toBeGreaterThanOrEqual(g.area.x0);
    expect(b.y).toBeGreaterThanOrEqual(g.area.y0);
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
