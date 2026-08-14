import { describe, it, expect } from 'vitest';
import { DEFAULT_QUANTUM_PARAMS } from '../../core/store/quantum-params';
import { checkRuleSupport, ruleDigest, type SyncedRules } from './protocol';

/**
 * Phase 5-12 ルール同期 (親 §6.5)。
 *
 * ここで固定したいのは「揃っていないことに気づけるか」。ルール同期の値打ちは
 * 揃ったときではなく、揃わなかったときに黙って進まないことにある。
 */

const BASE: SyncedRules = {
  gameType: 'shogi',
  torusMode: 'none',
  quantum: false,
  quantumDisplayMode: 'cycle',
  timeControl: { mode: 'byoyomi', mainSeconds: 900, byoyomiSeconds: 30 },
  quantumParams: DEFAULT_QUANTUM_PARAMS,
  handicap: null,
};

describe('ruleDigest — ルール一式の照合', () => {
  it('同じ設定からは同じ値になる (別々に組み立てても一致する)', () => {
    expect(ruleDigest({ ...BASE })).toBe(ruleDigest({ ...BASE }));
  });

  it('トーラスの詳細が違えば別の値になる', () => {
    // v1.19 まで落ちていた項目。円筒と完全トーラスを同じ値と見なしてしまうと
    // 「揃った」と表示したまま別の盤で対局が始まる。
    const cyl = ruleDigest({ ...BASE, torusMode: 'cylinder' });
    const full = ruleDigest({ ...BASE, torusMode: 'full' });
    expect(cyl).not.toBe(full);
  });

  it('手合いが違えば別の値になる (v1.33)', () => {
    // 手合いが揃わないと初期局面そのものが食い違う。見取り図に入れ忘れると
    // 「揃った」と表示したまま別の盤で始まってしまう。
    const even = ruleDigest(BASE);
    const drop = ruleDigest({ ...BASE, handicap: { typeId: 'ni', giver: 'self' } });
    const other = ruleDigest({ ...BASE, handicap: { typeId: 'ni', giver: 'opponent' } });
    expect(drop).not.toBe(even);
    expect(drop).not.toBe(other); // 落とす側が違えば別物
  });

  it('量子の実行時パラメータが違えば別の値になる', () => {
    // v1.19 の申し送り: デバッグパネルで片側だけ反復上限を変えると計算結果がずれる。
    const a = ruleDigest({ ...BASE, quantum: true });
    const b = ruleDigest({
      ...BASE,
      quantum: true,
      quantumParams: { ...DEFAULT_QUANTUM_PARAMS, maxIterations: 16 },
    });
    expect(a).not.toBe(b);
  });

  it('異常時の挙動が違えば別の値になる', () => {
    const a = ruleDigest({ ...BASE, quantum: true });
    const b = ruleDigest({
      ...BASE,
      quantum: true,
      quantumParams: { ...DEFAULT_QUANTUM_PARAMS, anomalyAction: 'no_game' },
    });
    expect(a).not.toBe(b);
  });

  it('持ち時間が違えば別の値になる', () => {
    const a = ruleDigest({ ...BASE });
    const b = ruleDigest({ ...BASE, timeControl: { mode: 'byoyomi', mainSeconds: 900, byoyomiSeconds: 60 } });
    expect(a).not.toBe(b);
  });
});

describe('checkRuleSupport — 自分のエンジンで扱えるか', () => {
  it('いま作れる部屋のルールはすべて扱える', () => {
    expect(checkRuleSupport({ ...BASE })).toEqual({ ok: true });
    expect(checkRuleSupport({ ...BASE, torusMode: 'full' })).toEqual({ ok: true });
    expect(checkRuleSupport({ ...BASE, quantum: true })).toEqual({ ok: true });
  });

  it('知らないゲーム種目は理由を付けて断る', () => {
    // 自作ルール (shogi-custom) は Phase 7 の担当なので、いまは扱えないと答えるのが正しい。
    expect(checkRuleSupport({ ...BASE, gameType: 'shogi-custom' })).toEqual({
      ok: false,
      reason: 'unsupported_game_type',
    });
  });

  it('知らないトーラスの種類は理由を付けて断る', () => {
    const rules = { ...BASE, torusMode: 'klein' as unknown as SyncedRules['torusMode'] };
    expect(checkRuleSupport(rules)).toEqual({ ok: false, reason: 'unsupported_torus_mode' });
  });
});
