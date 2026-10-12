// 同じ山で勝負のリンク（6e・Q45＝A）
import { describe, expect, it } from 'vitest';
import { decodeRuleLink } from '../engine/ruleSets';
import { decodeSameLink, encodeSameLink, sameWallOf } from './same';
import { benchCpu } from '../cpu/bench';
import type { Seat } from '../engine/events';
import { finalResult } from '../engine/final';
import { createRng, shuffle } from '../engine/rng';
import { GENERAL_RULES } from '../engine/rules';
import { startRoundFromWall } from '../engine/round';
import { dealerByDice } from '../engine/state';
import { tileSetFor } from '../engine/tiles';
import { playOne } from '../selfplay/run';
import type { KifuSource } from './kifu';

describe('同じ山で勝負のリンク', () => {
  it('ルール・山の種・送った人の成績が、読み直すと同じになる', () => {
    const choice = decodeRuleLink('tenhou.ippatsu_off')!;
    const w = { choice, seed: 'abc123', strength: 'apocalypse' as const, result: { rank: 2, total: -12.5 } };
    expect(decodeSameLink(encodeSameLink(w))).toEqual(w);
    const noResult = { choice, seed: 'xyz', strength: 'easy' as const };
    expect(decodeSameLink(encodeSameLink(noResult))).toEqual(noResult);
    expect(/^[A-Za-z0-9_-]+$/.test(encodeSameLink(w))).toBe(true);
  });

  it('CPU の強さが入っていない古いリンク（段階7より前）は Hard で読む', () => {
    const choice = decodeRuleLink('general')!;
    const code = encodeSameLink({ choice, seed: 'old', strength: 'easy' });
    const o = JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (code.length % 4)) % 4))) as Record<string, unknown>;
    delete o.c;
    const old = btoa(JSON.stringify(o)).replace(/=+$/, '');
    expect(decodeSameLink(old)?.strength).toBe('hard');
  });

  it('壊れたリンク・知らない版・ルールが読めないものは読まない', () => {
    expect(decodeSameLink('abc')).toBeNull();
    const bad = btoa(JSON.stringify({ v: 9, r: 'general', s: 'x' }));
    expect(decodeSameLink(bad)).toBeNull();
    expect(decodeSameLink(btoa(JSON.stringify({ v: 1, r: 'nope', s: 'x' })))).toBeNull();
  });
});

/** オンライン対局の代わり：CPU どうしの半荘を打ち、局ごとの山の並び（wallSeed から作り直す）を持たせた牌譜にする */
function onlineLike(me: Seat): KifuSource {
  const r = playOne('same-online', GENERAL_RULES, benchCpu, true);
  const walls = r.log.filter((e) => e.ev.type === 'wallSeed').map((e) => (e.ev.type === 'wallSeed' ? shuffle(tileSetFor(GENERAL_RULES), createRng(e.ev.seed ?? '')) : []));
  return { seed: 'online', startedAt: '2026-10-12T10:00:00+09:00', players: [], set: 'general', events: r.log, mode: 'online', walls, me };
}

describe('同じ山で勝負：オンライン対局から（Q5=A）', () => {
  it('山の並び・親決めのサイコロ・送った人の成績を入れ、読み直すと同じになる。壊れた山は読まない', () => {
    const src = onlineLike(2);
    const sw = sameWallOf(src);
    expect(sw.online?.walls).toHaveLength(src.walls!.length);
    const mine = finalResult(playOne('same-online', GENERAL_RULES, benchCpu, true).final).find((r) => r.seat === 2)!;
    expect(sw.result).toEqual({ rank: mine.rank, total: mine.total });
    expect(sw.seed).toBe('online-2026-10-12T10:00:00+09:00');
    const back = decodeSameLink(encodeSameLink(sw));
    expect(back).toEqual(sw);
    // 同じ牌が 2 枚ある山は読まない
    const bad = { ...sw, online: { ...sw.online!, walls: [sw.online!.walls[0].map((x, i) => (i === 1 ? sw.online!.walls[0][0] : x))] } };
    expect(decodeSameLink(encodeSameLink(bad))).toBeNull();
  });

  it('席を回す：受け取った人（席 0）の最初の配牌は、送った人（席 2）の最初の配牌と同じ', () => {
    const src = onlineLike(2);
    const sw = sameWallOf(src);
    const o = sw.online!;
    const dice = src.events[1].ev;
    if (dice.type !== 'dealerDice') throw new Error('親決めが無い');
    expect(o.by).toBe(((dice.by - 2 + 4) % 4) as Seat);
    const dealer = dealerByDice(o.by, o.dice);
    expect(dealer).toBe(((dice.dealer - 2 + 4) % 4) as Seat);
    const mine = startRoundFromWall(2, { roundIndex: 0, dealer, honba: 0 }, (pos) => o.walls[0][pos])
      .flatMap((e) => (e.ev.type === 'deal' && e.ev.seat === 0 ? e.ev.tiles : []));
    const theirs = src.events.slice(0, 40).flatMap((e) => (e.ev.type === 'deal' && e.ev.seat === 2 ? e.ev.tiles : []));
    expect(mine).toHaveLength(13);
    expect(mine).toEqual(theirs);
  });
});