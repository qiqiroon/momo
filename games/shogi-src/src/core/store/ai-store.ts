/**
 * 対 AI 対局の設定 (Phase 3)。
 *
 * 「相手が AI かどうか」「AI がどちらを持つか」「どれくらい考えさせるか」を持つ。
 * 対局そのものの状態 (盤・時計) は game-store 側なので、ここには置かない。
 *
 * Phase 3-1 では入口が 1 つ (トップの AI 対戦 → 人が先手・AI が後手) しかないので、
 * 先後や強さを選ぶ画面 (S03) はまだ無い。値の置き場だけ先に用意しておき、
 * S03 を作るときにそこから書き換える。
 */

import { create } from 'zustand';
import type { Player } from '../engine/mgf/types';
import { defaultEngine } from '../ai/engine-registry';

/** 考える時間の既定 (ms)。スマホは電池と発熱に配慮して短くする (親 §7.4)。 */
export const DEFAULT_THINK_MS = 2000;
export const MOBILE_THINK_MS = 1200;
/** 読む深さの上限。実際は時間で先に打ち切られるので、暴走止めの意味合い。 */
export const DEFAULT_MAX_DEPTH = 6;

export interface AiThinkInfo {
  depth: number;
  nodes: number;
  elapsedMs: number;
}

interface AiState {
  /** 対 AI 対局か。オフライン対局にだけ効く (オンラインでは常に無効)。 */
  enabled: boolean;
  /** AI が持つ側。 */
  aiSide: Player;
  /** 使う思考ルーチン。null なら既定 (重み最大) を使う。 */
  engineId: string | null;
  thinkMs: number;
  maxDepth: number;
  /** いま考えているか (画面の「考え中」表示用)。 */
  thinking: boolean;
  /** 直前に考えた結果の目安 (デバッグパネル用)。 */
  lastThink: AiThinkInfo | null;

  startVsAi: (opts?: { aiSide?: Player; engineId?: string; thinkMs?: number }) => void;
  stopVsAi: () => void;
  setThinking: (thinking: boolean) => void;
  setLastThink: (info: AiThinkInfo | null) => void;
}

/** スマホかどうかの当たり (指で触る画面幅)。 */
export function isSmallScreen(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true || window.innerWidth < 700;
}

export const useAiStore = create<AiState>((set) => ({
  enabled: false,
  aiSide: 'player2',
  engineId: null,
  thinkMs: DEFAULT_THINK_MS,
  maxDepth: DEFAULT_MAX_DEPTH,
  thinking: false,
  lastThink: null,

  startVsAi: (opts) =>
    set({
      enabled: true,
      aiSide: opts?.aiSide ?? 'player2',
      engineId: opts?.engineId ?? defaultEngine()?.id ?? null,
      thinkMs: opts?.thinkMs ?? (isSmallScreen() ? MOBILE_THINK_MS : DEFAULT_THINK_MS),
      thinking: false,
      lastThink: null,
    }),

  stopVsAi: () => set({ enabled: false, thinking: false }),
  setThinking: (thinking) => set({ thinking }),
  setLastThink: (lastThink) => set({ lastThink }),
}));
