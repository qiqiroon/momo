import { describe, it, expect } from 'vitest';
import { getMomoMatchmaking, hasMomoMatchmaking } from './client';

describe('matchmaking client (段階2-1 骨組み)', () => {
  it('hasMomoMatchmaking はテスト環境 (jsdom, momo-matchmaking 未 import) では false', () => {
    // Vitest 環境は momo-matchmaking.js を副作用 import しないため window.MomoMatchmaking は不在
    expect(hasMomoMatchmaking()).toBe(false);
    expect(getMomoMatchmaking()).toBeNull();
  });

  it('window.MomoMatchmaking モック時は取得できる', () => {
    const mockApi = {
      init: () => {},
      createRoom: () => {},
      joinRoom: () => {},
      send: () => {},
      leaveRoom: () => {},
      refreshRooms: () => {},
      kickGuest: () => {},
      getState: () => ({ isHost: false, connected: false, currentRoomId: null, currentRoomName: '' }),
      changeGameType: () => {},
    };
    (window as unknown as { MomoMatchmaking: typeof mockApi }).MomoMatchmaking = mockApi;
    try {
      expect(hasMomoMatchmaking()).toBe(true);
      expect(getMomoMatchmaking()).toBe(mockApi);
    } finally {
      delete (window as unknown as { MomoMatchmaking?: unknown }).MomoMatchmaking;
    }
  });
});
