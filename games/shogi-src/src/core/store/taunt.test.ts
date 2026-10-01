/**
 * ★v1.95 威嚇 (音響 §2.5・画面機能 S06)。
 *
 * 押してから指すと、その手で威嚇音が鳴る。ここで固定するのは「回数の数え方」:
 *   - **次の 1 手だけ**に効き、指せば予約は解ける
 *   - **指す前に取り消せば回数は減らない**
 *   - **1 局に 3 回まで**、陣営ごとに数える
 *   - 相手が威嚇つきで指した手が届けば、**相手の**回数が減る
 *   - AI の手・棋譜の並べ直しは威嚇にならない
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore, TAUNTS_PER_GAME } from './game-store';
import { generateLegalMoves } from '../engine';
import { wireMoveOf } from '../protocol/wire-move';
import type { BoardMove, DropMove } from '../engine/position/types';

/** 人が盤を触って指す (自分で指した手＝予約を見る道)。 */
function localMove(): void {
  const s = useGameStore.getState();
  const legal = generateLegalMoves(s.mgf, s.position).filter((m) => m.type === 'move' && !m.promote);
  const m = legal[0] as BoardMove;
  s.selectSquare(m.from);
  useGameStore.getState().tryMove(m.to);
}

function remoteMove(taunt?: boolean): boolean {
  const s = useGameStore.getState();
  const m = generateLegalMoves(s.mgf, s.position).find((x) => x.type === 'move' && !x.promote) as BoardMove | DropMove;
  return useGameStore.getState().applyRemoteMove(wireMoveOf(m), taunt === undefined ? undefined : { taunt });
}

const st = () => useGameStore.getState();

describe('威嚇 (★v1.95)', () => {
  beforeEach(() => {
    st().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
  });

  it('対局開始時は両者とも 3 回・予約なし', () => {
    expect(st().tauntsLeft).toEqual({ player1: TAUNTS_PER_GAME, player2: TAUNTS_PER_GAME });
    expect(st().tauntArmed).toBe(false);
  });

  it('予約して指すと、その手が威嚇つきになり、指した側の回数が 1 減り、予約は解ける', () => {
    st().setTauntArmed(true);
    localMove();
    expect(st().lastAppliedMove?.taunt).toBe(true);
    expect(st().tauntsLeft.player1).toBe(2);
    expect(st().tauntsLeft.player2).toBe(3);
    expect(st().tauntArmed).toBe(false);
  });

  it('次の 1 手だけ＝続けて指した手は威嚇にならない', () => {
    st().setTauntArmed(true);
    localMove(); // 先手 (威嚇)
    localMove(); // 後手 (予約なし)
    expect(st().lastAppliedMove?.taunt).toBeUndefined();
    expect(st().tauntsLeft).toEqual({ player1: 2, player2: 3 });
  });

  it('指す前に取り消せば回数は減らない', () => {
    st().setTauntArmed(true);
    st().setTauntArmed(false);
    localMove();
    expect(st().lastAppliedMove?.taunt).toBeUndefined();
    expect(st().tauntsLeft.player1).toBe(3);
  });

  it('3 回使ったら、もう予約できない', () => {
    for (let i = 0; i < 3; i++) {
      st().setTauntArmed(true); // 先手
      localMove();
      localMove(); // 後手
    }
    expect(st().tauntsLeft.player1).toBe(0);
    st().setTauntArmed(true);
    expect(st().tauntArmed).toBe(false);
  });

  it('相手が威嚇つきで指した手が届けば、相手の回数が減り、その手は威嚇つきとして記録される', () => {
    expect(remoteMove(true)).toBe(true);
    expect(st().lastAppliedMove?.taunt).toBe(true);
    expect(st().tauntsLeft.player1).toBe(2);
  });

  it('回数の残っていない相手が威嚇つきと申告してきても、威嚇にならない (回数は 0 のまま)', () => {
    useGameStore.setState({ tauntsLeft: { player1: 0, player2: 3 } });
    expect(remoteMove(true)).toBe(true);
    expect(st().lastAppliedMove?.taunt).toBeUndefined();
    expect(st().tauntsLeft.player1).toBe(0);
  });

  it('AI の手 (申告の無い届いた手) は威嚇にならない＝自分の予約も消費しない', () => {
    // 人が後手で、AI (先手) が指す前に予約しておいた場面。
    st().setTauntArmed(true);
    remoteMove();
    expect(st().lastAppliedMove?.taunt).toBeUndefined();
    expect(st().tauntsLeft).toEqual({ player1: 3, player2: 3 });
  });

  it('対局をやり直すと 3 回に戻る', () => {
    st().setTauntArmed(true);
    localMove();
    st().reset({ gameType: 'shogi', quantum: false, torusMode: 'none', handicap: null });
    expect(st().tauntsLeft).toEqual({ player1: 3, player2: 3 });
    expect(st().tauntArmed).toBe(false);
  });
});
