/**
 * OnlineGameConnector の実装。
 * matchmaking 起動時に registry に登録される。
 */

import { register } from '../../core/plugin/registry';
import { useChatStore } from '../../core/store/chat-store';
import { useGameStore } from '../../core/store/game-store';
import { useRouteStore } from '../../core/store/route-store';
import type { OnlineGameConnector, RemoteMovePayload } from '../../core/plugin/gameConnector';
import { getMomoMatchmaking } from './client';
import { PROTOCOL_VERSION } from './protocol';
import { useMatchmakingStore } from './store';

const connector: OnlineGameConnector = {
  isOnline() {
    return !!useMatchmakingStore.getState().gameStartInfo;
  },

  getMySide() {
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return null;
    const mySelection = state.isHost
      ? state.gameStartInfo.hostSide
      : state.gameStartInfo.guestSide;
    return mySelection === 'sente' ? 'player1' : 'player2';
  },

  getMyName() {
    return useMatchmakingStore.getState().playerName;
  },

  getOpponentName() {
    return useMatchmakingStore.getState().opponentName;
  },

  sendMove(payload: RemoteMovePayload) {
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send({
      v: PROTOCOL_VERSION,
      type: 'move',
      kind: payload.kind,
      pieceId: payload.pieceId,
      from: payload.from,
      to: payload.to,
      promote: payload.promote,
    });
  },

  sendChat(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return;
    const mySide: 'player1' | 'player2' =
      (state.isHost ? state.gameStartInfo.hostSide : state.gameStartInfo.guestSide) === 'sente'
        ? 'player1'
        : 'player2';
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send({
      v: PROTOCOL_VERSION,
      type: 'chat',
      side: mySide,
      text: trimmed,
    });
    useChatStore.getState().addMessage(mySide, trimmed);
  },

  sendResign(side) {
    // ローカル盤面をまず投了扱いに（オンライン/オフライン共通）
    useGameStore.getState().resign(side);
    // オンラインなら相手にも投了を通知
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send({
      v: PROTOCOL_VERSION,
      type: 'resign',
      side,
    });
  },

  leaveOnline() {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    // 退室時にハンドシェイク・部屋状態をリセット
    useMatchmakingStore.getState().resetRoomState();
    useRouteStore.getState().setScreen('net-lobby');
  },

  getOpponentLeftDuringGame() {
    return useMatchmakingStore.getState().opponentLeftDuringGame;
  },

  subscribe(cb) {
    return useMatchmakingStore.subscribe(cb);
  },
};

register<OnlineGameConnector>('gameConnector', connector);
