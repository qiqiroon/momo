// アシストモード（訂正26101113 の 2・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md）
//  - StartConsent：始める前の案内（アシスト・制限時間のどちらか／両方を 1 つの窓で）。アシストに「やめる」は置かない（利用者指示）
//  - ConsentWait：OK を押したあと、ほかの人を待つあいだ（ホストには誰を待っているか）
//  - AssistPanel：卓の横の余白に出す欄。余白が足りなければ帯「アシスト ▲」で開け閉めする（Q8=A）
// 見た目は制限時間の同意の窓（sound-backdrop・sound-panel）にそろえる。
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

/** 締め切りまでの残り秒数（切り上げ）。描き直しのため少しずつ時を進める */
function useSecondsLeft(deadline: number | null): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/** アシストの案内の文（4 つの段落） */
function AssistText({ t }: { t: T }) {
  return (
    <>
      <p className="as-intro">{t('asIntro')}</p>
      <p>{t('asHints')}</p>
      <p>{t('asFair')}</p>
      <p>{t('asCpu')}</p>
    </>
  );
}

export interface StartConsentProps {
  t: T;
  /** アシストモードの案内を出す */
  assist: boolean;
  /** 1 手の制限時間（秒・0＝時間なし＝制限時間の段は出さない） */
  seconds: number;
  /** 押す締め切り（時間のある対局だけ） */
  deadline: number | null;
  onOk: () => void;
  /** やめる（時間のある対局だけ＝席を CPU に任せる） */
  onCancel?: () => void;
}

/** 始める前の案内。アシストと制限時間が両方なら上下に並べ、ボタンは 1 組 */
export function StartConsent({ t, assist, seconds, deadline, onOk, onCancel }: StartConsentProps) {
  const left = useSecondsLeft(deadline);
  const timed = seconds > 0;
  return (
    <div className="sound-backdrop tc-backdrop" role="dialog" aria-modal="true" aria-label={t(assist ? 'asTitle' : 'tcTitle')}>
      <div className="sound-panel time-consent start-consent">
        {assist && (
          <>
            <h2>{t('asTitle')}</h2>
            <AssistText t={t} />
          </>
        )}
        {timed && (
          <>
            {assist ? <h3>{t('tcTitle')}</h3> : <h2>{t('tcTitle')}</h2>}
            <p>{t('tcBody', { s: seconds })}</p>
            <p className="tc-note">{t('tcCancelNote')}</p>
          </>
        )}
        <div className="tc-buttons">
          <button type="button" className="btn-primary tc-ok" onClick={onOk}>
            {t(assist ? 'asOk' : 'tcOk')}
          </button>
          {timed && onCancel && (
            <button type="button" className="btn-secondary tc-cancel" onClick={onCancel}>
              {t('tcCancel')}
            </button>
          )}
        </div>
        {left !== null && <p className="tc-countdown">{t('tcCountdown', { n: left })}</p>}
      </div>
    </div>
  );
}

/** OK を押したあと、ほかの人を待つあいだ。names＝ホストが待っている人（ホスト以外は空＝誰かは出さない） */
export function ConsentWait({ t, names }: { t: T; names: string[] }) {
  return (
    <div className="sound-backdrop tc-backdrop" role="status">
      <div className="sound-panel time-consent">
        <p>{names.length > 0 ? t('asWaitNames', { names: names.join(t('listDot')) }) : t('tcWaitOthers')}</p>
      </div>
    </div>
  );
}

/** 見出しの札「アシストモード」（全員の画面に出す＝そのモードの対局だと分かるように） */
export function AssistBadge({ t }: { t: T }) {
  return <span className="assist-badge">{t('asBadge')}</span>;
}

/** 欄の幅（px）。正方形の卓の左に置けるかの見積もりにも使う */
export const ASSIST_W = 240;
/** 卓と横の列のすき間（styles.css の .square-wrap の gap と同じ） */
const GAP = 28;
/** 右の列（鳴ける牌・チャット）の幅（styles.css の .square-wrap .side-col と同じ） */
const SIDE_W = 240;

/**
 * 正方形の卓の左に欄を置けるか（卓の大きさは窓の大きさで決まり、欄では変わらない＝欄を置いても卓は縮まない）。
 * 置けなければ帯で開け閉めする。横 4 列（携帯）はいつも帯
 */
export function useAssistDocked(wrapRef: RefObject<HTMLDivElement | null>, narrow: boolean, on: boolean, hasSide: boolean): boolean {
  const [docked, setDocked] = useState(false);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!on || narrow || !wrap) {
      setDocked(false);
      return;
    }
    const measure = () => {
      const sq = wrap.querySelector<HTMLElement>('.square');
      if (!sq) return;
      const need = sq.offsetWidth + GAP + ASSIST_W + (hasSide ? GAP + SIDE_W : 0);
      setDocked(wrap.clientWidth >= need);
    };
    measure();
    // 卓の大きさは窓の高さでも変わる＝入れ物と卓の両方を見張る（見張りの無い環境では窓の大きさだけ）
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(wrap);
    const sq = wrap.querySelector('.square');
    if (sq) ro?.observe(sq);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [wrapRef, narrow, on, hasSide]);
  return docked;
}

/** アシストの欄の中身（見出しと本文） */
function PanelBody({ t, children }: { t: T; children?: ReactNode }) {
  return (
    <>
      <div className="assist-head">{t('asPanelTitle')}</div>
      <div className="assist-body">{children ?? <p className="assist-soon">{t('asPanelSoon')}</p>}</div>
    </>
  );
}

/** 帯「アシスト ▲」（押すと開く・もう一度押すとたたむ） */
export function AssistTab({ t, open, onToggle, className = '' }: { t: T; open: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`assist-tab${open ? ' open' : ''}${className ? ` ${className}` : ''}`} aria-expanded={open} onClick={onToggle}>
      {t('asPanelTitle')} {open ? '▼' : '▲'}
    </button>
  );
}

/** 開いたときの欄（卓の上に半透明で重ねる） */
export function AssistOver({ t, children }: { t: T; children?: ReactNode }) {
  return (
    <aside className="assist-over">
      <PanelBody t={t}>{children}</PanelBody>
    </aside>
  );
}

/** 正方形の卓：余白に置く欄（docked）か、左上の帯と開いたときの半透明の欄 */
export function AssistPanel({ t, docked, children }: { t: T; docked: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  if (docked) {
    return (
      <aside className="assist-col">
        <PanelBody t={t}>{children}</PanelBody>
      </aside>
    );
  }
  return (
    <div className="assist-float">
      <AssistTab t={t} open={open} onToggle={() => setOpen(!open)} />
      {open && <AssistOver t={t}>{children}</AssistOver>}
    </div>
  );
}
