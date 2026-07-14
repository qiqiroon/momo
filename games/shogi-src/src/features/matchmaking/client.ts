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
  /** ホスト: 部屋作成成功 (server room_created) */
  onRoomCreated?: (roomId: string, roomName: string, rules?: unknown) => void;
  /** ゲスト: 入室成功 (server joined_room) */
  onJoinedRoom?: (roomId: string, roomName: string, hostName: string, rules?: unknown) => void;
  /** ホスト: ゲストが入室 (server guest_joined) */
  onGuestJoined?: (guestName: string) => void;
  /** ホスト: ゲストが退出 (server guest_left) */
  onGuestLeft?: () => void;
  /** 両者: P2P DataChannel open 完了 */
  onConnected?: () => void;
  /** 切断・部屋閉鎖 */
  onDisconnected?: (reason?: string) => void;
  /** 対局メッセージ (DataChannel or WS 経由の非内部型) */
  onMessage?: (data: unknown) => void;
  onError?: (msg: string) => void;
  onKicked?: () => void;
  /** v0.50: WebSocket open (シグナリング接続確立)。1.5 秒嘘タイマーの代替 */
  onWsOpen?: () => void;
  /** v0.50: WebSocket close */
  onWsClose?: () => void;
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
