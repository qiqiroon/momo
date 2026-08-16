/**
 * 棋譜再生画面 (S08) をどこから開いたか（付録D-8 §3・画面機能 §3 S08「遷移」）。
 *
 * 戻るボタンの行き先と見出しがこれで変わる。
 * - `lobby` … トップメニューから開いた → 「トップへ」
 * - `game` … 終局パネルから開いた → 「結果へ」（対局画面へ戻ると結果が出ている）
 *
 * 画面の状態ではなく**入り口の記録**なので、画面の持ち物にせず、開く側が置いていく。
 */

let origin: 'lobby' | 'game' = 'lobby';

export function setReplayOrigin(from: 'lobby' | 'game'): void {
  origin = from;
}

export function replayOrigin(): 'lobby' | 'game' {
  return origin;
}
