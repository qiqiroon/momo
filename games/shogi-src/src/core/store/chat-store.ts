import { create } from 'zustand';

/**
 * 対局中のチャット履歴を持つ store（段階 2-7 v0.28）。
 *
 * 履歴は共有前提で、自分の発言も相手の発言も同じ side（player1=先手 / player2=後手）
 * で記録する。両プレイヤーの端末で同じ順序・同じ side 属性で描画される。
 *
 * ★v1.55（親 §6.8.5）: **観戦者の発言も同じ 1 本の流れに入る**。
 * ただし観戦者は席を持たないので **side では表せない**（v1.54 までは席を持つ側として
 * 名乗っており、実機で**観戦者の発言が「後手」と出ていた**＝2026-08-21 ご報告）。
 * **席のある人の発言と、席の無い人の発言を、別の形として持つ。**
 */

/** 席のある人（対局者）の発言。 */
export interface PlayerChatMessage {
  kind: 'player';
  side: 'player1' | 'player2';
  text: string;
}

/**
 * 席の無い人（観戦者）の発言。
 *
 * **名前を持つ**＝観戦者は先手／後手で呼べず、`seatNames` にも載らないため。
 * **立場（観戦者であること）は発言に書き込まれていない**＝受け取った側が
 * **送り主を名簿に照らして**この形に振り分ける（§6.8.5）。
 */
export interface SpectatorChatMessage {
  kind: 'spectator';
  name: string;
  text: string;
}

export type ChatMessage = PlayerChatMessage | SpectatorChatMessage;

interface ChatState {
  messages: ChatMessage[];
  addMessage: (side: 'player1' | 'player2', text: string) => void;
  /** ★v1.55: 観戦者の発言を足す（名前つき）。 */
  addSpectatorMessage: (name: string, text: string) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (side, text) =>
    set((s) => ({ messages: [...s.messages, { kind: 'player', side, text }] })),
  addSpectatorMessage: (name, text) =>
    set((s) => ({ messages: [...s.messages, { kind: 'spectator', name, text }] })),
  clearChat: () => set({ messages: [] }),
}));
