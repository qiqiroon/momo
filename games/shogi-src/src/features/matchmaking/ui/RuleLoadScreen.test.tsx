import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RuleLoadScreen } from './RuleLoadScreen';
import { useRouteStore } from '../../../core/store/route-store';
import { useGameStore } from '../../../core/store/game-store';
import chessRaw from '../../../core/engine/mgf/chess.json';

/**
 * ルール読み込み画面 (第 9 段 段A)。一覧を出し、選ぶと「データとして読み込んだ MGF」で
 * オフライン対局が始まること・取得できないときはエラーを出すことを固定する。
 */
function mockFetchBySuffix(map: Record<string, { ok?: boolean; status?: number; body: unknown }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(map).find((k) => url.endsWith(k));
      const hit = key ? map[key] : undefined;
      if (!hit) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: hit.ok ?? true, status: hit.status ?? 200, json: async () => hit.body };
    }),
  );
}

describe('段A RuleLoadScreen', () => {
  beforeEach(() => {
    useRouteStore.setState({ screen: 'rule-load' });
    useGameStore.getState().reset({ gameType: 'shogi' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('一覧を出し、チェスを選ぶと custom で 8×8 の対局が始まる', async () => {
    mockFetchBySuffix({
      'rules/index.json': { body: { rules: [{ id: 'chess', file: 'chess.json', name: 'チェス' }] } },
      'rules/chess.json': { body: chessRaw },
    });
    render(<RuleLoadScreen />);
    const card = await screen.findByText('チェス');
    fireEvent.click(card);
    await waitFor(() => expect(useRouteStore.getState().screen).toBe('game'));
    expect(useGameStore.getState().currentGameType).toBe('custom');
    expect(useGameStore.getState().position.width).toBe(8);
  });

  it('一覧が取得できないときはエラーを出す (対局は始めない)', async () => {
    mockFetchBySuffix({ 'rules/index.json': { ok: false, status: 500, body: {} } });
    render(<RuleLoadScreen />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(useRouteStore.getState().screen).toBe('rule-load');
  });
});
