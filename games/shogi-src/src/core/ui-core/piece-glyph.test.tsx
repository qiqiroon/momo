import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PieceView } from './GameScreen';
import { hondou } from '../engine';
import type { Mgf } from '../engine';
import type { PieceInstance } from '../engine';

/**
 * 盤の駒に出す文字と色は**ルール定義から引く**（親 v1.65 §3.6.1・第 9 段 9-1 ⑤）。
 *
 * ★以前は駒種→文字の表が画面側に直書きされていた。ここで固定するのは 2 点:
 *   - 将棋は従来どおりの字が出る（回帰していない）
 *   - ルール定義が文字色を指定すると、その色が実際に付く（自作ルール向け）
 */

function piece(kind: string, owner: 'player1' | 'player2', promoted = false): PieceInstance {
  return {
    pieceId: `${kind}-x`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row: 0, col: 0 },
    promoted,
  };
}

describe('盤の駒の文字（§3.6.1）', () => {
  it('将棋の駒は従来どおりの字が出る（日本語）', () => {
    const { container } = render(
      <PieceView mgf={hondou} piece={piece('fu', 'player1')} kinds={['fu']} locale="ja" />,
    );
    expect(container.querySelector('.pc .ja')?.textContent).toBe('歩');
  });

  it('英語では英字が出る', () => {
    const { container } = render(
      <PieceView mgf={hondou} piece={piece('hi', 'player1')} kinds={['hi']} locale="en" />,
    );
    expect(container.querySelector('.pc .ja')?.textContent).toBe('R');
  });

  it('ルール定義の文字色が実際に付く（指定したときだけ）', () => {
    const colored: Mgf = {
      ...hondou,
      pieces: hondou.pieces.map((p) =>
        p.id === 'fu'
          ? { ...p, display: { glyph_color: { player1: 'rgb(255, 255, 255)', player2: 'rgb(42, 28, 12)' } } }
          : p,
      ),
    };
    const { container } = render(
      <PieceView mgf={colored} piece={piece('fu', 'player1')} kinds={['fu']} locale="ja" />,
    );
    const span = container.querySelector('.pc .ja') as HTMLElement;
    expect(span.style.color).toBe('rgb(255, 255, 255)');
  });

  it('文字色を指定していない将棋は、色を上書きしない（テーマ任せ）', () => {
    const { container } = render(
      <PieceView mgf={hondou} piece={piece('fu', 'player1')} kinds={['fu']} locale="ja" />,
    );
    const span = container.querySelector('.pc .ja') as HTMLElement;
    expect(span.style.color).toBe('');
  });
});
