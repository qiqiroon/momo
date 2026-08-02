// ── UI 専用ステート（盤面データ以外の一時状態）
import { create } from 'zustand';
import type { RelationFamily } from '../types';

export type ModalKind = null | 'cardRequest' | 'import' | 'handoff';

interface UIState {
  /** 次に引く関係線に付けるラベル（関係パレットで選択中） */
  pendingRelLabel: string;
  pendingRelFamily?: RelationFamily;
  setPendingRel: (label: string, family?: RelationFamily) => void;

  modal: ModalKind;
  openModal: (m: ModalKind) => void;
  closeModal: () => void;
}

export const useUI = create<UIState>((set) => ({
  pendingRelLabel: 'だから(順接)',
  pendingRelFamily: 'つづく',
  setPendingRel: (label, family) => set({ pendingRelLabel: label, pendingRelFamily: family }),

  modal: null,
  openModal: (m) => set({ modal: m }),
  closeModal: () => set({ modal: null }),
}));
