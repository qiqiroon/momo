import { describe, expect, it } from 'vitest';
import { makeMove } from '../src/core/move';
import {
  decodeMove, encodeMove, GameRecorder, GameStore, GAMES_KEY, moveCountOf, sanitizeLog, viewCountOf,
} from '../src/ui/gameLog';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

describe('プレイ記録', () => {
  it('手は軸・層・回す量で覚え、元に戻せる', () => {
    const m = makeMove(4, 'y', 0b0110, -1);
    expect(decodeMove(4, encodeMove(m))).toEqual(m);
  });

  it('シャッフルのあとの手・戻す・やり直す・全体の回転を順に覚える。全体の回転は手数に数えない', () => {
    const rec = new GameRecorder();
    rec.start(3, [makeMove(3, 'x', 1, 1)], [0, 0, 0, 1]);
    rec.committed(makeMove(3, 'y', 4, 2), 'user');
    rec.view([0, 0.70711, 0, 0.70711]);
    rec.view([0, 0.70711, 0, 0.70711]);
    rec.committed(makeMove(3, 'y', 4, 2), 'undo');
    rec.committed(makeMove(3, 'y', 4, 2), 'redo');
    rec.committed(makeMove(3, 'z', 1, 1), 'solver');
    rec.committed(makeMove(3, 'z', 1, 1), 'shuffle');
    const log = rec.log;
    expect(log.scramble).toEqual([[0, 1, 1]]);
    expect(log.steps).toEqual([[1, 4, 2], ['v', 0, 0.70711, 0, 0.70711], ['u'], ['r'], [2, 1, 1]]);
    expect(moveCountOf(log)).toBe(2);
    expect(viewCountOf(log)).toBe(1);
  });

  it('始めの向きと同じ向きは覚えない', () => {
    const rec = new GameRecorder();
    rec.start(2, [], [0, 0, 0, 1]);
    rec.view([0, 0, 0, 1]);
    expect(rec.log.steps).toEqual([]);
  });

  it('おかしな記録は読まない', () => {
    expect(sanitizeLog({ n: 3, scramble: [[0, 8, 1]], view0: [0, 0, 0, 1], steps: [] })).toBeNull();
    expect(sanitizeLog({ n: 3, scramble: [], view0: [0, 0, 0, 1], steps: [['x']] })).toBeNull();
    expect(sanitizeLog({ n: 3, scramble: [], view0: [0, 0, 0, 1], steps: [['v', 0, 0, 0, 1], ['u']], timeMs: 1200 }))
      .toEqual({ n: 3, scramble: [], view0: [0, 0, 0, 1], steps: [['v', 0, 0, 0, 1], ['u']], timeMs: 1200 });
  });

  it('保存・名前の変更・削除・ファイルの往復', () => {
    const storage = new MemoryStorage();
    const store = new GameStore(storage);
    const rec = new GameRecorder();
    rec.start(3, [makeMove(3, 'x', 1, 1)], [0, 0, 0, 1]);
    rec.committed(makeMove(3, 'x', 1, -1), 'user');
    const g = store.add('a', rec.log, 5);
    // 保存したあとに覚えた手は、保存したものに入らない
    rec.committed(makeMove(3, 'x', 1, 1), 'user');
    expect(store.get(g.id)!.log.steps).toEqual([[0, 1, -1]]);
    store.rename(g.id, 'b');
    const again = new GameStore(storage);
    expect(again.all.map((x) => x.name)).toEqual(['b']);
    const file = again.toFile();
    const other = new GameStore(new MemoryStorage());
    expect(other.importFile(file)).toBe(1);
    expect(other.all[0].log).toEqual(store.get(g.id)!.log);
    expect(other.importFile('{"kind":"other"}')).toBe(0);
    again.remove(g.id);
    expect(JSON.parse(storage.getItem(GAMES_KEY)!)).toEqual([]);
  });
});
