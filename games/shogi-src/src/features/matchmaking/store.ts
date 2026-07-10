import { create } from 'zustand';
import type { MomoRoomInfo } from './client';

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
  roomName: string;
  password: string;
  isPublic: boolean;
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
  }),
}));
