import { create } from 'zustand';
import type { PieceInstance } from '../engine/position/types';

/**
 * デバッグモード (v0.91 追加, Phase 5 補助)。
 *
 * URL クエリ `?debug=1` を検知して enable() することで有効化される (main-b.tsx)。
 * A ビルドはこの store 自体を import しないため tree-shake で除外される。
 *
 * 目的: Phase 5 (量子モード) の候補集合や制約適用の内部状態を可視化するため、
 * 盤面マス上に PieceID + candidates.size を出したり、駒クリック時に
 * PieceInstance を垂れ流し表示したりする。
 *
 * 将来の機能拡張余地あり (制約適用ログ表示など)。
 */

export interface DebugClickEntry {
  time: number;
  source: 'board' | 'hand';
  piece: PieceInstance;
}

interface DebugState {
  /** URL に ?debug=1 が付いていたか。付いていなければ全機能非表示 (歯車内リンクも出ない)。 */
  enabled: boolean;
  /** デバッグパネル自体の開閉状態。 */
  panelOpen: boolean;
  /** 盤マスの左上に PieceID + [candidates.size] を出すか。 */
  showPieceIds: boolean;
  /** 直近 MAX_LOG 件の駒クリック履歴 (新しい方が末尾)。 */
  clickLog: DebugClickEntry[];
  enable: () => void;
  setPanelOpen: (open: boolean) => void;
  toggleShowPieceIds: () => void;
  logClick: (piece: PieceInstance, source: 'board' | 'hand') => void;
  clearLog: () => void;
}

const MAX_LOG = 20;

export const useDebugStore = create<DebugState>((set) => ({
  enabled: false,
  panelOpen: false,
  showPieceIds: false,
  clickLog: [],
  enable: () => set({ enabled: true }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  toggleShowPieceIds: () => set((s) => ({ showPieceIds: !s.showPieceIds })),
  logClick: (piece, source) => set((s) => ({
    clickLog: [...s.clickLog, { time: Date.now(), source, piece }].slice(-MAX_LOG),
  })),
  clearLog: () => set({ clickLog: [] }),
}));
