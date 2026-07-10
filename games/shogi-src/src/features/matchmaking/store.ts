import { create } from 'zustand';
import type { MomoRoomInfo } from './client';
import type { GameType } from './roomNameCodec';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'in_room' | 'game_connected';

/**
 * 段階 2-5 で RoomScreen が両者の先後選択を扱う際に再利用する型。
 * 段階 2-4 時点では RoomConfig からは外し、部屋作成前には決めない。
 */
export type SideSelection = 'sente' | 'gote';
export type TimeControlMode = 'byoyomi' | 'sudden_death' | 'fischer' | 'no_limit';

export interface TimeControl {
  mode: TimeControlMode;
  mainSeconds: number;
  byoyomiSeconds?: number;
  incrementSeconds?: number;
}

export interface RoomConfig {
  /** ユーザーが入力した「素の」部屋名。encode 前・decode 後の状態を保持する。 */
  roomName: string;
  password: string;
  isPublic: boolean;
  /** ゲーム種類 (Phase 2 時点では本将棋/はさみ将棋の 2 択、自由ルールは Phase 3 で MGF 対応時に追加) */
  gameType: GameType;
  /** トーラス盤面 ON/OFF (対局実装は Phase 3+、現状はラベル用途) */
  torus: boolean;
  /** 量子将棋 ON/OFF (対局実装は Phase 3+、現状はラベル用途) */
  quantum: boolean;
  /** 自由ルール将棋 (shogi-custom) の MGF ルール名 (Phase 3+ で利用) */
  customRuleName?: string;
  timeControl: TimeControl;
}

export const DEFAULT_TIME_CONTROL: TimeControl = {
  mode: 'byoyomi',
  mainSeconds: 600,
  byoyomiSeconds: 30,
};

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  roomName: '',
  password: '',
  isPublic: true,
  gameType: 'shogi',
  torus: false,
  quantum: false,
  timeControl: DEFAULT_TIME_CONTROL,
};

interface MatchmakingState {
  connection: ConnectionStatus;
  rooms: MomoRoomInfo[];
  currentRoomId: string | null;
  currentRoomName: string;
  isHost: boolean;
  /** 相手プレイヤー名 (ホスト側=ゲスト名、ゲスト側=ホスト名) */
  opponentName: string;
  /** 現在部屋のルール設定 (段階 2-4 では表示用) */
  activeRoomConfig: RoomConfig | null;
  errorMessage: string | null;
  playerName: string;
  pendingRoomConfig: RoomConfig;
  /**
   * ユーザーが自分から部屋を出た直後を表すフラグ。
   * サーバーは host_leave / guest_leave を受け取ると本人にも
   * room_closed を送り返してくる。これがクライアントの onDisconnected
   * を発火し、ロビー画面が「未接続」表示に落ちるバグの原因になるため、
   * このフラグが true の間に届いた onDisconnected は無視する。
   * 一度消費したら false に戻す。
   */
  intentionallyLeft: boolean;

  setConnection: (c: ConnectionStatus) => void;
  setRooms: (rooms: MomoRoomInfo[]) => void;
  setCurrentRoom: (info: { roomId: string | null; roomName: string; isHost: boolean }) => void;
  setOpponentName: (name: string) => void;
  setActiveRoomConfig: (config: RoomConfig | null) => void;
  setError: (msg: string | null) => void;
  setPlayerName: (name: string) => void;
  setPendingRoomConfig: (config: Partial<RoomConfig>) => void;
  resetPendingRoomConfig: () => void;
  resetRoomState: () => void;
  setIntentionallyLeft: (v: boolean) => void;
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  connection: 'disconnected',
  rooms: [],
  currentRoomId: null,
  currentRoomName: '',
  isHost: false,
  opponentName: '',
  activeRoomConfig: null,
  errorMessage: null,
  playerName: '',
  pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG },
  intentionallyLeft: false,

  setConnection: (c) => set({ connection: c }),
  setRooms: (rooms) => set({ rooms }),
  setCurrentRoom: ({ roomId, roomName, isHost }) => set({ currentRoomId: roomId, currentRoomName: roomName, isHost }),
  setOpponentName: (opponentName) => set({ opponentName }),
  setActiveRoomConfig: (activeRoomConfig) => set({ activeRoomConfig }),
  setError: (errorMessage) => set({ errorMessage }),
  setPlayerName: (playerName) => set({ playerName }),
  setPendingRoomConfig: (partial) => set({ pendingRoomConfig: { ...get().pendingRoomConfig, ...partial } }),
  resetPendingRoomConfig: () => set({ pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG } }),
  resetRoomState: () => set({
    currentRoomId: null,
    currentRoomName: '',
    isHost: false,
    opponentName: '',
    activeRoomConfig: null,
    connection: 'connected',
    intentionallyLeft: true,
  }),
  setIntentionallyLeft: (intentionallyLeft) => set({ intentionallyLeft }),
}));
