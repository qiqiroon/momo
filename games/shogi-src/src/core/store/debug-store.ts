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

/**
 * v1.26: 「デバッグパネルが開かない」を突き止めるための開閉ログ (ユーザー報告 2026-08-14)。
 *
 * リンクを押しても何も出ない、という報告に対して、**押した／出た／消えた**のどれが
 * 起きたのかを記録する。原因は大きく 3 通りあり、どれかで見分けが付く:
 *   - 押した記録すら無い      → クリックが届いていない
 *   - 出た記録の直後に消えた記録 → 何かが即座に閉じている (背景タップの二度押し等)
 *   - 出た記録だけで消えていない → 出てはいるが、何かの陰に隠れて見えない
 * 最後の 1 つを見分けるため、表示直後にパネルの中心へ**実際に何があるか**を測って
 * `covering` に残す (数値をいじって直そうとしないための実測)。
 */
export interface DebugPanelEvent {
  time: number;
  kind: 'open-requested' | 'shown' | 'closed';
  /** 何が起きたか (押した場所・閉じた理由・覆っていた要素など) */
  detail: string;
}

/**
 * ★v1.62: 「窓の大きさが変わるたびに、盤をいくつにしたか」の記録
 * （2026-08-20 ユーザーご依頼）。
 *
 * 盤が不自然に小さくなったとき、**そのときの数値をそのまま貼って渡せる**ようにするための
 * ものである。推測で語らずに済むよう、**決まり方に効く値だけ**を残す＝窓の内寸・横長か
 * 縦長か・盤以外に置くものの高さ（引いた値）・実際に描かれた盤とマス・はみ出し量。
 */
export interface DebugLayoutEntry {
  time: number;
  vw: number;
  vh: number;
  landscape: boolean;
  /** 盤以外に置くものの高さ。縦長では使わないので null。 */
  fixed: number | null;
  boardPx: number;
  cellPx: number;
  overflowX: number;
  overflowY: number;
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
  /** v1.26: デバッグパネルの開閉ログ (最新が末尾)。 */
  panelEvents: DebugPanelEvent[];
  /** ★v1.62: 窓の大きさが変わるたびの「窓 → 盤」の記録 (最新が末尾)。 */
  layoutLog: DebugLayoutEntry[];
  enable: () => void;
  /** reason を渡すと開閉ログに残る (v1.26)。 */
  setPanelOpen: (open: boolean, reason?: string) => void;
  /** v1.26: 開閉ログに 1 件足す。 */
  logPanelEvent: (kind: DebugPanelEvent['kind'], detail: string) => void;
  toggleShowPieceIds: () => void;
  logClick: (piece: PieceInstance, source: 'board' | 'hand') => void;
  clearLog: () => void;
  /** 1 手で発生した候補変更エントリ群 (複数駒) をまとめて追加。 */
  logCandidateChanges: (entries: DebugCandidateChangeEntry[]) => void;
  clearCandidateChangeLog: () => void;
  /** ★v1.62: 窓 → 盤 を 1 件足す。**同じ窓の大きさが続くときは足さない**（埋もれるため）。 */
  logLayout: (entry: Omit<DebugLayoutEntry, 'time'>) => void;
  clearLayoutLog: () => void;
}

const MAX_LOG = 20;
/** ★v1.62: 窓の大きさは何度も変わるので、少し多めに持つ。 */
const MAX_LAYOUT_LOG = 60;
/** 開閉ログは直近だけ見られればよいので短く持つ (v1.26)。 */
const MAX_PANEL_EVENTS = 12;

export const useDebugStore = create<DebugState>((set) => ({
  enabled: false,
  panelOpen: false,
  showPieceIds: false,
  clickLog: [],
  candidateChangeLog: [],
  panelEvents: [],
  layoutLog: [],
  enable: () => set({ enabled: true }),
  setPanelOpen: (open, reason) => set((s) => ({
    panelOpen: open,
    panelEvents: reason === undefined
      ? s.panelEvents
      : [...s.panelEvents, {
          time: Date.now(),
          kind: open ? 'open-requested' as const : 'closed' as const,
          detail: reason,
        }].slice(-MAX_PANEL_EVENTS),
  })),
  logPanelEvent: (kind, detail) => set((s) => ({
    panelEvents: [...s.panelEvents, { time: Date.now(), kind, detail }].slice(-MAX_PANEL_EVENTS),
  })),
  toggleShowPieceIds: () => set((s) => ({ showPieceIds: !s.showPieceIds })),
  logClick: (piece, source) => set((s) => ({
    clickLog: [...s.clickLog, { time: Date.now(), source, piece }].slice(-MAX_LOG),
  })),
  clearLog: () => set({ clickLog: [] }),
  logCandidateChanges: (entries) => set((s) => ({
    candidateChangeLog: [...s.candidateChangeLog, ...entries].slice(-MAX_LOG),
  })),
  clearCandidateChangeLog: () => set({ candidateChangeLog: [] }),
  logLayout: (entry) => set((s) => {
    const last = s.layoutLog[s.layoutLog.length - 1];
    // **同じ窓の大きさで同じ盤なら足さない**＝引きずっている間の同じ値で埋め尽くさない。
    if (last && last.vw === entry.vw && last.vh === entry.vh && last.boardPx === entry.boardPx) {
      return {};
    }
    return {
      layoutLog: [...s.layoutLog, { time: Date.now(), ...entry }].slice(-MAX_LAYOUT_LOG),
    };
  }),
  clearLayoutLog: () => set({ layoutLog: [] }),
}));
