import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchRuleCatalog, fetchRuleMgf } from './rule-catalog';
import chessRaw from './chess.json';

/**
 * カスタムルールを「データとして読み込む」入口の検査 (親 v1.65 §5.5・第 9 段 段A)。
 * 取ってこられること・壊れたものを弾くこと・配られる rules/chess.json が
 * 焼き込みの chess.json と食い違わないことを固定する。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicRules = resolve(__dirname, '../../../../public/rules');

function mockFetch(map: Record<string, { ok?: boolean; status?: number; body: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const hit = map[url];
      if (!hit) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: hit.ok ?? true,
        status: hit.status ?? 200,
        json: async () => JSON.parse(hit.body),
      };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('段A rule-catalog: 取ってくる', () => {
  it('マニフェストを読み、id/file/name を取り出す', async () => {
    mockFetch({
      '/base/rules/index.json': { body: JSON.stringify({ rules: [{ id: 'chess', file: 'chess.json', name: 'チェス' }] }) },
    });
    const list = await fetchRuleCatalog('/base/');
    expect(list).toEqual([{ id: 'chess', file: 'chess.json', name: 'チェス' }]);
  });

  it('name が無ければ id で埋める', async () => {
    mockFetch({ '/base/rules/index.json': { body: JSON.stringify({ rules: [{ id: 'x', file: 'x.json' }] }) } });
    const list = await fetchRuleCatalog('/base/');
    expect(list[0].name).toBe('x');
  });

  it('ルール本体を取ってきて MGF として読める', async () => {
    mockFetch({ '/base/rules/chess.json': { body: JSON.stringify(chessRaw) } });
    const mgf = await fetchRuleMgf('/base/', 'chess.json');
    expect(mgf.metadata.game_id).toBe('chess');
    expect(mgf.board.width).toBe(8);
  });
});

describe('段A rule-catalog: 壊れたものを弾く', () => {
  it('一覧が取得できない (非 ok) と例外', async () => {
    mockFetch({ '/base/rules/index.json': { ok: false, status: 500, body: '{}' } });
    await expect(fetchRuleCatalog('/base/')).rejects.toThrow();
  });

  it('一覧の形式が違う (rules 配列なし) と例外', async () => {
    mockFetch({ '/base/rules/index.json': { body: JSON.stringify({ nope: 1 }) } });
    await expect(fetchRuleCatalog('/base/')).rejects.toThrow();
  });

  it('本体が取得できない (非 ok) と例外', async () => {
    mockFetch({ '/base/rules/missing.json': { ok: false, status: 404, body: '{}' } });
    await expect(fetchRuleMgf('/base/', 'missing.json')).rejects.toThrow();
  });

  it('MGF として欠けている (pieces なし) と例外', async () => {
    mockFetch({ '/base/rules/broken.json': { body: JSON.stringify({ metadata: { game_id: 'x' }, board: { width: 8, height: 8 }, initial_placement: {} }) } });
    await expect(fetchRuleMgf('/base/', 'broken.json')).rejects.toThrow();
  });
});

describe('段A 配られる rules/ が焼き込みと食い違わない (ドリフト防止)', () => {
  it('public/rules/chess.json は src の chess.json と同一', () => {
    const served = JSON.parse(readFileSync(resolve(publicRules, 'chess.json'), 'utf-8'));
    expect(served).toEqual(chessRaw);
  });

  it('public/rules/index.json にチェスが載っている', () => {
    const index = JSON.parse(readFileSync(resolve(publicRules, 'index.json'), 'utf-8'));
    expect(index.rules.some((r: { id: string }) => r.id === 'chess')).toBe(true);
  });
});
