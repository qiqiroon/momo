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
import { DEFAULT_AI_LEVEL, type AiLevel, type AiMode } from '../ai/types';

/**
 * 持ち時間から予算を割り出すときの上限 (ms)。
 *
 * **段ごとの考慮時間ではない** (それは各思考ルーチンが持つ=親 §7.5.3)。ここは
 * 「時間制限なしの対局でも、これ以上は待たせない」という頭打ちにだけ使う。
 * ★v1.94: 8 秒 → **29 秒**（ユーザー判断 2026-10-01＝Apocalypse の上限）。
 */
export const THINK_BUDGET_CAP_MS = 29_000;

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
  /**
   * 強さの段 (親 §7.5)。**AI 選択とは別の軸**で、どの思考ルーチンにも同じ 3 段階が効く。
   * 段が実際に何を変えるかは各思考ルーチンが決めるので、ここは名前を持つだけ。
   */
  level: AiLevel;
  /** いま考えているか (画面の「考え中」表示用)。 */
  thinking: boolean;
  /** 直前に考えた結果の目安 (デバッグパネル用)。 */
  lastThink: AiThinkInfo | null;

  startVsAi: (opts?: { aiSide?: Player; engineId?: string; level?: AiLevel; mode?: AiMode }) => void;
  /** S03 で AI を選び直したとき。null なら「そのモードの既定に任せる」。 */
  setEngineId: (engineId: string | null) => void;
  /** S03 で強さを選び直したとき。 */
  setLevel: (level: AiLevel) => void;
  stopVsAi: () => void;
  setThinking: (thinking: boolean) => void;
  setLastThink: (info: AiThinkInfo | null) => void;
}

/**
 * ★v1.94: 指で触る端末か (携帯・タブレット)。**画面の幅は見ない**＝PC でウィンドウを
 * 細くしただけで選べる段が変わるのは不自然なため (isSmallScreen とは別にしてある)。
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

/**
 * ★v1.94 (ユーザー判断 2026-10-01): **指で触る端末では Apocalypse を選べない**。
 * 1 手に最大 29 秒考えるので、電池と発熱に配慮する。前に PC で選んだ段が残っていても、
 * 指で触る端末では Hard として扱う＝画面と思考の両方がここを通る。
 */
export function levelAllowed(level: AiLevel, touch: boolean): boolean {
  return !(touch && level === 'Apocalypse');
}

export function effectiveLevel(level: AiLevel, touch: boolean): AiLevel {
  return levelAllowed(level, touch) ? level : 'Hard';
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
  level: DEFAULT_AI_LEVEL,
  thinking: false,
  lastThink: null,

  startVsAi: (opts) =>
    set((s) => ({
      enabled: true,
      aiSide: opts?.aiSide ?? 'player2',
      // 親 §7.1.1: 既定はモードごとに決まる。指定が無ければそのモードの最上位。
      engineId: opts?.engineId ?? resolveEngineId(null, opts?.mode ?? 'shogi'),
      // 段は画面で選んだものをそのまま持ち越す (指定が無ければ今の値)。
      level: opts?.level ?? s.level,
      thinking: false,
      lastThink: null,
    })),

  stopVsAi: () => set({ enabled: false, thinking: false }),
  setEngineId: (engineId) => set({ engineId }),
  setLevel: (level) => set({ level }),
  setThinking: (thinking) => set({ thinking }),
  setLastThink: (lastThink) => set({ lastThink }),
}));
