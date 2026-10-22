// アシストモード（訂正26101113 の 2・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md）
//  - StartConsent：始める前の案内（アシスト・制限時間のどちらか／両方を 1 つの窓で）。アシストに「やめる」は置かない（利用者指示）
//  - ConsentWait：OK を押したあと、ほかの人を待つあいだ（ホストには誰を待っているか）
//  - AssistPanel：卓の横の余白に出す欄。余白が足りなければ帯「アシスト ▲」で開け閉めする（Q8=A）
// 見た目は制限時間の同意の窓（sound-backdrop・sound-panel）にそろえる。
import { useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react';
import { yakuPlan, type YakuPlan } from '../assist/yakuPlan';
import type { Seat } from '../engine/events';
import { roundWindOf, seatWindOf, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';
import type { YakuId } from '../engine/yaku';
import type { MessageKey } from '../i18n/strings';
import { visibleCounts } from '../cpu/shanten';
import { Tile } from './Tile';

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

// ---- 役の候補一覧（段階2・設計 §4） ----

/** 役の候補一覧を数える働き手（1 つを使い回す）。Worker の無い環境（検査）では null＝画面の側で数える */
let worker: Worker | null | undefined;
let workerSeq = 0;
const workerWaits = new Map<number, (list: YakuPlan[]) => void>();
function planWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('../assist/planWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  worker?.addEventListener('message', (e: MessageEvent<{ id: number; list: (Omit<YakuPlan, 'spare'> & { spare: number[] })[] }>) => {
    const done = workerWaits.get(e.data.id);
    workerWaits.delete(e.data.id);
    done?.(e.data.list.map((p) => ({ ...p, spare: new Set(p.spare) })));
  });
  return worker;
}

/**
 * 役の候補一覧を数える。局面が変わる（手牌・場に見える牌・ドラ表示）たびに数え直す。
 * 数えるのは働き手（卓を止めない・あと 6〜7 枚の段まで数えきる）。働き手が無ければ描き終えてから画面の側で（時間の上限つき）。
 * 数え直しているあいだは前の一覧を出したまま。手牌が伏せているときは null
 */
export function useYakuPlan(view: GameState, seat: Seat, on: boolean): { list: YakuPlan[]; counting: boolean } | null {
  const key = useMemo(() => {
    if (!on || !view.rules || view.roundIndex < 0) return null;
    const hand = view.hands[seat];
    if (hand.length === 0 || hand.some((t) => t < 0)) return null;
    return JSON.stringify([seat, view.roundIndex, view.honba, view.dealer, hand, visibleCounts(view, seat), view.doraIndicators, view.melds[seat].length, view.discards[seat].length]);
  }, [on, view, seat]);
  const [plan, setPlan] = useState<{ key: string; list: YakuPlan[] } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const w = planWorker();
    if (w) {
      const id = ++workerSeq;
      workerWaits.set(id, (list) => live && setPlan({ key, list }));
      w.postMessage({ id, view, seat });
      return () => {
        live = false;
        workerWaits.delete(id);
      };
    }
    const id = setTimeout(() => setPlan({ key, list: yakuPlan(view, seat) }), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return null;
  return plan?.key === key ? { list: plan.list, counting: false } : { list: plan?.list ?? [], counting: true };
}

/** 手牌が 14 枚（切る番）のとき、その牌を切ると遠くなる行（役の組み合わせの key。数え終えていない段の行は出さない） */
export function crushedBy(plan: readonly YakuPlan[] | null, handSize: number, tile: TileId | null): Set<string> {
  const out = new Set<string>();
  if (!plan || tile === null || tile < 0 || handSize % 3 !== 2) return out;
  const k = kindOf(tile);
  for (const p of plan) if (!p.partial && !p.spare.has(k)) out.add(p.key);
  return out;
}

/** 役の名前（場風・自風は何の風か） */
export function yakuName(t: T, view: GameState, seat: Seat, id: YakuId): string {
  const wind = id === 'roundWind' ? roundWindOf(view) : id === 'seatWind' ? seatWindOf(view, seat) : null;
  return t(`yaku_${id}` as MessageKey, { wind: wind === null ? '' : t(`wind${wind - 27}` as MessageKey) });
}

/** 役の組み合わせの名前（「自風 北＋混一色」）。中国式は番の名前、番が 1 つも付かないアガリ（四川の平胡）は「番なし」 */
export function comboName(t: T, view: GameState, seat: Seat, p: YakuPlan): string {
  if (view.rules?.family === 'cn') return p.ids.length === 0 ? t('asNoFan') : p.ids.map((id) => t(`cnFan_${id}` as MessageKey)).join(t('asPlus'));
  return p.ids.map((id) => yakuName(t, view, seat, id as YakuId)).join(t('asPlus'));
}

/** 「坎张は连六・喜相逢に変えることも可能」 */
function swapNote(t: T, swap: NonNullable<YakuPlan['swap']>): string {
  const names = (ids: string[]) => ids.map((id) => t(`cnFan_${id}` as MessageKey)).join(t('asPlus'));
  return t('asSwap', { mine: names(swap.mine), others: swap.alts.map(names).join(t('asOr')) });
}

/** 1 行に出す牌の数（欄の幅 240px に、牌と残りの枚数が収まる数。あふれた分は「…ほか N 種」） */
const TILES_PER_ROW = 6;

/** 近づく牌：残りの多い順に 1 行ぶん。「…ほか N 種」を押す（合わせる）と全部 */
function PlanTiles({ t, view, tiles }: { t: T; view: GameState; tiles: YakuPlan['tiles'] }) {
  const [all, setAll] = useState(false);
  const shown = all ? tiles : tiles.slice(0, TILES_PER_ROW);
  const more = tiles.length - shown.length;
  return (
    <span className={`plan-tiles${all ? ' all' : ''}`} onMouseLeave={() => setAll(false)}>
      {shown.map((x) => (
        <span key={x.kind} className="plan-tile">
          <Tile id={x.kind * 4 + 3} rules={view.rules} className="mini" />
          <span className="plan-left">({x.left})</span>
        </span>
      ))}
      {more > 0 && (
        <button type="button" className="plan-more" onMouseEnter={() => setAll(true)} onClick={() => setAll(!all)}>
          {t('asMore', { n: more })}
        </button>
      )}
    </span>
  );
}

/** 役の候補一覧（1 行＝役の組み合わせ。あと何枚の少ない順・同じ枚数は点の高い順）。crushed＝合わせた牌を切るとつぶれる行 */
export function YakuPlanList({ t, view, seat, plan: res, crushed }: { t: T; view: GameState; seat: Seat; plan: { list: YakuPlan[]; counting: boolean } | null; crushed: ReadonlySet<string> }) {
  const plan = res?.list ?? [];
  // 数え終えて 1 行も無い＝あと 6 枚のうちにアガれる形が無い（香港の 3 番・国標の 8 番に届く形が遠いなど）
  if (plan.length === 0) return <p className="assist-soon">{t(res && !res.counting ? 'asNoneNear' : 'asCounting')}</p>;
  return (
    <ul className="plan-list">
      {plan.map((p) => (
        <li key={p.key} className={`plan-row${crushed.has(p.key) ? ' crushed' : ''}`} data-key={p.key}>
          <span className="plan-head">
            <span className="plan-name">{comboName(t, view, seat, p)}</span>
            <span className="plan-need">{p.need === 0 ? t('asWinShape') : p.need === 1 ? t('asTenpai') : t('asNeed', { n: p.need })}</span>
            {/* 中国式は番の数（点の数え方が四川・香港・国標で違うので、どれでも通じる番で出す） */}
            {/* 番が 1 つも付かない行（番なし）は数を出さない（名前と重なる） */}
            {(view.rules?.family !== 'cn' || p.ids.length > 0) && <span className="plan-points">{view.rules?.family === 'cn' ? t('asFan', { n: p.fan }) : t('asPoints', { n: p.points })}</span>}
          </span>
          {p.tiles.length > 0 && <PlanTiles t={t} view={view} tiles={p.tiles} />}
          {/* 1 番の番だけ入れ替えられる組み合わせをまとめた行：入れ替えられることだけを書く（待ちは出さない＝利用者指示 10-22） */}
          {p.swap && <span className="plan-swap">{swapNote(t, p.swap)}</span>}
          {p.furiten && <span className="plan-furiten">{t('asFuriten')}</span>}
        </li>
      ))}
    </ul>
  );
}

/** 手牌の上の 1 行：合わせた牌を切るとつぶれる役 */
export function CrushLine({ t, view, seat, plan, crushed }: { t: T; view: GameState; seat: Seat; plan: YakuPlan[] | null; crushed: ReadonlySet<string> }) {
  if (!plan || crushed.size === 0) return null;
  const names = plan.filter((p) => crushed.has(p.key)).map((p) => comboName(t, view, seat, p));
  return <div className="yaku-hints assist-crush">{t('asCrush', { list: names.join(t('listDot')) })}</div>;
}

