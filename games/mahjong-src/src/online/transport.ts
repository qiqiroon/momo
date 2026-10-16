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

/** 部屋にいる人の数（ホスト・プレイヤー・観戦。点呼の返事を待つ人数に使う。サーバーの役割は入ったときのまま＝麻雀の役割はアプリが決める） */
const peopleOf = (roster: readonly RosterEntry[]) => roster.length;

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
    spectatorCount: Number(r.spectatorCount ?? 0),
    maxSpectators: Number(r.maxSpectators ?? 0),
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
      onParticipantLeft: (_pid: string, roster: RosterEntry[]) => h.onPeerLeft(peopleOf(roster)),
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
    // 観戦の枠はいつもサーバーの最大（8）で作る。観戦を許すか・断るかはホストのアプリが決める（途中で切り替えられる＝段階10の3）
    api().createRoom({ ...o, mode: 'multi', maxSpectators: 8 });
  },
  joinRoom(roomId, password, name, role = 'player') {
    api().joinRoom(roomId, password, name, role);
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
