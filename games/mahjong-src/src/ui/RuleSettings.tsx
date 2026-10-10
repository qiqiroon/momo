// ルールの設定（段階6の6a-2）。見本 settings.html を本物にしたもの。動きは見本と同じ：
//  - 上でセットを選ぶと、下の個別設定がまとめて切り替わる
//  - 個別設定を 1 つでも変えてどのセットとも違えば「カスタムルール」（札は状態を示すだけで押せない）
//  - 押せない理由は「別の項目の値と矛盾する」ことだけ（理由も項目の言葉で書く）
//  - まとまりごとに畳む。まとまりの中で「どのセットも同じ値」の項目は「細かい決まり」にさらに畳む。最初は全部畳む
//  - 条文なしを MOMO が補った値は青い字で示す
// 中国式のセットは段階9まで押しても変わらない（並べ方は見本どおり）。

import { useState } from 'react';
import { JP_FIXED, JP_ITEMS, TIERS, type RuleItem } from '../engine/ruleTable';
import { JP_RULE_ITEMS, JP_SETS, blockedBy, familyOf, isSupplied, labelOf, presetValue, rulesOfSet, type SetId } from '../engine/ruleSets';
import type { JpRuleKey } from '../engine/rules';
import { groupName, optLabel, ruleName, ruleNote } from '../i18n/ruleText';
import type { BaseLang, MessageKey } from '../i18n/strings';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export interface RuleChoice {
  /** 基にしたセット */
  base: SetId;
  values: Record<JpRuleKey, string>;
}

const STORE_KEY = 'momo-mahjong.rules';

/** 前に選んだルール（端末に覚える）。無ければ一般ルール */
export function loadRuleChoice(): RuleChoice {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as RuleChoice;
      const full = rulesOfSet((JP_SETS as readonly string[]).includes(c.base) ? c.base : 'general');
      if (full.family === 'jp') return { base: c.base, values: { ...full.values, ...c.values } };
    }
  } catch {
    /* 読めなければ一般ルール */
  }
  const g = rulesOfSet('general');
  return { base: 'general', values: { ...(g.values as Record<JpRuleKey, string>) } };
}

export function saveRuleChoice(c: RuleChoice) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    /* 覚えられない端末 */
  }
}

/** 見出しの行のあとに続く項目（まとまりごと） */
function groups(): { name: string; fold: boolean; members: typeof JP_RULE_ITEMS }[] {
  const out: { name: string; fold: boolean; members: typeof JP_RULE_ITEMS }[] = [];
  let cur: { name: string; fold: boolean; members: (typeof JP_RULE_ITEMS)[number][] } | null = null;
  for (const x of JP_ITEMS as readonly RuleItem[]) {
    if (x.group) {
      cur = { name: x.group, fold: !!x.fold, members: [] };
      out.push(cur);
    } else if (x.k && cur) {
      const it = JP_RULE_ITEMS.find((y) => y.k === x.k);
      if (it) cur.members.push(it);
    }
  }
  return out;
}

/** どのセットも同じ値の項目（細かい決まり） */
const isDetail = (k: JpRuleKey) => new Set(JP_SETS.map((s) => presetValue(s, k))).size === 1;

export function RuleSettings({ t, lang, choice, onChange }: { t: T; lang: BaseLang; choice: RuleChoice; onChange: (c: RuleChoice) => void }) {
  /** 開いているまとまり（最初は全部畳む） */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const label = labelOf(choice.values, choice.base);
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const pickSet = (set: string) => {
    if (familyOf(set) !== 'jp') return; // 中国式は段階9
    const r = rulesOfSet(set as SetId);
    if (r.family === 'jp') onChange({ base: set as SetId, values: { ...(r.values as Record<JpRuleKey, string>) } });
  };
  const setValue = (k: JpRuleKey, v: string) => onChange({ base: choice.base, values: { ...choice.values, [k]: v } });
  const changed = (ms: typeof JP_RULE_ITEMS) => ms.filter((m) => choice.values[m.k] !== presetValue(choice.base, m.k)).length;

  const row = (it: (typeof JP_RULE_ITEMS)[number]) => {
    const why = blockedBy(choice.values, it.k);
    const note = ruleNote(it.k, lang);
    return (
      <div className="set-row" key={it.k}>
        <span className="lbl">
          {ruleName(it.k, lang)}
          {isSupplied(choice.base, it.k) ? <small className="supp">{t('rsSupplied')}</small> : note ? <small>{note}</small> : null}
          {why && <small className="why">{t('rsBlocked', { item: ruleName(why.k, lang).replace(/（.*$|\(.*$/, ''), value: optLabel(why.k, why.value, lang) })}</small>}
        </span>
        <span className="seg">
          {it.opts.map(([v]) => (
            <button type="button" key={v} className={choice.values[it.k] === v ? 'on' : ''} disabled={!!why} onClick={() => setValue(it.k, v)}>
              {optLabel(it.k, v, lang)}
            </button>
          ))}
        </span>
      </div>
    );
  };

  return (
    <section className="gset rule-settings">
      <h3>{t('ruleSet')}</h3>
      <details className="about-sets">
        <summary>{t('aboutSets')}</summary>
        <p className="guide">{t('aboutSetsText')}</p>
      </details>
      <div className="sets">
        {TIERS.map((tier, i) => (
          <div className="tier" key={i}>
            <span>{t(i === 0 ? 'tierJp' : 'tierCn')}</span>
            <span className="seg">
              {tier.sets.map((s) => {
                const tag = (s as readonly string[])[2];
                return (
                  <button
                    type="button"
                    key={s[0]}
                    className={`${label === s[0] ? 'on' : ''}${tag ? ' tagged' : ''}`}
                    data-tag={tag ? t(tag === 'net' ? 'tagNet' : 'tagIntl') : undefined}
                    onClick={() => pickSet(s[0])}
                  >
                    {t(`set_${s[0]}` as MessageKey)}
                  </button>
                );
              })}
            </span>
          </div>
        ))}
        <div className="tier">
          <span />
          <span>
            <span className={`custom-chip${label === 'custom' ? ' on' : ''}`}>{t('rsCustom')}</span>
          </span>
        </div>
      </div>
      {label === 'custom' && <p className="cur">{t('rsChangedFrom', { set: t(`set_${choice.base}` as MessageKey) })}</p>}
      <div className="indiv-head">{t('rsIndivHead')}</div>
      <div className="rule-rows">
        {groups().map((g) => {
          const key = g.name;
          const isOpen = !!open[key];
          const count = g.fold
            ? t('rsLocalCount', { n: g.members.filter((m) => choice.values[m.k] === 'on').length, all: g.members.length })
            : t('rsGroupCount', { n: g.members.length, c: changed(g.members) });
          const main = g.fold ? g.members : g.members.filter((m) => !isDetail(m.k));
          const detail = g.fold ? [] : g.members.filter((m) => isDetail(m.k));
          const dkey = key + ':detail';
          return (
            <div key={key}>
              <button type="button" className="group fold" aria-expanded={isOpen} onClick={() => toggle(key)}>
                {isOpen ? '▼' : '▶'} {groupName(g.name, lang)}（{count}）
              </button>
              {isOpen && main.map(row)}
              {isOpen && detail.length > 0 && (
                <>
                  <button type="button" className="group fold detail" aria-expanded={!!open[dkey]} onClick={() => toggle(dkey)}>
                    {open[dkey] ? '▼' : '▶'} {t('rsDetail', { n: detail.length, c: changed(detail) })}
                  </button>
                  {open[dkey] && detail.map(row)}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="fixed">{lang === 'ja' ? JP_FIXED.replace(/<\/?b>/g, '') : t('rsFixed')}</p>
    </section>
  );
}
