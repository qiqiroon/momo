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
import { get as pluginGet } from '../../core/plugin/registry';
import { getMomoMatchmaking } from './client';
import { SHOGI_GAME_TYPE, SIGNALING_URL } from './config';
import { handleShogiMessage } from './messageDispatcher';
import { decodeRoomName } from './roomNameCodec';
import { useMatchmakingStore, DEFAULT_ROOM_CONFIG, type RoomConfig } from './store';

let _inited = false;

/**
 * サーバーが joined_room で中継してくる rules は
 * ホストが createRoom に渡した `{game, torus, torusMode, quantum, qtdisp, customRuleName, time}`
 * を素通ししたもの。RoomConfig 形状に正規化する (先後はルームで決めるので含めない)。
 * roomName は encoded 状態のまま格納 (表示側で decode)。
 *
 * これは入室した時点 (P2P がつながる前) に部屋のルールを画面に出すための早見表。
 * 対局に使うルールの正本は Phase 5-12 の rule_sync で改めて届き、そちらで上書きされる。
 * 量子の実行時パラメータは画面に出さないのでここには載せず、rule_sync だけが運ぶ。
 *
 * export しているのはテストから直接呼ぶため (純関数)。
 */
export function normalizeIncomingRules(rules: unknown, roomName: string): RoomConfig | null {
  if (!rules || typeof rules !== 'object') return null;
  const r = rules as {
    game?: string;
    torus?: boolean;
    torusMode?: string;
    quantum?: boolean;
    qtdisp?: string;
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
    // Phase 5-12: ホストが選んだトーラスの詳細をそのまま採用する。
    // v0.57 からここは「つながっているなら円筒」の決め打ちで、ホストが完全トーラスを
    // 選んでもゲスト側は円筒に化けていた。torusMode を送ってこない旧版のホストが
    // 相手のときだけ、従来どおり円筒として復元する。
    torusMode:
      r.torusMode === 'none' || r.torusMode === 'cylinder' || r.torusMode === 'full'
        ? r.torusMode
        : r.torus
          ? 'cylinder'
          : 'none',
    quantum: !!r.quantum,
    // v1.08 (Phase 5-11): ホストが選んだ見せ方をそのまま採用する (公平性原則)。
    // 旧版のホストは qtdisp を送ってこないので、その場合は既定の巡回にする。
    quantumDisplayMode: r.qtdisp === 'stack' ? 'stack' : 'cycle',
    customRuleName: r.customRuleName,
    timeControl: {
      mode: time.mode ?? DEFAULT_ROOM_CONFIG.timeControl.mode,
      mainSeconds: time.mainSeconds ?? DEFAULT_ROOM_CONFIG.timeControl.mainSeconds,
      byoyomiSeconds: time.byoyomiSeconds,
      incrementSeconds: time.incrementSeconds,
    },
    // v1.33: 手合いは部屋名にも部屋一覧にも載せていない。正本はルール同期 (rule_sync) で
    // 届くので、ここでは平手にしておき、届いた時点で上書きされる (親 §6.5)。
    handicap: null,
  };
}

/**
 * 感想戦の最中に相手が抜けた (v1.47・親 §9.4.4)。
 *
 * 感想戦をやっていたなら**その旨だけを感想戦の側へ伝えて true を返す**＝呼んだ側は
 * 対局中の切断としての始末 (退室を促すモーダル) をしない。**続けられるものを打ち切らない。**
 * 感想戦をしていなければ false で、従来どおりの扱いになる。
 */
function reviewOpponentLeft(): boolean {
  const notify = pluginGet<() => boolean>('review:opponentLeft');
  return notify ? notify() : false;
}

/**
 * v1.50: 感想戦の部屋へ入った（画面機能 §3 S04・付録D-12 §8）。
 *
 * **待機画面 (S05) は通らず、そのまま感想戦へ進む**＝先後も持ち時間も無いので
 * 決めることが無い。**用途は部屋名の記号から読む**＝サーバーは部屋名を素通しする
 * だけで、部屋の用途という概念を持たない。棋譜の機能を積んでいないビルドでは
 * 口ごと無いので、その場合は今までどおり待機画面へ進む。
 */
function enterReviewAsGuest(roomName: string): boolean {
  if (!decodeRoomName(roomName).review) return false;
  const enter = pluginGet<() => void>('review:joinedRoom');
  if (!enter) return false;
  enter();
  return true;
}

/** v1.50: 自分の建てた感想戦の部屋へ客が来た＝**ここで棋譜を配り始める**。 */
function reviewGuestArrived(): boolean {
  const arrived = pluginGet<() => boolean>('review:guestArrived');
  return arrived ? arrived() : false;
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
      // v1.50: 感想戦の部屋なら待機画面ではなく感想戦へ（画面機能 §3 S04）。
      if (enterReviewAsGuest(roomName)) return;
      useRouteStore.getState().setScreen('room');
    },
    onGuestJoined: (guestName) => {
      useMatchmakingStore.getState().setOpponentName(guestName);
      // v1.50: 感想戦の部屋なら、ここが**棋譜を配り始める合図**（親 §6.3.6）。
      // 対局の部屋なら false が返るので、今までどおり何も起こらない。
      reviewGuestArrived();
    },
    onGuestLeft: () => {
      const state = useMatchmakingStore.getState();
      // v1.47 (親 §9.4.4): 感想戦の最中なら**感想戦は終わらない**。相手が抜けたことは
      // 知らせるが、対局中の切断とは扱いを分ける (退室を促さない)。
      if (reviewOpponentLeft()) return;
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
      // v1.47 (親 §9.4.4): 感想戦の最中の切断も「相手が抜けた」と同じ扱い＝ひとりで続ける。
      if (reviewOpponentLeft()) {
        useMatchmakingStore.setState({ wsPendingReconnect: false });
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
