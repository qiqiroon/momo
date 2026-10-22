// アシストモードの守りの手がかり（段階4・設計 アシストモード v0.01 §5・§6）の検査
import type { GameEvent, Seat } from '../engine/events';
import { GENERAL_RULES } from '../engine/rules';
import { apply, initialState, type GameState, type OpenMeld } from '../engine/state';
import { callLoss } from './callCheck';
import { risksOf, suspectsOf } from './danger';
import { yakuPlan } from './yakuPlan';

/** 種類から背番号（同じ種類は 0,1,2,3 番目を順に） */
function idsOf(kinds: number[], used = new Map<number, number>()): number[] {
  return kinds.map((k) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return k * 4 + n;
  });
}

/** 席 0 に配った局面。o で河・リーチ・鳴きを直接入れる（見える局面の数え方だけを確かめる） */
function table(mine: number[], o: { discards?: number[][]; riichi?: Seat[]; melds?: number[][][] } = {}): GameState {
  let s = initialState();
  let seq = 0;
  const push = (ev: GameEvent) => (s = apply(s, { seq: seq++, to: 'all', ev }));
  const used = new Map<number, number>();
  const hand = idsOf(mine, used);
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles: hand });
  const discards = [0, 1, 2, 3].map((i) => idsOf(o.discards?.[i] ?? [], used));
  const riichi = [0, 1, 2, 3].map((i) => (o.riichi?.includes(i as Seat) ? 'riichi' : 'none')) as GameState['riichi'];
  const riichiAt = [0, 1, 2, 3].map((i) => (o.riichi?.includes(i as Seat) ? 0 : null));
  const melds = [0, 1, 2, 3].map((i) => (o.melds?.[i] ?? []).map((ks): OpenMeld => ({ type: 'pon', tiles: idsOf(ks, used), called: null, from: ((i + 1) % 4) as Seat })));
  return { ...s, discards, riichi, riichiAt, melds };
}

describe('テンパイしていそうな人', () => {
  it('リーチの人は確か（テンパイ？ではない）。鳴きが 3 回の人はテンパイ？。何も無い人は出さない', () => {
    const s = table([0, 1, 2], { riichi: [1], melds: [[], [], [[27, 27, 27], [28, 28, 28], [31, 31, 31]], []] });
    const sus = suspectsOf(s, 0);
    expect(sus.map((x) => [x.seat, x.riichi, x.why.key])).toEqual([
      [1, true, 'tpRiichi'],
      [2, false, 'tpMelds'],
    ]);
    // あやしい待ち：3 つまで・リーチの人の現物は入らない
    expect(sus[0].waits.length).toBeLessThanOrEqual(3);
  });

  it('リーチの人の現物は待ちに入らない', () => {
    const s = table([0, 1, 2], { riichi: [1], discards: [[], [4, 13, 22], [], []] });
    const w = suspectsOf(s, 0)[0].waits;
    expect(w).not.toContain(4);
    expect(w).not.toContain(13);
  });
});

describe('手牌の危なさ', () => {
  // 手牌：5萬（筋なし真ん中）・2萬（リーチの人に 5萬が通っていれば筋）・東・リーチの人の現物 9萬
  it('現物は印なし・筋の通っていない真ん中は赤・字牌のまだ見えていない牌は黄。テンパイしていそうな人がいなければ空', () => {
    const s = table([4, 27, 8, 13], { riichi: [1], discards: [[], [8], [], []] });
    const r = risksOf(s, 0, suspectsOf(s, 0));
    expect(r.get(8)!.level).toBe(0);
    expect(r.get(8)!.why.key).toBe('dgGenbutsu');
    expect(r.get(4)!.level).toBe(2);
    expect(r.get(27)!.level).toBe(1);
    expect(risksOf(s, 0, [])).toEqual(new Map());
  });

  it('筋が通ると危なさが下がる（5萬が通っていれば 2萬と 8萬は筋）', () => {
    const s = table([1, 7], { riichi: [1], discards: [[], [4], [], []] });
    const r = risksOf(s, 0, suspectsOf(s, 0));
    expect(r.get(1)!.why.key).toBe('dgSuji');
    expect(r.get(1)!.level).toBeLessThan(2);
  });
});

describe('鳴く前の注意', () => {
  // 2萬3萬 456筒 789索 234索 5萬 6萬（門前・平和の形）に、上家が 4萬を切った
  it('門前の手でチーすると、平和とリーチが消える', () => {
    const s0 = table([1, 2, 12, 13, 14, 24, 25, 26, 19, 20, 21, 4, 5], { discards: [[], [], [], [3]] });
    const tile = s0.discards[3][0];
    const s: GameState = { ...s0, phase: 'claim', claim: { kind: 'discard', from: 3, tile, replies: [null, null, null, 'self'], rons: [], calls: [] } };
    const before = yakuPlan(s, 0, { budgetMs: 100000 });
    expect(before.some((p) => p.ids.includes('pinfu'))).toBe(true);
    const hand = s.hands[0];
    const loss = callLoss(s, 0, { type: 'chi', tiles: [hand[0], hand[1]] }, before, 100000)!;
    expect(loss.lost).toContain('pinfu');
    expect(loss.lost).toContain('riichi');
  });

  it('すでに鳴いている手では「リーチが消える」を足さない（もうリーチできない）', () => {
    // 白をポン済み（鳴いた面子）・手は 2萬3萬 456筒 789索 5萬 6萬 4萬、上家が 4萬を切った
    const s0 = table([1, 2, 12, 13, 14, 24, 25, 26, 4, 5], { discards: [[], [], [], [3]], melds: [[[31, 31, 31]], [], [], []] });
    const tile = s0.discards[3][0];
    const s: GameState = { ...s0, phase: 'claim', claim: { kind: 'discard', from: 3, tile, replies: [null, null, null, 'self'], rons: [], calls: [] } };
    const before = yakuPlan(s, 0, { budgetMs: 100000 });
    const hand = s.hands[0];
    const loss = callLoss(s, 0, { type: 'chi', tiles: [hand[0], hand[1]] }, before, 100000)!;
    expect(loss.lost).not.toContain('riichi');
    // 白の刻子があるので、鳴いても役は残る
    expect(loss.none).toBe(false);
  });
});
