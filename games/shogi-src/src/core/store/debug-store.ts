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

/**
 * v0.99: 1 手ごとの「候補集合が変化した駒 1 個ぶん」のログエントリ。
 * 実際の反映は「1 手で複数駒が同時に変化」→ 複数エントリを連続して push する形。
 */
export interface DebugCandidateChangeEntry {
  time: number;
  /** 変化を引き起こした着手の手数 (position.moveNumber を素直に採用)。 */
  moveNumber: number;
  pieceId: string;
  /** 変化前の candidates (sort 済み)。 */
  before: string[];
  /** 変化後の candidates (sort 済み)。 */
  after: string[];
  /** before から消えた駒種 (sort 済み)。 */
  removed: string[];
  /** after に足された駒種 (sort 済み)。C-002 単調非増加なら通常空。 */
  added: string[];
}

interface DebugState {
  /** URL に ?debug=1 が付いていたか。付いていなければ全機能非表示 (歯車内リンクも棋譜下 DebugClickLog も出ない)。 */
  enabled: boolean;
  /** フローティング DebugPanel (PieceID スイッチ等の切替 UI) の開閉状態。棋譜下の DebugClickLog は常時表示なので関係しない。 */
  panelOpen: boolean;
  /** 盤マスの左上に PieceID + [candidates.size] を出すか。 */
  showPieceIds: boolean;
  /** 直近 MAX_LOG 件の駒クリック履歴 (新しい方が末尾)。 */
  clickLog: DebugClickEntry[];
  /** 直近 MAX_LOG 件の候補集合変更履歴 (新しい方が末尾)。v0.99 追加。 */
  candidateChangeLog: DebugCandidateChangeEntry[];
  enable: () => void;
  setPanelOpen: (open: boolean) => void;
  toggleShowPieceIds: () => void;
  logClick: (piece: PieceInstance, source: 'board' | 'hand') => void;
  clearLog: () => void;
  /** 1 手で発生した候補変更エントリ群 (複数駒) をまとめて追加。 */
  logCandidateChanges: (entries: DebugCandidateChangeEntry[]) => void;
  clearCandidateChangeLog: () => void;
}

const MAX_LOG = 20;

export const useDebugStore = create<DebugState>((set) => ({
  enabled: false,
  panelOpen: false,
  showPieceIds: false,
  clickLog: [],
  candidateChangeLog: [],
  enable: () => set({ enabled: true }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  toggleShowPieceIds: () => set((s) => ({ showPieceIds: !s.showPieceIds })),
  logClick: (piece, source) => set((s) => ({
    clickLog: [...s.clickLog, { time: Date.now(), source, piece }].slice(-MAX_LOG),
  })),
  clearLog: () => set({ clickLog: [] }),
  logCandidateChanges: (entries) => set((s) => ({
    candidateChangeLog: [...s.candidateChangeLog, ...entries].slice(-MAX_LOG),
  })),
  clearCandidateChangeLog: () => set({ candidateChangeLog: [] }),
}));
