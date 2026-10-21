// ルールの設定（段階6の6a-2）。見本 settings.html を本物にしたもの。動きは見本と同じ：
//  - 上でセットを選ぶと、下の個別設定がまとめて切り替わる
//  - 個別設定を 1 つでも変えてどのセットとも違えば「カスタムルール」（札は状態を示すだけで押せない）
//  - 押せない理由は「別の項目の値と矛盾する」ことだけ（理由も項目の言葉で書く）
//  - まとまりごとに畳む。まとまりの中で「どのセットも同じ値」の項目は「細かい決まり」にさらに畳む。最初は全部畳む
//  - 条文なしを MOMO が補った値は青い字で示す
// 中国式も同じ作り（2026-10-13 第16）。項目は日本式と別の一覧（CN_ITEMS）。選択肢ごとに押せない組み合わせ（CN_FORBID）もある。

import { useState } from 'react';
import { encodeRuleLink } from '../engine/ruleSets';
import { CN_FIXED, CN_ITEMS, JP_FIXED, JP_ITEMS, TIERS, type RuleItem } from '../engine/ruleTable';
import { CN_RULE_ITEMS, CN_SETS, JP_RULE_ITEMS, JP_SETS, blockedBy, cnBlockedBy, cnIsSupplied, cnLabelOf, cnOptionBlockedBy, cnPresetValue, cnValuesOf, familyOf, generalChoice, isSupplied, labelOf, presetValue, rulesOfCnSet, rulesOfSet, type CnSetId, type RuleChoice, type SetId } from '../engine/ruleSets';
import type { CnRuleKey, JpRuleKey } from '../engine/rules';
import { groupName, optLabel, ruleName, ruleNote } from '../i18n/ruleText';
import type { BaseLang, MessageKey } from '../i18n/strings';
import { RuleBook } from './RuleBook';

type T = (k: MessageKey, v?: Record<string, string | number>) => string;

export type { RuleChoice };

const STORE_KEY = 'momo-mahjong.rules';

/** いま遊べる中国式のセット（段階9：四川から。香港・国標はそれぞれの手順で足す） */
export const CN_PLAYABLE: readonly CnSetId[] = ['sichuan', 'hk', 'mcr'];

/** 前に選んだルール（端末に覚える）。無ければ一般ルール */
export function loadRuleChoice(): RuleChoice {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const c = JSON.parse(raw) as RuleChoice;
      const full = rulesOfSet((JP_SETS as readonly string[]).includes(c.base) ? c.base : 'general');
      if (full.family === 'jp') {
        const cn = c.cn && CN_PLAYABLE.includes(c.cn) ? c.cn : null;
        return { base: c.base, values: { ...full.values, ...c.values }, ...(cn ? { cn, cnValues: cnValuesOf(c.cnValues, cn) } : {}) };
      }
    }
  } catch {
    /* 読めなければ一般ルール */
  }
  return generalChoice();
}

export function saveRuleChoice(c: RuleChoice) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    /* 覚えられない端末 */
  }
}

type Item = (typeof JP_RULE_ITEMS)[number] | (typeof CN_RULE_ITEMS)[number];

/** 見出しの行のあとに続く項目（まとまりごと）。fam＝日本式か中国式か */
function groups(fam: 'jp' | 'cn'): { name: string; fold: boolean; members: Item[] }[] {
  const out: { name: string; fold: boolean; members: Item[] }[] = [];
  let cur: { name: string; fold: boolean; members: Item[] } | null = null;
  const list = fam === 'cn' ? CN_RULE_ITEMS : JP_RULE_ITEMS;
  for (const x of (fam === 'cn' ? CN_ITEMS : JP_ITEMS) as readonly RuleItem[]) {
    if (x.group) {
      cur = { name: x.group, fold: !!x.fold, members: [] };
      out.push(cur);
    } else if (x.k && cur) {
      const it = (list as readonly Item[]).find((y) => y.k === x.k);
      if (it) cur.members.push(it);
    }
  }
  // 親が別のまとまりにある子は、親のまとまりへ移す（並べ方は arrange が親のすぐ下にする・利用者 2026-10-21 Q5=A）。
  // ローカル役（畳んで「あり」の数を数えるまとまり）の役は動かさない＝役の一覧から抜けると数がずれる
  const groupOf = (k: string) => out.find((g) => g.members.some((m) => m.k === k));
  for (let moved = true; moved; ) {
    moved = false;
    for (const g of out) {
      if (g.fold) continue;
      for (const m of [...g.members]) {
        const p = parentOf(m);
        const pg = p ? groupOf(p) : undefined;
        if (!pg || pg === g || pg.fold) continue;
        g.members = g.members.filter((x) => x !== m);
        pg.members.push(m);
        moved = true;
      }
    }
  }
  return out;
}

/** どのセットも同じ値の項目（細かい決まり） */
const isDetail = (fam: 'jp' | 'cn', k: string) =>
  fam === 'cn' ? new Set(CN_SETS.map((s) => cnPresetValue(s, k as CnRuleKey))).size === 1 : new Set(JP_SETS.map((s) => presetValue(s, k as JpRuleKey))).size === 1;

/** その項目が選べるかを決める親の項目（ruleTable の dep の 1 つ目）。無ければ null */
const parentOf = (it: Item): string | null => ((it as { dep?: readonly unknown[] }).dep?.[0] as string | undefined) ?? null;

/**
 * まとまりの中の並べ方。外の段（main）は表の順に並べ、子の項目は親のすぐ下に（depth＝何段下げるか）。
 * 「どのセットも同じ値」の子でも、親が外の段にあれば「細かい決まり」に入れず親の下に出す（利用者 2026-10-21 Q4=A。
 * ★前は子だけが「細かい決まり」に入り、親と別の段に分かれた＝リーチ後の暗槓とその条件など）
 */
function arrange(fam: 'jp' | 'cn', members: readonly Item[]): { main: { it: Item; depth: number }[]; detail: Item[] } {
  const inGroup = new Set<string>(members.map((m) => m.k));
  const top = new Set<string>(members.filter((m) => !isDetail(fam, m.k)).map((m) => m.k));
  // 細かい決まりの子のうち、親（またはその親）が外の段にあるものも外の段へ
  let grew = true;
  while (grew) {
    grew = false;
    for (const m of members) {
      const p = parentOf(m);
      if (!top.has(m.k) && p && inGroup.has(p) && top.has(p)) {
        top.add(m.k);
        grew = true;
      }
    }
  }
  const isChild = (m: Item) => {
    const p = parentOf(m);
    return !!p && inGroup.has(p) && top.has(p);
  };
  const main: { it: Item; depth: number }[] = [];
  const put = (it: Item, depth: number) => {
    main.push({ it, depth });
    for (const c of members) if (parentOf(c) === it.k && top.has(c.k)) put(c, depth + 1);
  };
  for (const m of members) if (top.has(m.k) && !isChild(m)) put(m, 0);
  return { main, detail: members.filter((m) => !top.has(m.k)) };
}

/** readOnly＝見るだけ（オンラインのゲスト・始まったあと）：選んだ値だけを文字で出す。まとまりは開いて見られる */
/** マイルールのリンク（いま開いているページの住所＋#rules=…） */
export function ruleLinkUrl(c: RuleChoice): string {
  return `${location.origin}${location.pathname}#rules=${encodeRuleLink(c)}`;
}

/** 「このルールのリンクをコピー」。コピーできない端末では、住所を選べる欄に出す */
function ShareLink({ t, choice }: { t: T; choice: RuleChoice }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const url = ruleLinkUrl(choice);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="rule-share">
      <button type="button" className="btn-secondary" onClick={() => void copy()}>
        {t('rsCopyLink')}
      </button>
      {state === 'copied' && <span className="rule-share-note">{t('rsCopied')}</span>}
      {state === 'failed' && (
        <>
          <span className="rule-share-note">{t('rsCopyFail')}</span>
          <input className="rule-share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        </>
      )}
    </div>
  );
}

/** share＝「このルールのリンクをコピー」を出す（CPU と対局の設定・ホストの待合） */
/** cnOk＝中国式のセットを選べる（CPU と対局・オンライン〔2026-10-14 から〕・リンクで届いたルール） */
/** inBook＝ルールブックの「いまのルール」のタブの中（見出し・セットの説明・ルールブックのボタンを出さない） */
export function RuleSettings({ t, lang, choice, onChange, readOnly = false, share = false, cnOk = false, inBook = false }: { t: T; lang: BaseLang; choice: RuleChoice; onChange?: (c: RuleChoice) => void; readOnly?: boolean; share?: boolean; cnOk?: boolean; inBook?: boolean }) {
  /** 開いているまとまり（最初は全部畳む） */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /** ルールブックを開いているか（中身は選んでいる途中の値に合わせる） */
  const [book, setBook] = useState(false);
  const cn = cnOk ? choice.cn : undefined;
  const fam: 'jp' | 'cn' = cn ? 'cn' : 'jp';
  // 中国式の値（個別に変えた値を含む）。日本式は choice.values
  const cnVals = cn ? cnValuesOf(choice.cnValues, cn) : null;
  const vals: Readonly<Record<string, string>> = cnVals ?? choice.values;
  const baseSet: string = cn ?? choice.base;
  const label = cn ? cnLabelOf(cnVals!, cn) : labelOf(choice.values, choice.base);
  const presetOf = (k: string) => (cn ? cnPresetValue(cn, k as CnRuleKey) : presetValue(choice.base, k as JpRuleKey));
  const suppliedHere = (k: string) => (cn ? cnIsSupplied(cn, k as CnRuleKey) : isSupplied(choice.base, k as JpRuleKey));
  const blockedHere = (k: string) => (cn ? cnBlockedBy(cnVals!, k as CnRuleKey) : blockedBy(choice.values, k as JpRuleKey));
  const toggle = (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] }));
  const pickSet = (set: string) => {
    if (familyOf(set) !== 'jp') {
      // 中国式は、いま遊べるセットだけ（日本式の値はそのまま持っておく）
      if (cnOk && CN_PLAYABLE.includes(set as CnSetId)) onChange?.({ base: choice.base, values: choice.values, cn: set as CnSetId, cnValues: { ...(rulesOfCnSet(set as CnSetId).values as Record<CnRuleKey, string>) } });
      return;
    }
    const r = rulesOfSet(set as SetId);
    if (r.family === 'jp') onChange?.({ base: set as SetId, values: { ...(r.values as Record<JpRuleKey, string>) } });
  };
  const setValue = (k: string, v: string) =>
    onChange?.(cn ? { ...choice, cnValues: { ...cnVals!, [k]: v } } : { base: choice.base, values: { ...choice.values, [k as JpRuleKey]: v } });
  const changed = (ms: readonly Item[]) => ms.filter((m) => vals[m.k] !== presetOf(m.k)).length;
  const itemWord = (k: string) => ruleName(k, lang, fam).replace(/（.*$|\(.*$/, '');

  const row = (it: Item, depth = 0) => {
    const why = blockedHere(it.k);
    const note = ruleNote(it.k, lang, fam);
    // 基にしたセットから変えた項目（Q38＝A：ホストもゲストも、名前と値をオレンジの文字に）
    const changedHere = vals[it.k] !== presetOf(it.k);
    // 選択肢ごとに押せない理由（中国式の同時に成り立ってはいけない組み合わせ）。項目ごと押せないときは出さない
    const optWhy = (v: string) => (cn && !why ? cnOptionBlockedBy(cnVals!, it.k as CnRuleKey, v) : null);
    const optNotes = it.opts.flatMap(([v]) => {
      const w = optWhy(v);
      return w ? [{ v, why: w.map((x) => t('rsWhyPart', { item: itemWord(x.k), value: optLabel(x.k, x.value, lang, fam) })) }] : [];
    });
    return (
      <div className={`set-row${changedHere ? ' changed' : ''}${depth > 0 ? ` child depth${Math.min(depth, 2)}` : ''}`} key={it.k} data-k={it.k}>
        <span className="lbl">
          {ruleName(it.k, lang, fam)}
          {suppliedHere(it.k) ? <small className="supp">{t('rsSupplied')}</small> : note ? <small>{note}</small> : null}
          {why && !readOnly && <small className="why">{t('rsBlocked', { item: itemWord(why.k), value: optLabel(why.k, why.value, lang, fam) })}</small>}
          {!readOnly &&
            optNotes.map((o) => (
              <small className="why" key={o.v}>
                {t('rsOptBlocked', { opt: optLabel(it.k, o.v, lang, fam), why: o.why.join(t('rsWhyJoin')) })}
              </small>
            ))}
        </span>
        {readOnly ? (
          <span className="ro-val">{optLabel(it.k, vals[it.k], lang, fam)}</span>
        ) : (
        <span className="seg">
          {it.opts.map(([v]) => (
            <button type="button" key={v} className={vals[it.k] === v ? 'on' : ''} disabled={!!why || !!optWhy(v)} onClick={() => setValue(it.k, v)}>
              {optLabel(it.k, v, lang, fam)}
            </button>
          ))}
        </span>
        )}
      </div>
    );
  };

  return (
    <section className={`gset rule-settings${inBook ? ' in-book' : ''}`}>
      {!inBook && (
        <>
          <h3>
            {t('ruleSet')}
            <button type="button" className="btn-secondary rb-open" onClick={() => setBook(true)}>
              {t('rbOpen')}
            </button>
          </h3>
          {book && <RuleBook t={t} lang={lang} rules={cnVals ? { family: 'cn', values: cnVals } : { family: 'jp', values: choice.values }} onClose={() => setBook(false)} />}
          <details className="about-sets">
            <summary>{t('aboutSets')}</summary>
            <p className="guide">{t('aboutSetsText')}</p>
          </details>
        </>
      )}
      {readOnly ? (
        <p className="cur ro-set">
          {label === 'custom' ? `${t('rsCustom')}（${t('rsChangedFrom', { set: t(`set_${baseSet}` as MessageKey) })}）` : t(`set_${label}` as MessageKey)}
        </p>
      ) : (
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
      )}
      {!readOnly && label === 'custom' && <p className="cur">{t('rsChangedFrom', { set: t(`set_${baseSet}` as MessageKey) })}</p>}
      {share && <ShareLink t={t} choice={cn ? choice : { base: choice.base, values: choice.values }} />}
      <div className="indiv-head">{t(readOnly ? 'rsReadOnlyHead' : 'rsIndivHead')}</div>
      <div className="rule-rows">
        {groups(fam).map((g) => {
          const key = `${fam}:${g.name}`;
          const isOpen = !!open[key];
          const count = g.fold
            ? t('rsLocalCount', { n: g.members.filter((m) => vals[m.k] === 'on').length, all: g.members.length })
            : t(g.members.length === 1 ? 'rsGroupCount1' : 'rsGroupCount', { n: g.members.length, c: changed(g.members) });
          const { main, detail } = g.fold ? { main: g.members.map((it) => ({ it, depth: 0 })), detail: [] as Item[] } : arrange(fam, g.members);
          const dkey = key + ':detail';
          return (
            <div key={key}>
              <button type="button" className="group fold" aria-expanded={isOpen} onClick={() => toggle(key)}>
                {isOpen ? '▼' : '▶'} {groupName(g.name, lang)}{lang === 'en' ? ` · ${count}` : `（${count}）`}
              </button>
              {isOpen && main.map((x) => row(x.it, x.depth))}
              {isOpen && detail.length > 0 && (
                <>
                  <button type="button" className="group fold detail" aria-expanded={!!open[dkey]} onClick={() => toggle(dkey)}>
                    {open[dkey] ? '▼' : '▶'} {t(detail.length === 1 ? 'rsDetail1' : 'rsDetail', { n: detail.length, c: changed(detail) })}
                  </button>
                  {open[dkey] && <div className="detail-rows">{detail.map((it) => row(it))}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="fixed">{cn ? (lang === 'ja' ? CN_FIXED.replace(/<\/?b>/g, '') : t('rsFixedCn')) : lang === 'ja' ? JP_FIXED.replace(/<\/?b>/g, '') : t('rsFixed')}</p>
    </section>
  );
}
