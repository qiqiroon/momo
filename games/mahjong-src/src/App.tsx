import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Envelope } from './engine/events';
import { useTable } from './game/useTable';
import { buildKifu, kifuFileName, parseKifu, type Kifu, type KifuSource } from './kifu/kifu';
import { downloadText, loadLastGame, saveToDrive } from './kifu/store';
import { Replay } from './ui/Replay';
import { NOTICE, hasConsented, saveConsent } from './i18n/notice';
import { Notice, TERMS_URL, type NoticeKind } from './ui/Notice';
import { LANG_MODES, baseOf, changeMode, currentMode, initLang, translate, type LangMode, type MessageKey } from './i18n/strings';
import { Table } from './ui/Table';
import { useLayout } from './ui/useLayout';
import { APP_VERSION } from './version';

/** 歯車の絵（MOMO Hanafuda・Sudoku と同じ意匠） */
const GEAR =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94 0 .31.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 0 1 8.4 12 3.6 3.6 0 0 1 12 8.4a3.6 3.6 0 0 1 3.6 3.6 3.6 3.6 0 0 1-3.6 3.6z';

export function App() {
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
  /** ご利用にあたって：同意していなければ開いた瞬間に出し、同意するまで閉じない（利用者 Q2=A） */
  const [consented, setConsented] = useState(hasConsented);
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
    setReplaying(null);
    setLast(loadLastGame());
    setNote('');
  };
  /** 見出しのアプリ名：対局の途中なら確かめてからトップへ */
  const onTitle = () => {
    if (replaying) return toTop();
    if (!started) return;
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
  const startGame = () => {
    setNote('');
    start();
  };

  useEffect(() => {
    // 再生中も対局中と同じ見出しの形（小さく）にする
    document.body.classList.toggle('in-game', started || replaying !== null);
    // ご利用にあたっての窓を出しているあいだも、見出し（言語の選択）は窓の上に出す
    document.body.classList.toggle('notice-open', !consented || reading !== null);
    const base = baseOf(lang);
    document.documentElement.lang = base === 'zh' ? 'zh-CN' : base;
  }, [started, replaying, lang, consented, reading]);

  const onLang = (m: LangMode) => {
    setMode(m);
    setLang(changeMode(m));
  };

  return (
    <>
      <header className="site-header">
        <img className="cat-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <div className={`title-block${started || replaying ? ' to-top' : ''}`} onClick={onTitle} role={started || replaying ? 'button' : undefined} title={started || replaying ? t('toTop') : undefined}>
          <h1>
            <span className="momo">MOMO</span>
            <span className="mahjong">Mahjong</span>
            <span className="version-tag">{APP_VERSION}</span>
          </h1>
          <div className={`subtitle${baseOf(lang) === 'zh' ? ' zh' : ''}`}>{t('subtitle')}</div>
        </div>
        <div className="header-right">
          {/* 画面切替：正方形の卓を出せない狭い画面（携帯）ではボタンごと出さない（見出しをはみ出させないため・利用者指示） */}
          {canSwitch && (
            <button type="button" className="icon-btn layout-btn" onClick={toggle}>
              {t('layoutSwitch')}
            </button>
          )}
          {/* 設定の中身はまだ無い（入れる段階で作る）。ボタンだけ先に置く */}
          <button type="button" className="icon-btn" aria-label={t('settings')} title={t('settings')}>
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
          <Replay events={replaying} narrow={layout === 'lanes'} lang={lang} onExit={toTop} />
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
          />
        </main>
      ) : (
        <main className="title">
          <p className="trial">{t('trial')}</p>
          <button type="button" className="btn-primary btn-start" onClick={startGame}>
            {t('start')}
          </button>
          {/* 牌譜：最後の対局（覚えているときだけ）と、ファイルを選んで再生 */}
          <div className="kifu-menu">
            {last && (
              <div className="kifu-row">
                <button type="button" className="btn-primary btn-replay-last" onClick={() => setReplaying(last.events)}>
                  {t('replayLastGame')}
                </button>
                <button type="button" className="btn-primary btn-save-file" onClick={() => saveFile(last)}>
                  {t('saveFile')}
                </button>
                <button type="button" className="btn-primary btn-save-drive" onClick={() => void saveDrive(last)}>
                  {t('saveDrive')}
                </button>
              </div>
            )}
            <button type="button" className="btn-primary btn-replay-file" onClick={() => fileInput.current?.click()}>
              {t('replayFromFile')}
            </button>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => void openFile(e)} />
            {note && <p className="hint save-note">{note}</p>}
          </div>
          {/* 賭けに使えないことの1行と、同意した文面・利用規約をあとから読み返すリンク（免責 v0.03 §3・§4） */}
          <footer className="title-foot">
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
          </footer>
        </main>
      )}
      {!consented ? (
        <Notice
          lang={baseOf(lang)}
          first="about"
          consent
          onAgree={() => {
            saveConsent();
            setConsented(true);
          }}
          onClose={() => {}}
        />
      ) : reading ? (
        <Notice key={reading} lang={baseOf(lang)} first={reading} consent={false} onAgree={() => {}} onClose={() => setReading(null)} />
      ) : null}
    </>
  );
}
