import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PieceStandView } from './GameScreen';
import type { PieceInstance } from '../engine';

/**
 * 駒が増えたときの駒台の詰め方（付録D-1 §4.4.1・駒UI v0.11 §5.1）。
 *
 * ここで固定したいのは 3 点。
 *   - **駒台は下へ伸びない**＝下にあるもの（操作列・再生の帯）を押し下げない
 *   - 詰める順が **①間隔 → ②2 列 → ③大きさ**であること
 *     （**間隔は失っても読めるが、大きさは失うと読めなくなる**）
 *   - **持ち駒があふれて消えることは無い**
 */

function fakeGroups(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const piece = {
      pieceId: `p${i}`,
      kind: 'fu',
      owner: 'player1',
      promoted: false,
    } as unknown as PieceInstance;
    return { key: `k${i}`, kinds: ['fu'], pieceIds: [`p${i}`], pieces: [piece] };
  });
}

function standOf(n: number): HTMLElement {
  const { container } = render(
    <PieceStandView
      side="you"
      pieces={fakeGroups(n)}
      onClick={() => {}}
      selectedId={null}
      activePlayer={false}
      locale="ja"
    />,
  );
  return container.querySelector('.stand') as HTMLElement;
}

describe('駒台の詰め方（付録D-1 §4.4.1）', () => {
  it('10 枚までは何も変えない（間隔も列も大きさもそのまま）', () => {
    const stand = standOf(10);
    expect(stand.classList.contains('tight')).toBe(false);
    expect(stand.classList.contains('two')).toBe(false);
    expect(stand.style.getPropertyValue('--stand-scale')).toBe('');
  });

  it('★11 枚で先に間隔を詰める（大きさにはまだ手を付けない）', () => {
    const stand = standOf(11);
    expect(stand.classList.contains('tight')).toBe(true);
    expect(stand.classList.contains('two')).toBe(false);
    expect(stand.style.getPropertyValue('--stand-scale')).toBe('');
  });

  it('★13 枚で 2 列にする。間隔は既定へ戻す（2 列のほうが 4 倍の面積で置ける）', () => {
    const stand = standOf(13);
    expect(stand.classList.contains('two')).toBe(true);
    expect(stand.classList.contains('tight')).toBe(false);
    expect(stand.style.getPropertyValue('--stand-scale')).toBe('');
  });

  it('21 枚では 2 列のまま間隔を詰める（まだ縮めない）', () => {
    const stand = standOf(21);
    expect(stand.classList.contains('two')).toBe(true);
    expect(stand.classList.contains('tight')).toBe(true);
    expect(stand.style.getPropertyValue('--stand-scale')).toBe('');
  });

  it('★25 枚ではじめて駒を縮める（最後の手段）', () => {
    const stand = standOf(25);
    expect(stand.classList.contains('two')).toBe(true);
    const scale = Number(stand.style.getPropertyValue('--stand-scale'));
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
  });

  it('★縮める下限を割らない（読めなくても駒を画面から消さない）', () => {
    const stand = standOf(38);
    const scale = Number(stand.style.getPropertyValue('--stand-scale'));
    // 付録D-1 の最小 `--cell * 0.40`（既定は 0.66）。
    expect(scale).toBeGreaterThanOrEqual(0.4 / 0.66 - 1e-9);
    // 枚数が増えても、駒は全部出ていること。
    expect(stand.querySelectorAll('.cap')).toHaveLength(38);
  });
});
