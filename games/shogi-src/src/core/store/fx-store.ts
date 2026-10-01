/**
 * ★v1.96 画面の演出の状態 (いま威嚇の動きを見せているか)。
 *
 * 対局の状態 (game-store) には入れない＝盤や手番とは関係のない、**見せ方だけ**の話なので。
 * AI はこれを見て、威嚇の動きが終わるまで考え始めない (すぐ指し返すと、吹き飛んだ駒が
 * 戻る前に盤が変わり、演出が途中で打ち切られて見えないため)。
 */
import { create } from 'zustand';

interface FxState {
  /** 威嚇の動き (taunt-fx.ts) を見せている最中か。 */
  tauntPlaying: boolean;
  setTauntPlaying: (playing: boolean) => void;
}

export const useFxStore = create<FxState>((set) => ({
  tauntPlaying: false,
  setTauntPlaying: (tauntPlaying) => set({ tauntPlaying }),
}));
