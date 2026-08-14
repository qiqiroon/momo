/**
 * AI の目録と既定選択 (親 §7.1.1・付録 D-5 v1.2 §6.3)。
 *
 * ここで固定したいのは「モードごとに最強が入れ替わってよい」という性質そのもの。
 * 1 本の重みで全モードを決めていた頃の作りに戻ると、この検査が落ちる。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerEngine,
  clearEngines,
  listEngines,
  defaultEngine,
  resolveEngineId,
  supports,
} from './engine-registry';
import type { EngineAdapter, EngineDescriptor } from './types';
import { aiModeFrom } from './mode';

const stub = () => ({}) as EngineAdapter;

function make(id: string, weights: EngineDescriptor['weights']): EngineDescriptor {
  return { id, labelKey: `${id}.name`, descKey: `${id}.desc`, weights, create: stub };
}

describe('AI の目録', () => {
  beforeEach(() => clearEngines());

  it('モードごとに最強が入れ替わる', () => {
    // 本将棋では外部エンジンが強く、量子では汎用が強い、という想定を表せること。
    registerEngine(make('usi', { shogi: 100 }));
    registerEngine(make('generic', { shogi: 5, variant: 5, torus: 5, quantum: 50 }));

    expect(defaultEngine('shogi')?.id).toBe('usi');
    expect(defaultEngine('quantum')?.id).toBe('generic');
    expect(defaultEngine('torus')?.id).toBe('generic');
  });

  it('名乗っていないモードでは選べない', () => {
    const usi = make('usi', { shogi: 100 });
    registerEngine(usi);
    expect(supports(usi, 'shogi')).toBe(true);
    expect(supports(usi, 'quantum')).toBe(false);
  });

  it('対応しないものも一覧には出す (理由を添えて選べなくするため)', () => {
    registerEngine(make('usi', { shogi: 100 }));
    registerEngine(make('generic', { shogi: 5, quantum: 5 }));

    const rows = listEngines('quantum');
    expect(rows.map((r) => r.descriptor.id)).toEqual(['generic', 'usi']);
    expect(rows[0].supported).toBe(true);
    expect(rows[1].supported).toBe(false);
    expect(rows[1].weight).toBeNull();
  });

  it('並び順はそのモードの重みの降順・同値なら登録順', () => {
    registerEngine(make('a', { shogi: 5 }));
    registerEngine(make('b', { shogi: 9 }));
    registerEngine(make('c', { shogi: 5 }));
    expect(listEngines('shogi').map((r) => r.descriptor.id)).toEqual(['b', 'a', 'c']);
  });

  it('1 つも積まれていなければ既定は無い (A ビルド)', () => {
    expect(defaultEngine('shogi')).toBeUndefined();
    expect(listEngines('shogi')).toEqual([]);
    expect(resolveEngineId(null, 'shogi')).toBeNull();
  });

  describe('モードが変わったとき', () => {
    beforeEach(() => {
      registerEngine(make('usi', { shogi: 100 }));
      registerEngine(make('generic', { shogi: 5, quantum: 5 }));
    });

    it('手で選んだものが新しいモードにも対応していれば、その選択を残す', () => {
      // 本将棋で「generic」を手で選んだ人が量子へ移っても generic のまま。
      expect(resolveEngineId('generic', 'quantum')).toBe('generic');
    });

    it('対応しなくなったときだけ、そのモードの既定へ移す', () => {
      expect(resolveEngineId('usi', 'quantum')).toBe('generic');
    });

    it('選んでいなければそのモードの既定', () => {
      expect(resolveEngineId(null, 'shogi')).toBe('usi');
    });

    it('知らない id を渡されても既定に落ちる', () => {
      expect(resolveEngineId('nonexistent', 'shogi')).toBe('usi');
    });
  });

  it('順位の差し替えは重みの数値だけで効く', () => {
    registerEngine(make('a', { shogi: 1 }));
    registerEngine(make('b', { shogi: 2 }));
    expect(defaultEngine('shogi')?.id).toBe('b');
    // 同じ id で登録し直す = 順位表の数値を書き換えるのと同じこと。
    registerEngine(make('a', { shogi: 3 }));
    expect(defaultEngine('shogi')?.id).toBe('a');
  });
});

describe('対局設定からモードを決める', () => {
  it('量子が最優先 (盤の端のつなぎ方より先に見る)', () => {
    expect(aiModeFrom({ gameType: 'shogi', torusMode: 'full', quantum: true })).toBe('quantum');
  });

  it('トーラスは量子 OFF のとき', () => {
    expect(aiModeFrom({ gameType: 'shogi', torusMode: 'cylinder', quantum: false })).toBe('torus');
    expect(aiModeFrom({ gameType: 'shogi', torusMode: 'full', quantum: false })).toBe('torus');
  });

  it('平面・量子 OFF なら、ルールの種類で本将棋と変則を分ける', () => {
    expect(aiModeFrom({ gameType: 'shogi', torusMode: 'none', quantum: false })).toBe('shogi');
    expect(aiModeFrom({ gameType: 'hasami', torusMode: 'none', quantum: false })).toBe('variant');
    expect(aiModeFrom({ gameType: 'shogi-custom', torusMode: 'none', quantum: false })).toBe('variant');
  });

  it('対局設定が取れないときは本将棋として扱う', () => {
    expect(aiModeFrom(null)).toBe('shogi');
    expect(aiModeFrom({})).toBe('shogi');
  });
});
