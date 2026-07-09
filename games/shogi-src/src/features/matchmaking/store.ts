import { create } from 'zustand';
import type { MomoRoomInfo } from './client';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'in_room' | 'game_connected';

export type SideSelection = 'host_sente' | 'host_gote' | 'random';
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
  sideSelection: SideSelection;
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
  sideSelection: 'host_sente',
  timeControl: DEFAULT_TIME_CONTROL,
};

interface MatchmakingState {
  connection: ConnectionStatus;
  rooms: MomoRoomInfo[];
  currentRoomId: string | null;
  currentRoomName: string;
  isHost: boolean;
  errorMessage: string | null;
  playerName: string;
  pendingRoomConfig: RoomConfig;

  setConnection: (c: ConnectionStatus) => void;
  setRooms: (rooms: MomoRoomInfo[]) => void;
  setCurrentRoom: (info: { roomId: string | null; roomName: string; isHost: boolean }) => void;
  setError: (msg: string | null) => void;
  setPlayerName: (name: string) => void;
  setPendingRoomConfig: (config: Partial<RoomConfig>) => void;
  resetPendingRoomConfig: () => void;
}

export const useMatchmakingStore = create<MatchmakingState>((set, get) => ({
  connection: 'disconnected',
  rooms: [],
  currentRoomId: null,
  currentRoomName: '',
  isHost: false,
  errorMessage: null,
  playerName: '',
  pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG },

  setConnection: (c) => set({ connection: c }),
  setRooms: (rooms) => set({ rooms }),
  setCurrentRoom: ({ roomId, roomName, isHost }) => set({ currentRoomId: roomId, currentRoomName: roomName, isHost }),
  setError: (errorMessage) => set({ errorMessage }),
  setPlayerName: (playerName) => set({ playerName }),
  setPendingRoomConfig: (partial) => set({ pendingRoomConfig: { ...get().pendingRoomConfig, ...partial } }),
  resetPendingRoomConfig: () => set({ pendingRoomConfig: { ...DEFAULT_ROOM_CONFIG } }),
}));
