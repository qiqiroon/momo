/**
 * 効果音・触覚の配線の検査（第3分冊 11.7 / 受入条件 7-6）
 *
 * 検査の環境に音の文脈（AudioContext）は無いため、**音は鳴らない。**
 * そこで、同じ契機から必ず出る**触覚の長さ**を観測して配線を確かめる。
 * 契機ごとの長さが違うので、どの契機が発火したかがそのまま分かる。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { settleBoard, answerSoundAsk } from '../../test/settle';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardSize } from '../../data/types';
import { resetInFlight } from '../../data/fetchJson';
import { indexLoader } from '../../data/indexLoader';
import { setLocale } from '../../i18n/locale';
import { readData } from '../../test/fixtures';
import { HAPTIC_MS_MEDIUM, HAPTIC_MS_STRONG, HAPTIC_MS_WEAK } from '../config';
import {
  create as createFeedback,
  createMixedSource,
  type FeedbackCue,
  type SoundSource,
} from '../feedback';
import { AppShell } from './AppShell';

const MANIFEST = readData('manifest.json');
const N01_INDEX = readData('n01/index.json');
const N01_CHUNK = readData('n01/c0000.json');
const N09_INDEX = readData('n09/index.json');
const N09_CHUNKS = ['c0000.json', 'c0001.json', 'c0002.json', 'c0003.json'].map((file) => ({
  file: `n09/${file}`,
  body: readData(`n09/${file}`),
}));

function stubFetch(): void {
  const table: Record<string, unknown> = {
    'manifest.json': MANIFEST,
    'n01/index.json': N01_INDEX,
    'n01/c0000.json': N01_CHUNK,
    'n09/index.json': N09_INDEX,
  };
  for (const chunk of N09_CHUNKS) table[chunk.file] = chunk.body;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = Object.keys(table).find((key) => url.endsWith(key));
      if (hit === undefined) return { ok: false, status: 404 } as unknown as Response;
      return { ok: true, status: 200, text: async () => JSON.stringify(table[hit]) } as unknown as Response;
    }),
  );
}

let vibrations: number[] = [];

/** 数値パレットのボタン */
function paletteKey(value: number): HTMLElement {
  const keys = screen.getByTestId('palette').querySelectorAll('button');
  return keys[value - 1] as HTMLElement;
}

/**
 * 押せるボタンが1つでもあるか。**「入力できる升が選ばれている」ことと同値である**（8.6）。
 *
 * 特定の値（たとえば `1`）で判定してはいけない。その値が盤面上で使い切られていると、
 * 入力できる升を選んでいても押せないままになる（C-119）。
 */
function firstEnabledKey(): HTMLButtonElement | null {
  const keys = [...screen.getByTestId('palette').querySelectorAll('button')] as HTMLButtonElement[];
  return keys.find((key) => !key.disabled) ?? null;
}

/**
 * 入力できる升が見つかるまで盤面を歩く。
 * どの升が固定かは変換で毎回変わるため、位置を決め打ちにしない。
 * 矢印は端で止まる（行をまたがない）ので、**折り返しながら全升を辿る**。
 */
function walkToEditableCell(n: number): void {
  fireEvent.keyDown(window, { key: 'ArrowRight' });
  for (let row = 0; row < n; row++) {
    for (let step = 0; step < n - 1; step++) {
      if (firstEnabledKey() !== null) return;
      fireEvent.keyDown(window, { key: row % 2 === 0 ? 'ArrowRight' : 'ArrowLeft' });
    }
    if (firstEnabledKey() !== null) return;
    fireEvent.keyDown(window, { key: 'ArrowDown' });
  }
}

async function start(size: BoardSize): Promise<void> {
  render(<AppShell />);
  // **ここは音そのものを見る検査**なので、起動時の問いかけには「鳴らす」で答える（⑧）
  answerSoundAsk(true);
  await screen.findByRole('button', { name: `${size}` });
  fireEvent.click(screen.getByRole('button', { name: `${size}` }));
  fireEvent.click(screen.getByRole('button', { name: '新しく始める' }));
  await screen.findByTestId('board');
    await settleBoard();
  vibrations.length = 0;
}

describe('効果音・触覚の配線（11.7.1 / 受入 7-6）', () => {
  beforeEach(async () => {
    resetInFlight();
    indexLoader.invalidate();
    localStorage.clear();
    localStorage.setItem('momoLang_mode', 'ja');
    await setLocale('ja');
    stubFetch();

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
    cleanup();
    Reflect.deleteProperty(navigator, 'vibrate');
    vi.unstubAllGlobals();
  });

  it('値を入れると入力の合図が出て、それで完成すれば完成の合図が続く', async () => {
    await start(1);
    fireEvent.keyDown(window, { key: 'ArrowRight' });

    fireEvent.click(paletteKey(1));

    expect(await screen.findByText('完成しました')).toBeInTheDocument();
    expect(vibrations).toEqual([HAPTIC_MS_WEAK, HAPTIC_MS_MEDIUM]);
  });

  it('誤った値では、入力の合図に続けて強い合図が出る（11.7.3）', async () => {
    await start(9);
    walkToEditableCell(9);
    expect(firstEnabledKey()).not.toBeNull();
    vibrations.length = 0;

    // 1つの升に 1〜9 を順に入れれば、少なくとも8回は誤りになる
    for (let value = 1; value <= 9; value++) {
      const key = paletteKey(value) as HTMLButtonElement;
      if (!key.disabled) fireEvent.click(key);
    }

    expect(vibrations).toContain(HAPTIC_MS_STRONG);
    // 誤りの直前には必ず入力の合図がある（順序は 11.7.1 のとおり）
    expect(vibrations[vibrations.indexOf(HAPTIC_MS_STRONG) - 1]).toBe(HAPTIC_MS_WEAK);
  });

  it('ヒントの提示でも合図が出る。無効操作では出ない（10.1）', async () => {
    await start(9);
    fireEvent.click(screen.getByTestId('action-hint'));
    expect(vibrations).toEqual([HAPTIC_MS_WEAK]);
  });

  it('取り消し・選択・ズームでは合図を出さない（11.7.1 の除外）', async () => {
    await start(9);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: '拡大' }));
    fireEvent.click(screen.getByRole('button', { name: '全体' }));
    expect(vibrations).toHaveLength(0);
  });

  it('設定で触覚を切ると出なくなる（受入 7-6）', async () => {
    await start(1);
    fireEvent.click(screen.getByRole('button', { name: '音と触覚の設定' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '触覚' }));
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.click(paletteKey(1));

    expect(await screen.findByText('完成しました')).toBeInTheDocument();
    expect(vibrations).toHaveLength(0);
  });
});

/**
 * 完成音の先読みと、遅れの計測（C-179）
 *
 * **完成音は1局に1度しか鳴らない。** そのままだと鳴らす瞬間が毎回「初めての読み込み」になり、
 * 何度も鳴って温まっている入力音と違って、そこだけ取りに行く時間が乗る。
 * 音を出してよいと分かった時点で、まとめて先に取りに行かせる。
 */
describe('効果音の先読み（C-179）', () => {
  function fakeSource(): { source: SoundSource; warmed: FeedbackCue[][] } {
    const warmed: FeedbackCue[][] = [];
    return {
      warmed,
      source: {
        play: () => {},
        stop: () => {},
        warm: (cues) => warmed.push([...cues]),
      },
    };
  }

  it('用意させると、契機がすべて渡る', () => {
    const { source, warmed } = fakeSource();
    createFeedback(source).warm();
    expect(warmed).toHaveLength(1);
    expect([...warmed[0]].sort()).toEqual(
      ['COMPLETED', 'FAILED', 'HINT_SHOWN', 'MISTAKE_DETECTED', 'VALUE_COMMITTED'].sort(),
    );
  });

  it('何度頼まれても、用意するのは一度きり', () => {
    const { source, warmed } = fakeSource();
    const feedback = createFeedback(source);
    feedback.warm();
    feedback.warm();
    feedback.warm();
    expect(warmed).toHaveLength(1);
  });

  it('合成音で鳴らす契機は、音声ファイル側へ渡さない', () => {
    const { source: synth, warmed: synthWarmed } = fakeSource();
    const { source: samples, warmed: sampleWarmed } = fakeSource();
    createFeedback(createMixedSource(['MISTAKE_DETECTED', 'FAILED'], synth, samples)).warm();
    expect(sampleWarmed[0]).toEqual(['VALUE_COMMITTED', 'COMPLETED', 'HINT_SHOWN']);
    expect(synthWarmed[0]).toEqual(['MISTAKE_DETECTED', 'FAILED']);
  });
});
