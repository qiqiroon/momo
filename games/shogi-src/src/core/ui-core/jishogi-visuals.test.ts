import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★v1.85（2026-08-22 実機のご報告・第57セッション）＝**持将棋の提案の見せ方 2 点**。
 *
 * ご報告は 2 つ。
 * 1. **「拒否する」が灰色で、押せないボタンに見える**
 * 2. **提案した側の覆いが薄く、盤の駒が読めてしまう**
 *
 * どちらも「見た目の好み」ではなく、**決まりに反していた**もの。
 * - **灰色は「押せない」だけを意味する**（付録D-3 §4.1／付録D-8 §7.1）＝押せるものを
 *   灰色で出すと、**押してよいのかどうかという判断そのものを誤らせる**。
 * - **盤を見せないと決めた場所では、実際に読めないこと**（付録D-1 v1.21 §7）＝
 *   **暗くするだけでは駒は読める**（輪郭が強いため）。**読めなくするのはぼかしの役目**。
 *
 * **次に触った人が元へ戻しても気づけるように、値の側を見張る。**
 */

const root = join(__dirname, '..', '..');
/** 改行の形（CRLF/LF）に左右されないよう、読んだ時点で揃える。 */
const css = readFileSync(join(root, 'core', 'ui-core', 'styles.css'), 'utf8')
  .split('\r\n')
  .join('\n');
const screen = readFileSync(join(root, 'core', 'ui-core', 'GameScreen.tsx'), 'utf8')
  .split('\r\n')
  .join('\n');

/** その決まりの中身だけを切り出す（`input-zoom.test.ts` と同じ求め方）。 */
function ruleBody(selector: string): string {
  const lines = css.split('\n');
  const at = lines.findIndex((line) => {
    const t = line.trim();
    return t === selector || t === `${selector},` || t.startsWith(`${selector} {`);
  });
  if (at < 0) return '';
  const from = lines.slice(at).join('\n');
  const open = from.indexOf('{');
  const close = from.indexOf('}', open);
  return from.slice(open, close);
}

/** `blur(NNpx)` の値を取り出す（無ければ 0）。 */
function blurOf(block: string): number {
  const m = block.match(/blur\(\s*([\d.]+)px\s*\)/);
  return m ? Number(m[1]) : 0;
}

describe('v1.85: 持将棋の提案の見せ方（付録D-1 v1.21 §7）', () => {
  it('★提案した側の覆いは、盤が読めないだけのぼかしを持つ', () => {
    const veil = ruleBody('.jishogi-veil');
    expect(veil).not.toBe('');
    // **暗くするだけでは足りない**＝ぼかしが無いと駒は読める。
    expect(blurOf(veil)).toBeGreaterThanOrEqual(10);
  });

  it('★覆いの濃さとぼかしは、一時中断・待った申し出とそろえる（同じ出来事を違う見せ方にしない）', () => {
    const veil = ruleBody('.jishogi-veil');
    const blocker = ruleBody('.board-blocker');
    expect(blocker).not.toBe('');
    expect(blurOf(veil)).toBe(blurOf(blocker));
    const alphaOf = (b: string) => b.match(/rgba\([^)]*?,\s*([\d.]+)\s*\)/)?.[1];
    expect(alphaOf(veil)).toBe(alphaOf(blocker));
  });

  it('★答える側のパネルには覆いを出さない（受けるかどうかは盤を見て決める）', () => {
    // 覆いを出しているのは「提案した側」の部品だけ。
    const veilUses = [...screen.matchAll(/jishogi-veil/g)].length;
    expect(veilUses).toBe(1);
    const sent = screen.slice(screen.indexOf('function JishogiSentPanel'));
    expect(sent.slice(0, sent.indexOf('function JishogiReceivedModal'))).toContain('jishogi-veil');
  });

  it('★「拒否する」は白文字・白枠（押せるものを灰色で出さない）', () => {
    const received = screen.slice(screen.indexOf('function JishogiReceivedModal'));
    const body = received.slice(0, received.indexOf('function JishogiSpectatorNotice'));
    const rejectBtn = body.slice(body.indexOf('jishogi.rejectAction') - 400, body.indexOf('jishogi.rejectAction'));
    // `ghost` だけだと薄い灰色（`.floating-result .btn.ghost`）になる。
    expect(rejectBtn).toContain('btn ghost outline');
  });

  it('★白文字・白枠の決まりが実際に白を指している（名前だけ付けて中身が灰色では意味が無い）', () => {
    const outline = ruleBody('.floating-result .btn.ghost.outline');
    expect(outline).not.toBe('');
    expect(outline).toContain('#fff');
    expect(outline).toMatch(/border-color:\s*rgba\(255,\s*255,\s*255/);
  });
});
