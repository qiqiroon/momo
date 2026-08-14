/**
 * 手合い (駒落ち) × 量子モード — 落とした駒は「正体の候補」からも消えること。
 *
 * 候補集合は §Q4.1 に従い「自陣営の全 PieceID 集合」なので、盤から駒を落として
 * (init.ts が通し番号を振る前に取り除く) から候補を配れば、落とした駒の PieceID は
 * そもそも存在せず候補にも入らない。この性質は初期化の順序に依存しているので、
 * 順序が入れ替わったときに気づけるようここで固定する。
 */
import { describe, it, expect } from 'vitest';
import { initPosition } from '../../core/engine/position/init';
import { hondou } from '../../core/engine/mgf/loader';
import { buildInitialKindMap, displayKindsFor, groupCandidatesByKind } from '../../core/engine/candidate-kinds';
import type { Player } from '../../core/engine/mgf/types';
import type { Position } from '../../core/engine/position/types';
import { quantumInit } from './init';

function startQuantum(typeId: string | null, giver: Player = 'player1'): Position {
  return quantumInit(
    initPosition(hondou, undefined, typeId ? { typeId, giver } : undefined),
  );
}

/** 上手 (駒を落とした側) の駒 1 枚について、駒種ごとの候補枚数を数える。 */
function kindCountsOf(pos: Position, side: Player): Map<string, number> {
  const kindMap = buildInitialKindMap(pos);
  let sample = null;
  for (const row of pos.board) {
    for (const cell of row) if (cell && cell.initialOwner === side) sample = cell;
  }
  if (!sample) throw new Error('駒が見つかりません');
  const groups = groupCandidatesByKind(hondou, sample.candidates!, false, kindMap);
  return new Map(Array.from(groups, ([kind, ids]) => [kind, ids.length]));
}

function pieceCount(pos: Position, side: Player): number {
  let n = 0;
  for (const row of pos.board) {
    for (const cell of row) if (cell && cell.initialOwner === side) n++;
  }
  return n;
}

describe('手合い × 量子モード: 落とした駒は候補から消える', () => {
  it('平手なら 20 枚ぶんの候補 (香 2・桂 2・飛 1・角 1)', () => {
    const counts = kindCountsOf(startQuantum(null), 'player1');
    expect(counts.get('kyo')).toBe(2);
    expect(counts.get('kei')).toBe(2);
    expect(counts.get('hi')).toBe(1);
    expect(counts.get('kaku')).toBe(1);
  });

  it('香落ちでは上手の香の可能性が 1 枚ぶん減る', () => {
    const pos = startQuantum('kyo');
    expect(pieceCount(pos, 'player1')).toBe(19);
    const counts = kindCountsOf(pos, 'player1');
    expect(counts.get('kyo')).toBe(1);
    // 落としていない駒種はそのまま
    expect(counts.get('kei')).toBe(2);
    expect(counts.get('hi')).toBe(1);
  });

  it('六枚落ちでは上手の香・桂・飛・角の可能性が 0 になる', () => {
    const pos = startQuantum('roku');
    expect(pieceCount(pos, 'player1')).toBe(14);
    const counts = kindCountsOf(pos, 'player1');
    expect(counts.get('kyo')).toBeUndefined();
    expect(counts.get('kei')).toBeUndefined();
    expect(counts.get('hi')).toBeUndefined();
    expect(counts.get('kaku')).toBeUndefined();
    // 残る駒種は歩 9・銀 2・金 2・玉 1
    expect(counts.get('fu')).toBe(9);
    expect(counts.get('gin')).toBe(2);
    expect(counts.get('kin')).toBe(2);
    expect(counts.get('ou')).toBe(1);
  });

  it('下手 (落とされていない側) の候補は 20 枚のまま', () => {
    const pos = startQuantum('roku');
    expect(pieceCount(pos, 'player2')).toBe(20);
    const counts = kindCountsOf(pos, 'player2');
    expect(counts.get('kyo')).toBe(2);
    expect(counts.get('kei')).toBe(2);
    expect(counts.get('hi')).toBe(1);
    expect(counts.get('kaku')).toBe(1);
  });

  it('画面に出る駒の顔 (巡回/重ね) にも落とした駒種は現れない', () => {
    const pos = startQuantum('roku');
    const kindMap = buildInitialKindMap(pos);
    for (const row of pos.board) {
      for (const cell of row) {
        if (!cell || cell.initialOwner !== 'player1') continue;
        const faces = displayKindsFor(hondou, cell, kindMap);
        expect(faces).not.toContain('kyo');
        expect(faces).not.toContain('kei');
        expect(faces).not.toContain('hi');
        expect(faces).not.toContain('kaku');
        expect(faces).toHaveLength(4); // 玉・金・銀・歩 の 4 種
      }
    }
  });

  it('上手が player2 側でも同じ (二枚落ちで飛角の可能性が 0)', () => {
    const pos = startQuantum('ni', 'player2');
    expect(pieceCount(pos, 'player2')).toBe(18);
    const counts = kindCountsOf(pos, 'player2');
    expect(counts.get('hi')).toBeUndefined();
    expect(counts.get('kaku')).toBeUndefined();
    expect(kindCountsOf(pos, 'player1').get('hi')).toBe(1);
  });
});
