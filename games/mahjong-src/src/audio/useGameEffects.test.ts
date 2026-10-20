// 局の始めの演出（親決めのサイコロ・洗牌・配る様子）は、本当に始まった局だけで出す（利用者 10-20 Q1=A）。
// ★前は戻ってきた人の卓（写しで作り直す）が途中で一瞬「配り終えた直後」に見え、続きから再開するのにサイコロが回った

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apply, initialState, type GameState } from '../engine/state';
import { DEAL_SHOW_MS, setDealHold, showsDice } from '../game/useTable';
import { playOne } from '../selfplay/run';
import { useGameEffects } from './useGameEffects';

vi.mock('./engine', () => ({ isAudioRunning: () => false, playRandomBgm: () => {}, playSample: () => {}, stopBgm: () => {} }));

/** 1 局ぶんの局面を順に（全部見える形） */
function states(): GameState[] {
  const { log } = playOne('effects-restore');
  const out: GameState[] = [];
  let s = initialState();
  for (const e of log) out.push((s = apply(s, e)));
  return out;
}

describe('局の始めの演出', () => {
  beforeEach(() => {
    setDealHold(DEAL_SHOW_MS);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setDealHold(0);
  });

  const all = states();
  // 配り終えた直後（最初のツモの前）。自動対局は親決めをしないので、親決めのサイコロの目を足す（対局の最初の局）
  const dealt = all[all.findIndex((s) => s.phase !== 'deal' && s.phase !== 'idle') - 1];
  const deal: GameState = { ...dealt, dealerDice: [3, 4] };
  const mid = all.filter((s) => s.phase === 'discard' && s.discards.reduce((n, d) => n + d.length, 0) >= 6)[0];

  it('ふつうに始まった最初の局：親決めのサイコロを見せ、手牌を少しずつ見せる', () => {
    expect(showsDice(deal)).toBe(true);
    const { result, rerender } = renderHook(({ v }) => useGameEffects(v, true, 0, 0), { initialProps: { v: initialState() } });
    rerender({ v: deal });
    expect(result.current.banner?.kind).toBe('dice');
    expect(result.current.dealt).toBe(0);
  });

  it('★写しで作り直した卓（局の途中から戻った）：途中で「配り終えた直後」に見えても、サイコロも配る様子も出さない', () => {
    expect(mid).toBeTruthy();
    // 戻る前の画面（局の途中）→ 作り直しの途中（配り終えた直後に見える）→ 続き
    const { result, rerender } = renderHook(({ v }) => useGameEffects(v, true, 0, mid.nextSeq), { initialProps: { v: mid } });
    rerender({ v: deal });
    expect(result.current.banner).toBeNull();
    expect(result.current.dealt).toBeNull();
    rerender({ v: mid });
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.banner).toBeNull();
    expect(result.current.dealt).toBeNull();
  });
});
