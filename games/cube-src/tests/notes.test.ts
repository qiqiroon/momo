import { describe, expect, it } from 'vitest';
import { assignKey, DEFAULT_KEYMAP, keymapFromFile, keymapToFile } from '../src/input/keymap';
import { MAX_NOTE, SequenceStore } from '../src/ui/sequences';

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

describe('手順セットの説明', () => {
  it('すべての大きさに共通で 1 つ。開き直しても残り、空にすると消える', () => {
    const storage = new MemoryStorage();
    const store = new SequenceStore(storage);
    store.setNote('基本の手順');
    expect(new SequenceStore(storage).note).toBe('基本の手順');
    store.setNote('x'.repeat(MAX_NOTE + 10));
    expect(new SequenceStore(storage).note.length).toBe(MAX_NOTE);
    store.setNote('  ');
    expect(new SequenceStore(storage).note).toBe('');
  });

  it('ファイルに入り、読み込むと空なら入り、あれば後ろに足す（同じものは足さない）', () => {
    const a = new SequenceStore(new MemoryStorage());
    a.add('one', 3);
    a.setNote('A');
    const file = a.toFile();
    const b = new SequenceStore(new MemoryStorage());
    b.importFile(file);
    expect(b.note).toBe('A');
    b.importFile(file);
    expect(b.note).toBe('A');
    const c = new SequenceStore(new MemoryStorage());
    c.setNote('C');
    c.importFile(file);
    expect(c.note).toBe('C\nA');
  });
});

describe('キーの割り当てのファイル', () => {
  it('保存して読み出すと同じ。印が違う・壊れたものは読まない', () => {
    const k = assignKey(DEFAULT_KEYMAP, 'U', 'KeyQ').keymap;
    expect(keymapFromFile(keymapToFile(k))).toEqual(k);
    expect(keymapFromFile(JSON.stringify({ kind: 'other', version: 1, keys: k }))).toBeNull();
    expect(keymapFromFile(JSON.stringify({ kind: 'momo-cube-keys', version: 1, keys: { ...k, D: 'KeyQ' } }))).toBeNull();
    expect(keymapFromFile('not json')).toBeNull();
  });
});
