/**
 * 受入条件 2-9（エクスポートしたものを取り込むと、設定・成績・既出が戻る）
 * あわせて、保存の共通作法（3.6.2）と成績の計上規則（3.10）を確かめる。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_VERSION } from '../data/config';
import { ensureMigrated, KEYS, readMeta } from './localStore';
import { empty as emptyRecent, recentStore } from './recentStore';
import { sessionStore } from './sessionStore';
import { settingsStore } from './settingsStore';
import { empty as emptyStats, statsStore } from './statsStore';
import { buildBundle, importBundle, validate } from './transfer';
import type { SuspendedSession } from '../data/types';

function sampleSession(): SuspendedSession {
  return {
    schemaVersion: STORAGE_VERSION,
    savedAt: '2026-08-06T00:00:00.000Z',
    sourceId: 'N9-000051',
    n: 9,
    difficulty: 'Easy',
    transformParams: { rotation: 1, mirror: false, symbols: [1, 2, 3] },
    entered: new Array<number>(81).fill(0),
    notes: [[1, 2], [], [3]],
    elapsedMs: 12345,
    mistakeCount: 2,
    failed: false,
    hintUsed: 1,
  };
}

describe('端末内の保存（3.6）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('設定は既定値から始まり、書けば戻ってくる', () => {
    expect(settingsStore.load().locale).toBe('ja');
    expect(settingsStore.load().soundEnabled).toBe(false);
    expect(settingsStore.load().soundVolume).toBe(0.5);

    settingsStore.save({ ...settingsStore.defaults(), locale: 'en', soundVolume: 0.8 });
    expect(settingsStore.load().locale).toBe('en');
    expect(settingsStore.load().soundVolume).toBe(0.8);
  });

  it('壊れているキーは、そのキーだけ初期値へ戻る（他は巻き添えにしない）', () => {
    settingsStore.save({ ...settingsStore.defaults(), locale: 'zh' });
    statsStore.save({ ...emptyStats(), updatedAt: '2026-08-06T00:00:00.000Z' });

    localStorage.setItem(KEYS.settings, '{ これは JSON ではない');

    expect(settingsStore.load().locale).toBe('ja'); // 初期値へ復旧した
    expect(statsStore.load().updatedAt).toBe('2026-08-06T00:00:00.000Z'); // 無事
  });

  it('項目が1つ壊れていても、その項目だけ既定値で補う', () => {
    localStorage.setItem(KEYS.settings, JSON.stringify({ locale: 'en', soundVolume: 'おおきく' }));
    const settings = settingsStore.load();
    expect(settings.locale).toBe('en');
    expect(settings.soundVolume).toBe(0.5);
  });

  it('成績は 3.10 の規則どおりに積まれる', () => {
    statsStore.record({
      n: 9,
      difficulty: 'Hard',
      completed: true,
      failed: false,
      elapsedMs: 60000,
      hintUsed: 2,
      mistakeCount: 1,
    });
    statsStore.record({
      n: 9,
      difficulty: 'Hard',
      completed: true,
      failed: true,
      elapsedMs: 10000,
      hintUsed: 0,
      mistakeCount: 3,
    });

    const entry = statsStore.load().entries['9:Hard'];
    expect(entry.playCount).toBe(2);
    expect(entry.clearCount).toBe(1);
    expect(entry.failedCount).toBe(1);
    expect(entry.hintUsedTotal).toBe(2);
    // 失敗したセッションは、速くても最短時間に採らない（C-06）
    expect(entry.bestTimeMs).toBe(60000);
  });

  it('既出はサイズ別のリングバッファとして回る', () => {
    recentStore.save({ ...emptyRecent(), bufferSize: 3 });

    for (const id of ['a', 'b', 'c', 'd']) recentStore.push(9, id);

    expect(recentStore.list(9)).toEqual(['d', 'c', 'b']); // 新しい順・古い a は落ちた
    expect(recentStore.list(16)).toEqual([]); // サイズごとに別
  });

  it('中断は1件だけ持ち、消せる', () => {
    expect(sessionStore.exists()).toBe(false);

    sessionStore.save(sampleSession());
    expect(sessionStore.exists()).toBe(true);
    expect(sessionStore.load()?.sourceId).toBe('N9-000051');
    // 変換パラメータは中身を解釈せず、そのまま戻す（3.2.6）
    expect(sessionStore.load()?.transformParams).toEqual({
      rotation: 1,
      mirror: false,
      symbols: [1, 2, 3],
    });

    sessionStore.clear();
    expect(sessionStore.exists()).toBe(false);
  });

  it('版が古ければ移行する。設定だけ初期化し、成績と既出は引き継ぐ（3.6.2）', () => {
    // 古いアプリが書き残した状態を作る（版の刻印は最後に置く。
    // 保存は必ず現行版で刻み直すため、先に置くと上書きされてしまう）
    statsStore.save({ ...emptyStats(), updatedAt: 'まえの記録' });
    recentStore.push(9, 'N9-000051');
    localStorage.setItem(KEYS.settings, JSON.stringify({ locale: 'zh', zoomPreference: 2.5 }));
    localStorage.setItem(KEYS.meta, JSON.stringify({ storageVersion: '1.00' }));

    ensureMigrated();

    expect(readMeta()?.storageVersion).toBe(STORAGE_VERSION);
    expect(settingsStore.load().locale).toBe('ja'); // 初期化された
    expect(statsStore.load().updatedAt).toBe('まえの記録'); // 引き継がれた
    expect(recentStore.list(9)).toEqual(['N9-000051']);
  });

  it('1.01 からの移行では、設定を残したまま音量だけ補う（3.6.2）', () => {
    localStorage.setItem(KEYS.meta, JSON.stringify({ storageVersion: '1.01' }));
    localStorage.setItem(KEYS.settings, JSON.stringify({ locale: 'en', soundEnabled: true }));

    ensureMigrated();

    const settings = settingsStore.load();
    expect(settings.locale).toBe('en'); // 残っている
    expect(settings.soundEnabled).toBe(true);
    expect(settings.soundVolume).toBe(0.5); // 補われた
  });

  it('退避マニフェストは移行で消えない（3.6.2）', () => {
    localStorage.setItem(KEYS.meta, JSON.stringify({ storageVersion: '0.99' }));
    localStorage.setItem(KEYS.manifestCache, JSON.stringify({ schemaVersion: '1.04' }));

    ensureMigrated();

    expect(localStorage.getItem(KEYS.manifestCache)).not.toBeNull();
  });
});

describe('エクスポートとインポート（3.7）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('2-9: 書き出したものを取り込むと、設定・成績・既出・中断が戻る', async () => {
    settingsStore.save({ ...settingsStore.defaults(), locale: 'zh', soundVolume: 0.3 });
    statsStore.record({
      n: 16,
      difficulty: 'Apocalypse',
      completed: true,
      failed: false,
      elapsedMs: 999000,
      hintUsed: 5,
      mistakeCount: 0,
    });
    recentStore.push(16, 'N16-000007');
    sessionStore.save(sampleSession());

    const bundle = buildBundle();
    expect(bundle.ok).toBe(true);
    if (!bundle.ok) return;
    const text = JSON.stringify(bundle.value);

    // ストレージが消えた状況を作る
    localStorage.clear();
    expect(settingsStore.load().locale).toBe('ja');
    expect(sessionStore.exists()).toBe(false);

    const file = new File([text], 'momo-sudoku-backup_20260806-000000.json', {
      type: 'application/json',
    });
    const imported = await importBundle(file);
    expect(imported.ok).toBe(true);

    expect(settingsStore.load().locale).toBe('zh');
    expect(settingsStore.load().soundVolume).toBe(0.3);
    expect(statsStore.load().entries['16:Apocalypse'].clearCount).toBe(1);
    expect(statsStore.load().entries['16:Apocalypse'].bestTimeMs).toBe(999000);
    expect(recentStore.list(16)).toEqual(['N16-000007']);
    expect(sessionStore.load()?.sourceId).toBe('N9-000051');
  });

  it('2-9: 取り込みは全置換で、元のデータと混ざらない', async () => {
    recentStore.push(9, '書き出す前のもの');
    const bundle = buildBundle();
    if (!bundle.ok) return;
    const text = JSON.stringify(bundle.value);

    recentStore.push(9, '書き出したあとに増えたもの');

    const file = new File([text], 'b.json', { type: 'application/json' });
    await importBundle(file);

    expect(recentStore.list(9)).toEqual(['書き出す前のもの']);
  });

  it('MOMO Sudoku のバックアップでなければ取り込まない', () => {
    expect(validate({ format: 'よそのアプリ' }).ok).toBe(false);
    expect(validate(null).ok).toBe(false);
  });

  it('保存形式のメジャー版が違えば取り込まない', () => {
    const bundle = buildBundle();
    if (!bundle.ok) return;
    expect(validate({ ...bundle.value, storageVersion: '2.00' }).ok).toBe(false);
    expect(validate({ ...bundle.value, storageVersion: '1.01' }).ok).toBe(true);
  });
});
