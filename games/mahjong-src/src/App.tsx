import { useEffect, useState } from 'react';
import { useTable } from './game/useTable';
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
  const { view, legal, start, next, choose, started } = useTable();
  const { layout, canSwitch, toggle } = useLayout();
  const t = (k: MessageKey) => translate(lang, k);

  useEffect(() => {
    document.body.classList.toggle('in-game', started);
    const base = baseOf(lang);
    document.documentElement.lang = base === 'zh' ? 'zh-CN' : base;
  }, [started, lang]);

  const onLang = (m: LangMode) => {
    setMode(m);
    setLang(changeMode(m));
  };

  return (
    <>
      <header className="site-header">
        <img className="cat-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
        <div className="title-block">
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
      {started ? (
        <main className="game">
          <Table narrow={layout === 'lanes'} view={view} legal={legal} lang={lang} onChoose={choose} onNext={next} onNewGame={start} />
        </main>
      ) : (
        <main className="title">
          <p className="trial">{t('trial')}</p>
          <button type="button" className="btn-primary btn-start" onClick={start}>
            {t('start')}
          </button>
        </main>
      )}
    </>
  );
}
