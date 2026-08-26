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
import { wireFieldsOf } from '../../core/protocol/wire-move';
import { JISHOGI_ANSWER_MS, useOffersStore } from '../../core/store/offers-store';
import { pieceIdListDigest, positionHash } from '../../core/engine';
import { get as pluginGet } from '../../core/plugin/registry';
import type { ReviewMessage } from '../../core/plugin/review';
import { getMomoMatchmaking } from './client';
import { sha256Hex } from './fairFlip';
import {
  checkRuleSupport,
  CLIENT_CAPABILITIES,
  isShogiMessage,
  PROTOCOL_VERSION,
  sendShogiMessage,
  ruleDigest,
  type RuleAckReason,
  type RuleSyncMsg,
  type ShogiMessage,
} from './protocol';
import type { Mgf } from '../../core/engine/mgf/types';
import { applySyncedRules, resolveCustomRuleForSync, rulesFromConfig, startGameFromSides } from './rulesSync';
import { findParticipant, isSpectator } from './roster';
import { applySpectateSync } from './spectate';
import { offerSpectateMigrate } from './spectateMigrate';
import { useMatchmakingStore } from './store';

/**
 * 感想戦の伝言を、感想戦の側へ渡す (v1.47・親 §6.3.6)。
 *
 * **通信機能から感想戦の実装を直に呼ばない**＝棋譜の機能を積んでいないビルドでは
 * 受け口が無いので、そのまま何も起きない (縮退互換)。
 */
function deliverReview(msg: ReviewMessage): void {
  pluginGet<(m: ReviewMessage) => void>('review:message')?.(msg);
}

/**
 * ★v1.55 (親 §6.8.1): **観戦者が受け取ってよい伝言**。
 *
 * ## なぜ「通すものを並べる」形にするのか
 *
 * **逆向き（危ないものを並べて弾く）は、次に伝言を足した人が書き忘れると、
 * その伝言に観戦者が反応してしまう**。実際に v1.68 で、**感想戦の打診が観戦者にも
 * 届いて観戦者が「受ける」と答えられ、本来の対局相手が置き去りにされた**
 * （2026-08-21 実機のご報告）。**振り駒のコミットも二人ぶん届いて必ず食い違い、
 * 「改ざんの疑い」の警告が出ていた。**
 *
 * こちら向きなら、**書き忘れは「観戦者に新しい表示が出ない」で済む**（軽いほう）。
 *
 * ## ここに無いもの＝観戦者には関わりの無い「二人で決める伝言」
 *
 * 先後の選択・準備完了・状態合わせ・振り駒・ルールの受領・引分/待った/再開の申し出、
 * そして**感想戦の打診と諾否**。
 */
const SPECTATOR_ALLOWED: ReadonlySet<ShogiMessage['type']> = new Set([
  // 盤を追うために要るもの
  'game_start',
  'move',
  'resign',
  'timeout',
  'spectate_sync',
  'rule_sync',
  'anomaly_raise',
  'anomaly_vote',
  'pause_notify',
  // 会話（送り分けは §6.8.5）
  'chat',
  // 感想戦の盤を追うために要るもの（打診と諾否は下の関数で弾く）
  'review',
  // ★v1.59 (段3・親 §6.8.6): 感想戦の部屋への移り先の知らせ。**観戦者だけが使う**
  // （席のある二人は自分たちで移り先を決めているので、受け取っても何もしない）。
  'review_migrate',
  // ★v1.84 (親 §4.4.1.3): 持将棋の提案と応答。**観戦者は諾否に関わらない**が、
  // **盤が止まるので「提案中」であることだけは見せる**（何も出さないと固まって見える）。
  // 立場による扱いの分けは下の case で行う。
  'jishogi_offer',
  'jishogi_response',
  // ★v1.88 (親 v1.63 §4.4.2): 入玉宣言と「選択中」。**観戦者は選ばないが、
  // 盤が止まるので「選択中」は見せ、勝ちの宣言は終局として適用する**
  // （**諾否に関わらないことと、結果を見届けられないことは別**＝第56・第57 と同じ形）。
  'nyugyoku_declare',
  'nyugyoku_prompt',
  // ★v1.90: 引き分けの主張。**諾否が無く、そのまま終局する**ので観戦者にも適用する。
  'draw_claim',
  // 生存確認
  'ping',
  'pong',
]);

/**
 * ★v1.55: いまの自分（観戦者かどうか）で、その伝言を処理してよいかを決める。
 *
 * **感想戦の伝言だけは中身で分ける**＝盤を追う伝言（`state`/`move`/`seek`/`mark`/`undo`）は
 * 要るが、**打診と諾否（`offer`/`reply`）は二人で決めるもの**なので観戦者は関わらない。
 */
function mayHandleAsSpectator(msg: ShogiMessage): boolean {
  if (!SPECTATOR_ALLOWED.has(msg.type)) return false;
  if (msg.type === 'review') {
    // ★中身は `payload` に入っている（`msg` ではない）。**名前を取り違えると
    // どの kind でも素通りし、弾いているつもりで弾けない**（検査も緑のまま通る）。
    const kind = (msg as { payload?: { kind?: string } }).payload?.kind;
    return kind !== 'offer' && kind !== 'reply';
  }
  return true;
}

export function handleShogiMessage(data: unknown, from?: string): void {
  if (!isShogiMessage(data)) return;
  const msg = data as ShogiMessage;
  // v0.48: 有効なメッセージが来た＝相手の P2P 直通が生きている証。生存タイムスタンプを更新。
  useMatchmakingStore.getState().setLastPeerMessageAt(Date.now());
  // ★v1.55: **観戦者は「二人で決める伝言」に反応しない**（上記）。
  if (isSpectator(useMatchmakingStore.getState().myRole) && !mayHandleAsSpectator(msg)) return;
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
      startGameFromSides({ hostSide: msg.hostSide, guestSide: msg.guestSide });
      useRouteStore.getState().setScreen('game');
      return;
    }
    case 'move': {
      const applied = useGameStore.getState().applyRemoteMove(wireFieldsOf(msg));
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
      // ★v1.55 (親 §6.8.5): **送り主を名簿に照らして、観戦者の発言かどうかを決める**。
      // **発言そのものに立場を書き込まない**＝書き込むと、途中で立場が変わったときに
      // 古い名札が残る。送り主が分からない相手（旧版）は従来どおり席のある人として扱う。
      const speaker = findParticipant(useMatchmakingStore.getState().roster, from);
      if (speaker && isSpectator(speaker.role)) {
        useChatStore.getState().addSpectatorMessage(speaker.name, msg.text);
        return;
      }
      // 席が入っていない発言は、送り主も分からないなら置き場所が無いので捨てる
      // （**分からないものを分かったように書かない**）。
      if (!msg.side) return;
      useChatStore.getState().addMessage(msg.side, msg.text);
      return;
    }
    case 'resign': {
      useGameStore.getState().resign(msg.side);
      return;
    }
    case 'nyugyoku_declare': {
      // ★v1.88: **観戦者にも同じ終局を適用する**（見届けられないと画面が止まる）。
      useGameStore.getState().applyRemoteNyugyoku(msg.side);
      return;
    }
    case 'nyugyoku_prompt': {
      // ★v1.88: **出すのは「選択中」の表示だけ**。盤と時計が止まるのは、
      // この印が立っていること自体から決まる（game-store 側で見ている）。
      useGameStore.getState().setNyugyokuPrompt(msg.open ? msg.side : null);
      return;
    }
    case 'draw_offer': {
      useOffersStore.getState().setDrawOfferFrom('opp');
      return;
    }
    case 'draw_claim': {
      // ★v1.90: 主張には諾否が無い。**届いたらそのまま同じ終局にする**
      //（数え直して突き合わせない＝途中から入った端末は遡れる範囲が短い）。
      useGameStore.getState().applyRemoteDrawClaim(msg.reason);
      return;
    }
    case 'jishogi_offer': {
      // ★v1.84: **観戦者には知らせるだけ**（選ばせるものが無い）。
      if (isSpectator(useMatchmakingStore.getState().myRole)) {
        useOffersStore.getState().setJishogiSpectatorNotice(true);
        return;
      }
      useOffersStore
        .getState()
        .setJishogiOfferFrom('opp', Date.now() + JISHOGI_ANSWER_MS);
      return;
    }
    case 'jishogi_response': {
      if (isSpectator(useMatchmakingStore.getState().myRole)) {
        // ★観戦者にも**結果は伝える**＝印を消すだけで終わると、**成立したのに観戦者の
        // 画面だけ対局中のまま止まる**（第56 の「追い出された側の画面が固まる」と同じ形）。
        // **諾否に関わらないことと、結果を見届けられないことは別**である。
        useOffersStore.getState().setJishogiSpectatorNotice(false);
        if (msg.accepted) useGameStore.getState().agreeJishogi();
        return;
      }
      useOffersStore.getState().setJishogiOfferFrom(null);
      // **断られたことも 10 秒経ったことも、同じ「不成立」として伝える**
      // （親 §4.4.1.3＝拒否は責められることではないので言い分けない）。
      useOffersStore.getState().setNotice('jishogi', msg.accepted ? null : 'rejected');
      if (msg.accepted) useGameStore.getState().agreeJishogi();
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
      if (client) sendShogiMessage(client, { v: PROTOCOL_VERSION, type: 'pong' });
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
      // ★段B②: **カスタムルールは定義を用意してから返事する**（公式一覧にあるものは
      // 受け取った側が自分で取りに行くので時間がかかる）。**用意できなければ必ず断る**
      // ＝黙って止まると、ホストは受領確認を永久に待つ。
      void adoptRuleSync(msg);
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
    // ★v1.56 (親 §6.3.6): 感想戦の伝言。**通信機能は中身を解釈しない**＝感想戦の画面
    // (features/kifu-replay) が受け口を registry に出しているので、**そのまま渡すだけ**。
    // v1.55 までは伝言の種類ごとに項目を書き写しており、**書き写す欄に無いものは黙って
    // 捨てられて**いた（ハイライトと、部屋を移るための合言葉が届かなかった＝
    // 2026-08-19 実機のご報告）。**数え上げる形は必ず漏れる**ので、丸ごと渡す形にした。
    // 棋譜の機能を積んでいないビルドでは受け口ごと無いので、黙って捨てられる。
    case 'spectate_sync': {
      // ★v1.55 (親 §6.8.4): 観戦者が途中から入ったので、いまの対局が丸ごと届いた。
      // **席のある者には来ない**（ホストが入ってきた観戦者ひとりに宛てて送る）。
      applySpectateSync(msg);
      return;
    }
    case 'review_migrate': {
      // ★v1.59 (段3・親 §6.8.6): 感想戦の部屋へ移るための知らせ。
      // **観戦者だけがこれで動く**＝席のある二人は自分たちのやり取りで移るので、
      // ここへ来ても何も起きない（**立場で分けず、確認を出す側が観戦者だけ**）。
      if (isSpectator(useMatchmakingStore.getState().myRole)) {
        offerSpectateMigrate(msg.room, msg.pass);
      }
      return;
    }
    case 'review':
      deliverReview(msg.payload);
      return;
    case 'pong': {
      // 生存確認 pong の受信自体は lastPeerMessageAt の更新で完結。追加処理不要。
      return;
    }
    default: {
      return;
    }
  }
}

/**
 * ★段B②: ルール同期を受けて採用するまで（親 §6.5）。
 *
 * Phase 5-12: **部屋を作った人が決めたルールをそのまま採用する**。対応可否を相談する
 * 仕組みではないので、扱えるなら黙って受け入れて確認だけ返す。
 *
 * ★**非同期にした理由**＝カスタムルールのうち**公式一覧にあるものは定義が線に乗らず、
 * 受け取った側が `rules/` から自分で取ってくる**（ユーザー判断 2026-08-25）。取ってくる
 * のは時間のかかる処理なので、**定義が揃ってから受領確認を返す**。
 *
 * ★**どの道を通っても必ず返事を出す**＝返事を出さない出口を作ると、ホストは
 * 「受領確認待ち」のまま永久に止まる（[[reference_absence_is_a_message]]）。
 */
async function adoptRuleSync(msg: RuleSyncMsg): Promise<void> {
  const client = getMomoMatchmaking();
  /** 断って止まる。**理由を添えて必ず返す**。 */
  const refuse = (reason: RuleAckReason) => {
    useMatchmakingStore.getState().setRuleSync('failed', reason);
    if (client) {
      sendShogiMessage(client, {
        v: PROTOCOL_VERSION,
        type: 'rule_ack',
        ok: false,
        digest: msg.digest,
        reason,
        capabilities: CLIENT_CAPABILITIES,
      });
    }
  };

  const support = checkRuleSupport(msg.rules);
  if (!support.ok) return refuse(support.reason);

  // ★段B②: 遊ぶための定義を用意する。ホストが配ってくれていればその場で決まり、
  // 公式一覧のルールなら取りに行く。**取ってこられなかったことは事実として返す**
  // ＝本将棋に落として続けない（部屋の札のルールと違う盤で指すことになる）。
  let resolved: Mgf | null = null;
  if (msg.rules.gameType === 'custom') {
    resolved = await resolveCustomRuleForSync(msg.rules);
    if (!resolved) return refuse('custom_rule_unavailable');
  }

  const applied = applySyncedRules(msg.rules, resolved);
  useMatchmakingStore.getState().setActiveRoomConfig(applied);
  // v1.22: 未確定駒の見せ方は「部屋の値」として受け取る。自分の画面の値は残したまま、
  // 部屋が重ねなら実際の見え方だけ重ねへ落とす (spec 駒UI v0.8 §4.4)。
  useGameStore.getState().applyRoomQuantumDisplay(applied.quantumDisplayMode);
  // 量子の実行時パラメータは両者の計算結果を左右するので、ホストの値に揃える
  // (v1.19 の申し送り: デバッグパネルで片側だけ変えると局面がずれる)。
  useGameStore.getState().setQuantumParams(msg.rules.quantumParams);
  // ★v1.55 (親 §6.8.1): **観戦者は受領の返事をしない**。
  // ルール同期は既定の宛先（自分以外の全員）で流れるので観戦者にも届くが、
  // **観戦者は正しさの担保に加わらない**＝ここで返すと、ホストは
  // 「ゲストが構えた」と取り違え、席がまだ空でも対局を始められる状態に見える。
  // **受け取ったルールを自分の盤に入れるのは観戦者にも要る**ので、そこは通す。
  if (client && !isSpectator(useMatchmakingStore.getState().myRole)) {
    sendShogiMessage(client, {
      v: PROTOCOL_VERSION,
      type: 'rule_ack',
      ok: true,
      // 受け取った値をそのまま返すのではなく、自分が採用した設定から作り直す。
      // 途中で欠けた項目があればここで違いが出る (古い版が知らない項目を捨てた等)。
      // ★段B②: **中身の印も自分の定義から作り直す**＝公式一覧から取ってきた定義が
      // ホストのものと違えば（相手のほうが新しい `rules/` を持っている等）、
      // ここで食い違いとして表に出る。
      digest: ruleDigest(rulesFromConfig(applied)),
      pieceIdListHash: applied.quantum
        ? pieceIdListDigest(useGameStore.getState().mgf)
        : undefined,
      capabilities: CLIENT_CAPABILITIES,
    });
  }
  useMatchmakingStore.getState().setRuleSync('ok');
}
