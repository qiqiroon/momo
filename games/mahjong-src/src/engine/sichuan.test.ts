// 四川（段階9の手順1：ツモって切る）の検査。108 枚・王牌なし・ドラなし・チーなし・缺一門（伏せる・最初の打牌で宣言・打牌の縛り）。
// 缺一門の決め方は原典（MIL『Brief Introduction to Bloody Mahjong』§5）どおり（2026-10-12 Q15=A）。
import { mask, type Envelope, type GameEvent, type Seat } from './events';
import { act, advance, callOptions, legalActions, startRound, type Action } from './round';
import { rulesOfCnSet } from './ruleSets';
import { apply, cnRonBlocked, initialState, kanProblem, liveWallLeft, startPoints, type GameState } from './state';
import { CN_FAN_IDS, sichuanScore } from './sichuan';
import { dictFor } from '../i18n/strings';
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

describe('缺一門：捨てる色の牌は鳴けない（利用者 2026-10-12 Q1=B）', () => {
  /** 席 2 が 9s を 2 枚持つ。伏せる色 suit2 を選び、親が 9s を切ったところ */
  function after9s(suit2: number, hold2: string) {
    const d = dealer();
    const t = new Table();
    t.push({ type: 'gameStart', rules: SICHUAN });
    t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
    const hs = [H0, H1, '5m5m6m6p6p6p7p7p7p5s6s9s9s', H3];
    hs.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
    t.push({ type: 'draw', seat: 0, tile: d('8m')[0] }, [0]);
    t.s = { ...t.s, wall: [] };
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9s'), suit: 2 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '1s'), suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, hold2), suit: suit2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9s') });
    return t;
  }

  it('捨てる色（伏せた色）の牌はポンできない。ほかの色にした人ならポンできる', () => {
    expect(callOptions(after9s(2, '5s').s, 2).some((a) => a.type === 'pon')).toBe(false);
    expect(callOptions(after9s(1, '6p').s, 2).some((a) => a.type === 'pon')).toBe(true);
  });

  it('ほかの人の端末に届いた鳴きでも、全体の局面で止める', () => {
    const t = after9s(2, '5s');
    const nines = t.s.hands[2].filter((x) => kindOf(x) === 26);
    expect(() => t.push({ type: 'call', seat: 2, meld: 'pon', tiles: nines })).toThrow('捨てる色の牌は鳴けない');
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

// ---- 手順2：アガリと点（MIL §3・§9・§10） ----

/** 「1m1m1m2m…」の手（14 枚）を種類ごとの枚数にする */
const counts = (s: string) => {
  const c = new Array(34).fill(0);
  for (const [, nums, suit] of s.matchAll(/(\d+)([mps])/g)) for (const d of nums) c[BASE[suit as 'm'] + Number(d) - 1]++;
  return c;
};
const score = (hand: string, pons: string[] = [], haidi = false) =>
  sichuanScore({ concealed: counts(hand), melds: pons.map((x) => ({ kind: BASE[x[1] as 'm'] + Number(x[0]) - 1, size: 3 as const })), haidi }, SICHUAN);
const fanIds = (hand: string, pons: string[] = [], haidi = false) => score(hand, pons, haidi)?.fans.map((f) => `${f.id}${f.fan}`).sort();

describe('四川の番と基本点', () => {
  it('役が無くてもアガれる（0 番＝1 点）。形でなければ null', () => {
    expect(score('1m1m1m2m3m4m5m6m7m2s3s4s9m9m')).toMatchObject({ fan: 0, points: 1, capped: false });
    expect(score('1m1m1m2m3m4m5m6m7m2s3s4s9m7s')).toBeNull();
  });

  it('碰碰胡 1・清一色 2・根（同じ牌 4 枚ごとに 1）', () => {
    expect(fanIds('1m1m1m3m3m3m5s5s5s7s7s7s9s9s')).toEqual(['pengpeng1']);
    expect(fanIds('1m2m3m2m3m4m4m5m6m7m8m9m9m9m')).toEqual(['qingyise2']);
    // 1m を 4 枚（123m＋111m）：根 1
    expect(fanIds('1m1m1m1m2m3m5s6s7s7p8p9p9p9p')).toEqual(['gen1']);
  });

  it('七对 2。同じ牌 4 枚は 2 対に数えて根 1 も付く（龙七对＝3 番 8 点）', () => {
    expect(fanIds('1m1m3m3m5m5m2s2s4s4s6s6s8s8s')).toEqual(['qidui2']);
    expect(score('1m1m1m1m5m5m2s2s4s4s6s6s8s8s')).toMatchObject({ fan: 3, points: 8 });
  });

  it('金钩钓：4 組とも鳴いて単騎（碰碰胡も付く）・海底 1', () => {
    expect(fanIds('9s9s', ['1m', '3m', '5s', '7s'])).toEqual(['jingou1', 'pengpeng1']);
    expect(fanIds('1m1m1m2m3m4m5m6m7m2s3s4s9m9m', [], true)).toEqual(['haidi1']);
  });

  it('上限 3 番（8 点）で切る：清一色＋七对＋根 2＝6 番でも 8 点', () => {
    const r = score('1m1m1m1m3m3m3m3m5m5m7m7m9m9m');
    expect(r).toMatchObject({ fan: 6, points: 8, capped: true });
  });
});

describe('四川のアガリ：払い方と見逃しの縛り', () => {
  // ※血戦到底（手順3）の流れは下の describe。ここの点の動きはアガった直後の持ち点の変化で見る
  // 席 1 は筒子が無い＝9m を伏せて「筒子」を捨てる色にする。1m1m1m 234m 567m 234s 9m の単騎＝9m でアガる（0 番 1 点）
  const S0 = '9m1p2p3p4p5p6p7p8p9p1s1s5s';
  const S1 = '1m1m1m2m3m4m5m6m7m2s3s4s9m';
  const S3 = '8m1p2p8p8p8p9p9p9p6s7s8s9s';
  function ready() {
    const r = setup([S0, S1, '5m5m6m6p6p6p7p7p7p5s6s7s8s', S3], '6s');
    const { t } = r;
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9m'), suit: 0 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '9m'), suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9m') });
    return r;
  }

  it('ロン：放銃者が基本点を払う。ほかの人の端末でも同じ結果', () => {
    const { t } = ready();
    expect(legalActions(t.s, 1).some((a) => a.type === 'ron')).toBe(true);
    t.do(1, { type: 'ron' });
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    expect(t.s.scores).toEqual([-1, 1, 0, 0]);
    expect(JSON.stringify(t.view(3).cnWins)).toBe(JSON.stringify(t.s.cnWins));
  });

  it('ツモ：ほかの 3 人がそれぞれ（基本点＋1）を払う', () => {
    const { t, d } = ready();
    for (const seat of [1, 2, 3] as Seat[]) t.do(seat, { type: 'pass' });
    t.push({ type: 'draw', seat: 1, tile: d('9m')[0] }, [1]);
    expect(legalActions(t.s, 1).some((a) => a.type === 'tsumo')).toBe(true);
    t.do(1, { type: 'tsumo' });
    expect(t.s.scores).toEqual([-2, 6, -2, -2]);
  });

  it('見逃したら、自分が次に引くまで同じ点以下ではロンできない（点が上がればできる）', () => {
    const { t, d } = ready();
    t.do(1, { type: 'pass' });
    expect(t.s.cnMissed[1]).toBe(1);
    // ほかの人の端末には見逃しは見えない
    expect(t.view(2).cnMissed[1]).toBeNull();
    expect(cnRonBlocked(t.s, 1, { fans: [], fan: 0, capped: false, points: 1 })).toBe(true);
    expect(cnRonBlocked(t.s, 1, { fans: [], fan: 1, capped: false, points: 2 })).toBe(false);
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    t.push({ type: 'draw', seat: 1, tile: d('3s')[0] }, [1]);
    expect(t.s.cnMissed[1]).toBeNull();
  });

  it('捨てる色が残っているとアガれない', () => {
    // 席 1 が筒子を捨てる色にせず、萬子（9m の色）にしたら、萬子だらけの手ではアガれない
    const r = setup([S0, S1, '5m5m6m6p6p6p7p7p7p5s6s7s8s', S3], '6s');
    const { t } = r;
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9m'), suit: 0 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '9m'), suit: 0 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9m') });
    expect(legalActions(t.s, 1).some((a) => a.type === 'ron')).toBe(false);
    expect(() => t.do(1, { type: 'ron' })).toThrow();
  });
});
describe('血戦到底（段階9の手順3・MIL §3-3）：アガった人が抜けて続く', () => {
  const S0 = '9m1p2p3p4p5p6p7p8p9p1s1s5s';
  const S1 = '1m1m1m2m3m4m5m6m7m2s3s4s9m';
  const S3 = '8m1p2p8p8p8p9p9p9p6s7s8s9s';
  function ready() {
    const r = setup([S0, S1, '5m5m6m6p6p6p7p7p7p5s6s7s8s', S3], '6s');
    const { t } = r;
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9m'), suit: 0 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '9m'), suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9m') });
    return r;
  }

  it('ロンした人は抜け、局は続く。次は抜けた人の下家がツモる。抜けた人は手牌を開けたまま', () => {
    const { t } = ready();
    t.do(1, { type: 'ron' });
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    expect(t.s.phase).toBe('draw');
    expect(t.s.turn).toBe(2);
    expect(t.s.cnOut).toEqual([false, true, false, false]);
    expect(t.s.opened[1]).toBe(true);
    expect(t.s.cnWins).toHaveLength(1);
    // ほかの人の端末でも、抜けた人の手牌が見えている
    expect(t.view(3).hands[1].every((x) => x >= 0)).toBe(true);
  });

  it('抜けた人は打たない：ツモれない・切られた牌に返事をしない', () => {
    const { t, d } = ready();
    t.do(1, { type: 'ron' });
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    // 番を無理に席 1 にしても、抜けた人はツモれない（番の決まりとは別に止める）
    const saved = t.s;
    t.s = { ...t.s, turn: 1 };
    expect(() => t.push({ type: 'draw', seat: 1, tile: d('3s')[0] }, [1])).toThrow('抜けた人がツモった');
    t.s = saved;
    t.push({ type: 'draw', seat: 2, tile: d('6m')[0] }, [2]);
    const cut = legalActions(t.s, 2).find((a) => a.type === 'discard')!;
    t.do(2, cut);
    expect(t.s.claim?.replies[1]).toBe('self');
    expect(legalActions(t.s, 1)).toEqual([]);
  });

  it('ツモで抜けたら、払うのはまだ抜けていない人だけ（基本点＋1）', () => {
    const { t, d } = ready();
    t.do(1, { type: 'ron' });
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    // 席 1 が抜けたあとに、席 2 がツモアガリしたことにする（手牌を差し替えて形を作る）
    const before = t.s.scores.slice();
    t.s = { ...t.s, hands: t.s.hands.map((h, i) => (i === 2 ? d('2m2m2m3m3m3m4m4m4m8m8m8m7m') : h)) };
    t.push({ type: 'draw', seat: 2, tile: d('7m')[0] }, [2]);
    t.do(2, { type: 'tsumo' });
    // 碰碰胡 1＋清一色 2＝3 番 8 点。席 0 と席 3 が 9 点ずつ。抜けた席 1 は払わない
    expect(t.s.scores.map((x, i) => x - before[i])).toEqual([-9, 0, 18, -9]);
    // 残りが 2 人（席 0・3）なので、まだ続く
    expect(t.s.phase).toBe('draw');
    expect(t.s.turn).toBe(3);
  });

  it('山が尽きたら、それまでのアガリを全部結果に入れて終える（点はアガったときに動いている）', () => {
    const { t } = ready();
    t.do(1, { type: 'ron' });
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    t.s = { ...t.s, wallLeft: 0 };
    const [ev] = advance(t.s);
    t.s = apply(t.s, ev);
    expect(t.s.phase).toBe('ended');
    expect(t.s.result).toMatchObject({ type: 'cnWin', exhausted: true });
    expect(t.s.settlement).toEqual([-1, 1, 0, 0]);
    expect(t.s.scores).toEqual([-1, 1, 0, 0]);
  });
});
describe('カン（段階9の手順4・MIL §8・§10）', () => {
  const S0 = '9m1p2p3p4p5p6p7p8p9p1s1s5s';
  const S1 = '1m1m1m2m3m4m5m6m7m2s3s4s9m';
  const S3 = '8m1p2p8p8p8p9p9p9p6s7s8s9s';
  /** 親が 9m を切り、全員見送って席 1 が 1m（4 枚目）を引いたところ。席 1 は筒子なし＝9m を伏せて筒子を捨てる色にしている */
  function drew1m() {
    const r = setup([S0, S1, '5m5m6m6p6p6p7p7p7p5s6s7s8s', S3], '6s');
    const { t, d } = r;
    t.do(0, { type: 'que', tile: tileOf(t.s, 0, '9m'), suit: 0 });
    t.do(1, { type: 'que', tile: tileOf(t.s, 1, '9m'), suit: 1 });
    t.do(2, { type: 'que', tile: tileOf(t.s, 2, '5s'), suit: 2 });
    t.do(3, { type: 'que', tile: tileOf(t.s, 3, '6s'), suit: 2 });
    t.do(0, { type: 'discard', tile: tileOf(t.s, 0, '9m') });
    for (const seat of [1, 2, 3] as Seat[]) t.do(seat, { type: 'pass' });
    t.push({ type: 'draw', seat: 1, tile: d('1m')[0] }, [1]);
    return r;
  }
  const ankan1m = (t: Table) => {
    const a = legalActions(t.s, 1).find((x) => x.type === 'kan' && x.kan === 'ankan');
    if (!a) throw new Error('暗槓できるはず');
    t.do(1, a);
  };

  it('暗槓：まだ抜けていない各人から 2 点（刮风下雨）。補充の牌は山の尻から', () => {
    const { t } = drew1m();
    ankan1m(t);
    expect(t.s.scores).toEqual([-2, 6, -2, -2]);
    expect(t.s.cnKans).toMatchObject([{ seat: 1, kind: 'ankan' }]);
    expect(t.s.rinshanDue).toBe(true);
    const full = { ...t.s, wall: Array.from({ length: 108 }, (_, i) => i) };
    expect(advance(full)[0].ev).toMatchObject({ type: 'draw', rinshan: true, tile: 107 });
  });

  it('杠上开花：補充の牌でツモ＝1 番（根も付く）。ツモの払い', () => {
    const { t, d } = drew1m();
    ankan1m(t);
    t.push({ type: 'draw', seat: 1, tile: d('9m')[0], rinshan: true }, [1]);
    t.do(1, { type: 'tsumo' });
    const w = t.s.cnWins[0];
    expect(w.score.fans.map((f) => f.id).sort()).toEqual(['gangkai', 'gen']);
    // 2 番 4 点＝各人 5 点。カンの 2 点と合わせて
    expect(t.s.scores).toEqual([-7, 21, -7, -7]);
  });

  it('杠上炮：カンした人の直後の打牌でロン＝1 番。そのカンの収入は返す', () => {
    const { t, d } = drew1m();
    ankan1m(t);
    // 席 2 を 9m 単騎の形にする（捨てる色の索子なし）
    t.s = { ...t.s, hands: t.s.hands.map((h, i) => (i === 2 ? d('2m2m2m3m3m3m4m4m4m9m5p5p5p') : h)) };
    t.push({ type: 'draw', seat: 1, tile: d('3p')[0], rinshan: true }, [1]);
    // 最初の打牌は伏せた 9m
    t.do(1, { type: 'discard', tile: tileOf(t.s, 1, '9m') });
    t.do(2, { type: 'ron' });
    t.do(3, { type: 'pass' });
    t.do(0, { type: 'pass' });
    expect(t.s.cnWins[0].score.fans.map((f) => f.id)).toContain('gangpao');
    expect(t.s.cnKans[0].returned).toBe(true);
    // 碰碰胡＋杠上炮＝2 番 4 点。カン [-2,6,-2,-2] → ロン 4 点（席 1 → 席 2）→ カンの収入を返す
    expect(t.s.scores).toEqual([0, -4, 4, 0]);
  });

  it('伏せた牌・捨てる色の牌ではカンできない', () => {
    const { t } = drew1m();
    expect(kanProblem(t.s, 1, 'ankan', t.s.hands[1].filter((x) => kindOf(x) === 8).concat([0, 1, 2]))).not.toBeNull();
    // 捨てる色（筒子）の牌を 4 枚持たせると暗槓の候補に出ない
    t.s = { ...t.s, hands: t.s.hands.map((h, i) => (i === 1 ? [...h.filter((x) => kindOf(x) !== 0), 36, 37, 38, 39] : h)), drawn: t.s.drawn.map((x, i) => (i === 1 ? 39 : x)) };
    expect(kanProblem(t.s, 1, 'ankan', [36, 37, 38, 39])).toContain('捨てる色');
  });
});
describe('四川の画面の言葉', () => {
  it('番の名前・カンの種類が日英中の辞書に全部ある（抜けると結果の枠で画面が止まる＝10-12 に一度起きた）', () => {
    for (const lang of ['ja', 'en', 'zh'] as const) {
      const d = dictFor(lang) as Record<string, string>;
      for (const id of CN_FAN_IDS) expect(d[`cnFan_${id}`], `${lang} cnFan_${id}`).toBeTruthy();
      for (const k of ['minkan', 'ankan', 'kakan']) expect(d[`cnKan_${k}`], `${lang} cnKan_${k}`).toBeTruthy();
    }
  });
});