/**
 * 効果音と触覚の検査（第3分冊 11.7 / 15.10 / 受入条件 7-6）
 *
 * **音そのものは検査で聞けない。** ここで確かめるのは「どの契機で・どの強さを・
 * 何回渡したか」と、設定による切り替えである。音色の良し悪しは実機で聴いて決める（U-18）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../data/types';
import { HAPTIC_MS_MEDIUM, HAPTIC_MS_STRONG, HAPTIC_MS_WEAK } from './config';
import { create, createMixedSource, type FeedbackCue, type SoundSource } from './feedback';

/** 鳴らした内容を記録するだけの音源。方式に依らない窓口の検査に使う */
function recordingSource(): SoundSource & {
  played: { cue: FeedbackCue; volume: number }[];
  stops: number;
} {
  const played: { cue: FeedbackCue; volume: number }[] = [];
  let stops = 0;
  return {
    played,
    get stops() {
      return stops;
    },
    play(cue, volume) {
      played.push({ cue, volume });
    },
    stop() {
      stops++;
    },
  };
}

const SETTINGS: Settings = {
  locale: 'ja',
  lastSize: null,
  lastDifficulty: null,
  zoomPreference: null,
  loupeCorner: 'TOP_RIGHT',
  loupeOpen: false,
  loupeSpan: 3,
  paletteScale: 1,
  recentBufferSize: 200,
  undoLimit: 100,
  soundEnabled: true,
  soundVolume: 0.6,
  hapticEnabled: true,
  keepAwake: true,
};

const CUES: FeedbackCue[] = [
  'VALUE_COMMITTED',
  'MISTAKE_DETECTED',
  'FAILED',
  'COMPLETED',
  'HINT_SHOWN',
];

let vibrations: number[] = [];

beforeEach(() => {
  vibrations = [];
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    value: (ms: number) => {
      vibrations.push(ms);
      return true;
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'vibrate');
});

describe('契機と発火（11.7.1 / 受入 7-6）', () => {
  it('5つの契機すべてで音と触覚が出る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);

    for (const cue of CUES) controller.fire(cue);

    expect(source.played.map((entry) => entry.cue)).toEqual(CUES);
    expect(vibrations).toHaveLength(CUES.length);
  });

  it('誤りと失敗の触覚は、他の契機より明確に長い（11.7.3）', () => {
    const controller = create(recordingSource());
    controller.applySettings(SETTINGS);

    controller.fire('VALUE_COMMITTED');
    controller.fire('HINT_SHOWN');
    controller.fire('COMPLETED');
    controller.fire('MISTAKE_DETECTED');
    controller.fire('FAILED');

    expect(vibrations).toEqual([
      HAPTIC_MS_WEAK,
      HAPTIC_MS_WEAK,
      HAPTIC_MS_MEDIUM,
      HAPTIC_MS_STRONG,
      HAPTIC_MS_STRONG,
    ]);
    // 中は弱の約2倍、強は中よりさらに長い（11.7.2 が定める関係そのもの）
    expect(HAPTIC_MS_MEDIUM).toBeGreaterThan(HAPTIC_MS_WEAK);
    expect(HAPTIC_MS_STRONG).toBeGreaterThan(HAPTIC_MS_MEDIUM);
  });

  it('音量は設定の値がそのまま音源へ渡る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings({ ...SETTINGS, soundVolume: 0.25 });

    controller.fire('VALUE_COMMITTED');
    expect(source.played[0].volume).toBe(0.25);
  });
});

describe('誤入力の重なり（11.7.1 / C-117）', () => {
  it('入力音と誤り音を続けて渡すと、後の合図が前を打ち切る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);

    // 呼び出し側は2回渡すだけでよい。**条件分岐は書かせない**
    controller.fire('VALUE_COMMITTED');
    const stopsBefore = source.stops;
    controller.fire('MISTAKE_DETECTED');

    // 打ち切りは音源側の `play` の中で行われる契約なので、ここでは順序と強さで確かめる
    expect(source.played.map((entry) => entry.cue)).toEqual([
      'VALUE_COMMITTED',
      'MISTAKE_DETECTED',
    ]);
    expect(source.stops).toBe(stopsBefore);
    // 触覚も上書きされ、利用者が最後に感じるのは強い振動である
    expect(vibrations).toEqual([HAPTIC_MS_WEAK, HAPTIC_MS_STRONG]);
  });
});

describe('音源の使い分け（U-18 の決着）', () => {
  /** 方式を混ぜても、呼び出し側からは1つの音源に見えることを確かめる */
  function pair(): { synth: ReturnType<typeof recordingSource>; file: ReturnType<typeof recordingSource> } {
    return { synth: recordingSource(), file: recordingSource() };
  }

  it('ブザーの2つだけ合成音へ、残りは音声ファイルへ流れる', () => {
    const { synth, file } = pair();
    const mixed = createMixedSource(['MISTAKE_DETECTED', 'FAILED'], synth, file);
    const controller = create(mixed);
    controller.applySettings(SETTINGS);

    for (const cue of CUES) controller.fire(cue);

    expect(synth.played.map((entry) => entry.cue)).toEqual(['MISTAKE_DETECTED', 'FAILED']);
    expect(file.played.map((entry) => entry.cue)).toEqual([
      'VALUE_COMMITTED',
      'COMPLETED',
      'HINT_SHOWN',
    ]);
  });

  it('打ち切りは方式をまたいで効く。またがないと2つ重なって鳴る', () => {
    const { synth, file } = pair();
    const mixed = createMixedSource(['MISTAKE_DETECTED'], synth, file);
    const controller = create(mixed);
    controller.applySettings(SETTINGS);

    // 誤入力＝ファイルの入力音 → 合成音のブザー、と方式をまたいで続く
    controller.fire('VALUE_COMMITTED');
    controller.fire('MISTAKE_DETECTED');

    expect(file.stops).toBeGreaterThan(0);
    expect(synth.stops).toBeGreaterThan(0);
  });
});

describe('設定による切り替え（15.10 / 受入 7-6）', () => {
  it('音を切ると鳴らない。触覚は残る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings({ ...SETTINGS, soundEnabled: false });

    controller.fire('VALUE_COMMITTED');
    expect(source.played).toHaveLength(0);
    expect(vibrations).toEqual([HAPTIC_MS_WEAK]);
  });

  it('触覚を切ると震えない。音は残る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings({ ...SETTINGS, hapticEnabled: false });

    controller.fire('VALUE_COMMITTED');
    expect(source.played).toHaveLength(1);
    expect(vibrations).toHaveLength(0);
  });

  it('音を切った時点で、鳴っている音を打ち切る', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);
    controller.fire('COMPLETED');

    controller.applySettings({ ...SETTINGS, soundEnabled: false });
    expect(source.stops).toBe(1);
  });

  it('試聴は音が切ってあるときは何もしない（2.10）', () => {
    const source = recordingSource();
    const controller = create(source);

    controller.applySettings({ ...SETTINGS, soundEnabled: false });
    controller.preview();
    expect(source.played).toHaveLength(0);

    controller.applySettings(SETTINGS);
    controller.preview();
    expect(source.played).toHaveLength(1);
  });
});

describe('環境と可視性（11.7.4 / 11.7.2）', () => {
  it('タブが見えていないあいだは音も触覚も出さない', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      controller.fire('VALUE_COMMITTED');
      expect(source.played).toHaveLength(0);
      expect(vibrations).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('隠れたときは鳴っている音を打ち切る（15.8）', () => {
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);
    controller.fire('COMPLETED');

    controller.suspend();
    expect(source.stops).toBe(1);
    // 振動も止める。0 は「止める」の意味である
    expect(vibrations.at(-1)).toBe(0);
  });

  it('触覚に対応しない環境でも、呼び出しが何もしないだけで例外を投げない', () => {
    Reflect.deleteProperty(navigator, 'vibrate');
    const source = recordingSource();
    const controller = create(source);
    controller.applySettings(SETTINGS);

    expect(() => controller.fire('MISTAKE_DETECTED')).not.toThrow();
    expect(source.played).toHaveLength(1);
  });

  it('音の文脈が作れない環境でも、既定の音源で例外を投げない（検査環境がそれである）', () => {
    const controller = create();
    controller.applySettings(SETTINGS);
    expect(() => {
      for (const cue of CUES) controller.fire(cue);
      controller.preview();
      controller.suspend();
    }).not.toThrow();
  });
});
