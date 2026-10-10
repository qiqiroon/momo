import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 言葉の違う卓（工程表 段階5）：通信で送るのは出来事の記号と人の名前・チャットの文だけ。
// 役名や宣言の言葉は、受け取った端末が自分の言葉で描く＝通信の部分は画面の言葉の辞書を使わない
describe('言葉の違う卓', () => {
  it('オンラインの通信の部分（src/online の検査以外）は、画面の言葉の辞書を読み込まない', () => {
    const dir = join(__dirname);
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf-8');
      expect(src, f).not.toMatch(/from ['"][^'"]*i18n/);
    }
  });
});
