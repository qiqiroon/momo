import { create } from 'zustand';
import type { MomoRoomInfo } from './client';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'in_room' | 'game_connected';

interface MatchmakingState {
  connection: ConnectionStatus;
  rooms: MomoRoomInfo[];
  currentRoomId: string | null;
  currentRoomName: string;
  isHost: boolean;
  errorMessage: string | null;
  playerName: string;

  setConnection: (c: ConnectionStatus) => void;
  setRooms: (rooms: MomoRoomInfo[]) => void;
  setCurrentRoom: (info: { roomId: string | null; roomName: string; isHost: boolean }) => void;
  setError: (msg: string | null) => void;
  setPlayerName: (name: string) => void;
}

export const useMatchmakingStore = create<MatchmakingState>((set) => ({
  connection: 'disconnected',
  rooms: [],
  currentRoomId: null,
  currentRoomName: '',
  isHost: false,
  errorMessage: null,
  playerName: '',

  setConnection: (c) => set({ connection: c }),
  setRooms: (rooms) => set({ rooms }),
  setCurrentRoom: ({ roomId, roomName, isHost }) => set({ currentRoomId: roomId, currentRoomName: roomName, isHost }),
  setError: (errorMessage) => set({ errorMessage }),
  setPlayerName: (playerName) => set({ playerName }),
}));
