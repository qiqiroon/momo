import { create } from 'zustand';

export type Screen = 'game' | 'lobby' | 'net-lobby' | 'rule-select' | 'room' | 'endgame' | 'offline-rule' | 'ai-setup';

interface RouteState {
  screen: Screen;
  /**
   * v0.69: S02 (rule-select) から戻るときの遷移先。
   * 'net-lobby' (S04 経由) / 'offline-rule' (オフライン対人) /
   * 'ai-setup' (対AI設定 S03・Phase 3-2)。
   */
  ruleSelectReturn: 'net-lobby' | 'offline-rule' | 'ai-setup';
  setScreen: (screen: Screen) => void;
  setRuleSelectReturn: (dest: 'net-lobby' | 'offline-rule' | 'ai-setup') => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  screen: 'game',
  ruleSelectReturn: 'net-lobby',
  setScreen: (screen) => set({ screen }),
  setRuleSelectReturn: (ruleSelectReturn) => set({ ruleSelectReturn }),
}));
