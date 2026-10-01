/**
 * ★v1.95 威嚇の運び方 (音響 §2.5「P2P では威嚇イベントを move に付随フラグとして送り、
 * 相手側で SE-taunt を鳴らす」)。
 *
 * 1. 送る側＝威嚇つきの手にだけ `taunt` を付ける (時計・局面の印と同じ外側の事情)
 * 2. 受ける側＝届いた手が威嚇つきなら、その手を威嚇つきとして記録し、**送り主の**回数を減らす
 * 3. 印の無い手 (旧クライアント・威嚇しなかった手) は今までどおり
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
import { generateLegalMoves } from '../../core/engine';
import { wireMoveOf } from '../../core/protocol/wire-move';
import type { BoardMove } from '../../core/engine/position/types';

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

function firstMove(): BoardMove {
  const s = useGameStore.getState();
  return generateLegalMoves(s.mgf, s.position).find((m) => m.type === 'move' && !m.promote) as BoardMove;
}

describe('威嚇を運ぶ (★v1.95)', () => {
  let sent: { data: unknown; to?: string }[] = [];
  beforeEach(() => {
    sent = [];
    (window as unknown as { MomoMatchmaking: unknown }).MomoMatchmaking = fakeApiFactory(sent);
    ensureMatchmakingInit();
    useGameStore.getState().reset({ gameType: 'shogi' });
    useMatchmakingStore.setState({ myRole: 'player', myPid: 'p0', isHost: true, roster: [] });
  });

  it('威嚇つきの手は taunt を付けて送る・付けなければ載せない', () => {
    const c = pluginGet<OnlineGameConnector>('gameConnector')!;
    c.sendMove({ ...wireMoveOf(firstMove()), taunt: true });
    c.sendMove({ ...wireMoveOf(firstMove()) });
    const moves = payloadsOf(sent).filter((p) => p.type === 'move');
    expect(moves[0].taunt).toBe(true);
    expect('taunt' in moves[1]).toBe(false);
  });

  it('届いた手が威嚇つきなら、威嚇つきとして記録し、送り主の回数を減らす', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'move', ...wireMoveOf(firstMove()), taunt: true });
    const s = useGameStore.getState();
    expect(s.position.history).toHaveLength(1);
    expect(s.lastAppliedMove?.taunt).toBe(true);
    expect(s.tauntsLeft.player1).toBe(2);
  });

  it('印の無い手 (旧クライアント・威嚇しなかった手) は今までどおり', () => {
    handleShogiMessage({ v: PROTOCOL_VERSION, type: 'move', ...wireMoveOf(firstMove()) });
    const s = useGameStore.getState();
    expect(s.position.history).toHaveLength(1);
    expect(s.lastAppliedMove?.taunt).toBeUndefined();
    expect(s.tauntsLeft.player1).toBe(3);
  });
});
