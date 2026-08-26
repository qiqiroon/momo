import { describe, it, expect } from 'vitest';
import { chess, hasami, hondou } from './loader';
import type { Mgf } from './types';
import { modifierConflict, quantumAllowed, torusAllowed } from './compatibility';

/**
 * 変則条件の可否は**ルール定義だけが持つ**（親 v1.65 §3.2.1・2026-08-26 ユーザー判断）。
 *
 * ★ここで固定したいのは「**画面や通信の側に一覧を持たない**」こと。v1.91 まではルール選択の
 * 画面が同じことを写して持っており、**カスタムだけは中身を見ずに『可』と決め打ち**だった。
 */
describe('§3.2.1 変則条件の可否は定義から引く', () => {
  it('本将棋は量子を許す', () => {
    expect(quantumAllowed(hondou)).toBe(true);
  });

  it('はさみ将棋は量子を許さない（駒種が 1 つで候補が最初から確定＝縮退する）', () => {
    expect(quantumAllowed(hasami)).toBe(false);
  });

  it('★チェスは量子を許す（親 §5.5.7）', () => {
    // ★v1.91 の定義は「許さない」と書いていたが、**規定は §5.5.7 で「可」と定めている**
    // ＝定義のほうが規定と食い違っていた（2026-08-26 に直した）。
    expect(quantumAllowed(chess)).toBe(true);
  });

  it('宣言が無ければすべて許す（§3.2.1「省略時の既定はすべて許容」）', () => {
    const noDecl = { ...hondou, compatible_modifiers: undefined } as Mgf;
    expect(quantumAllowed(noDecl)).toBe(true);
    expect(torusAllowed(noDecl, 'cylinder')).toBe(true);
    expect(torusAllowed(noDecl, 'full')).toBe(true);
  });

  it('★つなぎ方は 1 つずつ見る（円筒は許すが完全トーラスは許さない、が書ける）', () => {
    const cylOnly = {
      ...hondou,
      compatible_modifiers: { torus: { cylinder: true, full_torus: false } },
    } as Mgf;
    expect(torusAllowed(cylOnly, 'cylinder')).toBe(true);
    expect(torusAllowed(cylOnly, 'full')).toBe(false);
    expect(torusAllowed(cylOnly, 'none')).toBe(true); // 何もつながないのは常に許す
  });
});

describe('§3.13 設定が宣言に反していたら、その事実を返す', () => {
  it('許さないルールで量子を指定したら、量子が反していると返す', () => {
    expect(modifierConflict(hasami, { quantum: true, torusMode: 'none' })).toBe('quantum');
  });

  it('許さないつなぎ方を指定したら、つなぎ方が反していると返す', () => {
    const cylOnly = {
      ...hondou,
      compatible_modifiers: { torus: { cylinder: true, full_torus: false } },
    } as Mgf;
    expect(modifierConflict(cylOnly, { quantum: false, torusMode: 'full' })).toBe('torus');
    expect(modifierConflict(cylOnly, { quantum: false, torusMode: 'cylinder' })).toBeNull();
  });

  it('反していなければ null（本将棋の量子・チェスの量子とも通る）', () => {
    expect(modifierConflict(hondou, { quantum: true, torusMode: 'full' })).toBeNull();
    expect(modifierConflict(chess, { quantum: true, torusMode: 'cylinder' })).toBeNull();
  });
});
