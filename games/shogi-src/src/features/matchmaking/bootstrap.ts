/**
 * matchmaking クライアント (シグナリング WebSocket) の起動処理を一箇所に集約 (v0.55)。
 *
 * 従来は LobbyScreen の useEffect でのみ init を呼んでいたため、
 * S00 メニュー画面ではまだ通信状態が「未接続」のまま表示されており、
 * 「サーバー接続済み表示」や「ネット対戦ボタンの非活性判定」がロビー画面到達後
 * にしか正しく機能しなかった。
 *
 * v0.55 で MenuScreen もモック追随に伴い接続状態を表示する必要が出たため、
 * メニュー画面のマウント時からシグナリング接続を確立する。二重初期化を避けるため
 * モジュールスコープのフラグでガードする。両画面 (Menu / Lobby) から呼んでも
 * 実際の init は最初の一度だけ。
 */
import { useChatStore } from '../../core/store/chat-store';
import { useRouteStore } from '../../core/store/route-store';
import { useOffersStore } from '../../core/store/offers-store';
import { getMomoMatchmaking } from './client';
import { SHOGI_GAME_TYPE, SIGNALING_URL } from './config';
import { handleShogiMessage } from './messageDispatcher';
import { useMatchmakingStore, DEFAULT_ROOM_CONFIG, type RoomConfig } from './store';

let _inited = false;

/**
 * サーバーが joined_room で中継してくる rules は
 * ホストが createRoom に渡した `{game, torus, quantum, customRuleName, time}` を素通ししたもの。
 * RoomConfig 形状に正規化する (先後はルームで決めるので含めない)。
 * roomName は encoded 状態のまま格納 (表示側で decode)。
 */
function normalizeIncomingRules(rules: unknown, roomName: string): RoomConfig | null {
  if (!rules || typeof rules !== 'object') return null;
  const r = rules as {
    game?: string;
    torus?: boolean;
    quantum?: boolean;
    customRuleName?: string;
    time?: unknown;
  };
  const time = (r.time && typeof r.time === 'object' ? r.time : {}) as Partial<RoomConfig['timeControl']>;
  const gameType: RoomConfig['gameType'] =
    r.game === 'hasami' ? 'hasami' : r.game === 'shogi-custom' ? 'shogi-custom' : 'shogi';
  return {
    roomName,
    password: '',
    isPublic: true,
    gameType,
    torus: !!r.torus,
    quantum: !!r.quantum,
    customRuleName: r.customRuleName,
    timeControl: {
      mode: time.mode ?? DEFAULT_ROOM_CONFIG.timeControl.mode,
      mainSeconds: time.mainSeconds ?? DEFAULT_ROOM_CONFIG.timeControl.mainSeconds,
      byoyomiSeconds: time.byoyomiSeconds,
      incrementSeconds: time.incrementSeconds,
    },
  };
}

/**
 * matchmaking を初期化 (シグナリング WS を開く)。多重呼び出しは無視。
 * MenuScreen / LobbyScreen の両方から呼んで良い。
 */
export function ensureMatchmakingInit(): void {
  if (_inited) return;
  const client = getMomoMatchmaking();
  if (!client) {
    useMatchmakingStore.getState().setError('matchmaking module not available');
    return;
  }
  _inited = true;
  const store = useMatchmakingStore.getState();
  store.setConnection('connecting');
  store.setError(null);
  client.init({
    signalingUrl: SIGNALING_URL,
    gameType: SHOGI_GAME_TYPE,
    onRoomList: (list) => {
      useMatchmakingStore.getState().setRooms(list);
    },
    onRoomCreated: (roomId, roomName) => {
      const s = useMatchmakingStore.getState();
      s.setConnection('in_room');
      s.setCurrentRoom({ roomId, roomName, isHost: true });
    },
    onJoinedRoom: (roomId, roomName, hostName, rules) => {
      const s = useMatchmakingStore.getState();
      s.setConnection('in_room');
      s.setCurrentRoom({ roomId, roomName, isHost: false });
      s.setOpponentName(hostName);
      s.setActiveRoomConfig(normalizeIncomingRules(rules, roomName));
      useRouteStore.getState().setScreen('room');
    },
    onGuestJoined: (guestName) => {
      useMatchmakingStore.getState().setOpponentName(guestName);
    },
    onGuestLeft: () => {
      const state = useMatchmakingStore.getState();
      if (state.gameStartInfo) {
        useMatchmakingStore.setState({
          opponentName: '',
          opponentLeftDuringGame: true,
        });
        return;
      }
      state.setOpponentName('');
    },
    onConnected: () => {
      useMatchmakingStore.getState().setConnection('game_connected');
    },
    onDisconnected: (reason) => {
      const state = useMatchmakingStore.getState();
      if (state.intentionallyLeft) {
        useMatchmakingStore.setState({ intentionallyLeft: false, connection: 'connected' });
        return;
      }
      if (state.gameStartInfo) {
        const isWsOnly = typeof reason === 'string' && reason.includes('再接続中');
        if (isWsOnly) {
          if (state.wsPendingReconnect) return;
          useMatchmakingStore.setState({ wsPendingReconnect: true });
          return;
        }
        useMatchmakingStore.setState({
          wsPendingReconnect: false,
          opponentLeftDuringGame: true,
        });
        if (reason) state.setError(reason);
        return;
      }
      state.setConnection('disconnected');
      if (reason) state.setError(reason);
      // 対局中でない切断はメニュー相当画面へ戻すが、v0.55 では S00 メニューに
      // 接続状態バーを置いたため、S04 ロビーに強制遷移はしない。ユーザーの
      // 「メニューへ戻る」等の明示アクションで S04 → S00 に戻る。
    },
    onError: (msg) => {
      useMatchmakingStore.getState().setError(msg);
    },
    onMessage: (data) => {
      handleShogiMessage(data);
    },
    onWsOpen: () => {
      const state = useMatchmakingStore.getState();
      if (state.connection === 'connecting' || state.connection === 'disconnected') {
        state.setConnection('connected');
      }
    },
    onWsClose: () => {
      const state = useMatchmakingStore.getState();
      if (state.connection === 'connected' && !state.currentRoomId) {
        state.setConnection('connecting');
      }
    },
  });
  // 未使用参照を排除するため import しておく (エフェクト内部からは触らないが
  // 将来この bootstrap 内でチャットストア初期化等が必要になった時のための足場)
  void useChatStore;
  void useOffersStore;
}
