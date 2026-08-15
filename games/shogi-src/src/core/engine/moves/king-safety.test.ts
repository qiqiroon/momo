/**
 * 「玉の安全に関係しない手は盤を進めない」省略の安全網 (2026-08-15)。
 *
 * 読む速さのために、王手放置・自殺手の確認を**大多数の手で飛ばす**ようにした。
 * **答えが変わっていない**ことを、省略なしのやり方と**同じ局面で突き合わせて**確かめる。
 *
 * 土台の変更は後から検算する側にも効くので、**本将棋・はさみ・円筒・完全トーラス・量子**の
 * すべてで突き合わせる (前回 2026-08-14 の王手判定の作り替えと同じ立て付け)。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { hondou, hasami } from '../mgf/loader';
import { initPosition } from '../position/init';
import { applyMove } from '../position/apply';
import { buildKingSafety, generateLegalMoves, generateLegalMovesNoSkip } from './legal';
import type { Mgf } from '../mgf/types';
import type { BoardCell, Move, PieceInstance, Position } from '../position/types';
import { clear as clearPlugins } from '../../plugin/registry';

afterEach(() => clearPlugins());

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function key(m: Move): string {
  return m.type === 'drop'
    ? `drop ${m.pieceId} → ${m.to.row},${m.to.col}`
    : `move ${m.pieceId} ${m.from.row},${m.from.col} → ${m.to.row},${m.to.col}${m.promote ? '+' : ''}`;
}

function sortedKeys(moves: Move[]): string[] {
  return moves.map(key).sort();
}

/** ランダムに進めながら、各局面で「省略あり」と「省略なし」の合法手を突き合わせる。 */
function walkAndCompare(mgf: Mgf, start: Position, plies: number, seed: number, label: string): number {
  let pos = start;
  let compared = 0;
  const random = seeded(seed);
  for (let i = 0; i < plies; i++) {
    const fast = generateLegalMoves(mgf, pos);
    const slow = generateLegalMovesNoSkip(mgf, pos);
    expect(sortedKeys(fast), `${label} ${i} 手目`).toEqual(sortedKeys(slow));
    compared += slow.length;
    if (!slow.length) break;
    pos = applyMove(mgf, pos, slow[Math.floor(random() * slow.length)]);
  }
  return compared;
}

describe('合法手: 省略ありと省略なしが一致する', () => {
  it('本将棋 (平面)', () => {
    expect(walkAndCompare(hondou, initPosition(hondou), 60, 1, '本将棋')).toBeGreaterThan(1000);
  }, 120_000);

  it('はさみ将棋 (挟み取り＝省略を使わないルール)', () => {
    expect(walkAndCompare(hasami, initPosition(hasami), 40, 2, 'はさみ')).toBeGreaterThan(1000);
  }, 120_000);

  it('★円筒 (左右がつながる盤)', async () => {
    const { topologyFor } = await import('../../../features/torus');
    const pos = initPosition(hondou, topologyFor('cylinder'));
    expect(walkAndCompare(hondou, pos, 40, 3, '円筒')).toBeGreaterThan(1000);
  }, 120_000);

  it('★完全トーラス (四辺がつながる盤)', async () => {
    const { topologyFor } = await import('../../../features/torus');
    const pos = initPosition(hondou, topologyFor('full'));
    expect(walkAndCompare(hondou, pos, 40, 4, '完全トーラス')).toBeGreaterThan(1000);
  }, 120_000);

  it('★量子 (駒の正体が決まっていない)', async () => {
    await import('../../../features/quantum');
    const { quantumInit } = await import('../../../features/quantum/init');
    const pos = quantumInit(initPosition(hondou));
    expect(walkAndCompare(hondou, pos, 12, 5, '量子')).toBeGreaterThan(1000);
  }, 180_000);
});

// ── ここから、省略の判断そのものを直接確かめる ───────────────────────────

function piece(kind: string, owner: 'player1' | 'player2', row: number, col: number): PieceInstance {
  return {
    pieceId: `${kind}_${owner}_${row}${col}`,
    kind,
    owner,
    initialOwner: owner,
    initialKind: kind,
    initialSquare: { row, col },
    promoted: false,
  };
}

/** 指定した駒だけを並べた盤を作る (他は空)。 */
function board(mgf: Mgf, pieces: PieceInstance[], topology?: { wrapX: boolean; wrapY: boolean }): Position {
  const base = initPosition(mgf, topology);
  const empty: BoardCell[][] = Array.from({ length: base.height }, () =>
    Array.from({ length: base.width }, () => null as BoardCell),
  );
  for (const p of pieces) empty[p.initialSquare.row][p.initialSquare.col] = p;
  return { ...base, board: empty, hands: { player1: [], player2: [] } };
}

describe('省略の判断', () => {
  it('初期局面: 玉が見つかり、ふさぎ役は 5七の歩だけ (同じ筋の奥に相手の玉がいるため)', () => {
    const safety = buildKingSafety(hondou, initPosition(hondou));
    expect(safety).not.toBeNull();
    expect(safety!.king).toEqual({ row: 8, col: 4 });
    // 玉の筋を上へたどると 5七の歩 → その先は相手の玉。相手の玉は走らないので本当は
    // ふさぎ役ではないが、**拾いすぎる側に倒している** (その駒の手だけ従来どおり確かめる
    // だけで、答えは変わらない)。取りこぼすと指せない手を指せてしまうため。
    expect([...safety!.shields]).toEqual(['6,4']);
  });

  it('★ふさぎ役の駒を見つける (玉の前の角が、後ろの飛に貫かれている)', () => {
    // 5九 玉 / 5八 角 (自分) / 5一 飛 (相手) … 同じ筋に並ぶ
    const pos = board(hondou, [
      piece('ou', 'player1', 8, 4),
      piece('kaku', 'player1', 7, 4),
      piece('hi', 'player2', 0, 4),
    ]);
    const safety = buildKingSafety(hondou, pos);
    expect(safety).not.toBeNull();
    expect([...safety!.shields]).toEqual(['7,4']);
  });

  it('★ふさぎ役は筋から外れる手を指せない (省略ありでも同じ答えになる)', () => {
    const pos = board(hondou, [
      piece('ou', 'player1', 8, 4),
      piece('kaku', 'player1', 7, 4),
      piece('hi', 'player2', 0, 4),
    ]);
    const fast = generateLegalMoves(hondou, pos);
    expect(sortedKeys(fast)).toEqual(sortedKeys(generateLegalMovesNoSkip(hondou, pos)));
    // 角は斜めにしか動けないので、この筋の上に留まる手が無い＝1 手も指せない
    expect(fast.filter((m) => m.type === 'move' && m.from.row === 7 && m.from.col === 4)).toHaveLength(0);
  });

  it('すでに王手のときは省略しない (null を返す)', () => {
    const pos = board(hondou, [
      piece('ou', 'player1', 8, 4),
      piece('hi', 'player2', 0, 4),
    ]);
    expect(buildKingSafety(hondou, pos)).toBeNull();
  });

  it('★挟んで取るルールでは省略しない (指した駒以外が盤から消えるため)', () => {
    expect(buildKingSafety(hasami, initPosition(hasami))).toBeNull();
  });

  it('★玉が 2 枚あるルールでは省略しない (どれを玉とみなすかが入れ替わりうる)', () => {
    const pos = board(hondou, [
      piece('ou', 'player1', 8, 4),
      piece('ou', 'player1', 8, 0),
      piece('hi', 'player2', 0, 8),
    ]);
    expect(buildKingSafety(hondou, pos)).toBeNull();
  });

  it('★量子で玉が未確定なら「守るべき玉がいない」= 全部省ける', async () => {
    // features/quantum は import 済みだと登録が走らない (afterEach で登録を消しているため)。
    // ここでは玉の見つけ方だけを直接登録する。
    const { register } = await import('../../plugin/registry');
    const { findConfirmedKing } = await import('../../../features/quantum/king-detection');
    register('quantum:findKing', findConfirmedKing);
    const { quantumInit } = await import('../../../features/quantum/init');
    const pos = quantumInit(initPosition(hondou));
    const safety = buildKingSafety(hondou, pos);
    expect(safety).not.toBeNull();
    expect(safety!.king).toBeNull();
  });
});
