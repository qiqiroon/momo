// 流局したときのテンパイ・ノーテンの宣言と支払いの検査。配る牌を指定した局面を出来事の列で組む。
import type { Envelope, GameEvent, Seat } from './events';
import { act, legalActions } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, notenPayments, type GameState } from './state';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

function tiles(s: string, used: Map<number, number>): number[] {
  const out: number[] = [];
  for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of nums) {
      const kind = BASE[suit as 'm'] + Number(d) - 1;
      const n = used.get(kind) ?? 0;
      used.set(kind, n + 1);
      out.push(kind * 4 + 3 - n);
    }
  }
  return out;
}

const TENPAI = '123m456p789s1z1z2z2z'; // シャンポン待ち
const NOTEN = '1m4m7m2p5p8p3s6s9s1z3z5z7z';
const withRule = (patch: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...patch } } : GENERAL_RULES;

/** 4 人に手牌を配り、山を尽きさせて流局したところ（親は席 0）。riichi の席はリーチしたことにする */
function exhausted(hands: string[], rules: Rules = GENERAL_RULES, riichi: Seat[] = []): GameState {
  const used = new Map<number, number>();
  let s = initialState();
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => (s = apply(s, { seq: s.nextSeq, to, ev }));
  push({ type: 'gameStart', rules });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => push({ type: 'deal', seat: seat as Seat, tiles: tiles(h, used) }, [seat as Seat]));
  push({ type: 'doraReveal', tile: 33 * 4 });
  // 山を尽きさせる（最後の打牌のあと）。リーチの状態も持たせる
  s = { ...s, phase: 'draw', wallLeft: 14, riichi: s.riichi.map((r, i) => (riichi.includes(i as Seat) ? 'riichi' : r)) };
  push({ type: 'exhaust' });
  return s;
}

describe('流局の支払い', () => {
  it('テンパイの人数ごとの点の動き（合計 3000 点）', () => {
    expect(notenPayments([true, false, false, false])).toEqual([3000, -1000, -1000, -1000]);
    expect(notenPayments([true, true, false, false])).toEqual([1500, 1500, -1500, -1500]);
    expect(notenPayments([true, true, true, false])).toEqual([1000, 1000, 1000, -3000]);
    expect(notenPayments([false, false, false, false])).toEqual([0, 0, 0, 0]);
    expect(notenPayments([true, true, true, true])).toEqual([0, 0, 0, 0]);
  });

  it('親から順に宣言し、全員言い終わったら結果が出る。テンパイの人の手牌は全員に開く', () => {
    let s = exhausted([TENPAI, NOTEN.replace('1m', '2m'), '2m3m5m6m8m9m1p3p4p6p7p9p4z', '1s2s4s5s7s8s4z4z5z5z6z6z7z']);
    expect(s.phase).toBe('declare');
    expect(s.turn).toBe(0);
    s = declareAll(s);
    expect(s.phase).toBe('ended');
    expect(s.result).toEqual({ type: 'exhaust', tenpai: [true, false, false, false], payments: [3000, -1000, -1000, -1000] });
  });
});

describe('流局の宣言', () => {
  it('テンパイでリーチしていなければ「テンパイ」「ノーテン」の両方を選べる（一般ルール）', () => {
    const s = exhausted([TENPAI, NOTEN, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')]);
    expect(legalActions(s, 0)).toEqual([{ type: 'tenpai' }, { type: 'noten' }]);
  });

  it('テンパイを隠してノーテンと言うと、手牌は開かず、払う側になる', () => {
    let s = exhausted([TENPAI, NOTEN, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')]);
    for (const e of act(s, 0, { type: 'noten' })) s = apply(s, e);
    expect(s.declared[0]).toBe(false);
    s = declareAll(s);
    expect(s.result).toEqual({ type: 'exhaust', tenpai: [false, false, false, false], payments: [0, 0, 0, 0] });
  });

  it('リーチした人はノーテンと言えない', () => {
    const s = exhausted([TENPAI, NOTEN, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')], GENERAL_RULES, [0]);
    expect(legalActions(s, 0)).toEqual([{ type: 'tenpai' }]);
    expect(() => apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'declare', seat: 0, tenpai: false, hand: null } })).toThrow(/リーチした人/);
  });

  it('「テンパイでもノーテンと言える」が「できない」ルールでは、テンパイならテンパイだけ', () => {
    const s = exhausted([TENPAI, NOTEN, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')], withRule({ tenpaiHide: 'ng' }));
    expect(legalActions(s, 0)).toEqual([{ type: 'tenpai' }]);
    expect(() => apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'declare', seat: 0, tenpai: false, hand: null } })).toThrow(/このルールではできない/);
  });

  it('ノーテンの人はテンパイと言えない（出来事を直接作っても止める）', () => {
    let s = exhausted([NOTEN, TENPAI, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')]);
    expect(legalActions(s, 0)).toEqual([{ type: 'noten' }]);
    expect(() => (s = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'declare', seat: 0, tenpai: true, hand: s.hands[0].slice() } }))).toThrow(
      /テンパイでないのに/,
    );
  });

  it('順番でない人は宣言できない', () => {
    const s = exhausted([TENPAI, NOTEN, NOTEN.replace('1m', '2m'), NOTEN.replace('1m', '3m')]);
    expect(legalActions(s, 1)).toEqual([]);
    expect(() => apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'declare', seat: 1, tenpai: false, hand: null } })).toThrow(/宣言する時・席ではない/);
  });
});

/** まだ言っていない人が親から順に、言えることの先頭（テンパイならテンパイ）を宣言する */
function declareAll(s: GameState): GameState {
  while (s.phase === 'declare') {
    const seat = s.turn;
    for (const e of act(s, seat, legalActions(s, seat)[0])) s = apply(s, e);
  }
  return s;
}
