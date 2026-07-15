import { create } from 'zustand';

export type Screen = 'game' | 'lobby' | 'net-lobby' | 'rule-select' | 'room' | 'endgame' | 'offline-rule';

interface RouteState {
  screen: Screen;
  /** v0.69: S02 (rule-select) から戻るときの遷移先。'net-lobby' (S04 経由) か 'offline-rule' (S01 経由) */
  ruleSelectReturn: 'net-lobby' | 'offline-rule';
  setScreen: (screen: Screen) => void;
  setRuleSelectReturn: (dest: 'net-lobby' | 'offline-rule') => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  screen: 'game',
  ruleSelectReturn: 'net-lobby',
  setScreen: (screen) => set({ screen }),
  setRuleSelectReturn: (ruleSelectReturn) => set({ ruleSelectReturn }),
}));
