// 四川（段階9の手順1：ツモって切る）の検査。108 枚・王牌なし・ドラなし・チーなし・缺一門（伏せる・最初の打牌で宣言・打牌の縛り）。
// 缺一門の決め方は原典（MIL『Brief Introduction to Bloody Mahjong』§5）どおり（2026-10-12 Q15=A）。
import { mask, type Envelope, type GameEvent, type Seat } from './events';
import { act, advance, callOptions, legalActions, startRound, type Action } from './round';
import { rulesOfCnSet } from './ruleSets';
import { apply, initialState, liveWallLeft, startPoints, type GameState } from './state';
import { kindOf, tileSetFor, type TileId } from './tiles';

const SICHUAN = rulesOfCnSet('sichuan');
const BASE = { m: 0, p: 9, s: 18 } as const;

/** 背番号を配る係（同じ種類は 4 枚目→3 枚目…の順に使う） */
function dealer() {
  const used = new Map<number, number>();
  return (s: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of s.matchAll(/(\d+)([mps])/g)) {
      for (const d of nums) {
        const kind = BASE[suit as 'm'] + Number(d) - 1;
        const n = used.get(kind) ?? 0;
        if (n >= 4) throw new Error(`5 枚目は無い（${d}${suit}）`);
        used.set(kind, n + 1);
        out.push(kind * 4 + 3 - n);
      }
    }
    return out;
  };
}

class Table {
  s: GameState = initialState();
  log: Envelope[] = [];
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    const env = { seq: this.s.nextSeq, to, ev };
    this.s = apply(this.s, env);
    this.log.push(env);
  }
  do(seat: Seat, a: Action) {
    for (const e of act(this.s, seat, a)) {
      this.s = apply(this.s, e);
      this.log.push(e);
    }
  }
  /** その席から見える局面 */
  view(seat: Seat): GameState {
    return this.log.reduce((s, e) => apply(s, mask(e, seat)), initialState());
  }
}

/** 4 人に配って、親（席 0）が draw を引いたところ（捨てる色を決める番） */
function setup(hands: [string, string, string, string], draw: string) {
  const d = dealer();
  const t = new Table();
  t.push({ type: 'gameStart', rules: SICHUAN });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
  t.push({ type: 'draw', seat: 0, tile: d(draw)[0] }, [0]);
  t.s = { ...t.s, wall: [] };
  return { t, d };
}

const tileOf = (s: GameState, seat: Seat, code: string) => {
  const kind = BASE[code[1] as 'm'] + Number(code[0]) - 1;
  const t = s.hands[seat].find((x) => kindOf(x) === kind);
  if (t === undefined) throw new Error(`席 ${seat} は ${code} を持っていない`);
  return t;
};

// 席 0：索子が 1 枚だけ（捨てる色＝索子にしやすい）／席 1：筒子が 1 枚も無い（手に無い色を宣言できる）
const H0 = '1m2m3m4m5m6m7m1p2p3p4p5p9s';
const H1 = '1m2m3m4m6m7m8m9m9m1s2s3s4s';
const H2 = '5m5m6m6p6p6p7p7p7p5s6s7s8s';
const H3 = '8m1p6p8p8p8p9p9p9p6s7s8s9s';

describe('四川の牌と山', () => {
  it('108 枚（字牌・花牌なし）・王牌なし・配り終えてもドラ表示牌をめくらない', () => {
    const t = new Table();
    t.push({ type: 'gameStart', rules: SICHUAN });
    expect(tileSetFor(SICHUAN).length).toBe(108);
    for (const e of startRound(t.s, 'sc', 0, 0)) {
      t.s = apply(t.s, e);
      t.log.push(e);
    }
    expect(t.log.some((e) => e.ev.type === 'doraReveal')).toBe(false);
    // 52 枚配って残り 56 枚。王牌が無いので全部ツモれる
    expect(t.s.wallLeft).toBe(56);
    expect(liveWallLeft(t.s)).toBe(56);
  });

  it('持ち点は 0 点から（中国式の持ち点は点そのもの・千点単位ではない）', () => {
    expect(startPoints(SICHUAN)).toBe(0);
    expect(startPoints(rulesOfCnSet('mcr'))).toBe(500);
  });
});

describe('缺一門：捨てる色の牌を伏せる', () => {
  it('親の 14 枚目のあと、4 人そろうまで誰も切れない', () => {
    const { t } = setup([H0, H1, H2, H3], '8m');
    expect(t.s.phase).toBe('que');
    // 親もまだ切れない（伏せることだけ）
    expect(legalActions(t.s, 0).every((a) => a.type === 'que')).toBe(true);
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 2 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    expect(t.s.phase).toBe('que');
    expect(legalActions(t.s, 0)).toEqual([]);
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '1s'), suit: 2 });
    expect(t.s.phase).toBe('discard');
    expect(t.s.turn).toBe(0);
  });

  it('伏せた牌と色は本人だけに見える（ほかの人には伏せたことだけ）', () => {
    const { t } = setup([H0, H1, H2, H3], '8m');
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 2 });
    const own = t.view(0);
    const other = t.view(1);
    expect(own.queHeld[0]).toBe(tileOf(t.s, 0, '9s'));
    expect(own.queHeldSuit[0]).toBe(2);
    expect(other.queHeld[0]).toBe(-1);
    expect(other.queHeldSuit[0]).toBe(-1);
    // 伏せていない人は null のまま
    expect(other.queHeld[1]).toBeNull();
  });

  it('伏せた牌と違う色を捨てる色にできるのは、その色が手に 1 枚も無いときだけ', () => {
    const { t } = setup([H0, H1, H2, H3], '8m');
    // 席 1 は筒子が無い＝索子の牌を伏せて「筒子」を宣言できる
    const s1 = legalActions(t.s, 1);
    expect(s1.some((a) => a.type === 'que' && a.suit === 1 && kindOf(a.tile) >= 18)).toBe(true);
    // 席 0 は 3 色とも持っている＝伏せた牌の色しか宣言できない
    const s0 = legalActions(t.s, 0);
    expect(s0.every((a) => a.type === 'que' && a.suit === Math.floor(kindOf(a.tile) / 9))).toBe(true);
    expect(() => t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 1 })).toThrow('その色が手に 1 枚も無いときだけ');
  });

  it('伏せるのは 1 回だけ・持っていない牌は伏せられない', () => {
    const { t } = setup([H0, H1, H2, H3], '8m');
    expect(() => t.push({ type: 'queHold', seat: 0, tile: tileOf(t.s, 1, '9m'), suit: 0 }, [0])).toThrow('持っていない牌');
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 2 });
    expect(() => t.push({ type: 'queHold', seat: 0, tile: tileOf(t.s, 0, '1m'), suit: 0 }, [0])).toThrow('もう伏せた');
  });
});

describe('缺一門：最初の打牌で宣言し、捨てる色から切る', () => {
  /** 4 人とも伏せたところ。席 1 は筒子なし＝1s を伏せて筒子を宣言 */
  function held() {
    const r = setup([H0, H1, H2, H3], '8m');
    const { t } = r;
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 2 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '1s'), suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    return r;
  }

  it('最初の打牌は伏せた牌だけ。切ると捨てる色が全員に見える', () => {
    const { t } = held();
    const legal = legalActions(t.s, 0);
    expect(legal).toEqual([{ type: 'discard', tile: tileOf(t.s, 0, '9s') }]);
    expect(() => t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '1m') })).toThrow('伏せておいた牌');
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9s') });
    const last = t.log[t.log.length - 1].ev;
    expect(last.type === 'discard' && last.que).toBe(2);
    expect(t.view(3).que[0]).toBe(2);
    expect(t.s.queHeld[0]).toBeNull();
  });

  it('宣言した色と伏せたときの色が違う打牌は止める（ほかの人の端末でも）', () => {
    const { t } = held();
    expect(() => t.push({ type: 'discard', seat: 0, tile: tileOf(t.s, 0, '9s'), tsumogiri: false, que: 0 })).toThrow('伏せたときに決めた色と違う');
    expect(() => t.push({ type: 'discard', seat: 0, tile: tileOf(t.s, 0, '9s'), tsumogiri: false })).toThrow('宣言していない');
  });

  it('手に無い色を宣言した人は、伏せた牌（別の色）を最初に切る', () => {
    const { t, d } = held();
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9s') });
    for (const seat of [1, 2, 3] as Seat[]) t.do(seat, { type: 'pass' });
    t.push({ type: 'draw', seat: 1, tile: d('9p')[0] }, [1]);
    // 筒子を引いても、最初の打牌は伏せた 1s
    expect(legalActions(t.s, 1)).toEqual([{ type: 'discard', tile: tileOf(t.s, 1, '1s') }]);
    t.do(1, { type: 'discard', tile: tileOf(t.s, 1, '1s') });
    expect(t.s.que[1]).toBe(1);
  });

  it('捨てる色の牌が手に残るうちは、その色しか切れない。無くなればどれでも切れる', () => {
    const { t, d } = held();
    // 席 0 は 9s を切ったあと、引いた 7s が捨てる色（索子）＝ 7s しか切れない
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9s') });
    for (const seat of [1, 2, 3] as Seat[]) t.do(seat, { type: 'pass' });
    t.s = { ...t.s, phase: 'draw', turn: 0 };
    t.push({ type: 'draw', seat: 0, tile: d('7s')[0] }, [0]);
    expect(legalActions(t.s, 0)).toEqual([{ type: 'discard', tile: tileOf(t.s, 0, '7s') }]);
    expect(() => t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '1m') })).toThrow('捨てる色の牌が手に残っている');
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '7s') });
    for (const seat of [1, 2, 3] as Seat[]) t.do(seat, { type: 'pass' });
    t.s = { ...t.s, phase: 'draw', turn: 0 };
    t.push({ type: 'draw', seat: 0, tile: d('9m')[0] }, [0]);
    // 索子が無くなった＝どれでも切れる
    expect(legalActions(t.s, 0).filter((a) => a.type === 'discard').length).toBe(14);
  });

  it('チーは無い・カンはまだ（手順4）・伏せた牌は鳴きに使えない', () => {
    const { t } = held();
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9s') });
    // 席 1 は上家の 9s に 7s8s… を持っていないので、別の場面で確かめる：席 3 は 9s を持つ（6s7s8s9s のうち 6s を伏せた）
    expect(callOptions(t.s, 1).some((a) => a.type === 'chi')).toBe(false);
    expect(legalActions(t.s, 3).some((a) => a.type === 'kan')).toBe(false);
  });

  it('伏せた牌はポンに使えない', () => {
    // 席 1 は 1s を 2 枚持ち、1 枚を伏せる。親が 1s を切っても、残り 1 枚ではポンできない
    const d = dealer();
    const t = new Table();
    t.push({ type: 'gameStart', rules: SICHUAN });
    t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
    const hs = ['1m2m3m4m5m6m7m1p2p3p4p5p1s', '1m2m3m4m6m7m8m9m9m1s1s3s4s', H2, H3];
    hs.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
    t.push({ type: 'draw', seat: 0, tile: d('8m')[0] }, [0]);
    t.s = { ...t.s, wall: [] };
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '1s'), suit: 2 });
    const s1 = t.s.hands[1].filter((x) => kindOf(x) === 18);
    t.do(1, { type: 'que', tile: s1[0], suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '1s') });
    expect(callOptions(t.s, 1).some((a) => a.type === 'pon')).toBe(false);
  });
});

describe('四川の流局（手順1の仮）', () => {
  it('山が尽きたら宣言なしで点を動かさずに終える（查叫・花豬は手順5）', () => {
    const t = new Table();
    t.push({ type: 'gameStart', rules: SICHUAN });
    for (const e of startRound(t.s, 'sc2', 0, 0)) t.s = apply(t.s, e);
    t.s = { ...t.s, wallLeft: 0, phase: 'draw' };
    const [ev] = advance(t.s);
    expect(ev.ev.type).toBe('exhaust');
    t.s = apply(t.s, ev);
    expect(t.s.phase).toBe('ended');
    expect(t.s.settlement).toEqual([0, 0, 0, 0]);
  });
});
