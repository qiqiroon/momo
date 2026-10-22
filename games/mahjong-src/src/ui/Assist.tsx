// アシストモード（訂正26101113 の 2・設計 L:\momo\games\mahjong\docs\MOMO_Mahjong_アシストモード_v0.01.md）
//  - StartConsent：始める前の案内（アシスト・制限時間のどちらか／両方を 1 つの窓で）。アシストに「やめる」は置かない（利用者指示）
//  - ConsentWait：OK を押したあと、ほかの人を待つあいだ（ホストには誰を待っているか）
//  - AssistPanel：卓の横の余白に出す欄。余白が足りなければ帯「アシスト ▲」で開け閉めする（Q8=A）
// 見た目は制限時間の同意の窓（sound-backdrop・sound-panel）にそろえる。
import { useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from 'react';
import type { Reason, Suspect, TileRisk } from '../assist/danger';
import { callLoss, type CallLoss } from '../assist/callCheck';
import { adviceOf, type Advice } from '../assist/advice';
import type { Action } from '../engine/round';
import { yakuPlan, type YakuPlan } from '../assist/yakuPlan';
import type { Job } from '../assist/planWorker';
import type { Seat } from '../engine/events';
import { roundWindOf, seatWindOf, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';
import type { YakuId } from '../engine/yaku';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { yakuDescOf } from '../rulebook/desc';
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
function PanelBody({ t, children, onClose }: { t: T; children?: ReactNode; onClose?: () => void }) {
  return (
    <>
      <div className="assist-head">
        {t('asPanelTitle')}
        {onClose && (
          <button type="button" className="assist-tab assist-close" onClick={onClose}>
            {t('asPanelClose')}
          </button>
        )}
      </div>
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
export function AssistOver({ t, children, onClose }: { t: T; children?: ReactNode; onClose?: () => void }) {
  return (
    <aside className="assist-over">
      <PanelBody t={t} onClose={onClose}>{children}</PanelBody>
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

/** アシストの数えものの働き手（1 つを使い回す）。Worker の無い環境（検査）では null＝画面の側で数える */
let worker: Worker | null | undefined;
let workerSeq = 0;
const workerWaits = new Map<number, (result: unknown) => void>();
function planWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('../assist/planWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  worker?.addEventListener('message', (e: MessageEvent<{ id: number; result: unknown }>) => {
    const done = workerWaits.get(e.data.id);
    workerWaits.delete(e.data.id);
    done?.(e.data.result);
  });
  return worker;
}

/** 働き手に頼む（無ければ描き終えてから画面の側で sync を呼ぶ）。戻り値＝取り消し */
function ask<R>(job: Job extends infer J ? (J extends Job ? Omit<J, 'id'> : never) : never, sync: () => R, done: (r: R) => void): () => void {
  const w = planWorker();
  if (w) {
    const id = ++workerSeq;
    workerWaits.set(id, (r) => done(r as R));
    w.postMessage({ ...job, id });
    return () => workerWaits.delete(id);
  }
  const t = setTimeout(() => done(sync()), 0);
  return () => clearTimeout(t);
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
    return ask<YakuPlan[]>({ kind: 'plan', view, seat }, () => yakuPlan(view, seat), (list) => setPlan({ key, list }));
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

/**
 * 役の組み合わせの名前を、役ごとに押せる形で（押すとルールブックのその役へ・合わせる／長押しで役の条件）。段階5
 * 番が 1 つも付かない行（番なし）は文字だけ
 */
function ComboName({ t, lang, view, seat, p, onYaku, tip }: { t: T; lang: BaseLang; view: GameState; seat: Seat; p: YakuPlan; onYaku?: (id: string) => void; tip?: TipApi }) {
  if (p.ids.length === 0) return <>{comboName(t, view, seat, p)}</>;
  return (
    <>
      {p.ids.map((id, i) => (
        <span key={id}>
          {i > 0 && t('asPlus')}
          <YakuLink t={t} lang={lang} view={view} seat={seat} id={id} onYaku={onYaku} tip={tip} />
        </span>
      ))}
    </>
  );
}

/** 押せる役名 1 つ */
function YakuLink({ t, lang, view, seat, id, onYaku, tip }: { t: T; lang: BaseLang; view: GameState; seat: Seat; id: string; onYaku?: (id: string) => void; tip?: TipApi }) {
  const name = view.rules?.family === 'cn' ? t(`cnFan_${id}` as MessageKey) : yakuName(t, view, seat, id as YakuId);
  const handlers = useTipHandlers(tip, () => (view.rules && yakuDescOf(view.rules, id, lang)) ?? name);
  if (!onYaku) return <span {...handlers}>{name}</span>;
  return (
    <button type="button" className="yaku-link" onClick={() => onYaku(id)} {...handlers}>
      {name}
    </button>
  );
}

/** 卓の上の用語に付ける説明（合わせる／長押しで浮かぶ）。tip が無ければ中身だけ */
export function Gloss({ tip, text, children, className = '' }: { tip?: TipApi; text: () => ReactNode; children: ReactNode; className?: string }) {
  const handlers = useTipHandlers(tip, text);
  if (!tip) return <>{children}</>;
  return (
    <span className={`gloss${className ? ` ${className}` : ''}`} {...handlers}>
      {children}
    </span>
  );
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
export function YakuPlanList({ t, lang, view, seat, plan: res, crushed, onYaku, tip }: { t: T; lang: BaseLang; view: GameState; seat: Seat; plan: { list: YakuPlan[]; counting: boolean } | null; crushed: ReadonlySet<string>; onYaku?: (id: string) => void; tip?: TipApi }) {
  const plan = res?.list ?? [];
  // 数え終えて 1 行も無い＝あと 6 枚のうちにアガれる形が無い（香港の 3 番・国標の 8 番に届く形が遠いなど）
  if (plan.length === 0) return <p className="assist-soon">{t(res && !res.counting ? 'asNoneNear' : 'asCounting')}</p>;
  return (
    <ul className="plan-list">
      {plan.map((p) => (
        <li key={p.key} className={`plan-row${crushed.has(p.key) ? ' crushed' : ''}`} data-key={p.key}>
          <span className="plan-head">
            <span className="plan-name">
              <ComboName t={t} lang={lang} view={view} seat={seat} p={p} onYaku={onYaku} tip={tip} />
            </span>
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


// ---- 合わせる（指は長押し）と浮かぶ説明（段階4・設計 §5・§8） ----

/** 指の長押しとみなす長さ（ミリ秒） */
export const LONG_PRESS_MS = 450;

export interface TipApi {
  show: (el: Element, content: ReactNode) => void;
  hide: () => void;
}

/** 説明の窓の中身と位置（画面に 1 つだけ） */
export function useTip(): { api: TipApi; box: ReactNode } {
  const [tip, setTip] = useState<{ content: ReactNode; x: number; y: number } | null>(null);
  const api = useMemo<TipApi>(
    () => ({
      show: (el, content) => {
        const r = el.getBoundingClientRect();
        setTip({ content, x: r.left + r.width / 2, y: r.top });
      },
      hide: () => setTip(null),
    }),
    [],
  );
  const box = tip && (
    <div className="assist-tip" role="tooltip" style={{ left: Math.max(8, Math.min(window.innerWidth - 8, tip.x)), top: tip.y }}>
      {tip.content}
    </div>
  );
  return { api, box };
}

/** 説明を出す要素に付ける：マウスは合わせたとき、指は長押しのあいだ（離すと消える・操作にはならない） */
export function useTipHandlers(api: TipApi | undefined, content: () => ReactNode) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!api) return {};
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerEnter: (e: RPointerEvent) => e.pointerType === 'mouse' && api.show(e.currentTarget, content()),
    onPointerLeave: (e: RPointerEvent) => e.pointerType === 'mouse' && api.hide(),
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget as HTMLElement;
      clear();
      timer.current = setTimeout(() => {
        // 長押しだった印（離したあとの押した扱いを 1 回止める＝長押しは操作にならない）
        el.dataset.lp = '1';
        api.show(el, content());
      }, LONG_PRESS_MS);
    },
    onClickCapture: (e: RMouseEvent) => {
      const el = e.currentTarget as HTMLElement;
      if (el.dataset.lp !== '1') return;
      delete el.dataset.lp;
      e.preventDefault();
      e.stopPropagation();
    },
    onPointerUp: (e: RPointerEvent) => {
      if (e.pointerType === 'mouse') return;
      clear();
      api.hide();
    },
    onPointerCancel: () => {
      clear();
      api.hide();
    },
  };
}

/** 理由の言葉（name は席の番号で来るので名前にする） */
export function reasonText(t: T, why: Reason, nameOf: (seat: number) => string): string {
  const v = why.vars ?? {};
  return t(why.key as MessageKey, { ...v, ...(v.name !== undefined ? { name: nameOf(v.name) } : {}) });
}

/** 手牌の牌の危なさの説明（「すごく危ない：CPU 1さんに筋が通っていない真ん中の牌」） */
export function riskText(t: T, r: TileRisk, nameOf: (seat: number) => string): string {
  return `${t(r.level === 2 ? 'dgLv2' : 'dgLv1')}：${reasonText(t, r.why, nameOf)}`;
}

/** 手牌の牌の下の印（小さな三角の中に「！」。少し危ない＝黄・すごく危ない＝赤） */
export function DangerMark({ level }: { level: 1 | 2 }) {
  return (
    <span className={`danger-mark lv-${level}`} aria-hidden="true">
      !
    </span>
  );
}

/** 「テンパイ？」の札（リーチ棒の場所に赤で）。合わせる・長押しで理由とあやしい待ち */
export function TenpaiQ({ t, view, s, nameOf, tip }: { t: T; view: GameState; s: Suspect; nameOf: (seat: number) => string; tip?: TipApi }) {
  const handlers = useTipHandlers(tip, () => (
    <>
      <div>{reasonText(t, s.why, nameOf)}</div>
      {s.waits.length > 0 && (
        <div className="tip-waits">
          {t('tpWaits')}
          {s.waits.map((k) => (
            <Tile key={k} id={k * 4 + 3} rules={view.rules} className="mini" />
          ))}
        </div>
      )}
    </>
  ));
  return (
    <span className="tenpai-q" {...handlers}>
      {t('tpLabel')}
    </span>
  );
}

// ---- 鳴く前の注意（段階4・設計 §6） ----

/**
 * 鳴ける牌が来たとき、鳴きの選び方ごとに「鳴くと消える役・役が無くなるか」を数える（働き手で・選び方ごとに 0.15 秒まで）。
 * 同じ返事の番では数え直さない
 */
export function useCallNotes(view: GameState, seat: Seat, calls: readonly Action[], before: readonly YakuPlan[] | null, on: boolean): { a: Action; loss: CallLoss }[] {
  const key = on && calls.length > 0 && before && view.claim ? JSON.stringify([view.claim.from, view.claim.tile, calls]) : null;
  const [notes, setNotes] = useState<{ key: string; list: { a: Action; loss: CallLoss }[] } | null>(null);
  useEffect(() => {
    if (key === null || !before) return;
    const sync = () =>
      calls.flatMap((a) => {
        const loss = callLoss(view, seat, a, before);
        return loss ? [{ a, loss }] : [];
      });
    return ask<{ a: Action; loss: CallLoss }[]>({ kind: 'calls', view, seat, calls: [...calls], before: [...before] }, sync, (list) => setNotes({ key, list }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key !== null && notes?.key === key ? notes.list : [];
}

/** 手牌の上の 1 行：「チーすると平和・一盃口・リーチが消えます／ポンすると役が無くなります」 */
export function CallLine({ t, view, seat, notes }: { t: T; view: GameState; seat: Seat; notes: { a: Action; loss: CallLoss }[] }) {
  const name = (id: string) =>
    id === 'riichi' ? t('riichi') : view.rules?.family === 'cn' ? t(`cnFan_${id}` as MessageKey) : yakuName(t, view, seat, id as YakuId);
  const parts = [
    ...new Set(
      notes.flatMap(({ a, loss }) => {
        const call = t(a.type as MessageKey);
        if (loss.none) return [t('cwNone', { call })];
        if (loss.lost.length === 0) return [];
        return [t('cwLost', { call, list: loss.lost.map(name).join(t('listDot')) })];
      }),
    ),
  ];
  if (parts.length === 0) return null;
  return <div className="yaku-hints assist-crush call-warn">{parts.join(' ／ ')}</div>;
}

// ---- 行動の助言（段階6・設計 §7） ----

/** 行動の助言を数える（働き手で・局面が変わるたび）。数え直しているあいだは前の助言を出したまま */
export function useAdvice(view: GameState, seat: Seat, legal: readonly Action[], plan: readonly YakuPlan[] | null, on: boolean): Advice | null {
  const key = on && plan ? JSON.stringify([view.nextSeq, view.phase, legal, plan.map((p) => p.key)]) : null;
  const [advice, setAdvice] = useState<Advice | null>(null);
  useEffect(() => {
    if (key === null || !plan) return;
    return ask<Advice | null>({ kind: 'advice', view, seat, legal: [...legal], plan: [...plan] }, () => adviceOf(view, seat, legal, plan), setAdvice);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return key === null ? null : advice;
}

/** 助言の 1〜2 文（欄の一番上）。文のあとにおすすめの牌・待ちを絵で */
export function AdviceLine({ t, view, seat, advice, nameOf }: { t: T; view: GameState; seat: Seat; advice: Advice | null; nameOf: (seat: number) => string }) {
  if (!advice) return null;
  const v = advice.vars;
  const combo = advice.combo
    ? comboName(t, view, seat, { ids: advice.combo, key: '', need: 0, points: 0, fan: 0, tiles: [], furiten: false, spare: new Set(), partial: false })
    : '';
  const text = t(advice.key as MessageKey, {
    ...v,
    ...(v.name !== undefined ? { name: nameOf(Number(v.name)) } : {}),
    ...(typeof v.state === 'string' ? { state: t(v.state as MessageKey) } : {}),
    ...(v.suit !== undefined ? { suit: t(`suit${v.suit}` as MessageKey) } : {}),
    ...(v.how !== undefined ? { how: t(v.how as MessageKey) } : {}),
    combo,
  });
  return (
    <p className="assist-advice">
      {text}
      {advice.tiles.map((k) => (
        <Tile key={k} id={k * 4 + 3} rules={view.rules} className="mini" />
      ))}
    </p>
  );
}
