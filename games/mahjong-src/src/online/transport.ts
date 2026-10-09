// 通信の土台（games/matchmaking/momo-matchmaking.js）を Transport の形にする。
// 土台は MOMO Shogi と同じく組み立てに取り込む（将棋の features/matchmaking/vendor.ts と同じ形）。
// 土台そのもの・サーバーは触らない。麻雀の部屋はゲームの種類 'mahjong' で一覧が分かれる。

import '@momo-mm/momo-matchmaking.js';
import type { RoomInfo, Transport, TransportHandlers } from './session';

export const SIGNALING_URL = 'wss://momo-server-reversi.onrender.com';
export const GAME_TYPE = 'mahjong';

interface RosterEntry {
  pid: string;
  role: string;
}

interface MomoMatchmakingApi {
  init(o: Record<string, unknown>): void;
  createRoom(o: Record<string, unknown>): void;
  joinRoom(roomId: string, password: string, name: string, role?: string): void;
  send(data: unknown, to?: string): void;
  leaveRoom(): void;
  refreshRooms(): void;
  getState(): { currentRoomId: string | null };
}

declare global {
  interface Window {
    MomoMatchmaking?: MomoMatchmakingApi;
  }
}

const api = (): MomoMatchmakingApi => {
  if (!window.MomoMatchmaking) throw new Error('MomoMatchmaking が読み込まれていない');
  return window.MomoMatchmaking;
};

const playersOf = (roster: readonly RosterEntry[]) => roster.filter((p) => p.role === 'host' || p.role === 'player').length;

function toRoom(r: Record<string, unknown>): RoomInfo | null {
  if (r.mode !== 'multi') return null;
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    hostName: String(r.hostName ?? ''),
    hasPassword: r.hasPassword === true,
    isPublic: r.isPublic !== false,
    playerCount: Number(r.playerCount ?? 0),
    maxPlayers: Number(r.maxPlayers ?? 4),
    gameState: String(r.gameState ?? 'lobby'),
  };
}

/** 部屋にいるか（切れたときに、部屋が閉じたのか自分が切れたのかを分けるため） */
let inRoom = false;

export const matchmakingTransport: Transport = {
  connect(h: TransportHandlers) {
    api().init({
      signalingUrl: SIGNALING_URL,
      gameType: GAME_TYPE,
      onWsOpen: () => h.onOpen(),
      onWsClose: () => h.onClose(),
      onRoomList: (rooms: Record<string, unknown>[]) => h.onRooms(rooms.map(toRoom).filter((r): r is RoomInfo => r !== null)),
      onRoomCreated: (id: string, name: string) => {
        inRoom = true;
        h.onCreated(id, name);
      },
      onJoinedRoom: (id: string, name: string) => {
        inRoom = true;
        h.onJoined(id, name);
      },
      onParticipantLeft: (_pid: string, roster: RosterEntry[]) => h.onPeerLeft(playersOf(roster)),
      onMessage: (d: Record<string, unknown>) => h.onMessage(d),
      onDisconnected: () => {
        if (!inRoom) return;
        inRoom = false;
        // 部屋が閉じた（ホストが抜けた）ときは土台が先に部屋を忘れている。
        // 自分の接続が切れたときは部屋を覚えたままなので、ここで出てつなぎ直させる
        if (api().getState().currentRoomId === null) h.onRoomClosed();
        else {
          api().leaveRoom();
          h.onLost();
        }
      },
      onError: (m: string) => h.onError(m),
    });
  },
  createRoom(o) {
    api().createRoom({ ...o, mode: 'multi', maxSpectators: 0 });
  },
  joinRoom(roomId, password, name) {
    api().joinRoom(roomId, password, name, 'player');
  },
  send(data, to) {
    api().send(data, to);
  },
  leave() {
    inRoom = false;
    api().leaveRoom();
  },
  refresh() {
    api().refreshRooms();
  },
  setGameState(s) {
    api().send({ type: 'game_state_update', gameState: s });
  },
};
