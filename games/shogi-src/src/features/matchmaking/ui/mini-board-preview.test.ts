import { describe, it, expect } from 'vitest';
import { initialFor } from './MiniBoardPreview';

/**
 * 第 9 段 9-4a②：ルール選択のプレビュー盤 (MiniBoardPreview.initialFor) が、
 * 駒字を必ず **string** で返すこと。以前はチェスのように「漢字の対応表に無い駒」で
 * 生の name ({ja,en,zh} のオブジェクト) を返し、React の子に渡って画面が落ちていた。
 */

describe('9-4a② プレビュー盤の駒字は必ず string', () => {
  it('チェスは K/Q/R/B/N/P を string で返す (オブジェクトを出さない)', () => {
    const cells = initialFor('chess');
    expect(cells.every((c) => typeof c.ch === 'string')).toBe(true);
    const chars = new Set(cells.map((c) => c.ch).filter(Boolean));
    for (const ch of ['K', 'Q', 'R', 'B', 'N', 'P']) {
      expect(chars.has(ch)).toBe(true);
    }
  });

  it('将棋は従来どおり漢字 (玉・歩 等) で、string のまま', () => {
    const cells = initialFor('shogi');
    expect(cells.every((c) => typeof c.ch === 'string')).toBe(true);
    const chars = new Set(cells.map((c) => c.ch).filter(Boolean));
    expect(chars.has('玉')).toBe(true);
    expect(chars.has('歩')).toBe(true);
  });
});
