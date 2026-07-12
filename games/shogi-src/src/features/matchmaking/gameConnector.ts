/**
 * OnlineGameConnector の実装。
 * matchmaking 起動時に registry に登録される。
 */

import { register } from '../../core/plugin/registry';
import { useChatStore } from '../../core/store/chat-store';
import { useGameStore } from '../../core/store/game-store';
import { useOffersStore } from '../../core/store/offers-store';
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

  getMyChatSide() {
    const state = useMatchmakingStore.getState();
    if (state.gameStartInfo) {
      const sel = state.isHost ? state.gameStartInfo.hostSide : state.gameStartInfo.guestSide;
      return sel === 'sente' ? 'player1' : 'player2';
    }
    if (state.currentRoomId) {
      // S06 対局準備中: 対局前で side が未確定なので host=player1, guest=player2 の暫定側
      return state.isHost ? 'player1' : 'player2';
    }
    return null;
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
    // v0.32: getMyChatSide() は入室後なら暫定 side を返すため、対局前 (S06) でも動作
    const mySide = this.getMyChatSide();
    if (!mySide) return;
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

  sendDrawOffer() {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setDrawOfferFrom('me');
    client.send({ v: PROTOCOL_VERSION, type: 'draw_offer' });
  },

  sendDrawResponse(accepted) {
    const client = getMomoMatchmaking();
    if (!client) return;
    // 応答したので自分側の「相手からの申し出」表示を消す
    useOffersStore.getState().setDrawOfferFrom(null);
    client.send({ v: PROTOCOL_VERSION, type: 'draw_response', accepted });
    if (accepted) {
      useGameStore.getState().agreeDraw();
    }
  },

  sendUndoOffer(count = 1) {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setUndoOfferFrom('me');
    client.send({ v: PROTOCOL_VERSION, type: 'undo_offer', count });
  },

  sendUndoResponse(accepted, count = 1) {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setUndoOfferFrom(null);
    client.send({ v: PROTOCOL_VERSION, type: 'undo_response', accepted, count });
    if (accepted) {
      useGameStore.getState().undoLastMove(count);
    }
  },

  leaveOnline() {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    // 退室時にハンドシェイク・部屋状態をリセット
    useMatchmakingStore.getState().resetRoomState();
    useRouteStore.getState().setScreen('net-lobby');
  },

  returnToPreparation() {
    // 部屋接続は維持したまま、ハンドシェイクと盤面をリセット
    useMatchmakingStore.getState().resetHandshake();
    useGameStore.getState().reset();
    useChatStore.getState().clearChat();
    useOffersStore.getState().clearAll();
    useRouteStore.getState().setScreen('room');
  },

  getOpponentLeftDuringGame() {
    return useMatchmakingStore.getState().opponentLeftDuringGame;
  },

  subscribe(cb) {
    return useMatchmakingStore.subscribe(cb);
  },
};

register<OnlineGameConnector>('gameConnector', connector);
