// ルールの個別設定の並べ方（利用者 2026-10-21 Q4=A）：子の項目（親の値で選べるかが決まる）は親のすぐ下に一段下げて出す。
// 「どのセットも同じ値」の子でも、親が外の段にあれば「細かい決まり」に入れない。「細かい決まり」の中の行は字下げの枠に入れる。
// ★前は子だけが「細かい決まり」に入り、親と別の段に分かれた（リーチ後の暗槓とその条件など・日本式 7 組・中国式 4 組）
import { fireEvent, render } from '@testing-library/react';
import { CN_RULE_ITEMS, JP_RULE_ITEMS, generalChoice, rulesOfCnSet, type RuleChoice } from '../engine/ruleSets';
import type { CnRuleKey } from '../engine/rules';
import { translate, type MessageKey } from '../i18n/strings';
import { RuleSettings } from './RuleSettings';

const t = (k: MessageKey, v?: Record<string, string | number>) => translate('ja', k, v);

/** まとまりと「細かい決まり」を全部開く */
function openAll() {
  for (const b of [...document.querySelectorAll<HTMLButtonElement>('.rule-rows > div > .group.fold:not(.detail)')]) fireEvent.click(b);
  for (const b of [...document.querySelectorAll<HTMLButtonElement>('.group.fold.detail')]) fireEvent.click(b);
}

/** 親のある項目ごとに、親と子の行がどう並んでいるかを確かめる */
function checkPairs(items: readonly { k: string; dep?: readonly unknown[] }[]) {
  let pairs = 0;
  for (const it of items) {
    const p = it.dep?.[0] as string | undefined;
    if (!p) continue;
    const child = document.querySelector<HTMLElement>(`.set-row[data-k="${it.k}"]`);
    const parent = document.querySelector<HTMLElement>(`.set-row[data-k="${p}"]`);
    if (!child || !parent) continue;
    // ローカル役の役（大七星）は役の一覧から動かさない＝ダブル役満とは別のまとまりのまま
    if (child.closest('.rule-rows > div') !== parent.closest('.rule-rows > div')) {
      expect(it.k, `${it.k} が親 ${p} と別のまとまり`).toBe('daichisei');
      continue;
    }
    // 親が細かい決まりの中なら子も中・親が外なら子も外（同じ段）
    expect(!!child.closest('.detail-rows'), `${it.k} と親 ${p} が別の段`).toBe(!!parent.closest('.detail-rows'));
    if (parent.closest('.detail-rows')) continue;
    // 外の段では、子は親より後ろで、親との間にあるのは親の子（兄弟・孫）だけ。一段下げている
    expect(child.classList.contains('child'), `${it.k} が下がっていない`).toBe(true);
    let x = parent.nextElementSibling as HTMLElement | null;
    while (x && x !== child) {
      expect(x.classList.contains('child'), `${p} と ${it.k} の間に別の項目 ${x.dataset.k}`).toBe(true);
      x = x.nextElementSibling as HTMLElement | null;
    }
    expect(x).toBe(child);
    pairs++;
  }
  return pairs;
}

describe('ルールの個別設定の並べ方', () => {
  it('★日本式：子の項目は親のすぐ下に一段下げて出す。細かい決まりの行は字下げの枠に入る', () => {
    render(<RuleSettings t={t} lang="ja" choice={generalChoice()} onChange={() => {}} />);
    openAll();
    // リーチ後の暗槓の条件は、細かい決まりでなく暗槓の項目のすぐ下
    const cond = document.querySelector('.set-row[data-k="ankanCond"]')!;
    expect(cond.closest('.detail-rows')).toBeNull();
    expect(cond.previousElementSibling?.getAttribute('data-k')).toBe('riichiAnkan');
    expect(checkPairs(JP_RULE_ITEMS)).toBeGreaterThanOrEqual(10);
    // 細かい決まりの行はすべて字下げの枠の中
    for (const d of document.querySelectorAll('.group.fold.detail')) expect(d.nextElementSibling?.classList.contains('detail-rows')).toBe(true);
    expect(document.querySelectorAll('.detail-rows .set-row').length).toBeGreaterThan(0);
  });

  it('★中国式（四川）：同じ並べ方', () => {
    const r = rulesOfCnSet('sichuan');
    if (r.family !== 'cn') throw new Error('中国式のはず');
    const choice: RuleChoice = { ...generalChoice(), cn: 'sichuan', cnValues: { ...(r.values as Record<CnRuleKey, string>) } };
    render(<RuleSettings t={t} lang="ja" choice={choice} onChange={() => {}} cnOk />);
    openAll();
    expect(checkPairs(CN_RULE_ITEMS)).toBeGreaterThanOrEqual(10);
  });
});
