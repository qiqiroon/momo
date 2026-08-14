/**
 * 対 AI 対局の設定 (Phase 3)。
 *
 * 「相手が AI かどうか」「AI がどちらを持つか」「どれくらい考えさせるか」を持つ。
 * 対局そのものの状態 (盤・時計) は game-store 側なので、ここには置かない。
 *
 * Phase 3-2 で対AI設定画面 (S03) を作り、先後と AI をそこから書き込むようにした。
 * どの AI を既定にするかは**モードごと**に決まる (親 §7.1.1)。
 */

import { create } from 'zustand';
import type { Player } from '../engine/mgf/types';
import { resolveEngineId } from '../ai/engine-registry';
import type { AiMode } from '../ai/types';

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

  startVsAi: (opts?: { aiSide?: Player; engineId?: string; thinkMs?: number; mode?: AiMode }) => void;
  /** S03 で AI を選び直したとき。null なら「そのモードの既定に任せる」。 */
  setEngineId: (engineId: string | null) => void;
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
      // 親 §7.1.1: 既定はモードごとに決まる。指定が無ければそのモードの最上位。
      engineId: opts?.engineId ?? resolveEngineId(null, opts?.mode ?? 'shogi'),
      thinkMs: opts?.thinkMs ?? (isSmallScreen() ? MOBILE_THINK_MS : DEFAULT_THINK_MS),
      thinking: false,
      lastThink: null,
    }),

  stopVsAi: () => set({ enabled: false, thinking: false }),
  setEngineId: (engineId) => set({ engineId }),
  setThinking: (thinking) => set({ thinking }),
  setLastThink: (lastThink) => set({ lastThink }),
}));
