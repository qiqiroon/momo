// ルールブック（2026-10-14 第17・利用者 Q2=A）。1 つの窓にタブ 3 つ：役（中国式は番）の一覧／遊び方／いまのルール。
// 中身は「いま選んでいるルール」（設定画面なら選んでいる途中の値、対局中・再生中は卓のルール）に合わせて出す。
// 開く入口＝ルール選択の画面（RuleSettings）と、卓の画面（正方形は見出し・横4列は卓の上の帯）。対局中は役の一覧のタブで開く。
// 窓は花札の役一覧と同じく、つかんで動かせて後ろを隠さない（DraggableDialog）。

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { cnLabelOf, cnNearestSet, generalChoice, jpNearestSet, labelOf, type RuleChoice } from '../engine/ruleSets';
import type { Rules } from '../engine/rules';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { DraggableDialog } from './DraggableDialog';
import { CnFanList, JpYakuList } from './YakuList';
import { RuleSettings } from './RuleSettings';
import { howtoOf } from '../rulebook/howto';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export type RuleBookTab = 'yaku' | 'howto' | 'rules';

const TABS: readonly RuleBookTab[] = ['yaku', 'howto', 'rules'];

/** 窓の上に出すルールの名前（セットの名前か「カスタムルール」） */
function setNameOf(rules: Rules, t: T): string {
  const label = rules.family === 'cn' ? cnLabelOf(rules.values, cnNearestSet(rules.values)) : labelOf(rules.values, jpNearestSet(rules.values));
  return label === 'custom' ? t('rsCustom') : t(`set_${label}` as MessageKey);
}

/** 「いまのルール」のタブに渡す選び方（基にしたセット＝一番近いセット。セットから変えた項目はオレンジになる） */
function choiceOf(rules: Rules): RuleChoice {
  if (rules.family === 'cn') {
    const g = generalChoice();
    return { base: g.base, values: g.values, cn: cnNearestSet(rules.values), cnValues: { ...rules.values } };
  }
  return { base: jpNearestSet(rules.values), values: { ...rules.values } };
}

/** 手牌の上に収めるとき、窓の高さがこれより低くなるなら収めずに画面いっぱいで開く */
const FIT_MIN_PX = 240;

/**
 * above＝この要素（自分の手牌）の上までに窓を収める（携帯の横4列の卓・利用者 Q4=C 2026-10-15）。
 * 手牌と鳴き・アガリのボタンが窓に隠れないので、開いたまま打てる。手牌の場所が動いたら測り直す。
 */
function useFitAbove(above: string | undefined): number | null {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!above) return;
    const el = document.querySelector(above);
    if (!el) return;
    const measure = () => setTop(el.getBoundingClientRect().top);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [above]);
  return top;
}

/**
 * focus＝この役の行を開く（アシストモードの役名から・段階5）。役のタブにして、その行まで送り、少しのあいだ光らせる。
 * n は同じ役をもう一度押したときも送り直すための通し番号
 */
export function RuleBook({ t, lang, rules, first = 'yaku', above, focus, onClose }: { t: T; lang: BaseLang; rules: Rules; first?: RuleBookTab; above?: string; focus?: { id: string; n: number } | null; onClose: () => void }) {
  const [tab, setTab] = useState<RuleBookTab>(first);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    setTab('yaku');
    // 役のタブを描き終えてから行を探す
    const id = setTimeout(() => {
      const row = bodyRef.current?.querySelector<HTMLElement>(`.rb-row[data-ids~="${focus.id}"]`);
      if (!row) return;
      row.scrollIntoView?.({ block: 'center' });
      row.classList.add('rb-focus');
      setTimeout(() => row.classList.remove('rb-focus'), 2000);
    }, 0);
    return () => clearTimeout(id);
  }, [focus]);
  const handTop = useFitAbove(above);
  const fitH = handTop === null ? 0 : Math.min(handTop - 16, 720);
  const fit = fitH >= FIT_MIN_PX;
  const tabName = (x: RuleBookTab) => t(x === 'yaku' ? (rules.family === 'cn' ? 'rbTabFan' : 'rbTabYaku') : x === 'howto' ? 'rbTabHowto' : 'rbTabRules');
  return (
    <DraggableDialog className={`rulebook${fit ? ' fit-above' : ''}`} style={fit ? ({ '--fit-h': `${fitH}px` } as CSSProperties) : undefined}>
      <div className="rb-head">
        <span className="rb-title">{t('rbTitle')}</span>
        <span className="rb-cur">{t('rbCur', { name: setNameOf(rules, t) })}</span>
      </div>
      <div className="rb-tabs" role="tablist">
        {TABS.map((x) => (
          <button type="button" role="tab" key={x} aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>
            {tabName(x)}
          </button>
        ))}
      </div>
      <div className="rb-body" role="tabpanel" data-tab={tab} ref={bodyRef}>
        {/* 遊び方（Q10=B）：流れの大筋に、いまのルールの値で変わる所を書き分けた文 */}
        {tab === 'howto' && (
          <div className="rb-howto">
            {howtoOf(rules).map((sec, i) => (
              <section key={i}>
                <h4 className="rb-sec">{sec.title[lang]}</h4>
                <ul>
                  {sec.lines.map((l, j) => (
                    <li key={j}>{l[lang]}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {/* いまのルール（Q9=A）：ルール選択の画面と同じまとまり・畳み方で、値は見るだけ */}
        {tab === 'rules' && <RuleSettings t={t} lang={lang} choice={choiceOf(rules)} readOnly cnOk inBook />}
        {tab === 'yaku' && rules.family === 'jp' && <JpYakuList t={t} lang={lang} rules={rules} />}
        {tab === 'yaku' && rules.family === 'cn' && (rules.values.scoring === 'sichuan' || rules.values.scoring === 'hk' || rules.values.scoring === 'mcr') && <CnFanList t={t} lang={lang} rules={rules} scoring={rules.values.scoring} />}
      </div>
      <button type="button" className="btn-secondary rb-close" onClick={onClose}>
        {t('rbClose')}
      </button>
    </DraggableDialog>
  );
}
