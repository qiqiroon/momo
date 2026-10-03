import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18nStore } from '../../core/store/i18n-store';
import { useRulebookStore } from '../../core/store/rulebook-store';
import { t as _t } from '../../core/i18n';
import { seButton } from '../../core/audio/se-synth';
import { loadRulebook, RULEBOOKS, type RulebookLang } from './load';
import { parseMarkdown, splitBold, type Block } from './markdown-lite';

/**
 * ★v1.99 ルールブックの窓 (画面機能 v0.59 §4.1 M08・見本 momo_shogi_rulebook_mock_v2)。
 *
 * - S01「遊び方」から開くと**一覧**から、S02・S06 から開くと**本文**から出る。
 * - 閉じ方＝右上の ✕・窓の外を押す・Esc。閉じれば元の画面に戻る (画面は移らない)。
 * - **本文は画面の言語**。猫語のときは**猫語にする前の言語** (本文は鳴き声にしない・付録D-1 §10.2)。
 *   題名やボタンは t() を通す＝猫語にする。
 * - **呼び名の決まり**＝本文の一歩手前の名前 (一覧の項目) は「MOMO Shogi式量子将棋ルール」。
 *
 * どの画面の上にも出るよう、`document.body` へ出す (画面の入れ物の重なり順に埋もれない)。
 */
export function RulebookWindow() {
  const open = useRulebookStore((s) => s.open);
  if (!open) return null;
  return createPortal(<RulebookPanel />, document.body);
}

type LoadState = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'failed' };

function RulebookPanel() {
  const open = useRulebookStore((s) => s.open)!;
  const { close, showDoc, showList } = useRulebookStore.getState();
  const locale = useI18nStore((s) => s.locale);
  const catBase = useI18nStore((s) => s.catBase);
  const t = (key: string) => _t(key, locale);
  const docLang: RulebookLang = locale === 'cat' ? catBase : locale === 'en' || locale === 'zh' ? locale : 'ja';

  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [tocOpen, setTocOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (open.view !== 'doc') return;
    let alive = true;
    setLoad({ status: 'loading' });
    loadRulebook(RULEBOOKS[0], docLang).then(
      (text) => alive && setLoad({ status: 'ready', text }),
      () => alive && setLoad({ status: 'failed' }),
    );
    return () => {
      alive = false;
    };
  }, [open.view, docLang]);

  const parsed = useMemo(() => (load.status === 'ready' ? parseMarkdown(load.text) : null), [load]);

  const jump = (id: string) => {
    setTocOpen(false);
    const body = bodyRef.current;
    const el = body?.querySelector<HTMLElement>(`#${id}`);
    if (body && el) body.scrollTop = el.offsetTop - body.offsetTop - 6;
  };

  const isDoc = open.view === 'doc';
  return (
    <div
      className="rb-overlay"
      data-momo-rulebook-window=""
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="rb-panel" role="dialog" aria-modal="true" aria-label={isDoc ? t('rulebook.quantum') : t('rulebook.play')}>
        <div className="rb-head">
          {isDoc && open.fromList && (
            <button type="button" className="rb-ghost" onClick={() => { seButton(); showList(); setTocOpen(false); }}>
              {t('rulebook.backToList')}
            </button>
          )}
          <span className="rb-title">{isDoc ? t('rulebook.quantum') : t('rulebook.play')}</span>
          <span className="rb-sp" />
          {isDoc && parsed && parsed.toc.length > 0 && (
            <button
              type="button"
              className={`rb-ghost${tocOpen ? ' on' : ''}`}
              aria-expanded={tocOpen}
              onClick={() => setTocOpen((v) => !v)}
            >
              {t('rulebook.toc')}
            </button>
          )}
          <button type="button" className="rb-close" aria-label={t('rulebook.close')} title={t('rulebook.close')} onClick={close}>
            ✕
          </button>
        </div>
        <div className="rb-body" ref={bodyRef}>
          {!isDoc ? (
            <>
              <div className="rb-lead">{t('rulebook.choose')}</div>
              <button type="button" className="rb-item" onClick={() => { seButton(); showDoc(); }}>
                <div>
                  <div className="rb-item-name">{t('rulebook.quantum')}</div>
                  <div className="rb-item-desc">{t('rulebook.version')}</div>
                </div>
                <span className="rb-sp" />
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          ) : load.status === 'loading' ? (
            <div className="rb-lead">{t('rulebook.loading')}</div>
          ) : load.status === 'failed' || !parsed ? (
            <div className="rb-lead rb-failed">{t('rulebook.failed')}</div>
          ) : (
            <>
              {tocOpen && (
                <nav className="rb-toc">
                  {parsed.toc.map((e) => (
                    <button type="button" key={e.id} onClick={() => jump(e.id)}>
                      <Inline text={e.text} />
                    </button>
                  ))}
                </nav>
              )}
              <div className={`rb-doc${docLang === 'zh' ? ' zh' : ''}`} lang={docLang}>
                {parsed.blocks.map((b, i) => (
                  <BlockView key={i} b={b} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <Fragment key={i}>{s.text}</Fragment>))}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level}` as 'h1' | 'h2' | 'h3';
      return (
        <H id={b.id}>
          <Inline text={b.text} />
        </H>
      );
    }
    case 'p':
      return (
        <p>
          {b.lines.map((l, i) => (
            <Fragment key={i}>
              {i > 0 && <br />}
              <Inline text={l} />
            </Fragment>
          ))}
        </p>
      );
    case 'ul':
      return (
        <ul>
          {b.items.map((x, i) => (
            <li key={i}>
              <Inline text={x} />
            </li>
          ))}
        </ul>
      );
    case 'pre':
      return <pre>{b.text}</pre>;
    case 'table':
      return (
        <table>
          <thead>
            <tr>
              {b.head.map((c, i) => (
                <th key={i}>
                  <Inline text={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>
                    <Inline text={c} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    case 'hr':
      return null;
  }
}
