/**
 * 段階3（変換エンジン）の受入条件 3-1 〜 3-5 と、検証事項 V-10（変換の正当性・全サイズ）。
 *
 * **全7サイズとも実物の配信データを読む**（第17セッションで 36×36 / 49×49 の在庫が揃った）。
 * 合成の完成盤は、変換そのものの性質を確かめる箇所だけで使う。
 */

import { describe, expect, it } from 'vitest';

import type { BoardSize, Grid, Puzzle } from '../data/types';
import { LARGE_SIZES, RELEASED_SIZES, firstChunkPuzzles, syntheticPuzzle } from '../test/fixtures';
import { ROTATIONS, identityParams, randomParams, validateParams } from './params';
import { apply, createTransform } from './transformer';

const ALL_SIZES: readonly BoardSize[] = RELEASED_SIZES;

/** 各サイズの検査対象。実物の配信データの先頭2問 */
function samplesOf(n: BoardSize): Puzzle[] {
  return firstChunkPuzzles(n).slice(0, 2);
}

/** 行・列・ブロックに同じ値が2つ無いこと。0（空）は数えない */
function violatesSudoku(grid: Grid, n: number, b: number): string | null {
  const groups: Array<Map<number, number>> = [];
  for (let i = 0; i < n * 3; i++) groups.push(new Map());

  for (let index = 0; index < grid.length; index++) {
    const value = grid[index];
    if (value === 0) continue;
    if (!Number.isInteger(value) || value < 1 || value > n) {
      return `範囲外の値 ${value}（索引 ${index}）`;
    }
    const row = Math.floor(index / n);
    const col = index % n;
    const block = Math.floor(row / b) * b + Math.floor(col / b);
    for (const [kind, key] of [
      ['行', row],
      ['列', n + col],
      ['ブロック', n * 2 + block],
    ] as const) {
      const seen = groups[key];
      if (seen.has(value)) return `${kind}に ${value} が重複（索引 ${index}）`;
      seen.set(value, index);
    }
  }
  return null;
}

/** 完成盤として妥当か（空マスが無く、制約も満たす） */
function violatesCompleteSudoku(grid: Grid, n: number, b: number): string | null {
  const empty = grid.indexOf(0);
  if (empty >= 0) return `空マスが残っている（索引 ${empty}）`;
  return violatesSudoku(grid, n, b);
}

describe('検査そのものの確かめ（不合格を出せること）', () => {
  it('数独制約の判定は、行・列・ブロック・範囲外のいずれの違反も見つける', () => {
    const n = 9;
    const b = 3;
    const good = syntheticPuzzle(9, 3).solution;
    expect(violatesCompleteSudoku(good, n, b)).toBeNull();

    // 同じ行で2マスを入れ替えずに上書きすると、行と（多くの場合）ブロックが壊れる
    const rowBroken = good.slice();
    rowBroken[1] = rowBroken[0];
    expect(violatesSudoku(rowBroken, n, b)).toContain('重複');

    // 列の違反（同じ列の別の行へ写す）
    const colBroken = good.slice();
    colBroken[n * 1] = colBroken[0];
    expect(violatesSudoku(colBroken, n, b)).toContain('重複');

    // 範囲外の値
    const outOfRange = good.slice();
    outOfRange[0] = n + 1;
    expect(violatesSudoku(outOfRange, n, b)).toContain('範囲外');

    // 空マスが残っている完成盤
    const holed = good.slice();
    holed[5] = 0;
    expect(violatesSudoku(holed, n, b)).toBeNull();
    expect(violatesCompleteSudoku(holed, n, b)).toContain('空マス');
  });
});

describe('変換パラメータ（第2分冊 2.3 / 2.7 / 2.8）', () => {
  it.each(ALL_SIZES)('%i×%i: 恒等パラメータも乱数パラメータも検証を通る', (n) => {
    const b = Math.round(Math.sqrt(n));
    expect(validateParams(identityParams(n, b), n, b).ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      const verdict = validateParams(randomParams(n, b), n, b);
      expect(verdict.ok).toBe(true);
    }
  });

  it('壊れたパラメータは変換前に弾かれる（2.8）', () => {
    const n: BoardSize = 9;
    const b = 3;
    const base = identityParams(n, b);

    const broken: Array<[string, unknown]> = [
      ['object ではない', 'まったく別物'],
      ['null', null],
      ['配列', []],
      ['未知の版', { ...base, version: 2 }],
      ['rotation が範囲外', { ...base, rotation: 45 }],
      ['mirror が boolean でない', { ...base, mirror: 'yes' }],
      ['symbolMap の長さ違い', { ...base, symbolMap: [1, 2, 3] }],
      ['symbolMap に重複', { ...base, symbolMap: [1, 1, 3, 4, 5, 6, 7, 8, 9] }],
      ['symbolMap に 0', { ...base, symbolMap: [0, 2, 3, 4, 5, 6, 7, 8, 9] }],
      ['bandOrder が順列でない', { ...base, bandOrder: [0, 0, 1] }],
      ['stackOrder の長さ違い', { ...base, stackOrder: [0, 1] }],
      ['rowOrderInBand の本数違い', { ...base, rowOrderInBand: [[0, 1, 2]] }],
      ['colOrderInStack の中身が順列でない', { ...base, colOrderInStack: [[0, 1, 2], [0, 1, 2], [3, 1, 2]] }],
    ];

    for (const [label, value] of broken) {
      const verdict = validateParams(value, n, b);
      expect(verdict.ok, label).toBe(false);
      // 変換の組み立ても同じところで止まる
      expect(createTransform(value, n, b).ok, label).toBe(false);
    }
  });

  it('盤面サイズとブロック辺が食い違うパラメータは受け付けない', () => {
    expect(validateParams(identityParams(9, 3), 9, 4).ok).toBe(false);
  });

  it('順列生成は一様である（Fisher–Yates・2.7）', () => {
    const counts = new Map<string, number>();
    const trials = 2000;
    for (let i = 0; i < trials; i++) {
      const key = randomParams(9, 3).bandOrder.join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // 長さ3の順列は6通り。すべて現れ、期待値 333 から大きく外れないこと
    expect(counts.size).toBe(6);
    for (const [key, count] of counts) {
      expect(count, `${key} が ${count} 回`).toBeGreaterThan(233);
      expect(count, `${key} が ${count} 回`).toBeLessThan(433);
    }
  });
});

describe('V-10 変換の正当性（受入条件 3-1 / 3-2）', () => {
  it.each(ALL_SIZES)('%i×%i: 変換後の盤面が数独制約を満たし、solution が puzzle の解になっている', (n) => {
    const b = Math.round(Math.sqrt(n));
    for (const source of samplesOf(n)) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const result = apply(source, randomParams(n, b));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { given: puzzle, solution } = result.value;

        // 3-1: 変換後の盤面が数独制約を満たす
        expect(violatesSudoku(puzzle, n, b), `${source.id} の puzzle`).toBeNull();
        expect(violatesCompleteSudoku(solution, n, b), `${source.id} の solution`).toBeNull();

        // 3-2: 埋まっているマスがすべて solution と一致する＝解になっている
        for (let index = 0; index < puzzle.length; index++) {
          if (puzzle[index] !== 0) expect(puzzle[index]).toBe(solution[index]);
        }
        // ヒント数は変換で増減しない
        expect(puzzle.filter((v) => v !== 0).length).toBe(source.clueCount);
      }
    }
  });

  it.each(ALL_SIZES)('%i×%i: 元の盤面も数独制約を満たしている（前提の確認）', (n) => {
    const b = Math.round(Math.sqrt(n));
    for (const source of samplesOf(n)) {
      expect(violatesSudoku(source.puzzle, n, b), source.id).toBeNull();
      expect(violatesCompleteSudoku(source.solution, n, b), source.id).toBeNull();
    }
  });
});

describe('受入条件 3-4: 回転・鏡映とブロック構造の整合（N=36 / 49）', () => {
  it.each(LARGE_SIZES)('%i×%i: 回転4通り×鏡映2通りのすべてでブロック構造が保たれる', (n) => {
    const b = Math.round(Math.sqrt(n));
    const source = firstChunkPuzzles(n)[0];
    for (const rotation of ROTATIONS) {
      for (const mirror of [false, true]) {
        // 幾何変換だけを効かせ、並べ替えとシンボル置換は恒等にする
        const params = { ...identityParams(n, b), rotation, mirror };
        const result = apply(source, params);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const label = `rotation=${rotation} mirror=${mirror}`;
        expect(violatesCompleteSudoku(result.value.solution, n, b), label).toBeNull();
        expect(violatesSudoku(result.value.given, n, b), label).toBeNull();
      }
    }
  });

  it('鏡映が先・回転が後である（2.4 の正準順序）', () => {
    const n: BoardSize = 4;
    const b = 2;
    // 左右反転してから反時計回りに90度回すと、位置の写像は転置になる
    const built = createTransform({ ...identityParams(n, b), rotation: 90, mirror: true }, n, b);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        expect(built.value.cell.forward(row * n + col)).toBe(col * n + row);
      }
    }

    // 鏡映なしの90度回転は (r, c) → (N-1-c, r)
    const rotated = createTransform({ ...identityParams(n, b), rotation: 90 }, n, b);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        expect(rotated.value.cell.forward(row * n + col)).toBe((n - 1 - col) * n + row);
      }
    }
  });
});

describe('受入条件 3-3: 再現性', () => {
  it.each(ALL_SIZES)('%i×%i: 同じ元問題と同じパラメータからは同じ結果が出る', (n) => {
    const b = Math.round(Math.sqrt(n));
    const source = samplesOf(n)[0];
    const params = randomParams(n, b);

    const first = apply(source, params);
    const second = apply(source, params);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.given).toEqual(first.value.given);
    expect(second.value.solution).toEqual(first.value.solution);
  });

  it('JSON を通しても（中断保存を経ても）同じ結果が出る', () => {
    const source = samplesOf(9)[0];
    const params = randomParams(9, 3);
    const direct = apply(source, params);
    const restored = apply(source, JSON.parse(JSON.stringify(params)) as unknown);
    expect(direct.ok && restored.ok).toBe(true);
    if (!direct.ok || !restored.ok) return;
    expect(restored.value.given).toEqual(direct.value.given);
    expect(restored.value.solution).toEqual(direct.value.solution);
  });
});

describe('受入条件 3-5: N=1 の恒等性（2.6）', () => {
  it('どのパラメータを引いても 1×1 の変換は恒等になる', () => {
    const source = samplesOf(1)[0];
    for (let i = 0; i < 50; i++) {
      const params = randomParams(1, 1);
      const result = apply(source, params);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.given).toEqual(source.puzzle);
      expect(result.value.solution).toEqual(source.solution);
    }
  });

  it('1×1 では回転・鏡映のどの組み合わせでも恒等である（分岐ではなく規則の帰結）', () => {
    const source = samplesOf(1)[0];
    for (const rotation of ROTATIONS) {
      for (const mirror of [false, true]) {
        const result = apply(source, { ...identityParams(1, 1), rotation, mirror });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.solution).toEqual(source.solution);
      }
    }
  });
});

describe('座標と値の写像（2.5）', () => {
  it.each(ALL_SIZES)('%i×%i: 位置も値も往復すると元に戻る', (n) => {
    const b = Math.round(Math.sqrt(n));
    const built = createTransform(randomParams(n, b), n, b);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { cell, value } = built.value;

    const arrived = new Set<number>();
    for (let index = 0; index < n * n; index++) {
      const moved = cell.forward(index);
      expect(cell.inverse(moved)).toBe(index);
      arrived.add(moved);
    }
    // 全単射であること（行き先がひとつも重ならない）
    expect(arrived.size).toBe(n * n);

    expect(value.forward(0)).toBe(0);
    expect(value.inverse(0)).toBe(0);
    for (let v = 1; v <= n; v++) expect(value.inverse(value.forward(v))).toBe(v);
  });

  it.each(ALL_SIZES)('%i×%i: 恒等パラメータでは盤面が変わらない', (n) => {
    const b = Math.round(Math.sqrt(n));
    for (const source of samplesOf(n)) {
      const result = apply(source, identityParams(n, b));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.given).toEqual(source.puzzle);
      expect(result.value.solution).toEqual(source.solution);
    }
  });

  it('長さが N×N でない盤面は受け付けない', () => {
    const built = createTransform(identityParams(9, 3), 9, 3);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value.applyGrid([1, 2, 3]).ok).toBe(false);
  });
});
