/**
 * P2P で受信したゲームメッセージを type 別に処理する dispatcher。
 *
 * LobbyScreen の onMessage コールバックからここに転送される。
 * 各ハンドラは store の setState と、必要なら画面遷移を行う。
 *
 * 段階 2-5.1（S06 対局準備画面のハンドシェイク）:
 * - side_select    → oppSideChoice を更新
 * - ready          → oppReady を更新
 * - state_sync     → oppSideChoice / oppReady をまとめて更新
 * - furigoma_result → 振り駒結果を反映（両者同期）
 * - game_start     → gameStartInfo を確定して S07 対局画面へ遷移
 *
 * 段階 2-5.2（S07 対局中の着手送受信）:
 * - move           → 相手の着手を game-store に適用
 *
 * Phase 5-12 v1.20（ルール同期・親 §6.5）:
 * - rule_sync      → ゲスト側。ホストが決めたルールを採用して rule_ack を返す
 * - rule_ack       → ホスト側。ゲストが同じルールで構えたかを照合する
 *
 * 知らない type や不正な形式は黙って無視（フォワード互換）。
 */

import { useChatStore } from '../../core/store/chat-store';
import { useRouteStore } from '../../core/store/route-store';
import { useGameStore } from '../../core/store/game-store';
import { useOffersStore } from '../../core/store/offers-store';
import { handicapSettingFor, pieceIdListDigest, positionHash } from '../../core/engine';
import { getMomoMatchmaking } from './client';
import { sha256Hex } from './fairFlip';
import {
  checkRuleSupport,
  CLIENT_CAPABILITIES,
  isShogiMessage,
  PROTOCOL_VERSION,
  ruleDigest,
  type ShogiMessage,
  type SyncedRules,
} from './protocol';
import { DEFAULT_ROOM_CONFIG, useMatchmakingStore, type RoomConfig } from './store';

/**
 * Phase 5-12: 受け取ったルールを自分の部屋設定に流し込む。
 *
 * 部屋名は自分が既に持っているもの (サーバー経由で先に届いている) を残す。ルール同期が
 * 運ぶのはルールだけで、部屋の呼び名は同期の対象ではないため。
 */
function applySyncedRules(rules: SyncedRules): RoomConfig {
  const base = useMatchmakingStore.getState().activeRoomConfig ?? DEFAULT_ROOM_CONFIG;
  return {
    ...base,
    gameType: rules.gameType,
    torus: rules.torusMode !== 'none',
    torusMode: rules.torusMode,
    quantum: rules.quantum,
    quantumDisplayMode: rules.quantumDisplayMode,
    customRuleName: rules.customRuleName,
    timeControl: rules.timeControl,
    // v1.33: 手合いも部屋のルールの一部。席は送り手 (ホスト) から見た向きのまま持つ。
    handicap: rules.handicap ?? null,
  };
}

/** 自分が採用した設定から、送られてきたのと同じ形のルール一式を組み立て直す。 */
function rulesFromConfig(cfg: RoomConfig): SyncedRules {
  return {
    gameType: cfg.gameType,
    torusMode: cfg.torusMode,
    quantum: cfg.quantum,
    quantumDisplayMode: cfg.quantumDisplayMode,
    timeControl: cfg.timeControl,
    handicap: cfg.handicap,
    customRuleName: cfg.customRuleName,
    quantumParams: useGameStore.getState().quantumParams,
  };
}

export function handleShogiMessage(data: unknown): void {
  if (!isShogiMessage(data)) return;
  const msg = data as ShogiMessage;
  // v0.48: 有効なメッセージが来た＝相手の P2P 直通が生きている証。生存タイムスタンプを更新。
  useMatchmakingStore.getState().setLastPeerMessageAt(Date.now());
  switch (msg.type) {
    case 'side_select': {
      // 相手の選択変更 → 相手の準備完了は解除
      // 加えて、両者おまかせが崩れる変更なら振り駒結果もリセット
      const state = useMatchmakingStore.getState();
      const nextPatch: {
        oppSideChoice: typeof msg.choice;
        oppReady: boolean;
        furigomaResult?: null;
      } = {
        oppSideChoice: msg.choice,
        oppReady: false,
      };
      if (state.furigomaResult && (state.mySideChoice !== 'random' || msg.choice !== 'random')) {
        nextPatch.furigomaResult = null;
      }
      useMatchmakingStore.setState(nextPatch);
      return;
    }
    case 'ready': {
      useMatchmakingStore.setState({ oppReady: msg.ready });
      return;
    }
    case 'state_sync': {
      useMatchmakingStore.setState({ oppSideChoice: msg.choice, oppReady: msg.ready });
      return;
    }
    case 'furigoma_result': {
      // v0.53: 旧方式 (ホスト任せの振り駒結果)。互換のため受信は残置するが、
      //   新クライアントは furigoma_commit + furigoma_reveal を優先する。
      //   旧クライアントとの通信でここに来た場合は結果をそのまま採用する。
      useMatchmakingStore.setState({
        furigomaResult: { faceUps: msg.faceUps, hostIsSente: msg.hostIsSente },
      });
      return;
    }
    case 'furigoma_commit': {
      // v0.53: 相手のコミットを受信 (相手の nonce のハッシュ)。まだ nonce は明かされていない。
      useMatchmakingStore.getState().setOppFurigomaCommit(msg.commit);
      return;
    }
    case 'furigoma_reveal': {
      // v0.53: 相手のリビール (nonce 平文) 受信。ハッシュ検証してから採用する。
      //   検証成功: oppFurigomaNonce を保存 → RoomScreen 側の useEffect が結果計算
      //   検証失敗: furigomaError を立てる (両者のコミットが揃っていないケースはあり得ない)
      const state = useMatchmakingStore.getState();
      const oppCommit = state.oppFurigomaCommit;
      if (!oppCommit) {
        state.setFurigomaError('リビールがコミットより先に届きました (プロトコル違反)');
        return;
      }
      sha256Hex(msg.nonce).then((computed) => {
        const s = useMatchmakingStore.getState();
        if (computed !== oppCommit) {
          s.setFurigomaError('相手の乱数がコミットと不一致です (改ざんの疑い)');
          return;
        }
        s.setOppFurigomaNonce(msg.nonce);
      });
      return;
    }
    case 'game_start': {
      useMatchmakingStore.setState({
        gameStartInfo: { hostSide: msg.hostSide, guestSide: msg.guestSide },
      });
      const cfg = useMatchmakingStore.getState().activeRoomConfig;
      if (cfg?.timeControl) useGameStore.getState().setTimeControl(cfg.timeControl);
      // v0.90: 量子 ON の部屋なら初期候補集合を割り当てる (Phase 5-2)。
      // オフライン側と揃えるため、game_start を受けたタイミングで盤面を初期化する。
      // v1.08 (Phase 5-11): 未確定駒の見せ方 (qtdisp) は部屋のルールの一部なので、
      // ホストの選択をゲスト側にも「部屋の値」として適用する (spec 駒UI v0.8 §4.4)。
      // v1.22: 部屋の値が巡回なら、実際の見え方は各自の画面の値になる。
      // v1.25 (Phase 4): 盤の端のつなぎ方も部屋のルールの一部。ホスト・ゲスト・観戦者が
      // 同じ盤で始まらないと、同じ手が片方だけ非合法になって局面がずれる。
      useGameStore.getState().reset({
        // Phase 6: 部屋のルール (本将棋 / はさみ将棋)。ホストが決めた種類がルール同期で
        // 届いているので、対戦者も観戦者も同じルール定義で盤を作る。
        gameType: cfg?.gameType ?? 'shogi',
        // v1.33: ネット対戦でも手合いを使う (親 v1.28 §3.12.1)。上手＝先手＝player1 で、
        // 誰がその席に座るかは部屋の先後の確定値 (駒落ちなら自動確定) が受け持つ。
        // 平手なら null が渡り、直前の対AI対局の手合いを引きずらない。
        handicap: handicapSettingFor(cfg?.handicap ?? null),
        quantum: cfg?.quantum ?? false,
        quantumDisplay: cfg?.quantumDisplayMode ?? 'cycle',
        torusMode: cfg?.torusMode ?? 'none',
      });
      useRouteStore.getState().setScreen('game');
      return;
    }
    case 'move': {
      const applied = useGameStore.getState().applyRemoteMove({
        kind: msg.kind,
        pieceId: msg.pieceId,
        from: msg.from,
        to: msg.to,
        promote: msg.promote,
      });
      if (applied && msg.time) {
        const nextSide = useGameStore.getState().position.sideToMove;
        const moverSide: 'player1' | 'player2' = nextSide === 'player1' ? 'player2' : 'player1';
        useGameStore.getState().syncClock(moverSide, {
          mainMs: msg.time.mainMs,
          byoyomiMs: msg.time.byoyomiMs,
          inByoyomi: msg.time.inByoyomi,
        });
      }
      // v0.52 (段階 2-6): 局面ハッシュ相互検証。相手が送ってきたハッシュと
      // 自分側が着手適用後に計算したハッシュを照合。一致しなければ両者の盤面が
      // ズレている (バグや通信ミスの兆候) → 対局中止して警告モーダルへ。
      // msg.hash が省略されている旧クライアント相手には照合をスキップする。
      if (applied && typeof msg.hash === 'string') {
        const myHash = positionHash(useGameStore.getState().position);
        if (myHash !== msg.hash) {
          // eslint-disable-next-line no-console
          console.warn('[shogi] 局面ハッシュ不一致を検知:', { received: msg.hash, computed: myHash });
          useMatchmakingStore.setState({
            opponentLeftDuringGame: true,
            errorMessage: '盤面同期がずれました。対局を中断します。',
          });
        }
      }
      return;
    }
    case 'timeout': {
      useGameStore.getState().timeout(msg.side);
      return;
    }
    case 'chat': {
      useChatStore.getState().addMessage(msg.side, msg.text);
      return;
    }
    case 'resign': {
      useGameStore.getState().resign(msg.side);
      return;
    }
    case 'draw_offer': {
      useOffersStore.getState().setDrawOfferFrom('opp');
      return;
    }
    case 'draw_response': {
      useOffersStore.getState().setDrawOfferFrom(null);
      useOffersStore.getState().setNotice('draw', msg.accepted ? null : 'rejected');
      if (msg.accepted) useGameStore.getState().agreeDraw();
      return;
    }
    case 'draw_cancel': {
      // 相手が引分申し出を撤回（v0.42）
      useOffersStore.getState().setDrawOfferFrom(null);
      useOffersStore.getState().setNotice('draw', 'cancelled');
      return;
    }
    case 'undo_offer': {
      // 相手からの待った申し出（v0.42：count / challengerSide 付き）
      useOffersStore.getState().setUndoOfferFrom('opp', {
        count: msg.count,
        challengerSide: msg.challengerSide,
      });
      return;
    }
    case 'undo_response': {
      // 自分が申し出た待ったへの相手の応答（v0.42）
      // 承諾時は「承諾者の時計だけ復元」＝申し出者側は penalty で保持
      const meta = useOffersStore.getState().undoOfferMeta;
      useOffersStore.getState().setUndoOfferFrom(null);
      useOffersStore.getState().setNotice('undo', msg.accepted ? null : 'rejected');
      if (msg.accepted && meta) {
        const restoreSide: 'player1' | 'player2' =
          meta.challengerSide === 'player1' ? 'player2' : 'player1';
        useGameStore.getState().undoLastMove(meta.count, { restoreClockForSide: restoreSide });
      }
      return;
    }
    case 'undo_cancel': {
      // 相手が待った申し出を撤回（v0.42）
      useOffersStore.getState().setUndoOfferFrom(null);
      useOffersStore.getState().setNotice('undo', 'cancelled');
      return;
    }
    case 'pause_notify': {
      // 相手が一時中断（v0.42：合意不要）→ 自分側も即中断
      useGameStore.getState().pauseGame();
      useOffersStore.getState().setNotice('pause', 'cancelled'); // 「相手が中断」を告知
      return;
    }
    case 'resume_offer': {
      useOffersStore.getState().setResumeOfferFrom('opp');
      return;
    }
    case 'resume_response': {
      useOffersStore.getState().setResumeOfferFrom(null);
      useOffersStore.getState().setNotice('resume', msg.accepted ? null : 'rejected');
      if (msg.accepted) useGameStore.getState().resumeGame();
      return;
    }
    case 'ping': {
      // v0.48: 相手からの生存確認 ping。即 pong を返す。
      const client = getMomoMatchmaking();
      if (client) client.send({ v: PROTOCOL_VERSION, type: 'pong' });
      return;
    }
    case 'anomaly_raise': {
      // v1.15: 相手側で異常が起きた。デバッグで故意に起こしたものなら、同じ操作を
      // 自分の盤にも実行して両者の盤を揃える (走査の手順が決まっているので結果は同じ)。
      if (msg.debugForce) {
        useGameStore.getState().debugForceAnomaly(msg.debugForce, true);
      } else {
        useGameStore.getState().raiseAnomaly(msg.cause, true);
      }
      return;
    }
    case 'anomaly_vote': {
      // Phase 5-13: 相手の投票。「ノーゲーム」なら game-store 側で即座に不成立になる。
      useGameStore.getState().receiveAnomalyVote(msg.choice);
      return;
    }
    case 'rule_sync': {
      // Phase 5-12 (親 §6.5): ゲスト側。部屋を作った人が決めたルールをそのまま採用する。
      // 対応可否を相談する仕組みではないので、扱えるなら黙って受け入れて確認だけ返す。
      const client = getMomoMatchmaking();
      const support = checkRuleSupport(msg.rules);
      if (!support.ok) {
        useMatchmakingStore.getState().setRuleSync('failed', support.reason);
        if (client) {
          client.send({
            v: PROTOCOL_VERSION,
            type: 'rule_ack',
            ok: false,
            digest: msg.digest,
            reason: support.reason,
            capabilities: CLIENT_CAPABILITIES,
          });
        }
        return;
      }
      const applied = applySyncedRules(msg.rules);
      useMatchmakingStore.getState().setActiveRoomConfig(applied);
      // v1.22: 未確定駒の見せ方は「部屋の値」として受け取る。自分の画面の値は残したまま、
      // 部屋が重ねなら実際の見え方だけ重ねへ落とす (spec 駒UI v0.8 §4.4)。
      useGameStore.getState().applyRoomQuantumDisplay(applied.quantumDisplayMode);
      // 量子の実行時パラメータは両者の計算結果を左右するので、ホストの値に揃える
      // (v1.19 の申し送り: デバッグパネルで片側だけ変えると局面がずれる)。
      useGameStore.getState().setQuantumParams(msg.rules.quantumParams);
      if (client) {
        client.send({
          v: PROTOCOL_VERSION,
          type: 'rule_ack',
          ok: true,
          // 受け取った値をそのまま返すのではなく、自分が採用した設定から作り直す。
          // 途中で欠けた項目があればここで違いが出る (古い版が知らない項目を捨てた等)。
          digest: ruleDigest(rulesFromConfig(applied)),
          pieceIdListHash: applied.quantum
            ? pieceIdListDigest(useGameStore.getState().mgf)
            : undefined,
          capabilities: CLIENT_CAPABILITIES,
        });
      }
      useMatchmakingStore.getState().setRuleSync('ok');
      return;
    }
    case 'rule_ack': {
      // Phase 5-12 (親 §6.5.2): ホスト側。ゲストが本当に同じルールで構えたかを確かめる。
      const store = useMatchmakingStore.getState();
      if (!msg.ok) {
        store.setRuleSync('failed', msg.reason ?? 'unsupported_game_type');
        return;
      }
      const cfg = store.activeRoomConfig;
      if (!cfg) return;
      const myDigest = ruleDigest(rulesFromConfig(cfg));
      if (myDigest !== msg.digest) {
        // eslint-disable-next-line no-console
        console.warn('[shogi] ルール同期の食い違い:', { mine: myDigest, theirs: msg.digest });
        store.setRuleSync('failed', 'rule_digest_mismatch');
        return;
      }
      // 駒の身元の並びは量子 ON のときだけ突き合わせる (§6.5.2)。相手が返してこない
      // 場合 (量子 OFF / 旧クライアント) は照合を飛ばす。
      if (cfg.quantum && typeof msg.pieceIdListHash === 'string') {
        const myPieceIds = pieceIdListDigest(useGameStore.getState().mgf);
        if (myPieceIds !== msg.pieceIdListHash) {
          // eslint-disable-next-line no-console
          console.warn('[shogi] 駒の身元の並びが不一致:', { mine: myPieceIds, theirs: msg.pieceIdListHash });
          store.setRuleSync('failed', 'pieceid_hash_mismatch');
          return;
        }
      }
      store.setRuleSync('ok');
      return;
    }
    case 'pong': {
      // 生存確認 pong の受信自体は lastPeerMessageAt の更新で完結。追加処理不要。
      return;
    }
    default: {
      return;
    }
  }
}
