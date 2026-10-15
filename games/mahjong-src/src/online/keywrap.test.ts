import { describe, expect, it } from 'vitest';
import { LOCK_BITS, groupOf, modPow } from './lock';
import { newWrapKeyPair, unwrap, validWrapKey, wrapFor } from './keywrap';

const g = groupOf(LOCK_BITS);

describe('鍵の包み（ホストにしか開けられない）', () => {
  it('ホストの鍵で包んだものはホストが開けられる', async () => {
    const host = newWrapKeyPair(g);
    const plain = JSON.stringify({ hello: '鍵', n: [1, 2, 3] }).repeat(200);
    const blob = await wrapFor(g, host.y, plain);
    expect(blob).not.toContain('hello');
    expect(await unwrap(g, host.x, blob)).toBe(plain);
  });

  it('別の人の鍵では開けられない', async () => {
    const host = newWrapKeyPair(g);
    const other = newWrapKeyPair(g);
    const blob = await wrapFor(g, host.y, 'secret');
    expect(await unwrap(g, other.x, blob)).toBeNull();
  });

  it('書き換えた包みは開けられない', async () => {
    const host = newWrapKeyPair(g);
    const blob = JSON.parse(await wrapFor(g, host.y, 'secret')) as { ct: string };
    const ct = atob(blob.ct);
    const bad = { ...blob, ct: btoa(String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1)) };
    expect(await unwrap(g, host.x, JSON.stringify(bad))).toBeNull();
  });

  it('同じ中身でも包むたびに違う形になる（使い捨ての値）', async () => {
    const host = newWrapKeyPair(g);
    expect(await wrapFor(g, host.y, 'same')).not.toBe(await wrapFor(g, host.y, 'same'));
  });

  it('弱い包む鍵（1・p-1・群の外）は断る', async () => {
    expect(validWrapKey(g, 1n)).toBe(false);
    expect(validWrapKey(g, g.p - 1n)).toBe(false);
    // 平方数でない数（4 の累乗の群の外）
    let n = 2n;
    while (modPow(n, g.q, g.p) === 1n) n++;
    expect(validWrapKey(g, n)).toBe(false);
    await expect(wrapFor(g, 1n, 'x')).rejects.toThrow();
    expect(validWrapKey(g, newWrapKeyPair(g).y)).toBe(true);
  });
});
