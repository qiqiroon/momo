import { create } from 'zustand';

export type Screen = 'game' | 'lobby' | 'rule-select' | 'waiting' | 'endgame';

interface RouteState {
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  screen: 'game',
  setScreen: (screen) => set({ screen }),
}));
