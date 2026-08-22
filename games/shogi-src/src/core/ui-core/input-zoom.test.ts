import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ★v1.62（2026-08-22 実機のご報告・iPhone・第56セッション）＝**打ち込む欄の字の大きさ**。
 *
 * **iPhone の Safari は、字が 16px より小さい入力欄に触れると画面を勝手に拡大する**。
 * 拡大されたままだと**盤も操作も画面からはみ出し、人が自分でつまんで戻すしかない**。
 * ご報告＝「チャット入力など、何らかの理由で画面が拡大表示になってしまう」。
 *
 * **画面の指定（viewport）で拡大そのものを禁じる形は採らない**＝**見づらい人が自分で
 * 拡大する自由まで奪う**ため。**元から拡大が起きない大きさにする**（付録D-1 v1.19 §8）。
 *
 * ## なぜ字の大きさを検査で見張るのか
 *
 * **これは「見た目の好み」ではなく、端末の振る舞いに対する決まり**である。
 * **1 つでも 16px を割ると、その欄に触れた瞬間に画面が拡大する**ので、
 * **次に欄を足した人が小さくしたときに気づける形**にしておく。
 */

const root = join(__dirname, '..', '..');
/** 改行の形（CRLF/LF）に左右されないよう、読んだ時点で揃える。 */
const css = readFileSync(join(root, 'core', 'ui-core', 'styles.css'), 'utf8').split('\r\n').join('\n');

/** `font-size: NNpx` をすべて拾う。 */
function fontSizesIn(block: string): number[] {
  return [...block.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
}

/**
 * その決まりの中身だけを切り出す。
 *
 * **行頭から始まり、次が `{` か `,` のものだけを拾う**＝`.console .inputline input` を
 * 前方一致で探すと `.console .inputline input:disabled` の方を先に掴んでしまう
 * （**名前の長い別の決まりを取り違える**）。
 */
function ruleBody(selector: string): string {
  const lines = css.split('\n');
  const at = lines.findIndex((line) => {
    const t = line.trim();
    // 1 行で書かれた決まり（`.x .y input { ... }`）も拾う。
    return t === selector || t === `${selector},` || t.startsWith(`${selector} {`);
  });
  if (at < 0) return '';
  const from = lines.slice(at).join('\n');
  const open = from.indexOf('{');
  const close = from.indexOf('}', open);
  return from.slice(open, close);
}

describe('v1.62: 打ち込む欄の字は 16px 以上（付録D-1 v1.19 §8）', () => {
  it('★土台の決まりが 1 か所に置いてある（画面ごとに数え上げない）', () => {
    // `input,` `textarea,` `select {` の 3 行で始まる決まり。
    expect(fontSizesIn(ruleBody('input'))).toEqual([16]);
  });

  it('★チャットの入力欄が 16px 以上（ご報告の出どころ）', () => {
    const sizes = fontSizesIn(ruleBody('.console .inputline input'));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(16);
  });

  it('★準備画面のチャットの入力欄も 16px 以上', () => {
    const sizes = fontSizesIn(ruleBody('.s06-console .inputline input'));
    expect(sizes.length).toBeGreaterThan(0);
    for (const px of sizes) expect(px).toBeGreaterThanOrEqual(16);
  });

  it('★その場で字を指定している入力欄も 16px 以上（一覧の各画面）', () => {
    for (const rel of [
      join('features', 'matchmaking', 'ui', 'LobbyScreen.tsx'),
      join('features', 'matchmaking', 'ui', 'ReviewLobbyScreen.tsx'),
      join('features', 'matchmaking', 'ui', 'SpectateLobbyScreen.tsx'),
    ]) {
      const src = readFileSync(join(root, rel), 'utf8');
      // 入力欄の見た目は `borderRadius: 6` を持つ形で書いてある。
      const inputs = [...src.matchAll(/borderRadius: 6,?\s*(?:\/\/[^\n]*\n\s*)?fontSize: ([\d.]+)/g)];
      expect(inputs.length).toBeGreaterThan(0);
      for (const m of inputs) expect(Number(m[1])).toBeGreaterThanOrEqual(16);
    }
  });

  it('★拡大そのものを禁じる形は採らない（見づらい人の自由を奪わない）', () => {
    const html = readFileSync(join(root, '..', 'index.html'), 'utf8');
    expect(html).toContain('width=device-width');
    expect(html).not.toContain('maximum-scale');
    expect(html).not.toContain('user-scalable');
  });
});
