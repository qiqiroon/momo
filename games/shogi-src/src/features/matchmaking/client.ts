/**
 * momo-matchmaking (v1.01) の型安全ラッパ。
 * 実体は共通ライブラリ `games/matchmaking/momo-matchmaking.js`。
 * B ビルド専用 (features/*・A ビルドから tree-shake で除外)。
 *
 * 段階 2-1 の責務:
 * - 型定義の宣言 (MomoMatchmakingApi)
 * - 実行時 window global の存在確認 helper
 * - callback 型と MomoMatchmakingInitOptions の型付け
 *
 * 段階 2-2 以降:
 * - createRoom / joinRoom / send を UI から呼ぶ
 * - onData を Shogi 対局メッセージ dispatcher に接続
 */

export interface MomoMatchmakingInitOptions {
  signalingUrl: string;
  gameType: string;
  onRoomList?: (rooms: MomoRoomInfo[]) => void;
  onRoomCreated?: (roomId: string, hostName: string) => void;
  onJoinedRoom?: (info: { roomId: string; roomName: string; hostName: string; guestName: string; rules?: unknown }) => void;
  onGuestJoined?: (info: { guestName: string }) => void;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onData?: (data: unknown) => void;
  onError?: (msg: string) => void;
  onKicked?: () => void;
}

export interface MomoRoomInfo {
  /** サーバーの部屋 ID (signaling-server は `id` を返す) */
  id: string;
  name: string;
  hostName: string;
  hasPassword: boolean;
  isPublic: boolean;
  guestConnected?: boolean;
  gameState?: string;
  rules?: unknown;
}

export interface MomoCreateRoomOptions {
  hostName?: string;
  name?: string;
  password?: string;
  isPublic?: boolean;
  rules?: unknown;
}

export interface MomoMatchmakingState {
  isHost: boolean;
  connected: boolean;
  currentRoomId: string | null;
  currentRoomName: string;
}

export interface MomoMatchmakingApi {
  init: (options: MomoMatchmakingInitOptions) => void;
  createRoom: (options: MomoCreateRoomOptions) => void;
  joinRoom: (roomId: string, password: string, guestName: string) => void;
  send: (data: unknown) => void;
  leaveRoom: () => void;
  refreshRooms: () => void;
  kickGuest: () => void;
  getState: () => MomoMatchmakingState;
  changeGameType: (gameType: string) => void;
}

declare global {
  interface Window {
    MomoMatchmaking?: MomoMatchmakingApi;
  }
}

/** 実行時に window.MomoMatchmaking が読み込まれているかを確認する。 */
export function hasMomoMatchmaking(): boolean {
  return typeof window !== 'undefined' && !!window.MomoMatchmaking;
}

/** window.MomoMatchmaking を取得する (未ロード時は null)。 */
export function getMomoMatchmaking(): MomoMatchmakingApi | null {
  if (!hasMomoMatchmaking()) return null;
  return window.MomoMatchmaking ?? null;
}
