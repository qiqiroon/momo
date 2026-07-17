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
import { useMatchmakingStore, type SideChoice, type SideSelection } from '../store';
import { PROTOCOL_VERSION } from '../protocol';
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
export function RoomScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const isHost = useMatchmakingStore((s) => s.isHost);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const opponentName = useMatchmakingStore((s) => s.opponentName);
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
  const sendMsg = (msg: unknown) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    client.send(msg);
  };

  // 相手が入室してきた瞬間に自分の現在状態を送る（キャッチアップ用）
  useEffect(() => {
    if (!oppPresent) return;
    sendMsg({ v: PROTOCOL_VERSION, type: 'state_sync', choice: mySideChoice, ready: myReady });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppPresent]);

  // ゲスト退室でホストは待機表示に戻る（相手行が「入室待ち」に戻る）
  // また、ゲスト退室時にハンドシェイク状態はリセット（再入室で新規開始）
  useEffect(() => {
    if (isHost && !opponentName) {
      resetHandshake();
    }
  }, [isHost, opponentName, resetHandshake]);

  // v0.67 A5: ルール同期の ack 結果 (null=未検査, true=対応OK, false=非対応)。
  // ルール同期プロトコル実装時に置き換え予定。それまでは null で警告帯は非表示。
  const [ruleSyncAckOk] = useState<boolean | null>(null);

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
    resetRoomState();
    setScreen('net-lobby');
  };

  const onPickSide = (choice: SideChoice) => {
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

        {/* ===== ルール同期の進捗（段階 2-5.1 では見せかけ全部完了） ===== */}
        <div className="section-label">{t('s06.lblSync')}</div>
        <div className="s06-card">
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss1')}</span>
              <small>rule_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss2')}</span>
              <small>modifiers_sync</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
          <div className="sync-step done">
            <span className="ss-icon">✓</span>
            <div className="ss-label">
              <span>{t('s06.ss3')}</span>
              <small>rule_ack</small>
            </div>
            <span className="ss-spacer" />
            <span className="ss-state">{t('s06.stDone')}</span>
          </div>
          {/* v0.67 A5: ルール非対応の警告帯 (プレースホルダ)
             ルール同期プロトコル実装時に ackOk === false を検出して表示予定。
             今は wiring 済みで表示条件が false のため常に非表示。 */}
          {ruleSyncAckOk === false && (
            <div className="block-note">
              <span>⚠</span>
              <span>{t('s06.ackFail')}</span>
            </div>
          )}
        </div>

        {/* ===== 先後選択 ===== */}
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
            onClick={() => onPickSide('random')}
          />
        </div>

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

        {/* v0.61: 先後選択の状態メッセージ (5 段階) */}
        {(sideMessage.kind === 'prompt' || sideMessage.kind === 'conflict') ? (
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
          <div className="st-line">{t('s06.stLead')}</div>
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
          <button
            type="button"
            className={`start-btn${myReady ? ' armed' : ''}`}
            onClick={onToggleReady}
            disabled={readyDisabled}
          >
            {myReady ? t('s06.readyArmed') : t('s06.readyBtn')}
          </button>
          <div className={`opp-ready${oppReady ? ' ok' : ''}`}>
            {!oppPresent
              ? t('s06.readyHint')
              : oppReady
              ? t('s06.oppReadyYes')
              : t('s06.oppReadyNo')}
          </div>
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
            {t('s06.backToOnlineLobby')}
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
  onClick,
}: {
  label: string;
  desc: string;
  glyph: string;
  mine: boolean;
  opp: boolean;
  mineText: string;
  oppText: string;
  onClick: () => void;
}) {
  const cls = ['side-card'];
  if (mine) cls.push('on', 'mine'); // 自分の選択のみオレンジハイライト
  if (opp) cls.push('opp');
  return (
    <button type="button" className={cls.join(' ')} onClick={onClick}>
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
