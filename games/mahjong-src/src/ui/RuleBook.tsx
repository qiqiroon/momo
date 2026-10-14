// ルールブック（2026-10-14 第17・利用者 Q2=A）。1 つの窓にタブ 3 つ：役（中国式は番）の一覧／遊び方／いまのルール。
// 中身は「いま選んでいるルール」（設定画面なら選んでいる途中の値、対局中・再生中は卓のルール）に合わせて出す。
// 開く入口＝ルール選択の画面（RuleSettings）と、卓の画面（正方形は見出し・横4列は卓の上の帯）。対局中は役の一覧のタブで開く。
// 窓は花札の役一覧と同じく、つかんで動かせて後ろを隠さない（DraggableDialog）。

import { useState } from 'react';
import { cnLabelOf, cnNearestSet, generalChoice, jpNearestSet, labelOf, type RuleChoice } from '../engine/ruleSets';
import type { Rules } from '../engine/rules';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { DraggableDialog } from './DraggableDialog';
import { CnFanList, JpYakuList } from './YakuList';
import { RuleSettings } from './RuleSettings';

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

export function RuleBook({ t, lang, rules, first = 'yaku', onClose }: { t: T; lang: BaseLang; rules: Rules; first?: RuleBookTab; onClose: () => void }) {
  const [tab, setTab] = useState<RuleBookTab>(first);
  const tabName = (x: RuleBookTab) => t(x === 'yaku' ? (rules.family === 'cn' ? 'rbTabFan' : 'rbTabYaku') : x === 'howto' ? 'rbTabHowto' : 'rbTabRules');
  return (
    <DraggableDialog className="rulebook">
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
      <div className="rb-body" role="tabpanel" data-tab={tab}>
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
