// 香港麻雀（段階9 香港の手順1：ツモって切る・鳴く・カン・流局）の検査。
// 原典：香港麻雀協會『十三張清張麻雀規則』2023-05-17（作業側 docs\原典）。
import type { Envelope, GameEvent, Seat } from './events';
import { act, legalActions, type Action } from './round';
import { rulesOfCnSet } from './ruleSets';
import type { Rules } from './rules';
import { apply, callProblem, initialState, type GameState } from './state';
import { kindOf, tileSetFor, type TileId } from './tiles';

const HK = rulesOfCnSet('hk');
const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

/** 牌の書き方（1m〜9m・1p・1s・1z〜7z＝東南西北白發中）から背番号へ。同じ種類は 4 枚目→3 枚目…の順に使う */
function dealer() {
  const used = new Map<number, number>();
  return (code: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of code.matchAll(/(\d+)([mpsz])/g)) {
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

/** 4 人に配って、親（席 0）が draw を引いたところ */
function setup(hands: [string, string, string, string], draw: string, rules: Rules = HK) {
  const d = dealer();
  let s = initialState();
  const push = (ev: GameEvent, to: Envelope['to'] = 'all') => (s = apply(s, { seq: s.nextSeq, to, ev }));
  push({ type: 'gameStart', rules });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
  push({ type: 'draw', seat: 0, tile: d(draw)[0] }, [0]);
  return { s: { ...s, wall: [] } as GameState, d };
}

const run = (s: GameState, seat: Seat, a: Action) => act(s, seat, a).reduce(apply, s);
const tileOf = (s: GameState, seat: Seat, kind: number) => s.hands[seat].find((t) => kindOf(t) === kind)!;

// 4 人の手牌（同じ種類が 5 枚にならないように選んだ）。席 1 は 2m3m4m を持つ＝席 0 の 5m を 3m4m でチーできる
const H0 = '5m9m9m1p1p1s1s5z5z5z7z7z9s';
const H1 = '2m3m4m7p8p9p2s3s4s2z2z6z6z';
const H2 = '1p2p3p4m5m6m7m3p4p5p3z3z7z';
const H3 = '1s2s6s7s8s9s9p8p7p4z4z6z7z';

describe('香港のセットの値（原典どおり）', () => {
  it('字牌あり・花牌なし＝136 枚。チーあり・3 番起糊・上限 10 番・アガったら局を終える・食換は禁止', () => {
    expect(tileSetFor(HK)).toHaveLength(136);
    const v = HK.family === 'cn' ? HK.values : null;
    expect(v).toMatchObject({ honors: 'on', flower: 'off', chi: 'on', minFan: '3', cap: '10', afterWin: 'end', kuikae: 'ng', queyimen: 'off', dealer: 'renchan', miss: 'sameTile', multiWin: 'all' });
  });
  it('四川と国標は喰い替えを許す（条文なし＝MOMO が補った値）', () => {
    for (const set of ['sichuan', 'mcr'] as const) {
      const r = rulesOfCnSet(set);
      expect(r.family === 'cn' && r.values.kuikae).toBe('ok');
    }
  });
});

describe('香港の鳴き', () => {
  it('チーは上家の捨て牌だけ（下家の席 1 はできる・対面の席 2 と上家の席 3 はできない）', () => {
    const { s } = setup([H0, H1, H2, H3], '9s');
    const c = run(s, 0, { type: 'discard', tile: tileOf(s, 0, BASE.m + 4) }); // 5m
    expect(c.phase).toBe('claim');
    const pair = (seat: Seat): TileId[] => [tileOf(c, seat, BASE.m + 2) ?? tileOf(c, 1, BASE.m + 2), tileOf(c, seat, BASE.m + 3) ?? tileOf(c, 1, BASE.m + 3)];
    expect(callProblem(c, 1, 'chi', pair(1))).toBeNull();
    expect(callProblem({ ...c, hands: c.hands.map((h, i) => (i === 2 ? c.hands[1] : h)) }, 2, 'chi', pair(1))).toBe('チーは上家の捨て牌だけ');
  });

  it('食換は禁止：ポンした直後は同じ牌を切れない。チーした直後は現物と筋（つながって順子になる牌）を切れない', () => {
    // 席 0 が 5m を切る → 席 1 が 3m4m でチー（3m4m5m）→ 2m と 5m は切れない
    const { s } = setup([H0, H1, H2, H3], '9s');
    const c = run(s, 0, { type: 'discard', tile: tileOf(s, 0, BASE.m + 4) });
    const chi: Action = { type: 'chi', tiles: [tileOf(c, 1, BASE.m + 2), tileOf(c, 1, BASE.m + 3)] };
    expect(callProblem(c, 1, 'chi', (chi as { tiles: TileId[] }).tiles)).toBeNull();
    let t = run(c, 1, chi);
    for (const seat of [2, 3] as Seat[]) if (t.phase === 'claim' && t.claim?.replies[seat] === null) t = run(t, seat, { type: 'pass' });
    expect(t.phase).toBe('discard');
    const can = legalActions(t, 1).filter((a) => a.type === 'discard').map((a) => kindOf((a as { tile: TileId }).tile));
    expect(can).not.toContain(BASE.m + 1); // 2m（筋）
    expect(can).toContain(BASE.p + 6); // 7p は切れる
    expect(can.length).toBeGreaterThan(0);
    expect(() => run(t, 1, { type: 'discard', tile: tileOf(t, 1, BASE.m + 1) })).toThrow();
  });

  it('喰い替えを許すルールなら、チーした直後に筋の牌を切れる（香港の値から食換だけ変えたもの）', () => {
    const ok: Rules = HK.family === 'cn' ? { family: 'cn', values: { ...HK.values, kuikae: 'ok' } } : HK;
    const { s } = setup([H0, H1, H2, H3], '9s', ok);
    const c = run(s, 0, { type: 'discard', tile: tileOf(s, 0, BASE.m + 4) });
    let t = run(c, 1, { type: 'chi', tiles: [tileOf(c, 1, BASE.m + 2), tileOf(c, 1, BASE.m + 3)] });
    for (const seat of [2, 3] as Seat[]) if (t.phase === 'claim' && t.claim?.replies[seat] === null) t = run(t, seat, { type: 'pass' });
    const can = legalActions(t, 1).filter((a) => a.type === 'discard').map((a) => kindOf((a as { tile: TileId }).tile));
    expect(can).toContain(BASE.m + 1);
  });
});
