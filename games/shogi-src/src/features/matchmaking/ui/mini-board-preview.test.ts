import { describe, it, expect } from 'vitest';
import { initialFor } from './MiniBoardPreview';

/**
 * 第 9 段 9-4a②：ルール選択のプレビュー盤 (MiniBoardPreview.initialFor) が、
 * 駒字を必ず **string** で返すこと。以前はチェスのように「漢字の対応表に無い駒」で
 * 生の name ({ja,en,zh} のオブジェクト) を返し、React の子に渡って画面が落ちていた。
 */

describe('9-4a② プレビュー盤の駒字は必ず string', () => {
  // 【§5.0 一本化】チェスは S02 の同梱カードでなく読み込みのカスタムルールになったため、
  // initialFor('chess') は無くなった (S02 は元から入っているルールだけを並べる)。
  // チェスの駒 (K/Q/R/B/N/P) が string で描かれることは、実際の対局盤の検査
  // (chess-board-render.test) が固定している。

  it('将棋は従来どおり漢字 (玉・歩 等) で、string のまま', () => {
    const cells = initialFor('shogi');
    expect(cells.every((c) => typeof c.ch === 'string')).toBe(true);
    const chars = new Set(cells.map((c) => c.ch).filter(Boolean));
    expect(chars.has('玉')).toBe(true);
    expect(chars.has('歩')).toBe(true);
  });
});
