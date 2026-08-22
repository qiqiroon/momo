import { useEffect, useRef, useState } from 'react';
import { useI18nStore } from '../../../core/store/i18n-store';
import { useRouteStore } from '../../../core/store/route-store';
import { requestNewGame } from '../../../core/store/kifu-guard';
import { t as _t } from '../../../core/i18n';
import type { LocaleCode } from '../../../core/i18n/types';
import { CatIcon } from '../../../core/ui-core/CatIcon';
import { HeaderCommonRight } from '../../../core/ui-core/HeaderCommonRight';
import { RuleSelectionCard } from '../../../core/ui-core/RuleSelectionCard';
import { getMomoMatchmaking } from '../client';
import { createSeatedRoom, isRoomPlayersFull, joinSeatedRoom } from '../roster';
import { useMatchmakingStore } from '../store';
import { decodeRoomName, encodeRoomName } from '../roomNameCodec';
import { RoomBadges } from './RoomBadges';
import { ensureMatchmakingInit } from '../bootstrap';
import { seButton } from '../../../core/audio/se-synth';

/** localStorage キー：前回のプレイヤー名 */
const LS_LAST_PLAYER_NAME = 'shogi.lobby.lastPlayerName';
/** localStorage キー：前回の部屋名 (パスワードは保存しない) */
const LS_LAST_ROOM_NAME = 'shogi.roomForm.lastRoomName';

/**
 * v1.21: 部屋一覧を取り直す間隔 (ミリ秒)。
 *
 * 待つための画面なので、消えた部屋が数秒残る程度は許容して回数を抑える。
 * 送るのは小さな 1 通で、返ってくるのも部屋一覧だけ。
 */
const ROOM_LIST_REFRESH_MS = 10_000;

/** v0.58 S04 通信対戦ロビー。3 カード構成。
 *  - カード A: 接続状態 + プレイヤー名
 *  - カード B: 部屋に入る (公開部屋一覧 + 非公開部屋の表示切替)
 *  - カード C: 部屋を作る (ルールサマリ + 部屋名 + パスワード + 非公開 + 作成)
 *
 *  持ち時間設定は S02 に移動、S04 側はサマリ 1 行のみ。
 */
export function LobbyScreen() {
  const locale = useI18nStore((s) => s.locale);
  const t = (key: string) => _t(key, locale);
  const setScreen = useRouteStore((s) => s.setScreen);

  const connection = useMatchmakingStore((s) => s.connection);
  const rooms = useMatchmakingStore((s) => s.rooms);
  const errorMessage = useMatchmakingStore((s) => s.errorMessage);
  const playerName = useMatchmakingStore((s) => s.playerName);
  const config = useMatchmakingStore((s) => s.pendingRoomConfig);
  const setError = useMatchmakingStore((s) => s.setError);
  const setPlayerName = useMatchmakingStore((s) => s.setPlayerName);
  const setConfig = useMatchmakingStore((s) => s.setPendingRoomConfig);
  const setActiveRoomConfig = useMatchmakingStore((s) => s.setActiveRoomConfig);
  const setCurrentRoom = useMatchmakingStore((s) => s.setCurrentRoom);
  const setOpponentName = useMatchmakingStore((s) => s.setOpponentName);

  const [joinRoomId, setJoinRoomId] = useState<string | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  /**
   * ★v1.55: 観戦を許すか（親 §6.8.2・付録D-6 v1.2 §4）。**既定は「許す」**。
   *
   * **★この画面の中だけで持ち、store にも localStorage にも置かない。**
   * 規定は「**端末に覚えさせない・入るたび『許す』から始める**」であり、
   * **画面から出れば消える入れ物に置けば、覚えないことが仕組みとして保証される**
   * （数え上げて「入るたびに戻す」処理を書くと、入口が増えたときに必ず 1 つ漏れ、
   * しかも**初回は必ず意図どおりに動くので気づけない**）。
   * **部屋のほかの設定（`config`）へ相乗りさせないこと**＝あちらは持ち越す入れ物。
   */
  const [allowSpectators, setAllowSpectators] = useState(true);
  // v0.58: 非公開部屋の表示切替 + そのパスワード欄 (入室時に自動使用)
  const [showPrivate, setShowPrivate] = useState(false);
  const [privatePw, setPrivatePw] = useState('');
  // v0.58.1: Chrome の autofill でパスワード欄が勝手に埋まるのを防ぐため、
  // 直後 + 200ms 後にパスワード欄の DOM 値を強制クリア (gomoku-go 方式)
  const privatePwRef = useRef<HTMLInputElement | null>(null);
  const createPwRef = useRef<HTMLInputElement | null>(null);
  const joinPwRef = useRef<HTMLInputElement | null>(null);

  const subLocale: LocaleCode = locale === 'cat' ? 'ja' : locale;
  const subtitle = subLocale === 'zh' ? '擒王为胜，破局无界' : 'Capture the King, Bend the Rules';

  useEffect(() => {
    try {
      if (!playerName) {
        const saved = localStorage.getItem(LS_LAST_PLAYER_NAME);
        if (saved) setPlayerName(saved);
      }
      if (!config.roomName) {
        const savedRoom = localStorage.getItem(LS_LAST_ROOM_NAME);
        if (savedRoom) setConfig({ roomName: savedRoom });
      }
    } catch {
      // localStorage 使えない環境は無視
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPlayerNameChange = (name: string) => {
    setPlayerName(name);
    try {
      if (name.trim()) localStorage.setItem(LS_LAST_PLAYER_NAME, name);
    } catch {
      // localStorage 使えない環境は無視
    }
  };

  useEffect(() => {
    ensureMatchmakingInit();
  }, []);

  // v1.21 (ユーザー報告 2026-08-12): 部屋一覧を定期的に取り直す。
  //
  // それまでは更新ボタンを押したときと、サーバーから知らせが届いたときにしか
  // 一覧が変わらなかった。ホストの回線が黙って切れた場合など知らせが来ないことが
  // あり、**もう無い部屋が並んだまま**になっていた (サーバー側は無いと分かっていて、
  // 押すと「部屋が見つかりません」と返ってくる状態)。
  //
  // この画面を開いている間だけ動かす。裏に回った (タブが隠れた) 間は止めて、
  // 戻ってきたらすぐ 1 回取り直す — 復帰直後に古い一覧を見せないため。
  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      const client = getMomoMatchmaking();
      if (!client) return;
      // 部屋に入っている間は一覧を触らない (入室中に上書きすると表示が乱れる)
      if (useMatchmakingStore.getState().currentRoomId) return;
      client.refreshRooms();
    };
    refresh();
    const timer = window.setInterval(refresh, ROOM_LIST_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  // v1.21 (ユーザー報告 2026-08-12): 入室に失敗したら、その場で一覧を取り直す。
  // 押しても入れない行が残っていると同じ行を何度も押すことになるので、次の定期更新を
  // 待たずに消す。消えたかどうかの判断はサーバーの返事に任せる (手元で勝手に消さない)。
  useEffect(() => {
    if (!errorMessage) return;
    if (useMatchmakingStore.getState().currentRoomId) return;
    const client = getMomoMatchmaking();
    if (client) client.refreshRooms();
  }, [errorMessage]);

  // v0.58.1: Chrome の autofill 対策。autocomplete="new-password" を Chrome は無視するので、
  // マウント直後 + 少し遅延して 2 回、パスワード欄の DOM 値を強制的に空に戻す。
  useEffect(() => {
    const clearPw = () => {
      if (privatePwRef.current) privatePwRef.current.value = '';
      if (createPwRef.current) createPwRef.current.value = '';
      if (joinPwRef.current) joinPwRef.current.value = '';
    };
    clearPw();
    const t1 = setTimeout(clearPw, 0);
    const t2 = setTimeout(clearPw, 200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  const onJoin = (roomId: string, needsPassword: boolean, autoPassword?: string) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    if (!playerName.trim()) {
      setError(t('s04.errNoName'));
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError(t('s04.errNoServer'));
      return;
    }
    // 自動パスワード (非公開一覧のパスワード欄) が指定されていればそれを使う
    if (needsPassword && autoPassword !== undefined && autoPassword !== '') {
      joinSeatedRoom(client, { roomId, password: autoPassword, name: playerName, isPublic: false });
      setJoinRoomId(null);
      setJoinPassword('');
      return;
    }
    if (needsPassword && joinRoomId !== roomId) {
      setJoinRoomId(roomId);
      setJoinPassword('');
      return;
    }
    joinSeatedRoom(client, {
      roomId,
      password: needsPassword ? joinPassword : '',
      name: playerName,
      isPublic: rooms.find((r) => r.id === roomId)?.isPublic !== false,
    });
    setJoinRoomId(null);
    setJoinPassword('');
  };

  const onRefresh = () => {
    const client = getMomoMatchmaking();
    if (client) client.refreshRooms();
  };

  const onBackToMenu = () => {
    seButton(); // v0.76
    const client = getMomoMatchmaking();
    if (client) client.leaveRoom();
    setScreen('lobby');
  };

  // v0.69: S02 (ルール選択) から戻る際に S04 (net-lobby) に戻すよう指定
  const onEditRule = () => {
    useRouteStore.getState().setRuleSelectReturn('net-lobby');
    setScreen('rule-select');
  };

  const onCreateRoom = () => {
    seButton(); // v0.74
    if (!playerName.trim()) {
      setError(t('s04.errNoName'));
      return;
    }
    if (useMatchmakingStore.getState().connection !== 'connected') {
      setError(t('s04.errNoServer'));
      return;
    }
    const client = getMomoMatchmaking();
    if (!client) return;
    setError(null);
    const userRoomName = config.roomName || t('s04.defaultRoomName');
    const encodedName = encodeRoomName({
      gameType: config.gameType,
      torus: config.torus,
      quantum: config.quantum,
      // v0.87: 持ち時間も部屋名に埋め込む (ロビー一覧のバッジで表示)
      timeControl: config.timeControl,
      customRuleName: config.customRuleName,
      userRoomName,
    });
    try {
      localStorage.setItem(LS_LAST_ROOM_NAME, userRoomName);
    } catch {
      // localStorage 使えない環境は無視
    }
    // ★v1.51: **棋譜の確認が済んでから部屋を建てる**（親 §9.2.3 ②）。
    //
    // v1.50 まではここで先に建ててから画面を移していたため、画面を移る仕組みが
    // 「未保存の棋譜があります」の確認を割り込ませた時点で**部屋だけが先にできて
    // いた**。「やめる」を選ぶと画面はロビーのまま・**誰も居ない部屋が一覧に残る**
    // ＝作った本人にも片付けられない（戻ってくる画面が無い）。**対局のあとは必ず
    // 未保存の棋譜があるので、毎回これが起きていた**（2026-08-18 実機で再現）。
    //
    // 確認を先に通し、通ったときだけ建てて移る。**移るときは二度尋ねない**。
    requestNewGame(() => createAndEnter(encodedName));
  };

  /** 確認が済んだあとの本体＝**建てて、待機画面へ移る**。 */
  const createAndEnter = (encodedName: string) => {
    const client = getMomoMatchmaking();
    if (!client) return;
    setActiveRoomConfig({ ...config, roomName: encodedName });
    setCurrentRoom({ roomId: null, roomName: encodedName, isHost: true });
    setOpponentName('');
    createSeatedRoom(client, {
      hostName: playerName,
      name: encodedName,
      password: config.password,
      isPublic: config.isPublic,
      // ★v1.55 (親 §6.8.2): 許さないときは**観戦枠 0 で建てる**＝可否を別の項目に
      // 持たない（持つと枠と可否が食い違う組み合わせが生まれる）。
      allowSpectators,
      rules: {
        game: config.gameType,
        torus: config.torus,
        // Phase 5-12: トーラスの詳細 (円筒か完全か) も送る。以前は有無の真偽しか
        // 送っておらず、受け取る側が「つながっているなら円筒」と決め打ちで戻していた
        // ため、ホストが完全トーラスを選んでもゲストの画面は円筒になっていた。
        torusMode: config.torusMode,
        quantum: config.quantum,
        // v1.08 (Phase 5-11): 未確定駒の見せ方はルール設定者 (ホスト) が決めて
        // 両者に共通適用する決まりなので、部屋のルールとしてゲストへ送る。
        qtdisp: config.quantumDisplayMode,
        customRuleName: config.customRuleName,
        time: config.timeControl,
      },
    });
    setScreen('room', { skipKifuGuard: true });
  };

  const connLabel: Record<string, string> = {
    disconnected: t('s04.connState.disconnected'),
    connecting: t('s04.connState.connecting'),
    connected: t('s04.connState.connected'),
    in_room: t('s04.connState.inRoom'),
    game_connected: t('s04.connState.gameConnected'),
  };

  // v0.58.1: 部屋リストは 1 つに統合。「非公開を表示」トグルで非公開部屋が
  // 同じリストに増減する (パスワードの有無でリストが増える・減るだけ)。
  // 公開 + パスワード有りの部屋は最初から表示 (パスワードは入室時のゲート)。
  const publicRooms = rooms.filter((r) => r.isPublic);
  const privateRooms = rooms.filter((r) => !r.isPublic);
  const visibleRooms = showPrivate ? [...publicRooms, ...privateRooms] : publicRooms;

  const renderRoomRow = (r: typeof rooms[number]) => {
    const parts = decodeRoomName(r.name);
    /**
     * ★v1.54: **感想戦の部屋は見えるが、ここからは入れない**（親 v1.48 §9.4.4 の
     * 部屋の切り分け・画面機能 v0.42 §3 S04）。**入り口は感想戦ロビー (S12)**。
     *
     * 見えること自体は残す＝隠すと「在るのに見えない」で分かりにくく、印があれば
     * 取り違えない。**入れてしまうと、対局の相手を待っている人のところへ感想戦の客が
     * 来る**（逆も同じ）。**灰色は「押せない」だけを意味する**ので、**理由は言葉で出す**。
     */
    const isReviewRoom = !!parts.review;
    // 非公開 (privateRooms) の入室にはパスワード欄の値を自動送信する
    const autoPw = !r.isPublic ? privatePw : undefined;
    return (
      <div
        key={r.id}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface2)', borderRadius: 8, fontSize: 13 }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <RoomBadges parts={parts} locale={locale} />
            <span style={{ color: 'var(--text)' }}>{parts.userRoomName || `(${t('s04.roomNamePh')})`}</span>
            {!r.isPublic && <span style={{ fontSize: 10, color: 'var(--orange-light)', border: '1px solid var(--orange)', padding: '1px 6px', borderRadius: 10 }}>{t('s04.privateFlag')}</span>}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
            {t('s04.host')}: {r.hostName}
            {r.hasPassword && `  ${t('s04.hasPassword')}`}
            {isRoomPlayersFull(r) && `  ${t('s04.inGame')}`}
          </div>
          {isReviewRoom && (
            <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
              {t('s04.reviewRoomWhy')}
            </div>
          )}
        </div>
        {isReviewRoom ? (
          <button className="reset-btn" type="button" disabled>
            {t('s04.enterRoom')}
          </button>
        ) : joinRoomId === r.id && r.hasPassword && (autoPw === undefined || autoPw === '') ? (
          <>
            <input
              ref={joinPwRef}
              type="password"
              name="shogi-join-pw"
              autoComplete="new-password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder={t('s04.passwordPh2')}
              style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontSize: 16, width: 120 }}
            />
            <button className="reset-btn" type="button" onClick={() => onJoin(r.id, r.hasPassword)}>
              {t('s04.enterRoom')}
            </button>
          </>
        ) : (
          <button
            className="reset-btn"
            type="button"
            onClick={() => onJoin(r.id, r.hasPassword, autoPw)}
            disabled={connection !== 'connected' || isRoomPlayersFull(r)}
          >
            {t('s04.enterRoom')}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="stage">
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
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
            {/* v0.71: 家アイコン + 「モード選択」に統一 */}
            <button className="reset-btn" type="button" onClick={onBackToMenu} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12l9-9 9 9M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('s00.modeSelect')}
            </button>
            <HeaderCommonRight />
          </div>
        </header>

        {errorMessage && (
          <div style={{ marginTop: 10, padding: '8px 14px', background: 'rgba(179, 64, 26, 0.15)', border: '1px solid #b3401a', borderRadius: 8, color: '#e8836a', fontSize: 13 }}>
            {errorMessage}
          </div>
        )}

        {/* ── カード A: 接続 + プレイヤー名 ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardConn')}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('s04.connLabel')}:{' '}
              <span style={{ color: connection === 'disconnected' || connection === 'connecting' ? 'var(--text-muted)' : 'var(--orange-light)' }}>
                {connLabel[connection]}
              </span>
            </div>
            <button className="reset-btn" type="button" onClick={onRefresh} disabled={connection === 'connecting' || connection === 'disconnected'}>
              {t('s04.refresh')}
            </button>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.playerNameLbl')}</span>
            <input
              type="text"
              value={playerName}
              onChange={(e) => onPlayerNameChange(e.target.value)}
              placeholder={t('s04.playerNamePh')}
              maxLength={20}
              style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 16 }}
            />
          </label>
        </div>

        {/* ── カード B: 部屋に入る (v0.58.1: 統合リスト。非公開切替でリストが増減) ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardJoin')}</div>

          {/* 部屋一覧 (公開・パスワード有りも含む。非公開表示 ON で非公開部屋が追加される) */}
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: 10 }}>
            {visibleRooms.length === 0 ? (
              <div className="spec-empty">{t('s04.noRooms')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleRooms.map((r) => renderRoomRow(r))}
              </div>
            )}
          </div>

          {/* 非公開部屋を表示 (パスワードは入室時に自動送信) */}
          <div className="private-panel">
            <div className="pp-title">{t('s04.privateTitle')}</div>
            <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
              <div className="pp-row">
                <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('s04.privatePwLabel')}</label>
                <input
                  ref={privatePwRef}
                  type="password"
                  name="shogi-priv-pw"
                  autoComplete="new-password"
                  value={privatePw}
                  onChange={(e) => setPrivatePw(e.target.value)}
                />
                <button
                  type="button"
                  className="reset-btn"
                  onClick={() => setShowPrivate((v) => !v)}
                  style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {showPrivate ? t('s04.privateBtnHide') : t('s04.privateBtnShow')}
                </button>
              </div>
            </form>
            <div className="pp-note">{t('s04.privateNote')}</div>
          </div>
        </div>

        {/* ── カード C: 部屋を作る ── */}
        <div className="lobby-card">
          <div className="lc-title">{t('s04.cardCreate')}</div>

          {/* v0.86: ルールサマリ + 選択ボタン → S01 と同一の RuleSelectionCard サブカードに置換 */}
          <div style={{ marginBottom: 12 }}>
            <RuleSelectionCard
              gameType={config.gameType}
              torusMode={config.torusMode}
              quantum={config.quantum}
              timeControl={config.timeControl}
              onEditRule={onEditRule}
            />
          </div>

          {/* 部屋情報 */}
          <form autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.roomName')}</span>
                <input
                  type="text"
                  name="shogi-room-label"
                  autoComplete="off"
                  value={config.roomName}
                  onChange={(e) => setConfig({ roomName: e.target.value })}
                  placeholder={t('s04.roomNamePh')}
                  maxLength={30}
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 16 }}
                />
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 90 }}>{t('s04.password')}</span>
                <input
                  ref={createPwRef}
                  type="password"
                  name="shogi-room-key"
                  autoComplete="new-password"
                  value={config.password}
                  onChange={(e) => setConfig({ password: e.target.value })}
                  placeholder={t('s04.passwordPh')}
                  style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border-strong)', color: 'var(--text)', padding: '5px 10px', borderRadius: 6, fontSize: 16 }}
                />
              </label>
              {/* v0.58: 「公開」→「非公開」に反転 + オレンジのアクセント */}
              <label className="check-private">
                <input
                  type="checkbox"
                  checked={!config.isPublic}
                  onChange={(e) => setConfig({ isPublic: !e.target.checked })}
                />
                <span style={{ color: 'var(--text)' }}>{t('s04.private')}</span>
              </label>
              {/* ★v1.55: 観戦を許す（親 §6.8.2・付録D-6 v1.2 §4）。
                  **見た目は「非公開」と同じ**でそのすぐ下に置く（同じ形のものを
                  違う見た目にしない）。**既定は「許す」**。 */}
              <label className="check-private">
                <input
                  type="checkbox"
                  checked={allowSpectators}
                  onChange={(e) => setAllowSpectators(e.target.checked)}
                />
                <span style={{ color: 'var(--text)' }}>{t('s04.allowSpec')}</span>
              </label>
              {/* **建てた後は変えられない**（部屋の枠は建てるときに決まる）。 */}
              <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: -4 }}>
                {t('s04.allowSpecNote')}
              </div>
            </div>
          </form>

          {/* 部屋を作成 (大オレンジボタン) */}
          <button
            type="button"
            className="create-big-btn"
            onClick={onCreateRoom}
            disabled={connection !== 'connected'}
          >
            {t('s04.createRoom')}
          </button>
        </div>
      </div>
    </div>
  );
}
