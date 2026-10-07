import { useEffect, useMemo } from 'react';
import { useTable } from './game/useTable';
import { initLang, translate, type MessageKey } from './i18n/strings';
import { Table } from './ui/Table';
import { APP_VERSION } from './version';

export function App() {
  const lang = useMemo(initLang, []);
  const { view, legal, start, choose, started } = useTable();
  const t = (k: MessageKey) => translate(lang, k);

  useEffect(() => {
    document.body.classList.toggle('in-game', started);
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
  }, [started, lang]);

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
          <div className={`subtitle${lang === 'zh' ? ' zh' : ''}`}>{t('subtitle')}</div>
        </div>
      </header>
      {started ? (
        <main className="game">
          <Table view={view} legal={legal} lang={lang} onChoose={choose} onAgain={start} />
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
