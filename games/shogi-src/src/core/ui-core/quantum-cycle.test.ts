import { describe, it, expect } from 'vitest';
import { nextShown } from './quantum-cycle';

/**
 * 巡回表示の送り方（付録D-1 v1.14 §5.6.2・駒UI v0.14 §4.2）。
 *
 * ここで固定したいのは 1 点。
 *   - **候補が減っても順送りが途切れない**＝同じ字が続くのは候補が 1 つになったとき
 *     （＝確定して「？」も消えるとき）だけ
 *
 * v1.44 までは「候補の並びの何番目か」で選んでいたため、**候補が減った拍子に
 * 前と同じ字を指し、その駒だけ止まって見えた**（2026-08-17 ユーザー報告）。
 */

/** v1.44 までのやり方。対比のために置く（これが止まることを下で示す）。 */
const byIndex = (kinds: string[], tick: number): string => kinds[tick % kinds.length];

describe('巡回の送り方（付録D-1 §5.6.2）', () => {
  it('候補が変わらなければ、次の候補へ 1 つ送る', () => {
    const kinds = ['hisha', 'kaku', 'kin'];
    expect(nextShown('hisha', kinds)).toBe('kaku');
    expect(nextShown('kaku', kinds)).toBe('kin');
    expect(nextShown('kin', kinds)).toBe('hisha'); // 末尾なら先頭へ
  });

  it('まだ何も出していなければ先頭から', () => {
    expect(nextShown(undefined, ['kin', 'gin'])).toBe('kin');
  });

  it('いま出している字が候補から消えていたら先頭へ', () => {
    expect(nextShown('hisha', ['kin', 'gin'])).toBe('kin');
  });

  it('★候補が減っても、出す字は必ず変わる（止まらない）', () => {
    // 候補が 1 つずつ減っていく駒を、実際に送りながら追う。
    const shrinking = [
      ['hisha', 'kaku', 'kin', 'gin'],
      ['kin', 'gin', 'keima'],
      ['kin', 'gin'],
      ['gin', 'keima'],
    ];
    let shown = nextShown(undefined, shrinking[0]);
    for (let i = 1; i < shrinking.length; i += 1) {
      const before = shown;
      shown = nextShown(shown, shrinking[i]);
      expect(shown).not.toBe(before);
    }
  });

  it('★同じ場面を v1.44 までのやり方で送ると、同じ字のまま止まる（直した中身の証拠）', () => {
    // 候補 4 つの 3 番目「金」を出している駒が、上位 2 つを失って候補 3 つになる場面。
    const before = ['hisha', 'kaku', 'kin', 'gin'];
    const after = ['kin', 'gin', 'keima'];
    expect(byIndex(before, 2)).toBe('kin');
    expect(byIndex(after, 3)).toBe('kin'); // 時計が 1 つ進んでいるのに同じ字＝止まる
    // 直したあとは、同じ場面でも必ず変わる。
    expect(nextShown('kin', after)).not.toBe('kin');
  });

  it('候補が 1 つ（確定）のときは同じ字のままでよい', () => {
    expect(nextShown('kin', ['kin'])).toBe('kin');
  });
});
