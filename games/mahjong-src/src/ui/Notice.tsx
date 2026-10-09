// 「ご利用にあたって」の窓。初めて開いたときは同意するまで閉じられない（同意しないと遊べない＝免責 v0.03 §4）。
// 同意したあとはトップ画面の下のリンクから読み返せる（閉じるボタンつき）。
// 文面は i18n/notice.ts。猫語のときは猫語を選ぶ直前の言語で出す。

import { useEffect, useRef, useState } from 'react';
import { NOTICE, type NoticePage } from '../i18n/notice';
import type { BaseLang } from '../i18n/strings';

/** 利用規約（MOMO Works 共通）。出来上がりは games/mahjong/ に置かれる */
export const TERMS_URL = '../../terms.html';

export type NoticeKind = 'about' | 'fairness';

interface Props {
  lang: BaseLang;
  /** 最初に開く中身 */
  first: NoticeKind;
  /** 同意を求めるとき（閉じるボタンを出さず、同意のボタンだけで閉じる） */
  consent: boolean;
  onAgree: () => void;
  onClose: () => void;
}

function Page({ page }: { page: NoticePage }) {
  return (
    <>
      <h2 className="notice-title">{page.title}</h2>
      {page.lead && <p>{page.lead}</p>}
      {page.sections.map((s) => (
        <section key={s.heading}>
          <h3>{s.heading}</h3>
          {s.text && <p>{s.text}</p>}
          {s.items && (
            <ul>
              {s.items.map((it) => (
                <li key={it}>{it}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {page.foot && <p className="notice-foot">{page.foot}</p>}
    </>
  );
}

export function Notice({ lang, first, consent, onAgree, onClose }: Props) {
  const tx = NOTICE[lang];
  const [kind, setKind] = useState<NoticeKind>(first);
  const body = useRef<HTMLDivElement>(null);
  // 中身を切り替えたら先頭から読めるようにする
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [kind]);
  // 窓の上は見出しの下端まであける（言語を選び直せるように）。携帯では見出しが2段になるので実際の高さで測る
  const [top, setTop] = useState(16);
  useEffect(() => {
    const measure = () => {
      const h = document.querySelector('.site-header')?.getBoundingClientRect().bottom ?? 0;
      setTop(Math.max(16, Math.ceil(h) + 12));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  return (
    <div className="notice-backdrop" style={{ paddingTop: top }} role="dialog" aria-modal="true" aria-label={tx[kind].title}>
      <div className="notice">
        <div className="notice-body" ref={body}>
          <Page page={tx[kind]} />
          {kind === 'about' && (
            <p className="notice-links">
              <button type="button" className="link-btn" onClick={() => setKind('fairness')}>
                {tx.fairnessLink}
              </button>
              <a href={TERMS_URL} target="_blank" rel="noopener">
                {tx.terms}
              </a>
            </p>
          )}
        </div>
        <div className="notice-actions">
          {/* リンク先からは「ご利用にあたって」へ戻る（同意のボタンは「ご利用にあたって」の下だけ） */}
          {kind === 'fairness' && first === 'about' ? (
            <button type="button" className="btn-secondary" onClick={() => setKind('about')}>
              {tx.back}
            </button>
          ) : consent ? (
            <button type="button" className="btn-primary btn-agree" onClick={onAgree}>
              {tx.agree}
            </button>
          ) : null}
          {!consent && (
            <button type="button" className="btn-secondary" onClick={onClose}>
              {tx.close}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
