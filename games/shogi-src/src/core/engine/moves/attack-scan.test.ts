/**
 * 王手の判定を作り替えたときの安全網 (2026-08-14)。
 *
 * 速くするために「マスの側から届きうる駒だけを拾う」形に変えた。**答えが変わっていない**
 * ことを、作り替える前のやり方 (盤全体の総当たり) と**同じ局面で突き合わせて**確かめる。
 *
 * 土台の変更は、駒を動かす側だけでなく**後から検算する側**にも効く。とくに盤の端が
 * つながっている場合は「間に挟まれているか」の見え方が変わるので、
 * **平面・円筒・完全トーラス・はさみ将棋・量子のすべてで突き合わせる**。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { hondou, hasami } from '../mgf/loader';
import { initPosition } from '../position/init';
import { generateLegalMoves } from './legal';
import { applyMove } from '../position/apply';
import { isSquareAttackedBy, isSquareAttackedByScanAll } from './check';
import type { Position } from '../position/types';
import type { Mgf, Player } from '../mgf/types';
import { clear as clearPlugins } from '../../plugin/registry';

/** 毎回同じ局面をたどるようにした乱数。 */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** すべてのマス × 両陣営で、新旧の答えが一致するか。 */
function compareAllSquares(mgf: Mgf, position: Position, label: string): number {
  let checked = 0;
  for (let row = 0; row < position.height; row++) {
    for (let col = 0; col < position.width; col++) {
      for (const attacker of ['player1', 'player2'] as Player[]) {
        const fast = isSquareAttackedBy(mgf, position, { row, col }, attacker);
        const slow = isSquareAttackedByScanAll(mgf, position, { row, col }, attacker);
        if (fast !== slow) {
          throw new Error(`${label}: ${row},${col} を ${attacker} が脅かすか＝新 ${fast} / 旧 ${slow}`);
        }
        checked++;
      }
    }
  }
  return checked;
}

/** ランダムに進めながら、各局面で全マスを突き合わせる。 */
function walkAndCompare(mgf: Mgf, start: Position, moves: number, seed: number, label: string): number {
  let pos = start;
  let total = 0;
  const random = seeded(seed);
  for (let i = 0; i < moves; i++) {
    total += compareAllSquares(mgf, pos, `${label} ${i} 手目`);
    const ms = generateLegalMoves(mgf, pos);
    if (ms.length === 0) break;
    pos = applyMove(mgf, pos, ms[Math.floor(random() * ms.length)]);
  }
  return total;
}

afterEach(() => clearPlugins());

describe('王手の判定: 新しいやり方と古いやり方が一致する', () => {
  it('本将棋 (平面)', () => {
    const n = walkAndCompare(hondou, initPosition(hondou), 25, 1, '本将棋');
    expect(n).toBeGreaterThan(1000);
  }, 120_000);

  it('はさみ将棋 (歩だけ・盤いっぱいに駒が並ぶ)', () => {
    const n = walkAndCompare(hasami, initPosition(hasami), 20, 2, 'はさみ');
    expect(n).toBeGreaterThan(1000);
  }, 120_000);

  it('★円筒 (左右がつながる盤)', async () => {
    await import('../../../features/torus');
    const pos = { ...initPosition(hondou), torusMode: 'cylinder' as const };
    const n = walkAndCompare(hondou, pos, 20, 3, '円筒');
    expect(n).toBeGreaterThan(1000);
  }, 120_000);

  it('★完全トーラス (四辺がつながる盤)', async () => {
    await import('../../../features/torus');
    const pos = { ...initPosition(hondou), torusMode: 'full' as const };
    const n = walkAndCompare(hondou, pos, 20, 4, '完全トーラス');
    expect(n).toBeGreaterThan(1000);
  }, 120_000);

  it('★量子 (駒の正体が決まっていない)', async () => {
    await import('../../../features/quantum');
    const { quantumInit } = await import('../../../features/quantum/init');
    const pos = quantumInit(initPosition(hondou));
    const n = walkAndCompare(hondou, pos, 12, 5, '量子');
    expect(n).toBeGreaterThan(1000);
  }, 180_000);
});
