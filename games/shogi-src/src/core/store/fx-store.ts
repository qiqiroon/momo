/**
 * ★v1.96 画面の演出の状態 (いま威嚇の動きを見せているか)。
 *
 * 対局の状態 (game-store) には入れない＝盤や手番とは関係のない、**見せ方だけ**の話なので。
 * AI はこれを見て、威嚇の動きが終わるまで考え始めない (すぐ指し返すと、吹き飛んだ駒が
 * 戻る前に盤が変わり、演出が途中で打ち切られて見えないため)。
 */
import { create } from 'zustand';
import { useGameStore } from './game-store';

interface FxState {
  /** 威嚇の動き (taunt-fx.ts) を見せている最中か。 */
  tauntPlaying: boolean;
  setTauntPlaying: (playing: boolean) => void;
  /**
   * ★v1.97: 威嚇の動きを**見せ終えた** (または見せられなかった・打ち切った) 手の通し番号
   * (`lastAppliedMove.seq`)。勝敗の窓と勝敗の音は、最後の手が威嚇つきなら、この番号が
   * その手に追いつくまで待つ (ユーザー指摘 2026-10-01＝勝敗の窓が先に出て、その裏で
   * 威嚇の動きをしていた)。
   */
  tauntDoneSeq: number | null;
  setTauntDoneSeq: (seq: number) => void;
}

export const useFxStore = create<FxState>((set) => ({
  tauntPlaying: false,
  setTauntPlaying: (tauntPlaying) => set({ tauntPlaying }),
  tauntDoneSeq: null,
  setTauntDoneSeq: (tauntDoneSeq) => set({ tauntDoneSeq }),
}));

/**
 * ★v1.97: いま**最後の手の威嚇の動きを待っている**か。
 *
 * 「動いている最中か」(tauntPlaying) では足りない＝手が盤に載った瞬間の描画では、動きは
 * まだ始まっていない (始めるのは描画のあと)。そこで「最後の手が威嚇つきで、まだ見せ終えて
 * いない」を手の通し番号で見る。**同じ描画の中で決まる**ので、勝敗の窓が一瞬だけ出ることも無い。
 */
export function useTauntHolding(): boolean {
  const last = useGameStore((s) => s.lastAppliedMove);
  const done = useFxStore((s) => s.tauntDoneSeq);
  return !!last?.taunt && done !== last.seq;
}
