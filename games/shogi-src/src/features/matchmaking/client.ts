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

/**
 * v1.53 (親 §6.1): 部屋の中での立場。
 * - 'host' / 'player' … 席に着いている者 = 対局者
 * - 'spectator'       … 席を持たない者 = 観戦者 (段2 で入れるようになる)
 */
export type MomoRole = 'host' | 'player' | 'spectator';

/** v1.53: 参加者名簿の 1 人分 (サーバーが配る)。 */
export interface MomoRosterEntry {
  pid: string;
  role: MomoRole;
  name: string;
}

/**
 * v1.53: 部屋に入った/建てたときに渡される多人数情報。
 * 従来の 1 対 1 で建てた部屋では undefined になる。
 */
export interface MomoMultiInfo {
  mode: 'multi' | 'classic';
  pid: string | null;
  role: MomoRole;
  roster: MomoRosterEntry[];
}

export interface MomoMatchmakingInitOptions {
  signalingUrl: string;
  gameType: string;
  onRoomList?: (rooms: MomoRoomInfo[]) => void;
  /** ホスト: 部屋作成成功 (server room_created) */
  onRoomCreated?: (roomId: string, roomName: string, rules?: unknown, multi?: MomoMultiInfo) => void;
  /** ゲスト: 入室成功 (server joined_room) */
  onJoinedRoom?: (
    roomId: string,
    roomName: string,
    hostName: string,
    rules?: unknown,
    multi?: MomoMultiInfo,
  ) => void;
  /** ホスト: ゲストが入室 (server guest_joined)。**多人数の部屋では呼ばれない** (v1.53) */
  onGuestJoined?: (guestName: string) => void;
  /** ホスト: ゲストが退出 (server guest_left)。**多人数の部屋では呼ばれない** (v1.53) */
  onGuestLeft?: () => void;
  /**
   * v1.53 (親 §6.2): 多人数の部屋に誰かが入った。
   * **対局者とは限らない** — role を見て席の有無を判別すること。
   */
  onParticipantJoined?: (pid: string, role: MomoRole, name: string, roster: MomoRosterEntry[]) => void;
  /** v1.53: 多人数の部屋から誰かが抜けた。抜けた者の素性は roster の差分から読む。 */
  onParticipantLeft?: (pid: string, roster: MomoRosterEntry[]) => void;
  /**
   * 部屋に入った (送受信ができるようになった)。
   *
   * **★v1.53 (親 §6.2): これは「対局相手が居る」ことを意味しない。**
   * サーバー中継では**部屋を建てた時点で発火する** (まだ誰も来ていない)。
   * 対局を始められるかどうかは**参加者名簿に席のある相手が居るか**で判定すること。
   */
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
  /**
   * 1 対 1 で建てた部屋だけが持つ「ゲストが居るか」。
   * **多人数の部屋には無い** (v1.53) — 満席は playerCount / maxPlayers で見る。
   */
  guestConnected?: boolean;
  gameState?: string;
  rules?: unknown;
  /** v1.53: 多人数の部屋なら 'multi'。 */
  mode?: 'multi';
  /** v1.53: 席に着いている人数 (ホストを含む)。 */
  playerCount?: number;
  /** v1.53: 席の数。 */
  maxPlayers?: number;
  /** v1.53: 観戦している人数。 */
  spectatorCount?: number;
  /** v1.53: 観戦枠の数。 */
  maxSpectators?: number;
}

export interface MomoCreateRoomOptions {
  hostName?: string;
  name?: string;
  password?: string;
  isPublic?: boolean;
  rules?: unknown;
  /** v1.53 (親 §6.1): 'multi' を指定した部屋だけが席と観戦枠を持つ。 */
  mode?: 'multi';
  /** v1.53: 席の数。将棋は 2。 */
  maxPlayers?: number;
  /** v1.53: 観戦枠の数。段1 では 0 (観戦は段2)。 */
  maxSpectators?: number;
}

export interface MomoMatchmakingState {
  isHost: boolean;
  connected: boolean;
  currentRoomId: string | null;
  currentRoomName: string;
  /** v1.53: 多人数の部屋での自分の参加者 ID。 */
  pid?: string | null;
  /** v1.53: 多人数の部屋での自分の立場。 */
  role?: MomoRole | null;
  /** v1.53: 参加者名簿。 */
  roster?: MomoRosterEntry[];
}

export interface MomoMatchmakingApi {
  init: (options: MomoMatchmakingInitOptions) => void;
  createRoom: (options: MomoCreateRoomOptions) => void;
  /** v1.53: role を渡すと観戦者として入室できる (段2 で使う)。省略時は席に着く。 */
  joinRoom: (roomId: string, password: string, guestName: string, role?: MomoRole) => void;
  /**
   * v1.53 (親 §6.2): 宛先つきで送る。
   * 省略時は 'all' = 自分以外の全員 (観戦者にも届く)。
   */
  send: (data: unknown, to?: string) => void;
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
