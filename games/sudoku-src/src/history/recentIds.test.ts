/**
 * 既出管理（第2分冊 8章）の検査。
 *
 * 受入条件 4-8（既出が200件のリングバッファとしてサイズ別に回る）をここで確かめる。
 */

import { describe, expect, it } from 'vitest';

import { RECENT_BUFFER_SIZE_DEFAULT } from '../game/config';
import type { BoardSize } from '../data/types';
import * as recentIds from './recentIds';

function idsFor(n: BoardSize, count: number, offset = 0): string[] {
  return Array.from(
    { length: count },
    (_, i) => `N${String(n).padStart(2, '0')}-${String(i + 1 + offset).padStart(6, '0')}`,
  );
}

describe('既出リングバッファ（8.2 / 4-8）', () => {
  it('既定は200件で、超えた分は古い側から捨てる', () => {
    let recent = recentIds.create();
    expect(recent.bufferSize).toBe(RECENT_BUFFER_SIZE_DEFAULT);

    // 上限ちょうど＋10件
    for (const id of idsFor(9, RECENT_BUFFER_SIZE_DEFAULT + 10)) {
      recent = recentIds.push(recent, 9, id);
    }

    const list = recentIds.list(recent, 9);
    expect(list).toHaveLength(RECENT_BUFFER_SIZE_DEFAULT);
    // **新しい順**に返る
    expect(list[0]).toBe('N09-000210');
    // 古い10件は落ちている
    expect(list).not.toContain('N09-000001');
    expect(list).not.toContain('N09-000010');
    expect(list).toContain('N09-000011');
  });

  it('サイズごとに独立して回る', () => {
    let recent = recentIds.create(3);
    for (const id of idsFor(4, 5)) recent = recentIds.push(recent, 4, id);
    for (const id of idsFor(25, 2)) recent = recentIds.push(recent, 25, id);

    expect(recentIds.list(recent, 4)).toEqual(['N04-000005', 'N04-000004', 'N04-000003']);
    expect(recentIds.list(recent, 25)).toEqual(['N25-000002', 'N25-000001']);
    // 触っていないサイズは空
    expect(recentIds.list(recent, 16)).toEqual([]);
  });

  it('同じIDを積み直すと、いちばん新しい扱いになる（在庫1件の N=1 で効く）', () => {
    let recent = recentIds.create(200);
    for (let i = 0; i < 5; i++) recent = recentIds.push(recent, 1, 'N01-000001');
    // 同一IDで埋め尽くさない
    expect(recentIds.list(recent, 1)).toEqual(['N01-000001']);

    recent = recentIds.push(recent, 9, 'N09-000001');
    recent = recentIds.push(recent, 9, 'N09-000002');
    recent = recentIds.push(recent, 9, 'N09-000001');
    expect(recentIds.list(recent, 9)).toEqual(['N09-000001', 'N09-000002']);
  });

  it('バッファ長を縮めると古い側から捨てられる', () => {
    let recent = recentIds.create(10);
    for (const id of idsFor(16, 10)) recent = recentIds.push(recent, 16, id);

    recent = recentIds.resize(recent, 3);
    expect(recent.bufferSize).toBe(3);
    expect(recentIds.list(recent, 16)).toEqual(['N16-000010', 'N16-000009', 'N16-000008']);

    // 広げても既存は失われない
    recent = recentIds.resize(recent, 200);
    expect(recentIds.list(recent, 16)).toHaveLength(3);
  });

  it('元の値を書き換えない（積むたびに新しい値を返す）', () => {
    const first = recentIds.create(5);
    const second = recentIds.push(first, 9, 'N09-000001');
    expect(recentIds.list(first, 9)).toEqual([]);
    expect(recentIds.list(second, 9)).toEqual(['N09-000001']);
  });

  it('おかしなバッファ長は既定値へ落とす', () => {
    expect(recentIds.create(0).bufferSize).toBe(RECENT_BUFFER_SIZE_DEFAULT);
    expect(recentIds.create(-1).bufferSize).toBe(RECENT_BUFFER_SIZE_DEFAULT);
    expect(recentIds.create(1.5).bufferSize).toBe(RECENT_BUFFER_SIZE_DEFAULT);
  });
});
