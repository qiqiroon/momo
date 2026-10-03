import { create } from 'zustand';

/**
 * ★v1.99 ルールブックの窓 (画面機能 v0.59 §4.1 M08) の開け閉め。
 *
 * 窓は S01「遊び方」・S02 の量子の欄・S06 のヘッダの 3 か所から開くので、**開いているかどうかは
 * 画面の外 (ここ) に 1 つだけ持つ**＝画面ごとに持つと、画面を移ったときに片方だけ残る。
 *
 * 窓の中身は features/rulebook が持つ (A ビルドには窓ごと無い＝`overlay:rulebook` が未登録)。
 * ここには量子の言葉を書かない (A ビルドにも入るため)。
 */
export type RulebookView = 'list' | 'doc';

export interface RulebookOpen {
  view: RulebookView;
  /** 一覧から入ったか (本文の左上に「‹ 一覧」を出すか)。「遊び方」から開いたときだけ true。 */
  fromList: boolean;
}

interface RulebookState {
  open: RulebookOpen | null;
  /** 「遊び方」から開く＝一覧から。 */
  openList: () => void;
  /** S02・S06 から開く＝本文から (一覧は通らない)。 */
  openDoc: () => void;
  /** 一覧で 1 冊を選んだ。 */
  showDoc: () => void;
  /** 本文から「‹ 一覧」で戻った。 */
  showList: () => void;
  close: () => void;
}

export const useRulebookStore = create<RulebookState>((set) => ({
  open: null,
  openList: () => set({ open: { view: 'list', fromList: true } }),
  openDoc: () => set({ open: { view: 'doc', fromList: false } }),
  showDoc: () => set((s) => ({ open: s.open ? { ...s.open, view: 'doc' } : { view: 'doc', fromList: false } })),
  showList: () => set({ open: { view: 'list', fromList: true } }),
  close: () => set({ open: null }),
}));
