// アシストモードの行動の助言（段階6・設計 アシストモード v0.01 §7）の検査
import type { GameEvent, Seat } from '../engine/events';
import { GENERAL_RULES } from '../engine/rules';
import { legalActions } from '../engine/round';
import { apply, initialState, type GameState, type OpenMeld } from '../engine/state';
import { createRng, shuffle } from '../engine/rng';
import { adviceOf } from './advice';
import { yakuPlan } from './yakuPlan';

function idsOf(kinds: number[], used: Map<number, number>): number[] {
  return kinds.map((k) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return k * 4 + n;
  });
}

/** 席 0（親）に配った局面。14 枚なら自分の番（切る番）。o で河・リーチ・鳴きを直接入れる */
function table(mine: number[], o: { discards?: number[][]; riichi?: Seat[]; melds?: number[][][] } = {}): GameState {
  let s = initialState();
  let seq = 0;
  const push = (ev: GameEvent) => (s = apply(s, { seq: seq++, to: 'all', ev }));
  const used = new Map<number, number>();
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles: idsOf(mine, used) });
  const discards = [0, 1, 2, 3].map((i) => idsOf(o.discards?.[i] ?? [], used));
  const riichi = [0, 1, 2, 3].map((i) => (o.riichi?.includes(i as Seat) ? 'riichi' : 'none')) as GameState['riichi'];
  const riichiAt = [0, 1, 2, 3].map((i) => (o.riichi?.includes(i as Seat) ? 0 : null));
  const melds = [0, 1, 2, 3].map((i) => (o.melds?.[i] ?? []).map((ks): OpenMeld => ({ type: 'pon', tiles: idsOf(ks, used), called: null, from: ((i + 1) % 4) as Seat })));
  return { ...s, discards, riichi, riichiAt, melds, ...(mine.length === 14 ? { phase: 'discard' as const, turn: 0 as Seat } : {}) };
}
const advise = (s: GameState) => adviceOf(s, 0, legalActions(s, 0), yakuPlan(s, 0, { budgetMs: 100000 }));

// バラバラの 14 枚（アガリまで遠い）
const FAR = [0, 4, 8, 9, 13, 17, 18, 22, 26, 27, 28, 29, 31, 33];

describe('行動の助言', () => {
  it('自分の番・誰もテンパイしていなさそう・序盤：狙う役とおすすめの牌', () => {
    const a = advise(table([1, 2, 12, 13, 14, 24, 25, 26, 19, 20, 4, 4, 30, 33]))!;
    expect(['adEarly', 'adTenpai', 'adRiichi']).toContain(a.key);
    expect(a.tiles.length).toBe(1);
  });

  it('狙う役は、おすすめの牌を切っても遠くならない行から選ぶ（話がちぐはぐにならない）＝配牌 30 通り', () => {
    let checked = 0;
    for (let i = 0; i < 30; i++) {
      const wall = shuffle(Array.from({ length: 136 }, (_, j) => j), createRng('advice' + i));
      const s = table(wall.slice(0, 14).map((id) => Math.floor(id / 4)));
      const plan = yakuPlan(s, 0, { budgetMs: 100000 });
      const a = adviceOf(s, 0, legalActions(s, 0), plan);
      if (!a?.combo || (a.key !== 'adEarly' && a.key !== 'adMid')) continue;
      checked++;
      const row = plan.find((p) => p.ids.join() === a.combo!.join())!;
      expect(row.spare.has(a.tiles[0])).toBe(true);
    }
    expect(checked).toBeGreaterThan(10);
  }, 60000);

  it('自分の番・リーチの人がいて手が遠い：降りる（安全な牌から）か押すかを、おすすめの牌つきで', () => {
    const a = advise(table(FAR, { riichi: [1], discards: [[], [8, 27], [], []] }))!;
    // アガリまで遠い手は降りる（Apocalypse の CPU が近さを落としてでも安全な牌を選ぶ）
    expect(a.key).toBe('adFold');
    expect(a.vars.name).toBe(1);
    expect(a.vars.state).toBe('tpStateRiichi');
    expect(a.tiles.length).toBe(1);
  });

  it('自分の番でない・リーチの人がいる：「！」の印を見るように', () => {
    const a = advise(table(FAR.slice(0, 13), { riichi: [2] }))!;
    expect(a.key).toBe('adWatch');
    expect(a.vars.name).toBe(2);
  });

  it('自分の番でない・染め手の人がいる（萬子の鳴きが 2 つ）：その色に気をつける', () => {
    const a = advise(table(FAR.slice(0, 13), { melds: [[], [[1, 1, 1], [5, 5, 5]], [], []] }))!;
    expect(a.key).toBe('adFlush');
    expect(a.vars.suit).toBe(0);
  });

  it('自分の番でない・何もない：狙っている役', () => {
    const a = advise(table([1, 2, 12, 13, 14, 24, 25, 26, 19, 20, 4, 4, 30]))!;
    expect(['adAim', 'adWaiting']).toContain(a.key);
    expect(a.combo?.length).toBeGreaterThan(0);
  });
});
