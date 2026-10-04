/**
 * ★v2.04: ルール選択画面 (S02) のプレビューと量子の見本を**選んだルールの駒**で描く
 * (付録D-2 v1.10 §4.1・§5／付録D-10 v2.6 §5.2.1・2026-10-04 利用者の指摘)。
 *
 * v2.03 までは
 * - カスタム (チェス) を選んでもプレビューが本将棋の 9×9 のまま
 * - 量子の巡回／重ねの見本マスが将棋の 8 種の決め打ち
 * - 対局中の設定画面の見本が「歩・香・桂」の決め打ち
 * だった。ここではチェスで描けることと、**本将棋の見え方が変わっていない**ことの両方を見る。
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { chess, hondou } from '../../../core/engine';
import { MiniBoardPreview, initialFor, quantumKindsFor } from './MiniBoardPreview';
import { quantumSampleGlyphs } from '../../../core/ui-core/SettingsPopup';

describe('S02 プレビューはカスタムルールの定義から描く', () => {
  it('★チェスは 8×8・駒は K/Q/R/B/N/P・先手の字は白', () => {
    const { container } = render(<MiniBoardPreview rule="custom" torusMode="none" customMgf={chess} />);
    const squares = container.querySelectorAll('.mini-sq');
    expect(squares).toHaveLength(64);
    const glyphs = [...container.querySelectorAll('.mini-pc span')].map((s) => s.textContent);
    expect(glyphs.slice(0, 8)).toEqual(['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']);
    // 先手 (下側) の字はルール定義の色 (白)、後手は定義が色を持たないので付けない
    const bottomKing = [...container.querySelectorAll('.mini-pc:not(.g2) span')].find((s) => s.textContent === 'K') as HTMLElement;
    expect(bottomKing.style.color).toBe('rgb(255, 255, 255)');
    const topKing = [...container.querySelectorAll('.mini-pc.g2 span')].find((s) => s.textContent === 'K') as HTMLElement;
    expect(topKing.style.color).toBe('');
    // 右端の線を畳む印は 8 マスごと
    expect(container.querySelectorAll('.mini-sq.lc')).toHaveLength(8);
    expect(container.querySelectorAll('.mini-sq.lr')).toHaveLength(8);
  });

  it('チェスの回り込み (円筒) は 12 列 × 8 段・完全は 12 × 12', () => {
    const cyl = render(<MiniBoardPreview rule="custom" torusMode="cylinder" customMgf={chess} />);
    expect(cyl.container.querySelectorAll('.mini-sq')).toHaveLength(12 * 8);
    const full = render(<MiniBoardPreview rule="custom" torusMode="full" customMgf={chess} />);
    expect(full.container.querySelectorAll('.mini-sq')).toHaveLength(12 * 12);
    // 完全のときは最下段 12 マスすべての下の線を畳む
    expect(full.container.querySelectorAll('.mini-sq.lr')).toHaveLength(12);
  });

  it('本将棋は従来どおり 9×9 (線を畳む印も従来の 9 列ごと)・字に色を付けない', () => {
    const { container } = render(<MiniBoardPreview rule="shogi" torusMode="none" />);
    expect(container.querySelectorAll('.mini-sq')).toHaveLength(81);
    expect(container.querySelectorAll('.mini-sq.lc')).toHaveLength(9);
    expect(container.querySelectorAll('.mini-pc span.tinted')).toHaveLength(0);
    // 円筒は 13 列 × 9 段・下の線を畳むのは従来どおり最後の 9 マス
    const cyl = render(<MiniBoardPreview rule="shogi" torusMode="cylinder" />);
    expect(cyl.container.querySelectorAll('.mini-sq')).toHaveLength(13 * 9);
    expect(cyl.container.querySelectorAll('.mini-sq.lr')).toHaveLength(9);
  });

  it('定義がまだ無いカスタムは本将棋で代用する (従来どおり)', () => {
    expect(initialFor('custom')).toEqual(initialFor('shogi'));
  });
});

describe('量子の顔ぶれはルールの駒から', () => {
  it('★チェスは定義の並び (K→Q→R→B→N→P)・本将棋は従来の 8 種', () => {
    expect(quantumKindsFor(initialFor('custom', chess), false, chess)).toEqual(['K', 'Q', 'R', 'B', 'N', 'P']);
    expect(quantumKindsFor(initialFor('shogi'), false, hondou)).toEqual(['王', '飛', '角', '金', '銀', '桂', '香', '歩']);
  });

  it('★量子 ON のチェスのプレビューに漢字が出ない (重ね)', () => {
    const { container } = render(
      <MiniBoardPreview rule="custom" torusMode="none" customMgf={chess} quantum quantumDisplayMode="stack" />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/[王飛角金銀桂香歩]/);
    expect(text).toContain('K');
  });

  it('★設定画面の見本の字＝チェスは P・N・B、本将棋は歩・香・桂', () => {
    expect(quantumSampleGlyphs(chess)).toEqual(['P', 'N', 'B']);
    expect(quantumSampleGlyphs(hondou)).toEqual(['歩', '香', '桂']);
  });
});
