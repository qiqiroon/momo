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
import { sendShogiMessage, senderOfMessage, unwrapShogiMessage } from './protocol';
import { decodeRoomName } from './roomNameCodec';
import { hasOpponent, hasSeat, isSpectator, opponentOf } from './roster';
import { buildSpectateSync } from './spectate';
import { noteSpectatedRoomClosed, noteSpectatorKicked, spectateMigrateSettled } from './spectateMigrate';
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
 * ★v1.59 (段3・親 §6.8.6): 感想戦の部屋へ観戦者が入ってきた。
 *
 * **配るものは、入ってきた人の立場ではなく「いま自分が居る部屋の用途」で決まる**
 * ＝感想戦の部屋で対局用の配りを動かすと、**観戦者は在りもしない対局を組み立てて
 * 盤の画面へ行ってしまう**。感想戦の部屋でなければ false。
 */
function reviewSpectatorArrived(pid: string): boolean {
  const arrived = pluginGet<(pid: string) => boolean>('review:spectatorArrived');
  return arrived ? arrived(pid) : false;
}

/**
 * ★v1.55 (親 §6.8.4): 入ってきた観戦者ひとりに、いまの対局を丸ごと配る。
 *
 * **配るのはホストだけ**＝二人が同じものを配ると受け取った側が二度組み立て直す。
 * **ホストでなければ何もしない**のが正しい（黙っていてよい唯一の場面）。
 */
function sendSpectateSyncTo(pid: string): void {
  if (!useMatchmakingStore.getState().isHost) return;
  const client = getMomoMatchmaking();
  if (!client) return;
  sendShogiMessage(client, buildSpectateSync(), pid);
}

/**
 * v1.53: **対局相手が席に着いた**ときの始末を 1 か所にまとめたもの。
 *
 * 呼ばれる経路が 2 つある (従来の 1 対 1 の部屋＝ゲスト入室／多人数の部屋＝参加者の入室) ので、
 * **中身を 2 か所に書かない**。片方だけ直った状態を作らないため。
 */
function handleOpponentArrived(name: string): void {
  const s = useMatchmakingStore.getState();
  s.setOpponentName(name);
  // v1.53: 相手が席に着いて初めて「対局できる状態」になる (親 §6.2)。
  if (useMatchmakingStore.getState().connection === 'in_room') {
    s.setConnection('game_connected');
  }
  // v1.50: 感想戦の部屋なら、ここが**棋譜を配り始める合図**（親 §6.3.6）。
  // 対局の部屋なら false が返るので、今までどおり何も起こらない。
  reviewGuestArrived();
}

/**
 * v1.53: **対局相手が居なくなった**ときの始末を 1 か所にまとめたもの。
 * 従来の onGuestLeft の中身をそのまま移したもので、扱いは変えていない。
 */
function handleOpponentGone(): void {
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
    onRoomCreated: (roomId, roomName, _rules, multi) => {
      const s = useMatchmakingStore.getState();
      s.setConnection('in_room');
      s.setCurrentRoom({ roomId, roomName, isHost: true });
      if (multi) s.setMultiInfo({ pid: multi.pid, role: multi.role, roster: multi.roster });
    },
    onJoinedRoom: (roomId, roomName, hostName, rules, multi) => {
      const s = useMatchmakingStore.getState();
      s.setConnection('in_room');
      s.setCurrentRoom({ roomId, roomName, isHost: false });
      if (multi) s.setMultiInfo({ pid: multi.pid, role: multi.role, roster: multi.roster });
      // ★v1.55 (親 §6.8): 観戦者として入った場合。
      // **「相手」は居ない**（見ているだけで席に着いていない）ので相手の名前は空のまま。
      // 対局者の名前は `spectate_sync` が運ぶ（親 §6.8.4）。
      if (multi && isSpectator(multi.role)) {
        s.setOpponentName('');
        s.setActiveRoomConfig(normalizeIncomingRules(rules, roomName));
        // ★v1.59 (段3・親 §6.8.6): **観戦の部屋に入るたび、移行の控えを決め直す**。
        // 感想戦へ移り終えた合図でもあり、**観戦に入り直したときの決め直し**でもある
        // （**画面より長生きする控えは、入るたびに決め直す**＝前の対局で答えなかった
        // 確認が次の観戦に出てこないようにする）。**入り口ごとに書き足さない。**
        spectateMigrateSettled();
        // ★v1.59: **感想戦の部屋なら盤ではなく感想戦の画面へ**（親 §6.8.6）。
        // 配られるのは感想戦の土台なので、「対局を受け取っています」も立てない。
        if (enterReviewAsGuest(roomName)) return;
        // **受け取り終わるまで「対局を受け取っています」と出す**（画面機能 §3 S06）。
        useMatchmakingStore.setState({ spectateWaiting: true, seatNames: null });
        // **棋譜の確認は入る前に済ませてある**（S13＝親 §9.2.3 ②
        // 「確認の手前で外へ出る操作をしない」）ので、ここでは割り込ませない。
        useRouteStore.getState().setScreen('room', { skipKifuGuard: true });
        return;
      }
      // v1.53: 相手の名前は**名簿の席から**取る。名簿が無い部屋 (従来の 1 対 1) では
      // ホスト名がそのまま相手なのでそれを使う。
      const fromRoster = multi ? opponentOf(multi.roster, multi.pid) : null;
      s.setOpponentName(fromRoster ? fromRoster.name : hostName);
      s.setActiveRoomConfig(normalizeIncomingRules(rules, roomName));
      // v1.50: 感想戦の部屋なら待機画面ではなく感想戦へ（画面機能 §3 S04）。
      if (enterReviewAsGuest(roomName)) return;
      useRouteStore.getState().setScreen('room');
    },
    // v1.53: 従来の 1 対 1 の部屋だけがここを通る (多人数の部屋では呼ばれない)。
    onGuestJoined: (guestName) => {
      handleOpponentArrived(guestName);
    },
    onGuestLeft: () => {
      handleOpponentGone();
    },
    /**
     * v1.53 (親 §6.2): 多人数の部屋に誰かが入った。
     * **席の有無で振り分ける** — 観戦者が来ても対局相手にはしない。
     */
    onParticipantJoined: (pid, role, name, roster) => {
      useMatchmakingStore.getState().setRoster(roster);
      // ★v1.55 (親 §6.8.1): **観戦者に「自分の対局相手」は居ない**。
      // v1.68 はここを素通りしていたので、**観戦者が対局者の入室を「相手が来た」と
      // 受け取り、状態合わせの伝言を送り返して二人の準備状態を上書き**していた
      // （2026-08-21 実機のご報告＝対局が始まっても観戦者の試合が始まらない）。
      // 名簿だけ更新して、対局者としての始末はしない。
      if (isSpectator(useMatchmakingStore.getState().myRole)) return;
      if (!hasSeat(role)) {
        // ★v1.55 (親 §6.8.4): 観戦者が入ってきた。**ホストがその 1 人に宛てて
        // いまの対局を丸ごと配る**。**まだ何も始まっていなくても配る**＝
        // **「無い」は送るべき事実であって、送らない理由ではない**。黙ると、
        // 入ってきた側は「まだ来ていない」と「無い」を区別できず待ち続ける。
        // ★v1.59 (段3): **感想戦の部屋なら配るものが違う**（親 §6.8.6）。
        if (!reviewSpectatorArrived(pid)) sendSpectateSyncTo(pid);
        return;
      }
      handleOpponentArrived(name);
    },
    /**
     * v1.53: 多人数の部屋から誰かが抜けた。
     * **抜けたのが観戦者なら対局には何も起きない**ので、名簿を見て相手が残っているかで決める。
     */
    onParticipantLeft: (_pid, roster) => {
      const s = useMatchmakingStore.getState();
      const hadOpponent = !!s.opponentName;
      s.setRoster(roster);
      // ★v1.55: 観戦者に「対局相手」は居ないので、この始末は自分に当てはまらない。
      // **席のある者を自分の相手として拾わない**（拾うと対局していないのに
      // 「相手が抜けた」の始末が走る）。
      if (isSpectator(s.myRole)) {
        // ★v1.59 (段3・親 §6.8.6): **席のある人が誰も居なくなったら、観戦は続けられない**
        // ＝部屋を建てた人が抜けるとサーバーが部屋を閉じるので、観戦者だけ残れない。
        // **観戦者どうしの出入りでは何も起きない**（席の有無で決める＝人数で数えない）。
        // 移り先を受け取っているなら**予期された閉鎖**なので何もしない（判断は 1 か所）。
        if (!roster.some((p) => hasSeat(p.role))) noteSpectatedRoomClosed();
        return;
      }
      const opp = opponentOf(roster, s.myPid);
      if (opp) {
        s.setOpponentName(opp.name);
        return;
      }
      if (!hadOpponent) return;
      handleOpponentGone();
    },
    onConnected: () => {
      const s = useMatchmakingStore.getState();
      // ★v1.53 (親 §6.2): これは「部屋に入った」の合図であって「相手が居る」ではない。
      // サーバー中継では**部屋を建てた時点で発火する**ので、名簿に席のある相手が
      // 居るときだけ対局できる状態へ進める。
      // 名簿を持たない部屋 (従来の 1 対 1) では、この合図の到達そのものが
      // 相手とつながった証なので従来どおり進める。
      if (s.roster.length === 0 || hasOpponent(s.roster, s.myPid)) {
        s.setConnection('game_connected');
      }
    },
    /**
     * ★v1.61 (親 §6.8.4): **ホストに退室させられた**。
     *
     * **将棋はこの知らせをどこでも受けていなかった**ので、**追い出された人の画面は
     * 固まったまま**だった（2026-08-22 実測＝部屋からは確かに出ているのに、
     * 見ている側には何も起きない）。**黙って固まらない**＝言葉で伝えて返す。
     */
    onKicked: () => {
      const s = useMatchmakingStore.getState();
      if (isSpectator(s.myRole)) {
        noteSpectatorKicked();
        return;
      }
      // 席のある人を追い出す導線は置いていないが、届いたときに黙らない。
      s.setError(null);
      useMatchmakingStore.setState({ intentionallyLeft: true });
      useRouteStore.getState().setScreen('net-lobby', { skipKifuGuard: true });
    },
    onDisconnected: (reason) => {
      const state = useMatchmakingStore.getState();
      if (state.intentionallyLeft) {
        useMatchmakingStore.setState({ intentionallyLeft: false, connection: 'connected' });
        return;
      }
      // ★v1.59 (段3・親 §6.8.6): **観戦者には対局者としての始末をしない**。
      // 通信が一時的に切れただけのときは待つ（対局者側と同じ見分け方）。
      // **黙って固まらない**＝それ以外は「対局が終わりました」と伝えて一覧へ返す
      // （移り先を受け取っているときは予期された閉鎖なので、そちらで判断される）。
      if (isSpectator(state.myRole)) {
        const isWsOnly = typeof reason === 'string' && reason.includes('再接続中');
        if (isWsOnly) return;
        noteSpectatedRoomClosed();
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
      // ★v1.53: 対局の伝言は包みに入って届く（親 §6.2）。
      // 包みでないものはそのまま通す＝包みを使わない相手とも話せる。
      // ★v1.55: **送り主は包みの外側に付いている**ので、開ける前に取り出して一緒に渡す
      // （捨てると誰が言ったのか分からなくなる＝花札で実際に起きた壊れ方・§6.8.5）。
      handleShogiMessage(unwrapShogiMessage(data), senderOfMessage(data));
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
