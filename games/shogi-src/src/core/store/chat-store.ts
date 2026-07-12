import { create } from 'zustand';

/**
 * 対局中のチャット履歴を持つ store（段階 2-7 v0.28）。
 *
 * 履歴は共有前提で、自分の発言も相手の発言も同じ side（player1=先手 / player2=後手）
 * で記録する。両プレイヤーの端末で同じ順序・同じ side 属性で描画される。
 */

export interface ChatMessage {
  side: 'player1' | 'player2';
  text: string;
}

interface ChatState {
  messages: ChatMessage[];
  addMessage: (side: 'player1' | 'player2', text: string) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  addMessage: (side, text) =>
    set((s) => ({ messages: [...s.messages, { side, text }] })),
  clearChat: () => set({ messages: [] }),
}));
