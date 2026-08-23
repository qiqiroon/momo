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
import { positionHash } from '../../core/engine';
import { getMomoMatchmaking } from './client';
import { PROTOCOL_VERSION, sendShogiMessage } from './protocol';
import { hasSeat, isSpectator, otherSpectatorPids, spectatorsOf } from './roster';
import { resetSpectateMigrate } from './spectateMigrate';
import { useMatchmakingStore } from './store';

const connector: OnlineGameConnector = {
  isOnline() {
    return !!useMatchmakingStore.getState().gameStartInfo;
  },

  getMySide() {
    const state = useMatchmakingStore.getState();
    /**
     * ★v1.55: **観戦者は席を持たないので、どちらの側でもない**（親 §6.8.1）。
     *
     * ここを素通りさせていたため、**観戦者が「ゲスト側の人」として扱われ**、
     * 終局パネルに**「勝ち」「相手が投了」**と出ていた（2026-08-21 実サーバーで確認）。
     * **観戦者に勝ち負けも相手も無い**ので、null を返して**先手／後手の言い方**へ落とす。
     */
    if (isSpectator(state.myRole)) return null;
    if (!state.gameStartInfo) return null;
    const mySelection = state.isHost
      ? state.gameStartInfo.hostSide
      : state.gameStartInfo.guestSide;
    return mySelection === 'sente' ? 'player1' : 'player2';
  },

  getMyChatSide() {
    const state = useMatchmakingStore.getState();
    // ★v1.55: **観戦者は席を持たないので、席を名乗らない**（§6.8.5）。
    // v1.54 まではここが「ホストでなければ後手」を返していたため、実機で
    // **観戦者の発言が「後手」と出ていた**（2026-08-21 ご報告）。
    if (isSpectator(state.myRole)) return null;
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

  // ★v1.55 (親 §6.8): 観戦まわり。**A ビルドにはこの実装ごと無い**（縮退互換）。
  isSpectating() {
    return isSpectator(useMatchmakingStore.getState().myRole);
  },

  /**
   * 対局者二人の名前を**側で引ける形**に直す。
   *
   * ホストが配ってくるのは「ホスト側／ゲスト側」の名前なので、**先後の確定値で
   * 割り当て直す**。**先後が決まる前は null**＝どちらがどちらか言えないため
   * （**分からないものを分かったように書かない**）。
   */
  getSeatNames() {
    const s = useMatchmakingStore.getState();
    if (!isSpectator(s.myRole)) return null;
    /**
     * ★v1.55: **名前は名簿から引く。配られたものは足がかりにすぎない**。
     *
     * `spectate_sync` は**入ったその瞬間の顔ぶれ**を運ぶので、**あとから対局者が
     * 入ってくると古くなる**（実機で**後手の名前が空のまま**だった）。**名簿は
     * 出入りのたびに届く**ので、そちらを先に見る。
     */
    const seated = s.roster.filter((p) => hasSeat(p.role));
    const fromRoster = {
      host: seated.find((p) => p.role === 'host')?.name ?? '',
      guest: seated.find((p) => p.role !== 'host')?.name ?? '',
    };
    const names = {
      host: fromRoster.host || s.seatNames?.host || '',
      guest: fromRoster.guest || s.seatNames?.guest || '',
    };
    if (!names.host && !names.guest) return null;
    /**
     * **先後が決まる前は暫定の割り当てで読む**＝送る側も対局前は
     * 「ホスト＝先手・ゲスト＝後手」の暫定で名乗っている（`getMyChatSide`）ので、
     * **読む側だけ別の決め方をしない**。
     */
    const hostIsSente = s.gameStartInfo ? s.gameStartInfo.hostSide === 'sente' : true;
    return {
      player1: hostIsSente ? names.host : names.guest,
      player2: hostIsSente ? names.guest : names.host,
    };
  },

  getSpectators() {
    return spectatorsOf(useMatchmakingStore.getState().roster).map((p) => ({
      pid: p.pid,
      name: p.name,
    }));
  },

  isSpectateWaiting() {
    return useMatchmakingStore.getState().spectateWaiting;
  },

  getActiveRules() {
    const cfg = useMatchmakingStore.getState().activeRoomConfig;
    if (!cfg) return null;
    return { gameType: cfg.gameType, torusMode: cfg.torusMode, quantum: cfg.quantum, quantumDisplayMode: cfg.quantumDisplayMode, handicap: cfg.handicap };
  },

  getPendingRules() {
    const cfg = useMatchmakingStore.getState().pendingRoomConfig;
    return { gameType: cfg.gameType, torusMode: cfg.torusMode, quantum: cfg.quantum, quantumDisplayMode: cfg.quantumDisplayMode, handicap: cfg.handicap };
  },

  // v1.24: setQuantumDisplayMode は廃止した。対局中に部屋の値 (qtdisp) を書き換えられる口が
  //   あると、ルールを決めた側だけが自分に有利な局面で読みやすさを変えられてしまうため
  //   (spec 駒デザイン・対局UI v0.9 §4.4)。部屋の値が決まるのは S02 の setConfig 経路だけ。

  isRuleSetter() {
    const s = useMatchmakingStore.getState();
    // 部屋に入っていない = オフライン対局 = ルールを決めたのは本人
    if (!s.currentRoomId) return true;
    return s.isHost;
  },

  getPendingTimeControl() {
    return useMatchmakingStore.getState().pendingRoomConfig.timeControl;
  },

  commitPendingToActive() {
    const s = useMatchmakingStore.getState();
    s.setActiveRoomConfig({ ...s.pendingRoomConfig });
  },

  sendMove(payload: RemoteMovePayload) {
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, {
      v: PROTOCOL_VERSION,
      type: 'move',
      kind: payload.kind,
      pieceId: payload.pieceId,
      from: payload.from,
      to: payload.to,
      promote: payload.promote,
      time: payload.time,
      hash: payload.hash,
    });
  },

  sendChat(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    const st = useMatchmakingStore.getState();

    /**
     * ★v1.55 (親 §6.8.5): **観戦者の発言は観戦者どうしにだけ届く。**
     *
     * 理由＝**将棋の観戦者は盤を見ながら対局者に話しかけられる立場**なので、
     * 対局中に自由に書けると**指し手を教えられてしまう**。
     *
     * **「全員へ送って対局者の側で無視する」形は採らない**＝言葉そのものは相手の
     * 機械まで届いてしまい、助言を防いだことにならない。**土台に「観戦者全員」という
     * 宛先が無い**ので、**一人ずつ宛てて送る**。
     *
     * **★観戦者どうしだけに絞るのは「対局が進んでいる間」だけ**（2026-08-21 ユーザー判断）。
     * **対戦準備室・終局後・感想戦は全員に届く**＝**助言が成り立つのは、これから手を
     * 指す局面があるときだけ**だから。
     *
     * ★**画面の名前で並べず、事実で書く**＝「盤の画面に居て、かつ対局がまだ終わって
     * いない」。画面を数え上げる形にすると、**画面が増えたときに必ず書き忘れる**し、
     * **終局後も絞ったまま**になる（終局後に助言のしようは無い）。
     */
    if (isSpectator(st.myRole)) {
      const onBoard = useRouteStore.getState().screen === 'game';
      const inPlay = onBoard && useGameStore.getState().status === 'playing';
      const body = { v: PROTOCOL_VERSION, type: 'chat' as const, text: trimmed };
      if (!inPlay) {
        sendShogiMessage(client, body);
      } else {
        for (const pid of otherSpectatorPids(st.roster, st.myPid)) {
          sendShogiMessage(client, body, pid);
        }
      }
      // **相手が居なくても自分の画面には出す**＝押したのに何も起きないと、
      // 送れなかったのか誰も居ないのかを区別できない。
      useChatStore.getState().addSpectatorMessage(st.playerName, trimmed);
      return;
    }

    // v0.32: getMyChatSide() は入室後なら暫定 side を返すため、対局前 (S06) でも動作
    const mySide = this.getMyChatSide();
    if (!mySide) return;
    sendShogiMessage(client, {
      v: PROTOCOL_VERSION,
      type: 'chat',
      side: mySide,
      text: trimmed,
    });
    useChatStore.getState().addMessage(mySide, trimmed);
  },

  /**
   * ★v1.88: 入玉宣言の勝ちを届ける（親 v1.63 §6）。**手元の盤は宣言した時点で
   * 既に終局している**ので、ここは知らせるだけ。
   */
  sendNyugyokuDeclare(side: 'player1' | 'player2') {
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'nyugyoku_declare', side });
  },
  /**
   * ★v1.88: 「入玉宣言しますか」を出している／閉じたことの知らせ（親 v1.63 §6）。
   * **届かなくても対局は止まらない**（指した手そのものを答えるまで送らないため）。
   */
  sendNyugyokuPrompt(open: boolean) {
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return;
    const side = useGameStore.getState().nyugyokuPromptSide ?? this.getMySide();
    if (!side) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'nyugyoku_prompt', side, open });
  },
  sendResign(side) {
    // ローカル盤面をまず投了扱いに（オンライン/オフライン共通）
    useGameStore.getState().resign(side);
    // オンラインなら相手にも投了を通知
    const state = useMatchmakingStore.getState();
    if (!state.gameStartInfo) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, {
      v: PROTOCOL_VERSION,
      type: 'resign',
      side,
    });
  },

  sendDrawOffer() {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setDrawOfferFrom('me');
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'draw_offer' });
  },

  sendDrawResponse(accepted) {
    const client = getMomoMatchmaking();
    if (!client) return;
    // 応答したので自分側の「相手からの申し出」表示を消す
    useOffersStore.getState().setDrawOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'draw_response', accepted });
    if (accepted) {
      useGameStore.getState().agreeDraw();
    }
  },

  sendJishogiOffer() {
    // 持将棋の提案（v1.84・親 §4.4.1.3）。**撤回の口は持たない**＝10 秒で必ず決着する。
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setJishogiOfferFrom('me');
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'jishogi_offer' });
  },

  sendJishogiResponse(accepted) {
    const client = getMomoMatchmaking();
    if (!client) return;
    // 答えたので自分側の「相手からの提案」表示を消す
    useOffersStore.getState().setJishogiOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'jishogi_response', accepted });
    if (accepted) {
      useGameStore.getState().agreeJishogi();
    }
  },

  sendDrawCancel() {
    // 引分申し出を撤回（v0.42）
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setDrawOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'draw_cancel' });
  },

  sendUndoOffer(count, challengerSide) {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setUndoOfferFrom('me', { count, challengerSide });
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'undo_offer', count, challengerSide });
  },

  sendUndoResponse(accepted) {
    // v0.42: 承諾時は「承諾者側 (＝自分) の時計だけ復元、count は保存済み meta から取り出す」
    const client = getMomoMatchmaking();
    if (!client) return;
    const meta = useOffersStore.getState().undoOfferMeta;
    useOffersStore.getState().setUndoOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'undo_response', accepted });
    if (accepted && meta) {
      // 承諾者 side = challengerSide の反対 = mySide（＝this connector の getMySide()）。
      // 待ったのペナルティで challengerSide の時計は戻さない。
      const restoreSide: 'player1' | 'player2' =
        meta.challengerSide === 'player1' ? 'player2' : 'player1';
      useGameStore.getState().undoLastMove(meta.count, { restoreClockForSide: restoreSide });
    }
  },

  sendUndoCancel() {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setUndoOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'undo_cancel' });
  },

  sendTimeout(side) {
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'timeout', side });
  },

  sendAnomalyVote(choice) {
    // Phase 5-13 (親 §6.3.4): 自分の投票を相手に伝える。ローカルの反映は
    // game-store 側 (voteAnomaly) が済ませているのでここでは送信だけ。
    if (!this.isOnline()) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, {
      v: PROTOCOL_VERSION,
      type: 'anomaly_vote',
      choice,
      pieceIdListHash: positionHash(useGameStore.getState().position),
      timestamp: Date.now(),
    });
  },

  sendAnomalyRaise(cause, debugForce) {
    // v1.15: 異常が起きたことを相手に伝える。ローカルの反映は game-store 側が
    // 済ませているのでここでは送信だけ。
    if (!this.isOnline()) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'anomaly_raise', cause, debugForce });
  },

  isRoomHost() {
    const s = useMatchmakingStore.getState();
    return !!s.currentRoomId && s.isHost;
  },

  kickSpectator(pid) {
    /**
     * ★v1.61 (親 §6.8.4): **ホストが観戦者を退室させる**。
     *
     * ## 実測した事実（2026-08-22・本番サーバーで確認）
     *
     * - **`{ type: 'kick', pid }` を送ると、その参加者だけが退室させられる**
     *   （本人に `kicked` が届き、名簿からも消える）。**共通ライブラリは触らない。**
     * - **いまライブラリが持っている `kickGuest()`（pid 無しの `kick_guest`）は
     *   多人数の部屋では効かない**＝エラーにもならず、**ただの伝言として参加者へ
     *   素通りする**（**黙って無視される形**なので、押しても何も起きないように見える）。
     * - 共通ライブラリが必ず付ける **`to` が入っていても効く**。
     *
     * ## これは「対局の伝言」ではない
     *
     * **サーバー自身に宛てた指示**なので §6.2 の包みに入れない（部屋の段を知らせる
     * `game_state_update` と同じ扱い＝**包まない経路はこの 2 つだけ**）。
     */
    if (!this.isRoomHost()) return;
    if (!pid) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send({ type: 'kick', pid });
  },

  notifySpectatorsReviewMigrate(room, pass) {
    // ★v1.59 (段3・親 §6.8.6): 感想戦が成立した＝**観戦者に移り先を配る**。
    //
    // **配るのはホストだけ**＝二人が別々の移り先を配ると、どちらが正なのか
    // 誰も言えなくなる（部屋を建てるのもホストなので、書き手は自然に 1 人）。
    //
    // **一人ずつ宛てて送る**＝土台に「観戦者全員」という宛先が無い（§6.8.5）。
    // **席のある相手には送らない**＝相手は自分たちのやり取りで移り先を知っている。
    if (!this.isRoomHost()) return;
    const client = getMomoMatchmaking();
    if (!client) return;
    const st = useMatchmakingStore.getState();
    for (const pid of otherSpectatorPids(st.roster, st.myPid)) {
      sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'review_migrate', room, pass }, pid);
    }
  },

  sendReview(msg, to) {
    // ★v1.55 (親 §6.8.1): **観戦者は感想戦の打診も諾否も送らない**。
    // 受け取る側だけで守ると、**画面のどこかに導線が残っていたときに二人の相談へ
    // 割り込める**（実際に終局パネルの「感想戦」が観戦者にも出ていた）。
    // **盤を追う伝言も観戦者からは出ない**（観戦者は盤に触れないため）。
    if (isSpectator(useMatchmakingStore.getState().myRole)) return;
    // v1.47 (親 §6.3.6): 感想戦の伝言。**部屋に居ないときは送り先が無い**ので黙って捨てる
    // (ひとりの感想戦では縮退互換＝何も送らない)。
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!useMatchmakingStore.getState().currentRoomId) return;
    // ★v1.56: **中身に触れず、そのまま渡す**（protocol.ts の `ReviewMsg`）。
    // v1.55 までは伝言の種類ごとに項目を書き写しており、**書き写す欄に無いものは
    // 黙って捨てられて**いた（ハイライトと、部屋を移るための合言葉が届かなかった）。
    // **これ以降、感想戦の伝言を増やしてもここは直さなくてよい。**
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'review', payload: msg }, to);
  },

  sendPauseNotify() {
    // v0.42: 一時中断は合意不要 → ローカルは即中断＋相手へ通知
    useGameStore.getState().pauseGame();
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'pause_notify' });
  },

  sendResumeOffer() {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setResumeOfferFrom('me');
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'resume_offer' });
  },

  sendResumeResponse(accepted) {
    const client = getMomoMatchmaking();
    if (!client) return;
    useOffersStore.getState().setResumeOfferFrom(null);
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'resume_response', accepted });
    if (accepted) {
      useGameStore.getState().resumeGame();
    }
  },

  leaveOnline() {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    // ★v1.55 (親 §6.8.6): **観戦者は入ってきた場所へ戻す**＝観戦の一覧 (S13)。
    // 対戦のロビーへ戻すと、見に来ただけの人が**部屋を建てる画面に着地する**。
    // **立場を見てから畳む**＝畳んだ後では観戦者だったことが分からなくなる。
    const backTo = isSpectator(useMatchmakingStore.getState().myRole)
      ? 'spectate-lobby'
      : 'net-lobby';
    // ★v1.59 (段3): **自分から出たなら、移行の控えも捨てる**（親 §6.8.6）＝
    // 残すと、観戦の一覧に着いた先で「感想戦に入りますか」だけが立ったままになる。
    resetSpectateMigrate();
    // 退室時にハンドシェイク・部屋状態をリセット
    useMatchmakingStore.getState().resetRoomState();
    useRouteStore.getState().setScreen(backTo);
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

  getWsPendingReconnect() {
    return useMatchmakingStore.getState().wsPendingReconnect;
  },

  getLastPeerMessageAt() {
    return useMatchmakingStore.getState().lastPeerMessageAt;
  },

  sendPing() {
    const client = getMomoMatchmaking();
    if (!client) return;
    sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'ping' });
  },

  markConnectionHealthy() {
    useMatchmakingStore.getState().setWsPendingReconnect(false);
  },

  markConnectionDead() {
    useMatchmakingStore.setState({
      wsPendingReconnect: false,
      opponentLeftDuringGame: true,
    });
  },

  subscribe(cb) {
    return useMatchmakingStore.subscribe(cb);
  },
};

register<OnlineGameConnector>('gameConnector', connector);
