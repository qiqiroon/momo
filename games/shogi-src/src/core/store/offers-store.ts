import { create } from 'zustand';

/**
 * 引分 / 待った の申し出・応答状態（段階 2-7 v0.33 追加）。
 *
 * オンライン対戦で「申し出→相手の承諾/拒否→反映」の合意フロー用。
 * - drawOfferFrom / undoOfferFrom : 'me' = 自分が申し出中、'opp' = 相手が申し出中、null = なし
 * - lastResponse* : 直前の応答（拒否のトースト表示に使う）
 *
 * 対局のたびに clearAll() でリセット（game_start / returnToPreparation / reset）。
 */

export type OfferKind = 'draw' | 'undo' | 'pause' | 'resume';

interface OffersState {
  drawOfferFrom: 'me' | 'opp' | null;
  undoOfferFrom: 'me' | 'opp' | null;
  /** 中断の申し出（v0.41） */
  pauseOfferFrom: 'me' | 'opp' | null;
  /** 再開の申し出（v0.41） */
  resumeOfferFrom: 'me' | 'opp' | null;
  lastResponseKind: OfferKind | null;
  lastResponseAccepted: boolean | null;

  setDrawOfferFrom: (from: 'me' | 'opp' | null) => void;
  setUndoOfferFrom: (from: 'me' | 'opp' | null) => void;
  setPauseOfferFrom: (from: 'me' | 'opp' | null) => void;
  setResumeOfferFrom: (from: 'me' | 'opp' | null) => void;
  setLastResponse: (kind: OfferKind | null, accepted: boolean | null) => void;
  clearAll: () => void;
}

export const useOffersStore = create<OffersState>((set) => ({
  drawOfferFrom: null,
  undoOfferFrom: null,
  pauseOfferFrom: null,
  resumeOfferFrom: null,
  lastResponseKind: null,
  lastResponseAccepted: null,

  setDrawOfferFrom: (drawOfferFrom) => set({ drawOfferFrom }),
  setUndoOfferFrom: (undoOfferFrom) => set({ undoOfferFrom }),
  setPauseOfferFrom: (pauseOfferFrom) => set({ pauseOfferFrom }),
  setResumeOfferFrom: (resumeOfferFrom) => set({ resumeOfferFrom }),
  setLastResponse: (lastResponseKind, lastResponseAccepted) =>
    set({ lastResponseKind, lastResponseAccepted }),
  clearAll: () =>
    set({
      drawOfferFrom: null,
      undoOfferFrom: null,
      pauseOfferFrom: null,
      resumeOfferFrom: null,
      lastResponseKind: null,
      lastResponseAccepted: null,
    }),
}));
