// 見本 settings.html のルールの表を、そのままプログラムの形に写す（手で写すと写し間違える）
const fs = require('fs');
const html = fs.readFileSync('L:/momo/games/mahjong/mock/settings.html', 'utf8');
const s = html.slice(html.indexOf('const TIERS'), html.indexOf('// ── 状態 ──'));
const d = new Function(s + '; return {TIERS,FAMILY,ORDER,JP_ITEMS,SUPP,JP_FIXED,ORDER_CN,CN_ITEMS,SUPP_CN,CN_FIXED};')();
const j = (x) => (Array.isArray(x) ? '[\n' + x.map((e) => '  ' + JSON.stringify(e)).join(',\n') + ',\n]' : x && typeof x === 'object' ? '{\n' + Object.entries(x).map(([k, v]) => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(v)).join(',\n') + ',\n}' : JSON.stringify(x));
const out = `// ルールセットと設定項目の表（段階6の6a）。見本 L:\\momo\\games\\mahjong\\mock\\settings.html の表を、そのまま写したもの。
// ★手で直さない。見本を直したら写し直す（node scripts/gen-rule-table.cjs）。
// 正本はルール設定 v0.03（作業側 docs）。見本と文書の 792 値（72 項目×11 セット）が一致することは 2026-10-10 に突き合わせて確かめた。
/* eslint-disable */

export type Opt = readonly [key: string, label: string];
/** 設定の 1 項目（group＝見出しの行） */
export interface RuleItem {
  k?: string;
  name?: string;
  note?: string;
  opts?: readonly Opt[];
  /** セットごとの値（ORDER の順。null＝条文なし→SUPP で補う） */
  v?: readonly (string | null)[];
  /** 別の項目が [項目, 値] のときだけ選べる（3 つ目が 'not' なら、その値でないときだけ）。4 つ目は表示用の一言 */
  dep?: readonly string[];
  group?: string;
  fold?: boolean;
}

export const TIERS = ${j(d.TIERS)} as const;
export const FAMILY: Record<string, 'jp' | 'cn'> = ${j(d.FAMILY)};
export const ORDER = ${j(d.ORDER)} as const;
export const JP_ITEMS: readonly RuleItem[] = ${j(d.JP_ITEMS)};
/** 条文なしを MOMO が補った値（2026-10-05 決定：書いていない仕組みは「なし」と読む） */
export const SUPP: Record<string, Record<string, string>> = ${j(d.SUPP)};
export const JP_FIXED = ${j(d.JP_FIXED)};
export const ORDER_CN = ${j(d.ORDER_CN)} as const;
export const CN_ITEMS: readonly RuleItem[] = ${j(d.CN_ITEMS)};
export const SUPP_CN: Record<string, Record<string, string>> = ${j(d.SUPP_CN)};
export const CN_FIXED = ${j(d.CN_FIXED)};
`;
fs.writeFileSync('L:/momo/github/momo/games/mahjong-src/src/engine/ruleTable.ts', out);
console.log('ok', d.JP_ITEMS.filter((x) => x.k).length, d.CN_ITEMS.filter((x) => x.k).length);
