import { create } from 'zustand';
import { requestNewGame } from './kifu-guard';

export type Screen = 'game' | 'lobby' | 'net-lobby' | 'rule-select' | 'room' | 'endgame' | 'offline-rule' | 'ai-setup' | 'kifu-replay' | 'review';

/**
 * **そこから先へ進むと必ず盤が作り直される設定画面**（親 v1.36 §9.2.3 ②）。
 * ここへ入るときは、未保存の棋譜があれば「保存する／破棄する」を尋ねる。
 *
 * **画面 ID の列挙ではなく上の事実で選ぶこと**。v1.35 は S02／S03／S05 の 3 つを
 * 並べていたため、**画面一覧に載っていない `offline-rule`（オフライン対人の設定）が
 * 漏れ**、そこから始める対局では一度も尋ねずに棋譜が消えていた。
 * 画面を足すときは「その画面から対局が始まるか」で判断する。
 *
 * **棋譜再生 (S08) は入れない**＝再生は盤を作り直すが**新しい対局ではない**ので
 * 破棄の契機に当たらない（親 §9.2.3 ②・画面機能 §3 S08）。受け皿を見に行っただけで
 * 当の受け皿が消えては本末転倒になる。
 *
 * **感想戦 (S11) も入れない**（親 §9.4.3）＝盤は作り直すが対局ではない。
 * 記憶にも触らないので、破棄する理由がそもそも無い。
 */
const NEW_GAME_SETUP_SCREENS: readonly Screen[] = ['rule-select', 'ai-setup', 'room', 'offline-rule'];

interface RouteState {
  screen: Screen;
  /**
   * v0.69: S02 (rule-select) から戻るときの遷移先。
   * 'net-lobby' (S04 経由) / 'offline-rule' (オフライン対人) /
   * 'ai-setup' (対AI設定 S03・Phase 3-2)。
   */
  ruleSelectReturn: 'net-lobby' | 'offline-rule' | 'ai-setup';
  /**
   * 画面を移る。設定画面へ入るときは棋譜の確認をはさむ（親 §9.2.3 ②）。
   *
   * `skipKifuGuard` は**割り込んではいけない経路のための逃げ道**＝ネット対戦で
   * **相手の操作により盤が作り直される**経路。こちらが確認で止めると相手を待たせる。
   * 使ってよいのはその場合だけで、**既定は必ず確認を通す側**にしてある。
   */
  setScreen: (screen: Screen, opts?: { skipKifuGuard?: boolean }) => void;
  setRuleSelectReturn: (dest: 'net-lobby' | 'offline-rule' | 'ai-setup') => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  screen: 'game',
  ruleSelectReturn: 'net-lobby',
  setScreen: (screen, opts) => {
    if (!opts?.skipKifuGuard && NEW_GAME_SETUP_SCREENS.includes(screen)) {
      requestNewGame(() => set({ screen }));
      return;
    }
    set({ screen });
  },
  setRuleSelectReturn: (ruleSelectReturn) => set({ ruleSelectReturn }),
}));
