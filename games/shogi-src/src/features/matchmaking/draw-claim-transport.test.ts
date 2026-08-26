/**
 * 引き分けの主張の運び方（親 v1.65 §3.10.0・第 9 段 9-4d）。
 *
 * ここで押さえたいことは 3 つ。
 * 1. **主張は申し出とは別の伝言**＝**諾否を返すものが無い**（`draw_offer` と混ぜない）
 * 2. **届いたらそのまま同じ終局になる**（投了・入玉宣言と同じ扱い）
 * 3. **観戦者にも同じ終局が届く**＝見届けられないと画面が止まる
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ensureMatchmakingInit } from './bootstrap';
import type { MomoMatchmakingInitOptions } from './client';
import { handleShogiMessage } from './messageDispatcher';
import { PROTOCOL_VERSION } from './protocol';
import { useMatchmakingStore } from './store';
import './gameConnector';
import { useGameStore } from '../../core/store/game-store';
import { get as pluginGet } from '../../core/plugin/registry';
import type { OnlineGameConnector } from '../../core/plugin/gameConnector';

const fakeApiFactory = (sent: { data: unknown; to?: string }[]) => ({
  init: (_o: MomoMatchmakingInitOptions) => {},
  createRoom: () => {},
  joinRoom: () => {},
  send: (data: unknown, to?: string) => sent.push({ data, to }),
  leaveRoom: () => {},
  refreshRooms: () => {},
  kickGuest: () => {},
  getState: () => ({ isHost: true, connected: true, currentRoomId: 'r1', currentRoomName: '部屋' }),
  changeGameType: () => {},
});

function payloadsOf(sent: { data: unknown }[]): Record<string, unknown>[] {
  return sent
    .map((s) => (s.data as { body?: Record<string, unknown> })?.body)
    .filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null);
}

describe('引き分けの主張を運ぶ', () => {
  let sent: { data: unknown; to?: string }[] = [];

  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(sent);
    ensureMatchmakingInit();
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({ myRole: 'player', myPid: 'p0', isHost: true, roster: [] });
  });

  it('主張したことを、根拠つきで相手と観戦者へ送る', () => {
    useMatchmakingStore.setState({
      gameStartInfo: { gameType: 'shogi', hostSide: 'player1' } as never,
    });
    const c = pluginGet<OnlineGameConnector>('gameConnector');
    c?.sendDrawClaim?.('player1', 'move_limit');
    const body = payloadsOf(sent).find((p) => p.type === 'draw_claim');
    expect(body).toMatchObject({ type: 'draw_claim', side: 'player1', reason: 'move_limit' });
  });

  it('届いた主張は、諾否を挟まずそのまま終局になる（同じ形の繰り返し）', () => {
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'draw_claim',
      side: 'player2',
      reason: 'repetition',
    });
    expect(useGameStore.getState().status).toBe('sennichite');
  });

  it('届いた主張は、根拠どおりの終局になる（無進展手数）', () => {
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'draw_claim',
      side: 'player2',
      reason: 'move_limit',
    });
    expect(useGameStore.getState().status).toBe('move_limit');
  });

  it('観戦者にも同じ終局が届く（見届けられないと画面が止まる）', () => {
    useMatchmakingStore.setState({ myRole: 'spectator' });
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'draw_claim',
      side: 'player1',
      reason: 'repetition',
    });
    expect(useGameStore.getState().status).toBe('sennichite');
  });

  it('終わったあとに届いた主張は、盤を書き換えない', () => {
    useGameStore.getState().resign('player1');
    handleShogiMessage({
      v: PROTOCOL_VERSION,
      type: 'draw_claim',
      side: 'player2',
      reason: 'repetition',
    });
    expect(useGameStore.getState().status).toBe('resigned_p1');
  });
});
