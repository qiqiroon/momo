import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import { ViewController, type ViewSettings } from '../src/input/viewController';
import { AdaptiveQuality } from '../src/render/adaptiveQuality';
import {
  DEFAULT_SETTINGS, effectiveQuarterMs, loadSettings, sanitizeSettings, saveSettings, SETTINGS_KEY,
} from '../src/ui/settings';
import type { StorageLike } from '../src/ui/records';

const memory = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('設定（05 §5）', () => {
  it('保存して読み直せる', () => {
    const mem = memory();
    const s = { ...DEFAULT_SETTINGS, quarterMs: 150, viewGrid: 45 as const, mirrors: false, quality: 'low' as const };
    saveSettings(mem, s);
    expect(loadSettings(mem)).toEqual(s);
  });

  it('おかしな値は 1 つずつ既定に戻す。壊れていれば全部既定', () => {
    expect(sanitizeSettings({ quarterMs: 5, viewGrid: 30, viewInertia: 'yes', arrowLabels: 'all', mirrors: 0 }))
      .toEqual({ ...DEFAULT_SETTINGS, arrowLabels: 'all' });
    const mem = memory();
    mem.data.set(SETTINGS_KEY, '{oops');
    expect(loadSettings(mem)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    const broken: StorageLike = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(loadSettings(broken)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(broken, DEFAULT_SETTINGS)).not.toThrow();
  });

  it('「動きを減らす」では「ふつう」を 60ms にする（0 にはしない）。自分で選んだ速さはそのまま', () => {
    expect(effectiveQuarterMs(DEFAULT_SETTINGS, true)).toBe(60);
    expect(effectiveQuarterMs({ ...DEFAULT_SETTINGS, quarterMs: 300 }, true)).toBe(300);
    expect(effectiveQuarterMs({ ...DEFAULT_SETTINGS, quarterMs: 40 }, true)).toBe(40);
    expect(effectiveQuarterMs({ ...DEFAULT_SETTINGS, quarterMs: 300 }, false)).toBe(300);
  });
});

describe('適応的品質（03 §7.1）', () => {
  it('重いと 2 → 1.5 → 1 と下げ、それでも重ければ鏡を消す案内の合図', () => {
    const q = new AdaptiveQuality(2, false);
    expect(q.pixelRatio).toBe(2);
    let changed = 0;
    for (let i = 0; i < 60; i++) if (q.sample(30)) changed++;
    expect(changed).toBe(1);
    expect(q.pixelRatio).toBe(1.5);
    for (let i = 0; i < 60; i++) q.sample(30);
    expect(q.pixelRatio).toBe(1);
    expect(q.verySlow).toBe(false);
    for (let i = 0; i < 60; i++) q.sample(30);
    expect(q.verySlow).toBe(true);
  });

  it('軽い状態が 180 フレーム続けば 1 段戻す。途中で重いフレームがあれば数え直し', () => {
    const q = new AdaptiveQuality(2, false);
    for (let i = 0; i < 60; i++) q.sample(25);
    expect(q.pixelRatio).toBe(1.5);
    for (let i = 0; i < 179; i++) q.sample(8);
    q.sample(16);
    for (let i = 0; i < 179; i++) q.sample(8);
    expect(q.pixelRatio).toBe(1.5);
    q.sample(8);
    expect(q.pixelRatio).toBe(2);
  });

  it('スマホは 1.5 まで。画素比 1 の端末は 1 のまま。「きれい」「軽い」は動かさない', () => {
    expect(new AdaptiveQuality(3, true).pixelRatio).toBe(1.5);
    expect(new AdaptiveQuality(1, false).pixelRatio).toBe(1);
    const q = new AdaptiveQuality(2, false);
    q.setQuality('low');
    expect(q.pixelRatio).toBe(1);
    q.setQuality('high');
    for (let i = 0; i < 200; i++) expect(q.sample(50)).toBe(false);
    expect(q.pixelRatio).toBe(2);
  });
});

describe('視点の慣性（05 §5 viewInertia）', () => {
  const make = (s: ViewSettings) => {
    let t = 0;
    const v = new ViewController(new PerspectiveCamera(), s, undefined, () => t);
    v.setViewport(800, 600);
    return { v, tick: (ms: number) => (t += ms) };
  };
  const angleOf = (v: ViewController) => 2 * Math.acos(Math.min(1, Math.abs(v.delta.w)));

  it('オフなら離した位置で止まる。オンなら回り続けて、やがて止まる', () => {
    for (const inertia of [false, true]) {
      const { v, tick } = make({ viewGrid: 0, viewInertia: inertia });
      for (let i = 0; i < 5; i++) {
        tick(16);
        v.freeRotate(0, 0, 20, 0);
      }
      v.release();
      const a0 = angleOf(v);
      expect(v.update(16)).toBe(inertia);
      if (!inertia) {
        expect(angleOf(v)).toBeCloseTo(a0, 9);
        continue;
      }
      expect(angleOf(v)).toBeGreaterThan(a0);
      let frames = 0;
      while (v.update(16) && frames < 2000) frames++;
      expect(frames).toBeLessThan(2000);
      expect(v.isActive).toBe(false);
    }
  });

  it('止めてからしばらくして離したら、勢いは無い', () => {
    const { v, tick } = make({ viewGrid: 0, viewInertia: true });
    tick(16);
    v.freeRotate(0, 0, 20, 0);
    tick(300);
    v.release();
    expect(v.update(16)).toBe(false);
  });

  it('全体回転のキーの速さは設定の速さに合わせる', () => {
    const { v } = make({ viewGrid: 0, quarterMs: 300 });
    v.command({ kind: 'rotate', about: 'R', quarter: 1 });
    let ms = 0;
    while (v.update(10)) ms += 10;
    expect(ms).toBeGreaterThanOrEqual(350);
  });
});
