import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PieceStandView } from './GameScreen';
import { hondou } from '../engine';
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
      mgf={hondou}
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

const rowsOf = (stand: HTMLElement) => Number(stand.style.getPropertyValue('--stand-rows'));

describe('駒台の詰め方（付録D-1 §4.4.1）', () => {
  it('10 枚までは 1 列・既定の間隔（何も変えない）', () => {
    const stand = standOf(10);
    expect(stand.classList.contains('tight')).toBe(false);
    expect(stand.classList.contains('two')).toBe(false);
    expect(rowsOf(stand)).toBe(10);
  });

  it('★11 枚で先に間隔を詰める（列はまだ増やさない）', () => {
    const stand = standOf(11);
    expect(stand.classList.contains('tight')).toBe(true);
    expect(stand.classList.contains('two')).toBe(false);
    expect(rowsOf(stand)).toBe(11);
  });

  it('★13 枚で 2 列にする。間隔は既定へ戻す（2 列のほうが 4 倍の面積で置ける）', () => {
    const stand = standOf(13);
    expect(stand.classList.contains('two')).toBe(true);
    expect(stand.classList.contains('tight')).toBe(false);
    expect(rowsOf(stand)).toBe(7);
  });

  it('21 枚では 2 列のまま間隔も詰める', () => {
    const stand = standOf(21);
    expect(stand.classList.contains('two')).toBe(true);
    expect(stand.classList.contains('tight')).toBe(true);
    expect(rowsOf(stand)).toBe(11);
  });

  it('★どれだけ増えても列は 2 つまで＝3 列目を作らない', () => {
    // v1.42 は折り返しに任せていたため、増えると 3 列目が駒台からはみ出していた。
    for (const n of [13, 20, 21, 25, 30, 38, 40]) {
      const stand = standOf(n);
      expect(stand.classList.contains('two')).toBe(true);
      // 1 列に積む枚数 × 2 で全部入る＝2 列で足りる。
      expect(rowsOf(stand) * 2).toBeGreaterThanOrEqual(n);
      // かつ、余分に高くしない（1 列ぶん減らすと足りなくなる＝これ以上詰められない）。
      expect((rowsOf(stand) - 1) * 2).toBeLessThan(n);
    }
  });

  it('★枚数が増えても駒は全部出す（読みにくくても画面から消さない）', () => {
    const stand = standOf(38);
    expect(stand.querySelectorAll('.cap')).toHaveLength(38);
  });
});
