import { useEffect, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { ChatConsole } from '../../../core/ui-core/ChatConsole';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { getMomoMatchmaking } from '../client';
import { decodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { useGameStore } from '../../../core/store/game-store';
import { useMatchmakingStore, type SideChoice, type SideSelection } from '../store';
import { hasSeat, isSpectator, spectatorsOf } from '../roster';
import { CLIENT_CAPABILITIES, PROTOCOL_VERSION, ruleDigest, sendShogiMessage, type ShogiMessage, type SyncedRules } from '../protocol';
import { handleShogiMessage } from '../messageDispatcher';
import { deriveFurigoma, generateNonce, sha256Hex } from '../fairFlip';
import { seFurigoma, seButton } from '../../../core/audio/se-synth';

/**
 * S06 対局準備画面（段階 2-5.1 で S05 ホスト待機と統合、
 * 段階 2-5.1a で相手選択の可視化と振り駒同期を追加）。
 *
 * モック momo_shogi_S05_mock_v1.html の構造・スタイル・翻訳データを
 * verbatim にコピーして持ち込む。
 *
 * 段階 2-5.1a の追加ロジック:
 * - 各先後カードに「自分」「相手」の選択マーク（左上・右上）を独立表示
 * - 両者「おまかせ」が揃った時のみ振り駒アニメを発動
 *   （v0.53 段階 2-5.3 で「コミット & リビール方式」に置き換え: 両者が
 *   それぞれ乱数を生成し、ハッシュを先に交換 → 乱数本体を交換 → 検証 OK
 *   なら合成して結果決定。どちらも相手の乱数を見てから自分の乱数を変えられない）
 * - 準備完了ボタンは、両者おまかせ + 振り駒結果未確定なら無効
 * - 選択変更で自分の準備完了は自動解除、相手の準備完了は受信時に解除
 */
/** Phase 5-12: ルール同期の 1 段分の見た目 (CSS のクラス名と同じ語)。 */
type SyncStepState = 'wait' | 'active' | 'done' | 'fail';

function syncIcon(state: SyncStepState): string {
  if (state === 'done') return '✓';
  if (state === 'fail') return '!';
  if (state === 'active') return '⋯';
  return '·';
}

function syncStateKey(state: SyncStepState): string {
  if (state === 'done') return 's06.stDone';
  if (state === 'fail') return 's06.stFail';
  if (state === 'active') return 's06.stActive';
  return 's06.stWait';
}

export function RoomScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const isHost = useMatchmakingStore((s) => s.isHost);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const opponentName = useMatchmakingStore((s) => s.opponentName);
  /**
   * ★v1.55 (親 §6.8.3): 自分は観戦者か。**見るだけ**なので、先後も準備完了も出さない。
   * **`!hasSeat()` と書かない**＝立場が分かっていないときまで観戦者になってしまう。
   */
  const myRole = useMatchmakingStore((s) => s.myRole);
  const spectating = isSpectator(myRole);
  /** ★v1.55: 参加者名簿（付録D-7 v1.1 §4.1 の参加者カードが読む）。 */
  const roster = useMatchmakingStore((s) => s.roster);
  const seatNames = useMatchmakingStore((s) => s.seatNames);
  const spectateWaiting = useMatchmakingStore((s) => s.spectateWaiting);
  const currentRoomName = useMatchmakingStore((s) => s.currentRoomName);
  const activeRoomConfig = useMatchmakingStore((s) => s.activeRoomConfig);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const resetRoomState = useMatchmakingStore((s) => s.resetRoomState);

  const mySideChoice = useMatchmakingStore((s) => s.mySideChoice);
  const oppSideChoice = useMatchmakingStore((s) => s.oppSideChoice);
  const myReady = useMatchmakingStore((s) => s.myReady);
  const oppReady = useMatchmakingStore((s) => s.oppReady);
  const furigomaResult = useMatchmakingStore((s) => s.furigomaResult);
  const myFurigomaNonce = useMatchmakingStore((s) => s.myFurigomaNonce);
  const myFurigomaCommit = useMatchmakingStore((s) => s.myFurigomaCommit);
  const oppFurigomaCommit = useMatchmakingStore((s) => s.oppFurigomaCommit);
  const oppFurigomaNonce = useMatchmakingStore((s) => s.oppFurigomaNonce);
  const myFurigomaRevealed = useMatchmakingStore((s) => s.myFurigomaRevealed);
  const furigomaError = useMatchmakingStore((s) => s.furigomaError);
  const setMySideChoice = useMatchmakingStore((s) => s.setMySideChoice);
  const setMyReady = useMatchmakingStore((s) => s.setMyReady);
  const setFurigomaResult = useMatchmakingStore((s) => s.setFurigomaResult);
  const setMyFurigomaCommit = useMatchmakingStore((s) => s.setMyFurigomaCommit);
  const setMyFurigomaRevealed = useMatchmakingStore((s) => s.setMyFurigomaRevealed);
  const resetFurigoma = useMatchmakingStore((s) => s.resetFurigoma);
  const resetHandshake = useMatchmakingStore((s) => s.resetHandshake);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  const oppPresent = !!opponentName;

  // 振り駒アニメ再生中フラグ（結果が新しく確定した瞬間から 1 秒間）
  const [furigomaSpinning, setFurigomaSpinning] = useState(false);

  // v0.72 音響: 振り駒アニメが始まった瞬間に振り駒音を鳴らす
  useEffect(() => {
    if (furigomaSpinning) seFurigoma();
  }, [furigomaSpinning]);

  // 送信ユーティリティ
  const sendMsg = (msg: ShogiMessage) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    // ★v1.53: 生の送信は使わない（包みに入れないと `from`/`to` が土台に上書きされる）。
    sendShogiMessage(client, msg);
  };

  // 相手が入室してきた瞬間に自分の現在状態を送る（キャッチアップ用）
  useEffect(() => {
    if (!oppPresent) return;
    sendMsg({ v: PROTOCOL_VERSION, type: 'state_sync', choice: mySideChoice, ready: myReady });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppPresent]);

  // Phase 5-12 (親 §6.5): 相手が入室したらホストがルール定義を送る。
  // 一方向 — 部屋を作った人が決めたルールを対戦相手に揃えてもらう仕組みで、
  // 相談ではない。ゲストは受け取って採用し、受領確認だけを返す。
  useEffect(() => {
    if (!oppPresent || !isHost) return;
    // 送る口が無いときは「送信済み」にしない。ここを素通しにすると、実際には
    // 何も出ていないのに画面だけ「受領確認待ち」で止まって見える。
    if (!getMomoMatchmaking()) return;
    const cfg = useMatchmakingStore.getState().activeRoomConfig;
    if (!cfg) return;
    const rules: SyncedRules = {
      gameType: cfg.gameType,
      torusMode: cfg.torusMode,
      quantum: cfg.quantum,
      quantumDisplayMode: cfg.quantumDisplayMode,
      timeControl: cfg.timeControl,
      customRuleName: cfg.customRuleName,
      quantumParams: useGameStore.getState().quantumParams,
      // v1.33: 手合いも部屋のルールの一部。席はこちら (部屋を作った側) から見た向きで送る。
      handicap: cfg.handicap,
    };
    sendMsg({
      v: PROTOCOL_VERSION,
      type: 'rule_sync',
      rules,
      digest: ruleDigest(rules),
      capabilities: CLIENT_CAPABILITIES,
    });
    useMatchmakingStore.getState().setRuleSync('sent');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppPresent, isHost]);

  // ゲスト退室でホストは待機表示に戻る（相手行が「入室待ち」に戻る）
  // また、ゲスト退室時にハンドシェイク状態はリセット（再入室で新規開始）
  useEffect(() => {
    if (isHost && !opponentName) {
      resetHandshake();
    }
  }, [isHost, opponentName, resetHandshake]);

  // Phase 5-12: ルール同期の進み具合。v0.67 A5 で置いた見せかけの表示 (常に「完了」)
  // をここで本物のメッセージフローに差し替えた。
  const ruleSyncPhase = useMatchmakingStore((s) => s.ruleSyncPhase);
  // 1・2 段目 (送信とモディファイア) は同じ 1 通で運ぶので状態を共有する。
  // 3 段目 (相手の対応確認) だけが受領確認の到着を待つ。
  const syncStep12: SyncStepState = ruleSyncPhase === 'idle' ? 'wait' : 'done';
  const syncStep3: SyncStepState =
    ruleSyncPhase === 'ok' ? 'done'
    : ruleSyncPhase === 'failed' ? 'fail'
    : ruleSyncPhase === 'sent' ? 'active'
    : 'wait';

  // v0.67 A6: 相手が退室したときの警告帯 (部屋は維持)
  // 一度でも相手が入室していた状態から相手不在に戻ったら oppLeftWarn を立てる。
  // 新しい相手が入室したら自動でクリア。
  const [oppLeftWarn, setOppLeftWarn] = useState(false);
  const hadOpponentRef = useRef(false);
  useEffect(() => {
    if (opponentName) {
      hadOpponentRef.current = true;
      setOppLeftWarn(false);
    } else if (hadOpponentRef.current) {
      setOppLeftWarn(true);
    }
  }, [opponentName]);

  // v0.67 A6: 入室タイムアウト警告 (60 秒経っても相手不在ならバナー表示)
  const [oppTimeoutWarn, setOppTimeoutWarn] = useState(false);
  useEffect(() => {
    if (opponentName) {
      setOppTimeoutWarn(false);
      return;
    }
    const id = setTimeout(() => setOppTimeoutWarn(true), 60_000);
    return () => clearTimeout(id);
  }, [opponentName]);

  // v0.53: 振り駒の検証エラーが起きたら errorMessage に流す (画面上部の帯に表示)
  useEffect(() => {
    if (furigomaError) {
      useMatchmakingStore.getState().setError(furigomaError);
    }
  }, [furigomaError]);

  // v0.53 段階 2-5.3: 公平な振り駒 (コミット & リビール 3 段階)
  //
  // 段階 1: 両者「おまかせ」検知 → 各自 nonce を生成しコミット (SHA-256) を送信
  useEffect(() => {
    if (mySideChoice !== 'random' || oppSideChoice !== 'random') return;
    if (myFurigomaCommit) return; // 既にコミット済み
    (async () => {
      const nonce = generateNonce();
      const commit = await sha256Hex(nonce);
      setMyFurigomaCommit(nonce, commit);
      sendMsg({ v: PROTOCOL_VERSION, type: 'furigoma_commit' as const, commit });
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySideChoice, oppSideChoice, myFurigomaCommit]);

  // 段階 2: 両者のコミットが揃った → 自分の nonce を平文で送信 (リビール)
  useEffect(() => {
    if (!myFurigomaCommit || !oppFurigomaCommit) return;
    if (myFurigomaRevealed) return; // 二重送信防止
    if (!myFurigomaNonce) return;
    setMyFurigomaRevealed(true);
    sendMsg({ v: PROTOCOL_VERSION, type: 'furigoma_reveal' as const, nonce: myFurigomaNonce });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myFurigomaCommit, oppFurigomaCommit, myFurigomaRevealed, myFurigomaNonce]);

  // 段階 3: 両者の nonce (自分の＋検証済み相手) が揃った → 結果を導出
  //   相手 nonce の検証 (SHA-256 一致) は messageDispatcher 側で済み。
  //   ここでは XOR で合成し 5 コマの表裏と hostIsSente を決めるだけ。
  useEffect(() => {
    if (!myFurigomaNonce || !oppFurigomaNonce) return;
    if (furigomaResult) return; // 既に導出済み
    // 導出は決定的なので両者で同じ結果になる
    const isHostVal = isHost;
    // deriveFurigoma は「先に渡した nonce の持ち主が sente か」ではなく、
    // 「両 nonce の合成の 5 bit で face-up 過半なら hostIsSente」を返す。
    // 両側で「ホスト」の解釈を揃える必要があるので、順序ではなくホスト/ゲスト側で
    // nonce の役割を統一する: 先の引数 = ホストの nonce にする。
    const hostNonce = isHostVal ? myFurigomaNonce : oppFurigomaNonce;
    const guestNonce = isHostVal ? oppFurigomaNonce : myFurigomaNonce;
    const derived = deriveFurigoma(hostNonce, guestNonce);
    setFurigomaResult(derived);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myFurigomaNonce, oppFurigomaNonce, furigomaResult, isHost]);

  // 振り駒結果が新しく確定 → アニメを 1 秒間再生
  useEffect(() => {
    if (!furigomaResult) {
      setFurigomaSpinning(false);
      return;
    }
    setFurigomaSpinning(true);
    const timer = setTimeout(() => setFurigomaSpinning(false), 1000);
    return () => clearTimeout(timer);
  }, [furigomaResult]);

  // 選択が「両者おまかせ」以外に変化したら、振り駒関連の一切をリセット
  //   (旧振り駒結果だけでなく nonce/commit/reveal も含む。次回また両者おまかせに
  //    戻ったら段階 1 からやり直し)
  useEffect(() => {
    if (mySideChoice !== 'random' || oppSideChoice !== 'random') {
      resetFurigoma();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySideChoice, oppSideChoice]);

  // v0.62: 明示的な合意 (sente+gote / gote+sente / random+random+結果) のみ Ready 可能。
  // 混合パターン (sente+random 等) は「合意ができていない」ので Ready 不可。
  const canReady = (() => {
    if (!oppPresent) return false;
    // Phase 5-12: ルールが揃わなかったことが分かっているときだけ準備完了を止める。
    // 「まだ返事が来ていない」では止めない — 相手が旧クライアントだと受領確認を返さず、
    // 待ち続けると永久に対局を始められなくなるため。
    if (ruleSyncPhase === 'failed') return false;
    if (mySideChoice === null || oppSideChoice === null) return false;
    // 明示的な相互合意
    if (mySideChoice === 'sente' && oppSideChoice === 'gote') return !furigomaSpinning;
    if (mySideChoice === 'gote' && oppSideChoice === 'sente') return !furigomaSpinning;
    // 両者おまかせ (振り駒結果が出た後だけ Ready 可)
    if (mySideChoice === 'random' && oppSideChoice === 'random' && furigomaResult && !furigomaSpinning) return true;
    // 同側衝突 / 明示 × random の混合 / random+random 未決着 は合意なし
    return false;
  })();
  const readyDisabled = !canReady && !myReady;

  // 両者準備完了 → ホストが先後を確定して game_start を送信
  useEffect(() => {
    if (!myReady || !oppReady) return;
    if (!isHost) return;
    const hostChoice = mySideChoice;
    const guestChoice = oppSideChoice;
    const { hostSide, guestSide } = resolveSides(hostChoice, guestChoice, furigomaResult);
    const msg = { v: PROTOCOL_VERSION, type: 'game_start' as const, hostSide, guestSide };
    sendMsg(msg);
    // v0.35: ホストも dispatcher 経由で処理してゲスト側と同じロジックを通す。
    // これにより持ち時間 setTimeControl 等の副作用がホストにも適用される。
    handleShogiMessage(msg);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myReady, oppReady, isHost]);

  const onLeave = () => {
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    // ★v1.55: 観戦者は**入ってきた場所へ戻す**＝観戦ロビー (S13)。
    // 対局のロビー (S04) へ戻すと、見に来ただけの人が部屋を建てる画面に着地する。
    const backTo = spectating ? 'spectate-lobby' : 'net-lobby';
    resetRoomState();
    setScreen(backTo);
  };

  /**
   * v1.33: 駒落ちの部屋では先後が手合いから決まる (親 v1.28 §3.12.1)。
   *
   * 上手＝先手なので、**落とす席の人が先手**。手合いの席は部屋を作った側から見た向きで
   * 届くので、ゲスト側は反転して読む。平手なら null＝従来どおり自分で選ぶ。
   */
  const lockedSide: SideChoice | null = (() => {
    const hc = activeRoomConfig?.handicap;
    if (!hc) return null;
    const hostGivesOdds = hc.giver === 'self';
    const iGiveOdds = isHost ? hostGivesOdds : !hostGivesOdds;
    return iGiveOdds ? 'sente' : 'gote';
  })();

  // 決まった側を「選ばれた状態」にして送る。画面は消さず、押せなくするだけ (付録D-5 v1.4 §4.3)。
  useEffect(() => {
    if (!lockedSide) return;
    if (mySideChoice === lockedSide) return;
    setMySideChoice(lockedSide);
    sendMsg({ v: PROTOCOL_VERSION, type: 'side_select', choice: lockedSide });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedSide, mySideChoice]);

  const onPickSide = (choice: SideChoice) => {
    if (lockedSide) return; // 駒落ちのあいだは変えられない
    setMySideChoice(choice);
    // 選択変更で自分の準備完了は自動解除（もし押していた場合）
    if (myReady) {
      setMyReady(false);
      sendMsg({ v: PROTOCOL_VERSION, type: 'ready', ready: false });
    }
    sendMsg({ v: PROTOCOL_VERSION, type: 'side_select', choice });
  };

  const onToggleReady = () => {
    seButton(); // v0.74
    if (readyDisabled) return;
    const next = !myReady;
    setMyReady(next);
    sendMsg({ v: PROTOCOL_VERSION, type: 'ready', ready: next });
  };

  const parts = decodeRoomName(currentRoomName || '');

  const timeLabel = (() => {
    if (!activeRoomConfig) return '';
    const tc = activeRoomConfig.timeControl;
    const min = Math.floor(tc.mainSeconds / 60);
    const minU = t('time.min');
    const secU = t('time.sec');
    switch (tc.mode) {
      case 'byoyomi':
        return `${t('s04.timeByoyomi')} ${min}${minU} + ${tc.byoyomiSeconds}${secU}`;
      case 'sudden_death':
        return `${t('s04.timeBoth')} ${min}${minU}`;
      case 'fischer':
        return `${t('s04.timeIncrement')} ${min}${minU} + ${tc.incrementSeconds}${secU}`;
      case 'no_limit':
        return t('s04.timeFree');
    }
  })();

  /**
   * ★v1.55 (付録D-7 v1.1 §4.1): 参加者カードに並べる行。
   * **席のある者が先、観戦者があと**。数え上げて 2 行に決め打たない。
   */
  const seatedRows = roster.filter((p) => hasSeat(p.role));
  const watchers = spectatorsOf(roster);

  // 自分の役割（ホスト/ゲスト）と相手の役割
  const myRoleLabel = isHost ? t('s06.roleHost') : t('s06.roleGuest');
  const oppRoleLabel = isHost ? t('s06.roleGuest') : t('s06.roleHost');

  // 振り駒枠を表示するか（両者「おまかせ」時のみ）
  const showFurigoma = mySideChoice === 'random' && oppSideChoice === 'random';

  // v0.62: 明示的な合意のみ resolved と扱う。以下の 3 パターンだけ myEffectiveSide が確定:
  //   - sente + gote / gote + sente (両者が異なる明示側を選択)
  //   - random + random + 振り駒結果 (両者おまかせ + 決着済み)
  // それ以外 (同側衝突・明示×random の混合・両random 未決着) は「合意成立せず」で null。
  //
  // 変更前 (v0.61): mySide=sente と oppSide=random でも即 sente resolved にしていたが、
  // ユーザー指摘「片方が明示・もう片方が random は合意になっていない」を受けて厳格化した。
  const myEffectiveSide: 'sente' | 'gote' | null = (() => {
    if (mySideChoice === null || oppSideChoice === null) return null;
    if (mySideChoice === 'sente' && oppSideChoice === 'gote') return 'sente';
    if (mySideChoice === 'gote' && oppSideChoice === 'sente') return 'gote';
    if (mySideChoice === 'random' && oppSideChoice === 'random' && furigomaResult) {
      const iAmSente = isHost ? furigomaResult.hostIsSente : !furigomaResult.hostIsSente;
      return iAmSente ? 'sente' : 'gote';
    }
    return null;
  })();

  // v0.61: 先後選択の状態メッセージ (5 段階)
  //   prompt   : mySide 未選択 → 「先手か後手を選んでください」オレンジ強調
  //   waitOpp  : mySide 選択済み・相手未選択 → 「相手の選択待ちです」グレー
  //   conflict : 両者が同じ側 → 「先手・後手の合意ができていません」オレンジ強調
  //   furigoma : random × random 未確定 → 「振り駒で決定中です…」グレー
  //   resolved : 決定済 → 「あなたは先手/後手です」通常色
  type SideMsgKind = 'prompt' | 'waitOpp' | 'conflict' | 'furigoma' | 'resolved';
  const sideMessage: { text: string; kind: SideMsgKind } = (() => {
    if (mySideChoice === null) return { text: t('s06.sidePromptChoose'), kind: 'prompt' };
    if (myEffectiveSide) {
      return { text: myEffectiveSide === 'sente' ? t('s06.sideYouSente') : t('s06.sideYouGote'), kind: 'resolved' };
    }
    if (oppSideChoice === null) return { text: t('s06.sideWaitOpp'), kind: 'waitOpp' };
    // 両者おまかせ・振り駒結果未確定 (myEffectiveSide が null なのはここに来る前提)
    if (mySideChoice === 'random' && oppSideChoice === 'random') {
      return { text: t('s06.sideResolvingFurigoma'), kind: 'furigoma' };
    }
    // v0.62: 同側衝突 (sente+sente, gote+gote) だけでなく、明示×random の混合も conflict 扱い。
    return { text: t('s06.sideConflict'), kind: 'conflict' };
  })();

  // v0.60: ルール名の多言語表示 (準備完了カードの「本将棋」ハードコードを解消)
  const ruleNameLabel = (() => {
    const g = activeRoomConfig?.gameType ?? 'shogi';
    if (g === 'hasami') return t('s02.ruleHasami.name');
    if (g === 'shogi-custom') return t('s02.ruleCustom.name');
    return t('s02.ruleHongi.name');
  })();

  // 振り駒中のテキスト（誰が振っているか）
  const rollingText = isHost ? t('s06.frRollingHost') : t('s06.frRollingGuest');

  // 振り駒結果テキスト
  const resultText = (() => {
    if (!furigomaResult) return '';
    const { faceUps, hostIsSente } = furigomaResult;
    // ★v1.55 (付録D-7 v1.1 §8.1): 観戦者には「あなた」が無いので**第三者の言い方**にする。
    // 名前は `spectate_sync` が運んだもの（親 §6.8.4）。まだ届いていなければ
    // 名簿の席から読む＝**どちらにせよ空欄のまま出さない**。
    if (spectating) {
      const names = seatNames ?? {
        host: seatedRows[0]?.name ?? '',
        guest: seatedRows[1]?.name ?? '',
      };
      const first = hostIsSente ? names.host : names.guest;
      return t('spec.frResult').replace('{name}', first);
    }
    const faceUpCount = faceUps.filter((x) => x).length;
    const faceDownCount = faceUps.length - faceUpCount;
    if (hostIsSente) {
      const key = isHost ? 's06.frFaceUpYou' : 's06.frFaceUpOpp';
      return t(key).replace('{n}', String(faceUpCount));
    }
    const key = !isHost ? 's06.frFaceDownYou' : 's06.frFaceDownOpp';
    return t(key).replace('{n}', String(faceDownCount));
  })();

  return (
    <div className="stage">
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        {/* ===== ヘッダ ===== */}
        <header className="match-header">
          <CatIcon />
          <div className="title-block">
            <h1>
              <span className="momo">MOMO</span> <span className="shogi">Shogi</span>{' '}
              <span className="ver">{t('app.ver')}</span>
            </h1>
            <div className={`subtitle${subLocale === 'zh' ? ' zh' : ''}`}>{subtitle}</div>
          </div>
          <div className="header-spacer" />
          <div className="header-tools">
            <HeaderCommonRight />
          </div>
        </header>

        {/* ===== 部屋情報 ===== */}
        <div style={{ marginTop: 10, padding: '8px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{t('s04.roomName')}:</span>
          <RoomBadges parts={parts} locale={locale} />
          <span style={{ fontSize: 13, color: 'var(--text)' }}>{parts.userRoomName || `(${t('s04.roomNamePh')})`}</span>
          {timeLabel && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>{timeLabel}</span>
          )}
        </div>

        {/* ===== 対局者 ===== */}
        <div className="section-label">{t('s06.lblPlayers')}</div>
        <div className="s06-card">
          {/* ★v1.55: 席のある二人（付録D-7 v1.1 §4.1）。
              **観戦者が居ない部屋では v1.54 と 1 px も変わらない。**
              観戦者から見るときだけ、自分ではなく**対局者二人**を並べる。 */}
          {spectating ? (
            seatedRows.map((p, i) => (
              <div className="player-row" key={p.pid}>
                <span className="p-dot ok" />
                <span className="p-name">{p.name}</span>
                <span className="role-tag">{i === 0 ? t('s06.roleHost') : t('s06.roleGuest')}</span>
                <span className="p-spacer" />
                <span className="p-status ok">{t('s06.stConnected')}</span>
              </div>
            ))
          ) : (
            <>
              <div className="player-row">
                <span className="p-dot ok" />
                <span className="p-name">{playerName || t('s06.youName')}</span>
                <span className="role-tag you">{myRoleLabel}</span>
                <span className="p-spacer" />
                <span className="p-status ok">{t('s06.stConnected')}</span>
              </div>
              <div className="player-row">
                <span className={`p-dot ${oppPresent ? 'ok' : 'wait'}`} />
                <span className={`p-name${oppPresent ? '' : ' muted'}`}>
                  {oppPresent ? opponentName : t('s06.oppWaiting')}
                </span>
                {oppPresent && <span className="role-tag">{oppRoleLabel}</span>}
                <span className="p-spacer" />
                <span className={`p-status ${oppPresent ? 'ok' : 'warn'}`}>
                  {oppPresent ? t('s06.stConnected') : ''}
                </span>
              </div>
            </>
          )}
          {/* ★v1.55: 観戦者の行（付録D-7 v1.1 §4.1）。
              **0 人のときは見出しごと出さない**＝空の見出しを置かない。
              **席の 2 行は常に見えるよう、流すのは観戦者の行だけ。** */}
          {watchers.length > 0 && (
            <>
              <div className="section-label" style={{ marginTop: 8 }}>
                {t('spec.role')}（{watchers.length}）
              </div>
              <div style={{ maxHeight: 132, overflowY: 'auto' }}>
                {watchers.map((p) => (
                  <div className="player-row" key={p.pid}>
                    <span className="p-dot ok" />
                    <span className="p-name">
                      {p.name}（{t('spec.role')}）
                    </span>
                    <span className="p-spacer" />
                    <span className="p-status">{t('spec.watching')}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {/* v0.67 A6: 相手切断・入室タイムアウト警告帯 (部屋は維持) */}
          {oppLeftWarn && (
            <div className="block-note">
              <span>⚠</span>
              <span>{t('s06.oppLeftWarn')}</span>
            </div>
          )}
          {!oppLeftWarn && oppTimeoutWarn && !oppPresent && (
            <div className="block-note">
              <span>⚠</span>
              <span>{t('s06.oppTimeoutWarn')}</span>
            </div>
          )}
        </div>

        {/* ===== ルール同期の進捗（Phase 5-12 で本物のメッセージフローに接続） ===== */}
        <div className="section-label">{t('s06.lblSync')}</div>
        <div className="s06-card">
          <div className={`sync-step ${syncStep12}`}>
            <span className="ss-icon">{syncIcon(syncStep12)}</span>
            <div className="ss-label">
              <span>{t('s06.ss1')}</span>
              <small>rule_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t(syncStateKey(syncStep12))}</span>
          </div>
          <div className={`sync-step ${syncStep12}`}>
            <span className="ss-icon">{syncIcon(syncStep12)}</span>
            <div className="ss-label">
              <span>{t('s06.ss2')}</span>
              <small>modifiers_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t(syncStateKey(syncStep12))}</span>
          </div>
          <div className={`sync-step ${syncStep3}`}>
            <span className="ss-icon">{syncIcon(syncStep3)}</span>
            <div className="ss-label">
              <span>{t('s06.ss3')}</span>
              <small>rule_ack</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t(syncStateKey(syncStep3))}</span>
          </div>
          {/* Phase 5-12: 相手が扱えない、または照合が食い違ったときの警告帯。
             ここが出ている間は準備完了を押せない (canReady 側で止めている)。 */}
          {ruleSyncPhase === 'failed' && (
            <div className="block-note">
              <span>⚠</span>
              <span>{t('s06.ackFail')}</span>
            </div>
          )}
        </div>

        {/* ===== 先後選択 ===== */}
        {/* ★v1.55 (親 §6.8.3・付録D-7 v1.1 §8.1): 観戦者には**置かない**。
            灰色にして置くのではなく置かない＝**灰色は「押せない」だけを意味する**ので、
            そもそも自分に関係の無い操作は出さない。**振り駒の結果は下で見える。** */}
        {!spectating && (
        <>
        <div className="section-label">{t('s06.lblSide')}</div>
        <div className="side-pick">
          <SideCard
            label={t('s06.sideNameS')}
            desc={t('s06.sideDescS')}
            glyph="先"
            mine={mySideChoice === 'sente'}
            opp={oppSideChoice === 'sente'}
            mineText={t('s06.mineLabel')}
            oppText={t('s06.oppLabel')}
            locked={!!lockedSide && lockedSide !== 'sente'}
            onClick={() => onPickSide('sente')}
          />
          <SideCard
            label={t('s06.sideNameG')}
            desc={t('s06.sideDescG')}
            glyph="後"
            mine={mySideChoice === 'gote'}
            opp={oppSideChoice === 'gote'}
            mineText={t('s06.mineLabel')}
            oppText={t('s06.oppLabel')}
            locked={!!lockedSide && lockedSide !== 'gote'}
            onClick={() => onPickSide('gote')}
          />
          <SideCard
            label={t('s06.sideNameR')}
            desc={t('s06.sideDescR')}
            glyph="？"
            mine={mySideChoice === 'random'}
            opp={oppSideChoice === 'random'}
            mineText={t('s06.mineLabel')}
            oppText={t('s06.oppLabel')}
            locked={!!lockedSide}
            onClick={() => onPickSide('random')}
          />
        </div>
        {lockedSide && <div className="incompat show">{t('s03.sideLocked')}</div>}
        </>
        )}

        {/* ===== 振り駒アニメ（両者おまかせ時のみ表示） ===== */}
        <div className={`furigoma${showFurigoma ? ' show' : ''}`}>
          <div className="fg-row">
            {Array.from({ length: 5 }).map((_, i) => {
              const finalFaceUp = furigomaResult ? furigomaResult.faceUps[i] : true;
              const inlineStyle: React.CSSProperties | undefined =
                !furigomaSpinning && furigomaResult && !finalFaceUp
                  ? { transform: 'rotateX(180deg)' }
                  : undefined;
              return (
                <div key={i} className={`fg-piece${furigomaSpinning ? ' spin' : ''}`}>
                  <div className="fg-inner" style={inlineStyle}>
                    <div className="fg-face">
                      <span>歩</span>
                    </div>
                    <div className="fg-face back">
                      <span>と</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`fg-result${furigomaResult && !furigomaSpinning ? ' win' : ''}`}>
            {furigomaSpinning
              ? rollingText
              : furigomaResult
              ? resultText
              : rollingText}
          </div>
        </div>

        {/* v0.61: 先後選択の状態メッセージ (5 段階)。
            ★v1.55: **観戦者には出さない**＝「先手か後手を選んでください」など、
            **押すものが無い人への指示**になってしまう（2026-08-21 実サーバーで確認）。 */}
        {spectating ? null : (sideMessage.kind === 'prompt' || sideMessage.kind === 'conflict') ? (
          <div style={{ marginTop: 10, padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--orange-light)', border: '1px solid var(--orange)', borderRadius: 8, background: 'var(--bg-selected)' }}>
            {sideMessage.text}
          </div>
        ) : (sideMessage.kind === 'waitOpp' || sideMessage.kind === 'furigoma') ? (
          <div style={{ marginTop: 10, padding: '8px 12px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {sideMessage.text}
          </div>
        ) : (
          <div style={{ marginTop: 10, padding: '8px 12px', textAlign: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {sideMessage.text}
          </div>
        )}

        <div style={{ marginTop: 10, padding: '0 4px' }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {t('s06.sideShareNote')}
          </div>
          {/* v0.60: 振り駒の公平性説明はグレー (以前は orange-light だった) */}
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', lineHeight: 1.55, marginTop: 4 }}>
            {t('s06.fairNote')}
          </div>
        </div>

        {/* ===== チャット（v0.32 で S07 と同じ ChatConsole を使用） ===== */}
        <div className="section-label">{t('s06.lblChatSec')}</div>
        <div className="s06-card">
          <ChatConsole t={t} />
        </div>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        {/* ===== 準備完了カード ===== */}
        <div className="start-card">
          {/* ★v1.55: 観戦者にはリード文を出さない＝**「準備完了を押してください」は
              押すものが無い人への指示**（2026-08-21 実サーバーで確認）。
              代わりの 1 行は下のボタンの位置に置いてある。 */}
          {!spectating && <div className="st-line">{t('s06.stLead')}</div>}
          <div className="st-rule">
            {/* v0.67 A11: ルール名 + 盤サイズ表記 (現状の 3 ルールは全て 9×9) */}
            <span>{ruleNameLabel} 9×9</span>
          </div>
          {/* v0.67 A10: 先後 + モディファイア のチップ列 (mock S05 の #stChips 追随) */}
          <div className="chips">
            {mySideChoice && (
              <span className="chip">
                {mySideChoice === 'sente'
                  ? t('s06.sideNameS')
                  : mySideChoice === 'gote'
                  ? t('s06.sideNameG')
                  : t('s06.sideNameR')}
              </span>
            )}
            {activeRoomConfig?.torusMode === 'cylinder' && (
              <span className="chip mod">{t('s04.summaryTorusCyl')}</span>
            )}
            {activeRoomConfig?.torusMode === 'full' && (
              <span className="chip mod">{t('s04.summaryTorusFull')}</span>
            )}
            {activeRoomConfig?.quantum && (
              <span className="chip mod">{t('s04.summaryQuantum')}</span>
            )}
          </div>
          {/* ★v1.55 (親 §6.8.3・付録D-7 v1.1 §8.1): 観戦者は「準備完了」を押せない。
              **ボタンの位置を空白のまま空けない**＝押すものが無いのか、まだ出て
              いないのかを区別できないため、代わりに 1 行を置く。 */}
          {spectating ? (
            <div
              style={{
                margin: '10px 0 4px',
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-muted)',
              }}
            >
              {spectateWaiting ? t('spec.receiving') : t('spec.autoStart')}
            </div>
          ) : (
            <button
              type="button"
              className={`start-btn${myReady ? ' armed' : ''}`}
              onClick={onToggleReady}
              disabled={readyDisabled}
            >
              {myReady ? t('s06.readyArmed') : t('s06.readyBtn')}
            </button>
          )}
          {/* ★v1.55: 観戦者には出さない＝この行は「相手」という言い方で、
              **観戦者に相手は居ない**（誰のことを言っているのか読み取れない）。 */}
          {!spectating && (
            <div className={`opp-ready${oppReady ? ' ok' : ''}`}>
              {!oppPresent
                ? t('s06.readyHint')
                : oppReady
                ? t('s06.oppReadyYes')
                : t('s06.oppReadyNo')}
            </div>
          )}
          <div className="start-dest">{t('s06.startDest')}</div>
        </div>

        {/* ===== 退室 ===== */}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="reset-btn"
            onClick={onLeave}
            style={{ minWidth: 260, padding: '8px 18px', fontSize: 13 }}
          >
            {spectating ? t('s13.leave') : t('s06.backToOnlineLobby')}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 先後選択カード（駒モチーフ 3 枚のうちの 1 枚）。
 * v0.27: オレンジハイライトは自分の選択時のみ。相手の選択は緑チェック＋
 * 「相手の選択」文言だけで示す（オレンジは付けない）ので、自分と相手の
 * 選択を視覚的に区別しやすい。
 */
function SideCard({
  label,
  desc,
  glyph,
  mine,
  opp,
  mineText,
  oppText,
  locked = false,
  onClick,
}: {
  label: string;
  desc: string;
  glyph: string;
  mine: boolean;
  opp: boolean;
  mineText: string;
  oppText: string;
  /** v1.33: 駒落ちで先後が決まっているとき、選ばれていないカードを押せなくする。 */
  locked?: boolean;
  onClick: () => void;
}) {
  const cls = ['side-card'];
  if (mine) cls.push('on', 'mine'); // 自分の選択のみオレンジハイライト
  if (opp) cls.push('opp');
  return (
    <button
      type="button"
      className={cls.join(' ')}
      onClick={onClick}
      disabled={locked}
      style={locked ? { opacity: 0.32, cursor: 'not-allowed' } : undefined}
    >
      <div className="side-glyph">
        <span>{glyph}</span>
      </div>
      <div className="sc-name">{label}</div>
      <div className="sc-desc">{desc}</div>
      {/* 自分の選択ラベル（オレンジ） */}
      <span className="sc-label mine">{mineText}</span>
      {/* 相手の選択ラベル（緑） */}
      <span className="sc-label opp">{oppText}</span>
      {/* 自分マーク（左上・オレンジ） */}
      <span className="sc-mine">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
      {/* 相手マーク（右上・緑） */}
      <span className="sc-opp">
        <svg viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    </button>
  );
}

/**
 * 両者の選択から先後を確定する（ホストが両者準備完了時に呼ぶ）。
 *
 * - 「先手」×「後手」→ そのまま確定
 * - 片方おまかせ → 明示側優先で確定
 * - 両者おまかせ → furigomaResult に従う（呼び出し前に非 null になっているはず）
 * - conflict（両者同じ明示）→ 到達しないはず（readyDisabled で防ぐ）が保険でホスト先手
 */
function resolveSides(
  hostChoice: SideChoice,
  guestChoice: SideChoice,
  furigomaResult: { hostIsSente: boolean } | null,
): { hostSide: SideSelection; guestSide: SideSelection } {
  if (hostChoice === 'sente' && guestChoice === 'gote') return { hostSide: 'sente', guestSide: 'gote' };
  if (hostChoice === 'gote' && guestChoice === 'sente') return { hostSide: 'gote', guestSide: 'sente' };
  if (hostChoice === 'sente' && guestChoice === 'random') return { hostSide: 'sente', guestSide: 'gote' };
  if (hostChoice === 'gote' && guestChoice === 'random') return { hostSide: 'gote', guestSide: 'sente' };
  if (guestChoice === 'sente' && hostChoice === 'random') return { hostSide: 'gote', guestSide: 'sente' };
  if (guestChoice === 'gote' && hostChoice === 'random') return { hostSide: 'sente', guestSide: 'gote' };
  if (hostChoice === 'random' && guestChoice === 'random' && furigomaResult) {
    return furigomaResult.hostIsSente
      ? { hostSide: 'sente', guestSide: 'gote' }
      : { hostSide: 'gote', guestSide: 'sente' };
  }
  // 到達不能の保険：ホスト先手
  return { hostSide: 'sente', guestSide: 'gote' };
}
