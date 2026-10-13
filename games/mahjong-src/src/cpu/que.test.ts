// CPU の缺一門（段階9 手順7）：捨てる色の選び方と、捨てる色の牌を「手に無いもの」として測ること。
import { kindCounts } from '../engine/agari';
import type { Envelope, GameEvent, Seat } from '../engine/events';
import { act, legalActions } from '../engine/round';
import { rulesOfCnSet } from '../engine/ruleSets';
import { apply, initialState, type GameState } from '../engine/state';
import { kindOf, type TileId } from '../engine/tiles';
import { chooseQue, handCounts, queSuitOf, shantenAfterDiscard } from './common';
import { acceptance, shanten } from './shanten';

const SICHUAN = rulesOfCnSet('sichuan');
const BASE = { m: 0, p: 9, s: 18 } as const;

function tiles(code: string, used: Map<number, number>): TileId[] {
  const out: TileId[] = [];
  for (const [, nums, suit] of code.matchAll(/(\d+)([mps])/g)) {
    for (const d of nums) {
      const kind = BASE[suit as 'm'] + Number(d) - 1;
      const n = used.get(kind) ?? 0;
      used.set(kind, n + 1);
      out.push(kind * 4 + 3 - n);
    }
  }
  return out;
}

/** 席 0 が親で 14 枚目を引き、捨てる色を決める番（ほかの 3 人は使わない牌から） */
function queTurn(hand: string, draw: string): GameState {
  const used = new Map<number, number>();
  let s = initialState();
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => (s = apply(s, { seq: s.nextSeq, to, ev }));
  push({ type: 'gameStart', rules: SICHUAN });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  const mine = tiles(hand, used);
  const drawn = tiles(draw, used)[0];
  push({ type: 'deal', seat: 0, tiles: mine }, [0]);
  // ほかの席は残りの牌から 13 枚ずつ
  const rest: TileId[] = [];
  for (let k = 0; k < 27; k++) for (let i = 0; i < 4 - (used.get(k) ?? 0); i++) rest.push(k * 4 + i);
  for (const seat of [1, 2, 3] as Seat[]) push({ type: 'deal', seat, tiles: rest.splice(0, 13) }, [seat]);
  push({ type: 'draw', seat: 0, tile: drawn }, [0]);
  expect(s.phase).toBe('que');
  return { ...s, wall: [] };
}

const choose = (s: GameState) => {
  const a = chooseQue(s, 0, legalActions(s, 0));
  if (a.type !== 'que') throw new Error('伏せる手でない');
  return a;
};

describe('捨てる色の選び方', () => {
  it('枚数の一番少ない色でなく、捨てたあとアガリに近い色を捨てる', () => {
    // 萬子 9 枚で 3 面子・筒子はばらばらの 3 枚・索子は 5s6s の塔子 2 枚
    // 索子（2 枚）を捨てると 2 向聴、筒子（3 枚）を捨てると 1 向聴（5s6s が残る）＝筒子を捨てる
    const s = queTurn('1m2m3m4m5m6m7m8m1p5p9p5s6s', '9m');
    const a = choose(s);
    expect(a.suit).toBe(1);
    expect(Math.floor(kindOf(a.tile) / 9)).toBe(1);
  });

  it('近さが同じなら、枚数の少ない色を捨てる（捨て終えるのが早い）', () => {
    // 筒子 1p9p（2 枚）・索子 1s5s9s（3 枚）はどちらも面子にならない＝近さは同じ→筒子
    const s = queTurn('1m2m3m4m5m6m7m8m9m1p9p1s5s', '9s');
    expect(choose(s).suit).toBe(1);
  });

  it('手に 1 枚も無い色があれば、その色を捨てる。伏せる牌（最初に切る牌）は手を崩さない牌', () => {
    // 筒子が無い。伏せた牌は最初の打牌になるので、浮いている 9s を伏せる
    const s = queTurn('1m2m3m4m6m7m8m9m9m1s2s3s9s', '5m');
    const a = choose(s);
    expect(a.suit).toBe(1);
    expect(kindOf(a.tile)).toBe(BASE.s + 8);
    // 伏せたあとの手の近さは、どの牌を伏せたときよりも悪くない
    const after = (t: TileId) => {
      const c = kindCounts(s.hands[0]);
      c[kindOf(t)]--;
      return shanten(c, 0);
    };
    expect(Math.min(...s.hands[0].map(after))).toBe(after(a.tile));
  });
  it('手に無い色を捨てる色にするとき、伏せた牌を抜いた手で比べる（孤立の度合いだけで選ばない）', () => {
    // 6m を伏せると 456m・345s・678s・11s・99s でテンパイ。4m を伏せると遠くなる
    const s = queTurn('4m5m6m1s1s3s4s5s6s7s8s9s9s', '6m');
    const a = choose(s);
    expect(a.suit).toBe(1);
    expect(kindOf(a.tile)).toBe(BASE.m + 5);
  });
});

describe('捨てる色の牌は手に無いものとして測る', () => {
  // 捨てる色を筒子に決めて、最初の打牌（伏せた牌）を切ったあと、席 0 が次に引いた局面
  function afterQue(): GameState {
    let s = queTurn('1m2m3m4m5m6m7m8m1p5p9p5s6s', '9m');
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const a = chooseQue(s, seat, legalActions(s, seat));
      for (const e of act(s, seat, a)) s = apply(s, e);
    }
    return s;
  }

  it('捨てる色が決まると、その色の牌は数えない（足しても受け入れにならない）', () => {
    const s = afterQue();
    expect(queSuitOf(s, 0)).toBe(1);
    const c = handCounts(s, 0);
    for (let k = 9; k < 18; k++) expect(c[k]).toBe(0);
    expect(acceptance(c, 0).kinds.every((k) => k < 9 || k >= 18)).toBe(true);
  });

  it('捨てる色の牌を切っても、測った手の近さは今のまま（ほかの牌を切ると変わる）', () => {
    const s = afterQue();
    const now = shanten(handCounts(s, 0), 0);
    const after = shantenAfterDiscard(s, 0);
    const pin = s.hands[0].filter((t) => Math.floor(kindOf(t) / 9) === 1);
    expect(pin.length).toBeGreaterThan(0);
    for (const t of pin) expect(after(t)).toBe(now);
    // 萬子の面子を崩すと遠くなる（測り方が働いている）
    const m5 = s.hands[0].find((t) => kindOf(t) === 4)!;
    expect(after(m5)).toBeGreaterThan(now);
  });
});
