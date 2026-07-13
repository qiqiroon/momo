import { create } from 'zustand';

/**
 * 引分 / 待った / 一時中断・再開 の申し出・応答状態。
 * 段階 2-7 v0.33 追加、v0.42 で「中断は合意不要」「撤回対応」に改装。
 *
 * オンライン対戦で「申し出→相手の承諾/拒否/撤回→反映」の合意フロー用。
 * - drawOfferFrom / undoOfferFrom / resumeOfferFrom :
 *     'me' = 自分が申し出中、'opp' = 相手が申し出中、null = なし。
 * - 中断（pause）は v0.42 で合意不要になり、pauseOfferFrom は廃止。
 * - undoOfferMeta : 待った申し出中に「巻き戻し手数」「申し出者 side」を保持。
 * - lastNoticeKind / lastNoticeType : 直前の通知（拒否・撤回など）をトースト表示するため。
 *
 * 対局のたびに clearAll() でリセット（game_start / returnToPreparation / reset）。
 */

export type OfferKind = 'draw' | 'undo' | 'pause' | 'resume';
export type OfferNoticeType = 'rejected' | 'cancelled';

interface UndoOfferMeta {
  count: number;
  challengerSide: 'player1' | 'player2';
}

interface OffersState {
  drawOfferFrom: 'me' | 'opp' | null;
  undoOfferFrom: 'me' | 'opp' | null;
  undoOfferMeta: UndoOfferMeta | null;
  resumeOfferFrom: 'me' | 'opp' | null;
  lastNoticeKind: OfferKind | null;
  lastNoticeType: OfferNoticeType | null;

  setDrawOfferFrom: (from: 'me' | 'opp' | null) => void;
  setUndoOfferFrom: (from: 'me' | 'opp' | null, meta?: UndoOfferMeta | null) => void;
  setResumeOfferFrom: (from: 'me' | 'opp' | null) => void;
  setNotice: (kind: OfferKind | null, type: OfferNoticeType | null) => void;
  clearAll: () => void;
}

export const useOffersStore = create<OffersState>((set) => ({
  drawOfferFrom: null,
  undoOfferFrom: null,
  undoOfferMeta: null,
  resumeOfferFrom: null,
  lastNoticeKind: null,
  lastNoticeType: null,

  setDrawOfferFrom: (drawOfferFrom) => set({ drawOfferFrom }),
  setUndoOfferFrom: (undoOfferFrom, meta) =>
    set({
      undoOfferFrom,
      undoOfferMeta: undoOfferFrom ? meta ?? null : null,
    }),
  setResumeOfferFrom: (resumeOfferFrom) => set({ resumeOfferFrom }),
  setNotice: (lastNoticeKind, lastNoticeType) => set({ lastNoticeKind, lastNoticeType }),
  clearAll: () =>
    set({
      drawOfferFrom: null,
      undoOfferFrom: null,
      undoOfferMeta: null,
      resumeOfferFrom: null,
      lastNoticeKind: null,
      lastNoticeType: null,
    }),
}));
