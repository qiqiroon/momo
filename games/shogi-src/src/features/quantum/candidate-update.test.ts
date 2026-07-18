import { describe, it, expect, afterEach } from 'vitest';
import { hondou } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { register, clear } from '../../core/plugin/registry';
import type { Position } from '../../core/engine/position/types';
import { candidateUpdate, type QuantumConstraint } from './candidate-update';
import { quantumInit } from './init';

describe('features/quantum/candidate-update (Phase 5-4)', () => {
  afterEach(() => {
    // 他テストへの副作用を防ぐため、テストごとにレジストリをクリアして
    // 必要な最小限だけ登録し直す (init.test は init を必要とするので都度復元)。
    clear();
  });

  it('制約 0 個 (骨組み) の量子初期局面: 呼んでも Position は変化しない (idempotent)', () => {
    const pos: Position = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);
    // 参照そのまま (制約が空だから)
    expect(result).toBe(pos);
    // 念のため中身も一致
    for (let r = 0; r < pos.height; r++) {
      for (let c = 0; c < pos.width; c++) {
        expect(result.board[r][c]).toBe(pos.board[r][c]);
      }
    }
  });

  it('本将棋モード (candidates=undefined) の駒は制約が登録されていても触られない', () => {
    // 何か触りたがる制約を仕込む: すべての駒を kind=fu に絞ろうとする
    const nastyConstraint: QuantumConstraint = () => new Set(['fu']);
    register<QuantumConstraint[]>('quantum:constraints', [nastyConstraint]);

    const pos = initPosition(hondou); // 本将棋モード (candidates 無し)
    const result = candidateUpdate(pos, hondou);
    // すべての駒で candidates は undefined のままで、制約はスキップされる
    for (const row of result.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates).toBeUndefined();
      }
    }
  });

  it('候補を狭める制約を 1 個登録: 全駒が該当駒種に絞られ confirmed=true になる', () => {
    // 全駒を kind={fu} に絞る制約 (単調非増加なので C-002 を破らない)
    const shrinkToFu: QuantumConstraint = () => new Set(['fu']);
    register<QuantumConstraint[]>('quantum:constraints', [shrinkToFu]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);

    for (const row of result.board) {
      for (const cell of row) {
        if (!cell) continue;
        // fu を候補に持っていた駒だけ通る (本将棋なら全駒 fu 候補あり)
        expect(cell.candidates).toBeDefined();
        expect(cell.candidates!.size).toBe(1);
        expect(cell.candidates!.has('fu')).toBe(true);
        // 5-4 の副作用として size==1 で confirmed=true になる
        expect(cell.confirmed).toBe(true);
      }
    }
  });

  it('複数制約: 各制約の返す集合の intersection が反映される', () => {
    const c1: QuantumConstraint = () => new Set(['fu', 'gin', 'hi']);
    const c2: QuantumConstraint = () => new Set(['gin', 'hi', 'kaku']);
    register<QuantumConstraint[]>('quantum:constraints', [c1, c2]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);

    const sample = result.board[0][4]; // gote 王
    expect(sample).toBeDefined();
    // {fu,gin,hi} ∩ {gin,hi,kaku} = {gin,hi}
    expect(Array.from(sample!.candidates!).sort()).toEqual(['gin', 'hi']);
    expect(sample!.confirmed).toBe(false);
  });

  it('駒の kind が候補に含まれない制約: intersection が空にならないよう current & allowed で交わる', () => {
    // 制約が {ou} のみを許すとすると、王候補を持たない駒は候補ゼロになる。
    // (5-4 骨組みは制約側の妥当性チェック無し。C-002 単調性は制約側の責務)
    const onlyOu: QuantumConstraint = () => new Set(['ou']);
    register<QuantumConstraint[]>('quantum:constraints', [onlyOu]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);

    // 全駒が candidates={ou} に絞られる (uniform_pool には ou が含まれるので)
    for (const row of result.board) {
      for (const cell of row) {
        if (!cell) continue;
        expect(cell.candidates!.has('ou')).toBe(true);
        expect(cell.candidates!.size).toBe(1);
        expect(cell.confirmed).toBe(true);
      }
    }
  });

  it('固定点に到達しない制約でも MAX_ITERATIONS で強制停止する (無限ループ耐性)', () => {
    // C-002 単調非増加を破る不正制約: サイクリックに候補集合を書き換える。
    // 実際の制約は単調非増加が前提なのでこういう挙動は起きないが、
    // 5-4 の骨組みが MAX_ITERATIONS で必ず終わることを保証したい。
    let toggle = 0;
    const nonMonotone: QuantumConstraint = () => {
      toggle++;
      // 現在の候補と異なる集合を毎回返す → intersect で常に何かが変わる
      return toggle % 2 === 0
        ? new Set(['fu', 'gin'])
        : new Set(['fu']);
    };
    register<QuantumConstraint[]>('quantum:constraints', [nonMonotone]);

    const pos = quantumInit(initPosition(hondou));
    // 例外なく完了することが最低ライン (無限ループしない)
    const result = candidateUpdate(pos, hondou);
    // 返り値は Position 型
    expect(result).toBeDefined();
    expect(result.board.length).toBe(pos.height);
  });

  it('applyConstraintsToPiece の識別性: 候補が変化しない駒は同じ PieceInstance 参照を保つ (React memo 配慮)', () => {
    // 全駒の候補集合と全く同じ集合を返す制約 → 実質的な変化なし
    const noop: QuantumConstraint = (piece) => new Set(piece.candidates!);
    register<QuantumConstraint[]>('quantum:constraints', [noop]);

    const pos = quantumInit(initPosition(hondou));
    const result = candidateUpdate(pos, hondou);
    // 制約が変化を起こさないので、全体 Position の参照が保存される
    expect(result).toBe(pos);
  });
});
