// 同じ山で勝負のリンク（6e・Q45＝A）
import { describe, expect, it } from 'vitest';
import { decodeRuleLink } from '../engine/ruleSets';
import { decodeSameLink, encodeSameLink } from './same';

describe('同じ山で勝負のリンク', () => {
  it('ルール・山の種・送った人の成績が、読み直すと同じになる', () => {
    const choice = decodeRuleLink('tenhou.ippatsu_off')!;
    const w = { choice, seed: 'abc123', result: { rank: 2, total: -12.5 } };
    expect(decodeSameLink(encodeSameLink(w))).toEqual(w);
    const noResult = { choice, seed: 'xyz' };
    expect(decodeSameLink(encodeSameLink(noResult))).toEqual(noResult);
    expect(/^[A-Za-z0-9_-]+$/.test(encodeSameLink(w))).toBe(true);
  });

  it('壊れたリンク・知らない版・ルールが読めないものは読まない', () => {
    expect(decodeSameLink('abc')).toBeNull();
    const bad = btoa(JSON.stringify({ v: 9, r: 'general', s: 'x' }));
    expect(decodeSameLink(bad)).toBeNull();
    expect(decodeSameLink(btoa(JSON.stringify({ v: 1, r: 'nope', s: 'x' })))).toBeNull();
  });
});
