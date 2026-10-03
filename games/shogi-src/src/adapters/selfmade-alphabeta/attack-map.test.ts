/**
 * ★v1.98: 利きの地図 (attack-map.ts) が、王手の判定 (`isSquareCapturableBy`) と
 * **同じ答えを出す**ことの安全網。
 *
 * 地図は速さのために別に作った数え方なので、本物の判定と食い違うと、評価だけが
 * 「別のゲーム」を見ることになる。平面・円筒・完全トーラス・チェスで、ランダムに
 * 進めた局面の**すべてのマス × 両陣営**を突き合わせる。
 *
 * 自分の駒が乗っているマス (守っている) は、本物の判定では「取れない」になるので、
 * その駒を相手の駒に置き換えてから突き合わせる (乗っている駒がふさぐ筋は変わらない)。
 * 玉の乗ったマスは外す＝完全トーラスの「玉は敵の玉に王手をかけない」は地図の扱う範囲外。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { hondou, chess } from '../../core/engine/mgf/loader';
import { initPosition } from '../../core/engine/position/init';
import { generateLegalMoves } from '../../core/engine/moves/legal';
import { applyMove } from '../../core/engine/position/apply';
import { isSquareCapturableBy } from '../../core/engine/moves/check';
import type { Mgf, Player } from '../../core/engine/mgf/types';
import type { Position } from '../../core/engine/position/types';
import { clear as clearPlugins } from '../../core/plugin/registry';
import { buildAttackMap } from './attack-map';

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

function compareAll(mgf: Mgf, position: Position, label: string): number {
  const royal = new Set(mgf.pieces.filter((p) => p.is_royal).map((p) => p.id));
  const map = buildAttackMap(mgf, position);
  let checked = 0;
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      const cell = position.board[row][col];
      if (cell && royal.has(cell.kind)) continue;
      for (const attacker of ['player1', 'player2'] as Player[]) {
        let probe = position;
        if (cell && cell.owner === attacker) {
          const board = position.board.map((r) => r.slice());
          const other: Player = attacker === 'player1' ? 'player2' : 'player1';
          board[row][col] = { ...cell, owner: other };
          probe = { ...position, board };
        }
        const real = isSquareCapturableBy(mgf, probe, { row, col }, attacker);
        const fast = map[attacker][row * position.width + col] > 0;
        if (real !== fast) throw new Error(`${label}: ${row},${col} に ${attacker} が利くか＝地図 ${fast} / 判定 ${real}`);
        checked++;
      }
    }
  }
  return checked;
}

function walk(mgf: Mgf, start: Position, moves: number, seed: number, label: string): number {
  let pos = start;
  let total = 0;
  const random = seeded(seed);
  for (let i = 0; i < moves; i++) {
    total += compareAll(mgf, pos, `${label} ${i} 手目`);
    const ms = generateLegalMoves(mgf, pos);
    if (ms.length === 0) break;
    pos = applyMove(mgf, pos, ms[Math.floor(random() * ms.length)]);
  }
  return total;
}

afterEach(() => clearPlugins());

describe('利きの地図が王手の判定と一致する', () => {
  it('本将棋 (平面)', () => {
    expect(walk(hondou, initPosition(hondou), 60, 11, '本将棋')).toBeGreaterThan(5000);
  }, 120_000);

  it('円筒 (左右がつながる盤)', async () => {
    const { topologyFor } = await import('../../features/torus');
    expect(walk(hondou, initPosition(hondou, topologyFor('cylinder')), 40, 12, '円筒')).toBeGreaterThan(3000);
  }, 120_000);

  it('完全トーラス (四辺がつながる盤)', async () => {
    const { topologyFor } = await import('../../features/torus');
    expect(walk(hondou, initPosition(hondou, topologyFor('full')), 40, 13, '完全トーラス')).toBeGreaterThan(3000);
  }, 120_000);

  it('チェス (取れない動き＝ポーンの前進を数えない)', () => {
    expect(walk(chess, initPosition(chess), 40, 14, 'チェス')).toBeGreaterThan(3000);
  }, 120_000);

  it('同じ向きを 2 つの動きが持っていても 1 枚と数える', () => {
    // 龍に「8 方向へ 1 マス」を重ねて持たせた作り物のルール。縦横は走りと 1 マスが重なる。
    const mgf: Mgf = {
      ...hondou,
      pieces: hondou.pieces.map((p) =>
        p.id === 'ryu' && p.move_logic
          ? { ...p, move_logic: { ...p.move_logic, abilities: [...p.move_logic.abilities, { type: 'step', direction: 'all_8', range: 1 }] } }
          : p,
      ),
    } as Mgf;
    const board: Position['board'] = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => null));
    board[4][4] = { pieceId: 'R', kind: 'ryu', owner: 'player1', initialOwner: 'player1', initialKind: 'hi', initialSquare: { row: 4, col: 4 }, promoted: true };
    const pos: Position = { width: 9, height: 9, board, hands: { player1: [], player2: [] }, sideToMove: 'player1', moveNumber: 1, history: [] };
    const map = buildAttackMap(mgf, pos);
    for (const [r, c] of [[3, 4], [5, 4], [4, 3], [4, 5], [3, 3], [5, 5], [0, 4], [4, 8]]) {
      expect(map.player1[r * 9 + c], `${r},${c}`).toBe(1);
    }
  });
});
