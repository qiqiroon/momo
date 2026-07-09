import { create } from 'zustand';

export type Screen = 'game' | 'lobby' | 'waiting' | 'endgame';

interface RouteState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  screen: 'game',
  setScreen: (screen) => set({ screen }),
}));
