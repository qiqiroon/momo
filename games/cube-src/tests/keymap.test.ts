import { describe, expect, it } from 'vitest';
import {
  actionOf, assignKey, DEFAULT_KEYMAP, isReservedCode, KEY_ACTIONS, KEYMAP_STORAGE_KEY, keyLabel, loadKeymap,
  parseKeymap, saveKeymap, serializeKeymap,
} from '../src/input/keymap';

const memoryStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
};

describe('キーの割り当て（04 §5.2）', () => {
  it('既定の割り当ては重ならず、割り当てられないキーを使っていない', () => {
    const codes = KEY_ACTIONS.map((a) => DEFAULT_KEYMAP[a]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.some(isReservedCode)).toBe(false);
  });

  it('使われているキーを割り当てると入れ替わる（重なりが生まれない）', () => {
    const { keymap, swapped } = assignKey(DEFAULT_KEYMAP, 'R', 'KeyL');
    expect(swapped).toBe('L');
    expect(keymap.R).toBe('KeyL');
    expect(keymap.L).toBe('KeyR');
    const codes = KEY_ACTIONS.map((a) => keymap[a]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(actionOf(keymap, 'KeyL')).toBe('R');
  });

  it('数字・修飾キー・Esc などは割り当てられない', () => {
    for (const code of ['Digit3', 'Numpad5', 'ShiftLeft', 'AltRight', 'ControlLeft', 'MetaLeft', 'Escape', 'Tab', 'Space', 'Enter']) {
      expect(isReservedCode(code), code).toBe(true);
      expect(() => assignKey(DEFAULT_KEYMAP, 'R', code)).toThrow(RangeError);
    }
  });

  it('保存と読み込みが往復する。既定と同じなら保存場所を空ける', () => {
    const st = memoryStorage();
    const changed = assignKey(DEFAULT_KEYMAP, 'U', 'KeyI').keymap;
    saveKeymap(changed, st);
    expect(st.map.has(KEYMAP_STORAGE_KEY)).toBe(true);
    expect(loadKeymap(st)).toEqual(changed);
    saveKeymap(DEFAULT_KEYMAP, st);
    expect(st.map.has(KEYMAP_STORAGE_KEY)).toBe(false);
    expect(loadKeymap(st)).toEqual(DEFAULT_KEYMAP);
  });

  it('壊れた値・版の違う値・重なった値は既定に戻す', () => {
    expect(parseKeymap('{')).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(JSON.stringify({ version: 2, keys: DEFAULT_KEYMAP }))).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(JSON.stringify({ version: 1, keys: { ...DEFAULT_KEYMAP, U: 'KeyD' } }))).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(JSON.stringify({ version: 1, keys: { ...DEFAULT_KEYMAP, U: 'Digit1' } }))).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(JSON.stringify({ version: 1, keys: { R: 'KeyR' } }))).toBe(DEFAULT_KEYMAP);
    expect(parseKeymap(serializeKeymap(DEFAULT_KEYMAP))).toEqual(DEFAULT_KEYMAP);
  });

  it('保存場所が使えなくても既定で動く', () => {
    const broken = { getItem: () => { throw new Error('denied'); } };
    expect(loadKeymap(broken)).toBe(DEFAULT_KEYMAP);
    expect(loadKeymap(null)).toBe(DEFAULT_KEYMAP);
  });

  it('刻印：英字・数字・記号', () => {
    expect(keyLabel('KeyR')).toBe('R');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('Semicolon')).toBe(';');
    expect(keyLabel('Home')).toBe('Home');
  });
});
