import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★v1.87（2026-08-23 ユーザー指示・第58セッション）＝
 * **透明パネルの上では、本文に灰色を使わない**（付録D-3 v1.11 §4.1）。
 *
 * v1.4 から**灰色は「押せない」だけを意味する**と決めてあったが、**ボタンの話としてしか
 * 書かれていなかった**ため、あとから作った表示（補足詳細の折込みカード・保存できたことの
 * 知らせ）が項目名を灰色で出していた。
 *
 * このパネルは**半透明で下の盤が透ける**ので、**地の明るさが場所によって変わる**。
 * 灰色の字はそこで沈み、**読めないだけでなく「効いていない表示」に見える**。
 *
 * **見張り方＝名指しでなく、種類ごと全部を見る。**
 * 「折込みカードが灰色でないこと」だけを見ると、**次に足された表示がまた灰色で出る**。
 * ここでは**透明パネルの中の色の指定を全部拾い**、灰色を許す場所を名指しで挙げる形にした
 * （＝**許す側を数え上げる**ので、足した表示は黙って通らない）。
 */

const root = join(__dirname, '..', '..');
/** 改行の形（CRLF/LF）に左右されないよう、読んだ時点で揃える。 */
const css = readFileSync(join(root, 'core', 'ui-core', 'styles.css'), 'utf8')
  .split('\r\n')
  .join('\n');

/** `--text-muted` の実体。名前を変えられても見落とさないよう、値の側も見る。 */
const GRAY = ['--text-muted', '#737373'];

interface Rule {
  selector: string;
  body: string;
}

/** スタイルシートを「選択子 → 中身」に割る（入れ子のない書き方なので単純に切れる）。 */
function rules(): Rule[] {
  const out: Rule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const close = css.indexOf('}', open);
    if (close < 0) break;
    const selector = css
      .slice(i, open)
      .split('\n')
      .map((l) => l.replace(/\/\*[\s\S]*?\*\//g, '').trim())
      .filter((l) => l && !l.startsWith('*') && !l.startsWith('/*'))
      .join(' ')
      .trim();
    out.push({ selector, body: css.slice(open + 1, close) });
    i = close + 1;
  }
  return out;
}

/** 透明パネル（終局パネルとその中身）の決まりか。 */
function onFloatingPanel(selector: string): boolean {
  return selector.includes('.floating-result') || selector.includes('.save-notice-row');
}

/** `color:` の指定だけを取り出す（枠線の色は本項の対象外）。 */
function colorDeclarations(body: string): string[] {
  return body
    .split(';')
    .map((d) => d.replace(/\/\*[\s\S]*?\*\//g, '').trim())
    .filter((d) => /^color\s*:/.test(d));
}

/**
 * 灰色を許す場所（ここに挙がっていないものが灰色を使ったら赤にする）。
 *
 * - **押せないボタン**＝そこでは灰色が「押せない」という意味を持っている。
 * - **「負け」の大見出し**＝付録D-3 §3.1 が「負けは静か＝グレー」と定めている。
 *   **ご指示と食い違うので、独断で外さない**（変えるなら §3.1 を先に決め直す）。
 */
const ALLOWED = [':disabled', '.verdict.lose'];

describe('v1.87: 透明パネルの上では本文に灰色を使わない（付録D-3 v1.11 §4.1）', () => {
  it('スタイルシートを実際に割れている（見張りの土台が空でない）', () => {
    const panel = rules().filter((r) => onFloatingPanel(r.selector));
    // 割れていなければ「対象なし」で緑になってしまうので、まず数を確かめる。
    expect(panel.length).toBeGreaterThan(10);
    expect(panel.some((r) => r.selector.includes('.detail'))).toBe(true);
  });

  it('★灰色の字は「押せない」と「負けの大見出し」だけ（種類ごと全部を見る）', () => {
    const offenders: string[] = [];
    for (const rule of rules()) {
      if (!onFloatingPanel(rule.selector)) continue;
      if (ALLOWED.some((a) => rule.selector.includes(a))) continue;
      for (const decl of colorDeclarations(rule.body)) {
        if (GRAY.some((g) => decl.includes(g))) offenders.push(`${rule.selector} { ${decl} }`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('★折込みカードは主従を太さで付ける（色を落として区別しない）', () => {
    const all = rules();
    const card = all.find((r) => r.selector === '.floating-result .detail');
    const label = all.find((r) => r.selector === '.floating-result .detail .drow span');
    const value = all.find((r) => r.selector === '.floating-result .detail .drow b');
    expect(card?.body).toContain('color: var(--text)');
    expect(label?.body).toContain('font-weight: 400');
    expect(value?.body).toContain('font-weight: 700');
    // 値の側で色を変えていない＝項目名と同じ明るさのまま、太さだけで差を付ける。
    expect(colorDeclarations(value?.body ?? '')).toEqual([]);
  });

  it('★押せないボタンの灰色は残す（灰色が意味を持っている唯一の場所）', () => {
    const disabled = rules().find((r) =>
      r.selector.includes('.btn.ghost.outline:disabled'),
    );
    expect(disabled).toBeDefined();
    expect(disabled!.body).toContain('--text-muted');
  });
});
