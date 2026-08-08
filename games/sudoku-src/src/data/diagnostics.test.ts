/**
 * 取り込み記録（C-168）
 *
 * 取り込みの側から見た検査は `fetchJson.test.ts` にある。
 * ここでは**控えそのもの**——`?debug=1` の判定と、人が読む形への畳み方——を確かめる。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diagnostics, resetDebugMode, type AttemptRecord } from './diagnostics';

function withSearch(search: string): void {
  window.history.replaceState({}, '', `/momo/games/sudoku/${search}`);
  resetDebugMode();
}

describe('取り込み記録（C-168）', () => {
  beforeEach(() => {
    diagnostics.reset();
    withSearch('');
  });

  afterEach(() => {
    withSearch('');
  });

  it('?debug=1 のときだけ控えを見せる', () => {
    expect(diagnostics.isDebugMode()).toBe(false);

    withSearch('?debug=1');
    expect(diagnostics.isDebugMode()).toBe(true);

    // 他の値では開かない。うっかり `?debug=0` で開いては意味が無い
    withSearch('?debug=0');
    expect(diagnostics.isDebugMode()).toBe(false);
  });

  it('判定は起動時の1回きりで、あとから履歴をいじっても変わらない', () => {
    withSearch('?debug=1');
    expect(diagnostics.isDebugMode()).toBe(true);

    // `resetDebugMode` を呼ばずに URL だけ書き換える
    window.history.replaceState({}, '', '/momo/games/sudoku/');
    expect(diagnostics.isDebugMode()).toBe(true);
  });

  it('失敗の行には、番号・かかった時間・試みの回数が並ぶ', () => {
    const record: AttemptRecord = {
      seq: 7,
      url: '/data/n25/c0000.json',
      attempt: 1,
      outcome: 'timeout',
      elapsedMs: 15000.4,
      detail: 'AbortError: 中断',
    };
    const line = diagnostics.formatRecord(record);

    expect(line).toContain('#7');
    expect(line).toContain('timeout');
    expect(line).toContain('15000ms');
    expect(line).toContain('2回目');
    expect(line).toContain('AbortError');
    expect(line).toContain('/data/n25/c0000.json');
  });

  it('記録が1件も無くても、貼れる形になる', () => {
    const report = diagnostics.formatReport();
    expect(report).toContain('MOMO Sudoku');
    expect(report).toContain('(記録なし)');
  });

  it('まとめには、症状の切り分けに要る環境の素性が載る', () => {
    diagnostics.record({ url: '/data/manifest.json', attempt: 0, outcome: 'ok', elapsedMs: 3 });
    const report = diagnostics.formatReport();

    expect(report).toContain('画面 ');
    expect(report).toContain('オンライン判定');
    expect(report).toContain('/data/manifest.json');
  });
});

/**
 * できごとの記録（C-179）
 *
 * **完成音が遅れる件を追うために置いた。** 完成を検知した時刻と音が鳴り始めた時刻を
 * 並べれば、遅れがどこで生まれているのかが引き算で読める。
 */
describe('できごとの記録（C-179）', () => {
  beforeEach(() => diagnostics.reset());

  it('積んだ順に残り、まとめにも出る', () => {
    diagnostics.recordEvent('完成を検知（パネル表示）');
    diagnostics.recordEvent('音の要求', 'COMPLETED 読込状態0');
    diagnostics.recordEvent('音が鳴り始めた', 'COMPLETED');

    const events = diagnostics.listEvents();
    expect(events).toHaveLength(3);
    expect(events[0].label).toBe('完成を検知（パネル表示）');
    expect(events[2].detail).toBe('COMPLETED');

    const report = diagnostics.formatReport();
    expect(report).toContain('[できごと]');
    expect(report).toContain('完成を検知（パネル表示）');
    // **間隔が読めること**が肝心である。時刻だけ並べても差を目で引くことになる
    expect(report).toMatch(/\(\+\d+ms\)/);
  });

  it('取り込みの記録とは別に数え、まとめには両方が載る', () => {
    diagnostics.record({ url: '/data/manifest.json', attempt: 0, outcome: 'ok', elapsedMs: 3 });
    diagnostics.recordEvent('完成を検知（パネル表示）');

    const report = diagnostics.formatReport();
    expect(report).toContain('/data/manifest.json');
    expect(report).toContain('完成を検知（パネル表示）');
    expect(diagnostics.list()).toHaveLength(1);
    expect(diagnostics.listEvents()).toHaveLength(1);
  });
});
