import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Envelope } from './engine/events';
import { HUMAN, useTable } from './game/useTable';
import { SeatContext, type SeatInfo } from './ui/seatContext';
import { buildKifu, kifuFileName, parseKifu, type Kifu, type KifuSource } from './kifu/kifu';
import { downloadText, listDriveKifu, loadLastGame, readDriveFile, saveToDrive } from './kifu/store';
import { CpuSetup, ModeRow, ReplayHub, SiteFooter } from './ui/Menu';
import { useGameEffects } from './audio/useGameEffects';
import { armAudioAsk, finishAudioAsk, rearmAudioAsk } from './audio/firstGesture';
import { bindVisibility } from './audio/visibility';
import { Effects } from './ui/Effects';
import { Chat } from './ui/Chat';
import { SettingsPanel, SoundPrompt } from './ui/Sound';
import { Replay } from './ui/Replay';
import { NOTICE } from './i18n/notice';
import { Notice, TERMS_URL, type NoticeKind } from './ui/Notice';
import { LANG_MODES, baseOf, changeMode, currentMode, initLang, translate, type LangMode, type MessageKey } from './i18n/strings';
import { Table } from './ui/Table';
import { Lobby, OnlineStatus, WaitingRoom, useOnline } from './ui/Online';
import { CallStrip } from './ui/CallStrip';
import { OnlineSession } from './online/session';
import { matchmakingTransport } from './online/transport';
import { useLayout } from './ui/useLayout';
import { APP_VERSION } from './version';

/** 歯車の絵（MOMO Hanafuda・Sudoku と同じ意匠） */
const GEAR =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6 3.6 3.6 0 0 1-3.6 3.6z';

/** オンライン対局（部屋の一覧と待合）。サーバーにつなぐのはオンライン対局の画面に入ったときだけ */
const online = new OnlineSession(matchmakingTransport);

export function App({ startConsented = false }: { startConsented?: boolean } = {}) {
  const [lang, setLang] = useState(initLang);
  const [mode, setMode] = useState<LangMode>(currentMode);
  const { view, legal, start, next, choose, quit, source, started } = useTable();
  const { layout, canSwitch, toggle } = useLayout();
  const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
  /** 再生している牌譜の出来事の列（再生していなければ null） */
  const [replaying, setReplaying] = useState<readonly Envelope[] | null>(null);
  /** トップ画面で覚えている最後の対局（トップへ戻るたびに読み直す） */
  const [last, setLast] = useState<KifuSource | null>(() => loadLastGame());
  /** 保存・読み込みの結果の一言 */
  const [note, setNote] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  /** トップ側の画面：モード選択／CPU と対局（ルールを選ぶ）／オンライン対局／対局の再生 */
  const [screen, setScreen] = useState<'top' | 'cpu' | 'online' | 'replay'>('top');
  const ol = useOnline(online);
  /** オンラインの卓（対局が始まっていれば。ol.tableRev が変わるたびに描き直す） */
  const tbl = online.table;
  const onlineOn = screen === 'online' && ol.where === 'room' && ol.started && !!tbl?.started && !ol.reconnecting;
  const tableView = onlineOn && tbl ? tbl.view : view;
  const seatInfo: SeatInfo = onlineOn && tbl ? { me: tbl.mySeat ?? 0, names: tbl.seats.map((x) => (x.kind === 'human' ? x.name : null)) } : { me: HUMAN, names: null };
  /** ご利用にあたって：起動するたびに開いた瞬間に出し、同意するまで閉じない（利用者 Q2=A）。
   *  端末には覚えない＝毎回、賭けに使わないことを思い出してもらう（利用者 10-09）。startConsented は検査用 */
  const [consented, setConsented] = useState(startConsented);
  /** トップ画面の下のリンクから読み返している中身（読んでいなければ null） */
  const [reading, setReading] = useState<NoticeKind | null>(null);
  const notice = NOTICE[baseOf(lang)];

  /** 牌譜を作る（名前は保存するときの表示の言葉で入れる） */
  const kifuOf = (src: KifuSource): Kifu =>
    buildKifu({ ...src, players: [0, 1, 2, 3].map((seat) => ({ name: seat === 0 ? t('you') : t('cpu', { n: seat }), kind: seat === 0 ? 'human' : 'cpu' })) }, APP_VERSION);
  /** ファイルの文字：上の項目は字下げ、出来事の列は 1 行に 1 つ */
  const kifuText = (k: Kifu) =>
    JSON.stringify({ ...k, events: '__EVENTS__' }, null, 2).replace('"__EVENTS__"', () => `[\n${k.events.map((e) => `    ${JSON.stringify(e)}`).join(',\n')}\n  ]`);
  const saveFile = (src: KifuSource) => {
    const k = kifuOf(src);
    const name = kifuFileName(k);
    downloadText(name, kifuText(k));
    setNote(t('savedFile', { name }));
  };
  const saveDrive = async (src: KifuSource) => {
    const k = kifuOf(src);
    try {
      const name = await saveToDrive(kifuFileName(k), kifuText(k));
      setNote(t('savedDrive', { name }));
    } catch (e) {
      setNote(t('saveFailed', { why: (e as Error).message }));
    }
  };
  const toTop = () => {
    quit();
    setScreen('top');
    setReplaying(null);
    setLast(loadLastGame());
    setNote('');
  };
  /** 見出しのアプリ名：対局の途中なら確かめてからトップへ */
  const onTitle = () => {
    if (replaying) return toTop();
    // 部屋にいるときは、確かめてから部屋を出る（ホストなら部屋が閉じる）
    if (ol.where === 'room') {
      if (!window.confirm(t(ol.room?.isHost ? 'olCloseConfirm' : 'olLeaveConfirm'))) return;
      online.leave();
    }
    if (screen === 'online') online.clearNote();
    if (!started) return setScreen('top');
    if (view.phase !== 'gameover' && !window.confirm(t('quitConfirm'))) return;
    toTop();
  };
  const openFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      setReplaying(parseKifu(await f.text()).events);
      setNote('');
    } catch (err) {
      setNote(t('kifuBad', { why: (err as Error).message }));
    }
  };
  /** 卓を出している画面か（対局中・牌譜の再生中）。画面切替を出すのはここだけ */
  const onBoard = started || replaying !== null || onlineOn;
  /** 対局の音と演出（再生中は鳴らさない） */
  const fx = useGameEffects(tableView, (started && !replaying) || onlineOn, seatInfo.me);
  /** 「音楽を再生しますか？」を出しているか・歯車の設定を開いているか */
  const [soundAsk, setSoundAsk] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 最初の操作で音を尋ねる（同意画面のあと＝同意のボタンは止めない）。1 時間以上離れて戻ったらもう一度
  useEffect(() => {
    if (!consented) return;
    armAudioAsk(() => setSoundAsk(true));
    bindVisibility(() => rearmAudioAsk());
  }, [consented]);
  /** 再生を終えたら、入ってきた画面（対局の再生）へ戻る */
  const exitReplay = () => {
    setReplaying(null);
    setLast(loadLastGame());
  };
  const playDrive = async (id: string) => {
    try {
      setReplaying(parseKifu(await readDriveFile(id)).events);
      setNote('');
    } catch (err) {
      setNote(t('kifuBad', { why: (err as Error).message }));
    }
  };
  const startGame = () => {
    setNote('');
    start();
  };

  useEffect(() => {
    // 再生中も対局中と同じ見出しの形（小さく）にする
    document.body.classList.toggle('in-game', started || replaying !== null || onlineOn);
    // ご利用にあたっての窓を出しているあいだも、見出し（言語の選択）は窓の上に出す
    document.body.classList.toggle('notice-open', !consented || reading !== null);
    const base = baseOf(lang);
    document.documentElement.lang = base === 'zh' ? 'zh-CN' : base;
  }, [started, replaying, onlineOn, lang, consented, reading]);

  const onLang = (m: LangMode) => {
    setMode(m);
    setLang(changeMode(m));
  };

  return (
    <SeatContext.Provider value={seatInfo}>
      <header className="site-header">
        <img className="cat-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <div className={`title-block${started || replaying || screen !== 'top' ? ' to-top' : ''}`} onClick={onTitle} role={started || replaying || screen !== 'top' ? 'button' : undefined} title={started || replaying || screen !== 'top' ? t('toTop') : undefined}>
          <h1>
            <span className="momo">MOMO</span>
            <span className="mahjong">Mahjong</span>
            <span className="version-tag">{APP_VERSION}</span>
          </h1>
          <div className={`subtitle${baseOf(lang) === 'zh' ? ' zh' : ''}`}>{t('subtitle')}</div>
        </div>
        <div className="header-right">
          {/* 画面切替：正方形の卓を出せない狭い画面（携帯）ではボタンごと出さない（見出しをはみ出させないため・利用者指示） */}
          {/* 対局の中断：確かめてからモード選択へ（途中までの対局は「前回の対局」として残る） */}
          {(started || onlineOn) && !replaying && tableView.phase !== 'gameover' && layout !== 'lanes' && (
            <button type="button" className="icon-btn layout-btn quit-btn" onClick={onTitle} aria-label={t('quitGame')}>
              {/* 狭い画面は短く（見出しから言語選択をはみ出させない） */}
              <span className="quit-long">{t('quitGame')}</span>
              <span className="quit-short">{t('quitGameShort')}</span>
            </button>
          )}
          {/* 画面切替は卓を出す画面（対局・牌譜の再生）だけ（利用者指示 10-09）。卓を出す画面を足したら onBoard に入れる */}
          {canSwitch && onBoard && (
            <button type="button" className="icon-btn layout-btn" onClick={toggle}>
              {t('layoutSwitch')}
            </button>
          )}
          {/* 設定：BGM と効果音の音量・ミュート・音源クレジット（ルールの設定は段階6で足す） */}
          <button type="button" className="icon-btn" aria-label={t('settings')} title={t('settings')} onClick={() => setSettingsOpen(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
              <path fill="currentColor" d={GEAR} />
            </svg>
          </button>
          <select className="lang-select" aria-label={t('language')} value={mode} onChange={(e) => onLang(e.target.value as LangMode)}>
            {LANG_MODES.map((o) => (
              <option key={o.mode} value={o.mode}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      {replaying ? (
        <main className="game">
          <Replay events={replaying} narrow={layout === 'lanes'} lang={lang} onExit={exitReplay} />
        </main>
      ) : started ? (
        <main className="game">
          <Table
            narrow={layout === 'lanes'}
            view={view}
            legal={legal}
            lang={lang}
            onChoose={choose}
            onNext={next}
            onNewGame={startGame}
            onTop={toTop}
            onSaveFile={() => saveFile(source)}
            onSaveDrive={() => void saveDrive(source)}
            saveNote={note}
            dealt={fx.dealt}
            onQuit={onTitle}
            chat={<Chat t={t} you={t('you')} />}
          />
        </main>
      ) : onlineOn && tbl ? (
        <main className="game">
          <OnlineStatus t={t} table={tbl} members={ol.members} />
          <Table
            narrow={layout === 'lanes'}
            view={tbl.view}
            legal={tbl.choices()}
            lang={lang}
            onChoose={(a) => tbl.choose(a)}
            onNext={() => tbl.next()}
            nextWait={ol.room?.isHost ? undefined : t('olWaitNext')}
            onTop={onTitle}
            dealt={fx.dealt}
            onQuit={onTitle}
            chat={<Chat t={t} you={t('you')} online={{ lines: ol.chat, myId: online.myId, onSend: (s) => online.sendChat(s) }} />}
            callPanel={<CallStrip t={t} table={tbl} />}
          />
        </main>
      ) : (
        <main className="title">
          {screen === 'cpu' ? (
            <CpuSetup t={t} onBack={() => setScreen('top')} onStart={startGame} />
          ) : screen === 'online' ? (
            ol.where === 'room' ? (
              <WaitingRoom t={t} session={online} />
            ) : (
              <Lobby
                t={t}
                session={online}
                onBack={() => {
                  online.clearNote();
                  setScreen('top');
                }}
              />
            )
          ) : screen === 'replay' ? (
            <ReplayHub
              t={t}
              hasLast={last !== null}
              note={note}
              onBack={() => {
                setScreen('top');
                setNote('');
              }}
              onPlayLast={() => last && setReplaying(last.events)}
              onPlayFile={() => fileInput.current?.click()}
              listDrive={listDriveKifu}
              onPlayDrive={(id) => void playDrive(id)}
              onSaveFile={() => last && saveFile(last)}
              onSaveDrive={() => last && void saveDrive(last)}
            />
          ) : (
            <>
              <div className="screen-head">
                <h2>{t('menuHead')}</h2>
              </div>
              {/* 将棋のモード選択にならい、牌（ピンズの 1〜3）の絵とメニューをそろえて並べる */}
              <div className="mode-list">
                <ModeRow tile="1p" name={t('menuCpu')} desc={t('menuCpuDesc')} onClick={() => setScreen('cpu')} />
                <ModeRow tile="2p" name={t('menuOnline')} desc={t('menuOnlineDesc')} onClick={() => setScreen('online')} />
                <ModeRow tile="3p" name={t('menuReplay')} desc={t('menuReplayDesc')} onClick={() => setScreen('replay')} />
              </div>
            </>
          )}
          <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void openFile(e)} />
        </main>
      )}
      {/* フッターはモード選択（トップ）だけ。ページの一番下に帯で置く（ほかのアプリと同じ） */}
      {!started && !replaying && screen === 'top' && (
        <SiteFooter t={t}>
          {/* 賭けに使えないことの1行と、同意した文面・利用規約をあとから読み返すリンク（免責 v0.04 §3・§4） */}
          <div className="title-foot">
            <p>{notice.titleNote}</p>
            <p className="notice-links">
              <button type="button" className="link-btn" onClick={() => setReading('about')}>
                {notice.aboutLink}
              </button>
              <button type="button" className="link-btn" onClick={() => setReading('fairness')}>
                {notice.fairnessLink}
              </button>
              <a href={TERMS_URL} target="_blank" rel="noopener">
                {notice.terms}
              </a>
            </p>
          </div>
        </SiteFooter>
      )}
      <Effects t={t} banner={fx.banner} kusudama={fx.kusudama} />
      {soundAsk && (
        <SoundPrompt
          t={t}
          onDone={() => {
            setSoundAsk(false);
            finishAudioAsk();
            fx.syncBgm();
          }}
        />
      )}
      {settingsOpen && <SettingsPanel t={t} onClose={() => setSettingsOpen(false)} />}
      {!consented ? (
        <Notice
          lang={baseOf(lang)}
          first="about"
          consent
          onAgree={() => setConsented(true)}
          onClose={() => {}}
        />
      ) : reading ? (
        <Notice key={reading} lang={baseOf(lang)} first={reading} consent={false} onAgree={() => {}} onClose={() => setReading(null)} />
      ) : null}
    </SeatContext.Provider>
  );
}
