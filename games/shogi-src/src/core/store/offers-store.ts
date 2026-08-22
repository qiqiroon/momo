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

/**
 * 持将棋の提案に答えられる時間（親 v1.62 §4.4.1.3・**10 秒**）。
 * **答える側の締め切りであり、提案した側の待ち時間もこれで決まる。**
 */
export const JISHOGI_ANSWER_MS = 10_000;

/**
 * 提案した側が「返事が来ない」と見切るまでの時間（v1.84）。
 *
 * **答える側は 10 秒で必ず答えを送る**が、**その伝言が届かないことはある**（回線・離脱）。
 * 見切らないと**提案した側は永久に待ち、盤も時計も止まったままになる**。
 * **答える側の締め切りより長くする**＝先に切ると、届いた答えを捨ててしまう。
 */
export const JISHOGI_WAIT_TIMEOUT_MS = 15_000;

export type OfferKind = 'draw' | 'undo' | 'pause' | 'resume' | 'jishogi';
export type OfferNoticeType = 'rejected' | 'cancelled';

interface UndoOfferMeta {
  count: number;
  challengerSide: 'player1' | 'player2';
}

interface OffersState {
  /**
   * v1.47: 感想戦の打診（親 §9.4.1・付録D-12 §7）。'me'＝返事待ち／'opp'＝答える番。
   *
   * **他の申し出と違い、断られても申し出た側は先へ進む**（ひとりで感想戦に入る）
   * ＝同意が要るのは「相手を巻き込むこと」だけで、振り返り自体には要らないため。
   */
  reviewOfferFrom: 'me' | 'opp' | null;
  drawOfferFrom: 'me' | 'opp' | null;
  /**
   * v1.84: 持将棋の提案 (親 v1.62 §4.4.1.3)。'me'＝返事待ち／'opp'＝答える番。
   *
   * **引分の申し出と別に持つ**＝**持将棋での引き分けと理由のない引き分けは別の終局**
   * であり、同じ枠を使い回すと**どちらに答えたのかが受け取った側で分からなくなる**。
   */
  jishogiOfferFrom: 'me' | 'opp' | null;
  /**
   * 相手が答えるまでの締め切り (ミリ秒・`Date.now()` 基準)。**答える側だけが持つ。**
   * **10 秒経ったら合意不成立**とする (親 §4.4.1.3)。
   */
  jishogiDeadline: number | null;
  /**
   * v1.84: **観戦者に見せるためだけの印**（親 v1.62 §4.4.1.3）。
   * **観戦者に選ばせるものは無い**ので諾否の状態は持たせず、これだけを立てる
   * （盤が止まるので、何も出さないと固まったように見える）。
   */
  jishogiSpectatorNotice: boolean;
  undoOfferFrom: 'me' | 'opp' | null;
  undoOfferMeta: UndoOfferMeta | null;
  resumeOfferFrom: 'me' | 'opp' | null;
  lastNoticeKind: OfferKind | null;
  lastNoticeType: OfferNoticeType | null;

  setReviewOfferFrom: (from: 'me' | 'opp' | null) => void;
  setDrawOfferFrom: (from: 'me' | 'opp' | null) => void;
  setJishogiOfferFrom: (from: 'me' | 'opp' | null, deadline?: number | null) => void;
  setJishogiSpectatorNotice: (on: boolean) => void;
  setUndoOfferFrom: (from: 'me' | 'opp' | null, meta?: UndoOfferMeta | null) => void;
  setResumeOfferFrom: (from: 'me' | 'opp' | null) => void;
  setNotice: (kind: OfferKind | null, type: OfferNoticeType | null) => void;
  clearAll: () => void;
}

export const useOffersStore = create<OffersState>((set) => ({
  reviewOfferFrom: null,
  drawOfferFrom: null,
  jishogiOfferFrom: null,
  jishogiDeadline: null,
  jishogiSpectatorNotice: false,
  undoOfferFrom: null,
  undoOfferMeta: null,
  resumeOfferFrom: null,
  lastNoticeKind: null,
  lastNoticeType: null,

  setReviewOfferFrom: (reviewOfferFrom) => set({ reviewOfferFrom }),
  setDrawOfferFrom: (drawOfferFrom) => set({ drawOfferFrom }),
  setJishogiOfferFrom: (jishogiOfferFrom, deadline) =>
    set({ jishogiOfferFrom, jishogiDeadline: jishogiOfferFrom ? deadline ?? null : null }),
  setJishogiSpectatorNotice: (jishogiSpectatorNotice) => set({ jishogiSpectatorNotice }),
  setUndoOfferFrom: (undoOfferFrom, meta) =>
    set({
      undoOfferFrom,
      undoOfferMeta: undoOfferFrom ? meta ?? null : null,
    }),
  setResumeOfferFrom: (resumeOfferFrom) => set({ resumeOfferFrom }),
  setNotice: (lastNoticeKind, lastNoticeType) => set({ lastNoticeKind, lastNoticeType }),
  clearAll: () =>
    set({
      reviewOfferFrom: null,
      drawOfferFrom: null,
      jishogiOfferFrom: null,
      jishogiDeadline: null,
      jishogiSpectatorNotice: false,
      undoOfferFrom: null,
      undoOfferMeta: null,
      resumeOfferFrom: null,
      lastNoticeKind: null,
      lastNoticeType: null,
    }),
}));
