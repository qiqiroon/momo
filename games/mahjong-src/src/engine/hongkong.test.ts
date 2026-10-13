// 香港麻雀（段階9 香港の手順1：ツモって切る・鳴く・カン・流局）の検査。
// 原典：香港麻雀協會『十三張清張麻雀規則』2023-05-17（作業側 docs\原典）。
import type { Envelope, GameEvent, Seat } from './events';
import { act, legalActions, type Action } from './round';
import { rulesOfCnSet } from './ruleSets';
import type { Rules } from './rules';
import { apply, callProblem, initialState, paoFromCall, type Claim, type GameState, type OpenMeld } from './state';
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

// ---- 番（手順2）：原典の番種一覧表ごとに手を作って確かめる ----
import { HK_FAN_IDS, hkPoints, hongkongScore, type HkWinContext } from './hongkong';
import { dictFor } from '../i18n/strings';

/** 種類ごとの枚数（1m〜9m・1p・1s・1z〜7z） */
function counts(code: string): number[] {
  const c = new Array<number>(34).fill(0);
  for (const [, nums, suit] of code.matchAll(/(\d+)([mpsz])/g)) for (const d of nums) c[BASE[suit as 'm'] + Number(d) - 1]++;
  return c;
}
const k = (code: string) => counts(code).findIndex((n) => n > 0);
/** 手の中の 14 枚（または鳴きの分を引いた枚数）とアガリ方から、番を出す。席は南家（自風＝南）・場風＝東 */
function score(hand: string, win: string, o: Partial<HkWinContext> = {}, rules: Rules = HK) {
  const ctx: HkWinContext = { concealed: counts(hand), melds: [], winTile: k(win), tsumo: true, seatWind: 28, roundWind: 27, haidi: false, gangkai: false, kanChain: 0, qianggang: false, tianhu: false, dihu: false, ...o };
  return hongkongScore(ctx, rules);
}
const ids = (r: ReturnType<typeof score>) => (r ? Object.fromEntries(r.fans.map((f) => [f.id, f.fan])) : null);
const pon = (code: string) => ({ kind: k(code), type: 'pon' as const, concealed: false });
const chi = (code: string) => ({ kind: k(code), type: 'chi' as const, concealed: false });
const kan = (code: string, concealed = false) => ({ kind: k(code), type: 'kan' as const, concealed });

describe('香港の番（1 番）', () => {
  it('平糊・門前清・自摸（順子 4 組の門前ツモ）＝3 番 32 点', () => {
    const r = score('123m456m789p234s55s', '5s');
    expect(ids(r)).toEqual({ pinghu: 1, menqing: 1, zimo: 1 });
    expect(r!.fan).toBe(3);
    expect(r!.points).toBe(32);
  });
  it('三元牌は刻子 1 組ごと・風牌は自風（南）と場風（東）。両方の刻子なら 2', () => {
    expect(ids(score('555z666z123m456p11s', '1s', { tsumo: false }))).toMatchObject({ dragon: 2, menqing: 1 });
    expect(ids(score('111z222z123m456p11s', '1s', { tsumo: false }))).toMatchObject({ wind: 2 });
    // 場風と自風が同じ（東場の東家）なら 1 組で 2
    expect(ids(score('111z123m456p789s11s', '1s', { tsumo: false, seatWind: 27 }))).toMatchObject({ wind: 2 });
  });
  it('平糊はチーした順子も数える（門前清は付かない）', () => {
    const r = score('456m789p234s55s', '5s', { tsumo: false, melds: [chi('1m')] });
    expect(ids(r)).toEqual({ pinghu: 1 });
    expect(r!.points).toBe(0);
  });
  it('門前清は鳴いた面子が無いときだけ（暗槓も明章に数える）', () => {
    expect(ids(score('123m456p789s11s', '1s', { melds: [kan('9m', true)] }))).not.toHaveProperty('menqing');
  });
  it('花么：么九牌と字牌だけ＝對對糊も付く', () => {
    // 門前の単騎ロンだと暗刻 4 つ＝坎坎糊になるので、1 組ポンした手で見る
    expect(ids(score('999p111s555z77z', '7z', { tsumo: false, melds: [pon('1m')] }))).toMatchObject({ huayao: 1, duidui: 3 });
  });
  it('搶槓・槓上自摸・海底撈月', () => {
    expect(ids(score('123m456m789p234s55s', '5s', { tsumo: false, qianggang: true }))).toMatchObject({ qianggangHk: 1 });
    expect(ids(score('123m456m789p234s55s', '5s', { gangkai: true, kanChain: 1 }))).toMatchObject({ gangkaiHk: 1 });
    expect(ids(score('123m456m789p234s55s', '5s', { haidi: true }))).toMatchObject({ haidiHk: 1 });
  });
});

describe('香港の番（3・5・7 番）', () => {
  it('混一色 3・對對糊 3・清一色 7', () => {
    expect(ids(score('123m456m789m111z22z', '2z', { tsumo: false }))).toMatchObject({ hunyise: 3 });
    expect(ids(score('111m555p999s222s33m', '2s', { tsumo: false }))).toMatchObject({ duidui: 3 }); // シャンポンのロン（単騎だと坎坎糊）
    expect(ids(score('123m456m789m234m55m', '5m', { tsumo: false }))).toMatchObject({ qingyiseHk: 7 });
  });
  it('小三元は 3 番＋三元牌 2 組＝5 番。大三元は 5 番＋三元牌 3 組＝8 番', () => {
    const small = score('555z666z77z123m456m', '6m', { tsumo: false });
    expect(ids(small)).toMatchObject({ xiaosanyuan: 3, dragon: 2 });
    const big = score('555z666z777z123m44m', '4m', { tsumo: false });
    expect(ids(big)).toMatchObject({ dasanyuan: 5, dragon: 3 });
  });
  it('読み方が 2 つあれば番の高いほう（111222333m は 3 暗刻にも 3 順子にも読める）', () => {
    // 順子に読むと平糊、刻子に読むと對對糊（3 番）＝高いほう
    // （門前の単騎だと坎坎糊になるので 5p をポンした手）
    const r = score('111m222m333m77p', '7p', { tsumo: false, melds: [pon('5p')] });
    expect(ids(r)).toMatchObject({ duidui: 3 });
    expect(ids(r)).not.toHaveProperty('pinghu');
  });
});

describe('香港の例牌（10 番）', () => {
  const limit = (r: ReturnType<typeof score>, id: string) => {
    expect(r?.fans.map((f) => f.id)).toContain(id);
    expect(r?.fan).toBe(10);
    expect(r?.points).toBe(512);
  };
  it('全番子・小四喜・大四喜・清么九・十八羅漢・十三么九', () => {
    limit(score('111z222z555z666z77z', '7z', { tsumo: false }), 'ziyise');
    limit(score('111z222z333z44z123m', '3m', { tsumo: false }), 'xiaosixi');
    limit(score('111z222z333z444z11m', '1m', { tsumo: false }), 'dasixi');
    limit(score('111m999m111p999p11s', '1s', { tsumo: false }), 'qingyaojiu');
    limit(score('11s', '1s', { melds: [kan('1m'), kan('2m'), kan('3p'), kan('4s')] }), 'shibaluohan');
    limit(score('19m19p19s12345677z', '7z', { tsumo: false }), 'shisanyao');
  });
  it('坎坎糊：暗刻 4 つ。ツモはどれでも・ロンは単騎だけ（シャンポンのロンは對對糊）', () => {
    limit(score('111m333m555p777s99s', '9s', { tsumo: true }), 'kankan');
    limit(score('111m333m555p777s99s', '9s', { tsumo: false }), 'kankan');
    const shanpon = score('111m333m555p777s99s', '7s', { tsumo: false });
    expect(shanpon?.fans.map((f) => f.id)).not.toContain('kankan');
    expect(ids(shanpon)).toMatchObject({ duidui: 3 });
    // カンが入れば坎坎糊にならない
    expect(score('111m333m555p99s', '9s', { melds: [kan('7s', true)] })?.fans.map((f) => f.id)).not.toContain('kankan');
  });
  it('九子連環：ツモはどの形でも。ロンは 9 面待ち（13 枚が 1112345678999）のときだけ', () => {
    limit(score('11123455678999m', '5m'), 'jiulian');
    limit(score('11123455678999m', '5m', { tsumo: false }), 'jiulian');
    // 13 枚が 1122345678999（9 面待ちでない）で 1m をロン → 九子連環にならない（清一色）。同じ形のツモは九子連環
    const notNine = score('11122345678999m', '1m', { tsumo: false });
    expect(notNine?.fans.map((f) => f.id)).not.toContain('jiulian');
    expect(ids(notNine)).toMatchObject({ qingyiseHk: 7 });
    limit(score('11122345678999m', '1m'), 'jiulian');
  });
  it('天糊・地糊・槓上槓自摸（ルールの天和・地和が「あり」のとき）', () => {
    limit(score('123m456m789p234s55s', '5s', { tianhu: true }), 'tianhu');
    limit(score('123m456m789p234s55s', '5s', { tsumo: false, dihu: true }), 'dihu');
    limit(score('123m456m789p234s55s', '5s', { gangkai: true, kanChain: 2 }), 'ganggang');
    const off: Rules = HK.family === 'cn' ? { family: 'cn', values: { ...HK.values, tenhou: 'off' } } : HK;
    expect(score('123m456m789p234s55s', '5s', { tianhu: true }, off)?.fans.map((f) => f.id)).not.toContain('tianhu');
  });
});

describe('香港の点（分數換算表）', () => {
  it('3 番 32・4 番 64・5 番 96・6 番 128・7 番 192・8 番 256・9 番 384・10 番 512。上限 10 番', () => {
    expect([3, 4, 5, 6, 7, 8, 9, 10].map((f) => hkPoints(f, HK).points)).toEqual([32, 64, 96, 128, 192, 256, 384, 512]);
    expect(hkPoints(13, HK)).toEqual({ points: 512, capped: true });
    expect(hkPoints(2, HK).points).toBe(0);
  });
  it('清一色＋對對糊＋門前清＋自摸＝12 番は 10 番で切る', () => {
    const r = score('111m333m555m777m99m', '9m');
    // 暗刻 4 つのツモは坎坎糊（例牌）になる＝10 番
    expect(r?.fan).toBe(10);
    const open = score('333m555m777m99m', '9m', { melds: [pon('1m')] });
    expect(open?.fan).toBe(7 + 3 + 1);
    expect(open?.capped).toBe(true);
    expect(open?.points).toBe(512);
  });
});

describe('香港の番の名前', () => {
  it('どの番も日英中の名前がある（無いと結果の枠で止まる）', () => {
    for (const lang of ['ja', 'en', 'zh'] as const) {
      const d = dictFor(lang) as Record<string, string>;
      for (const id of HK_FAN_IDS) expect(d[`cnFan_${id}`], `${lang} cnFan_${id}`).toBeTruthy();
    }
  });
});

describe('香港のアガリ（局面から）', () => {
  // 席 0（親）の配牌 13 枚＋ツモ。席 1〜3 は牌がぶつからない手
  const O1 = '1s2s6s7s8s9s9p8p7p4z4z6z7z';
  const O2 = '1p2p3p4m5m6m7m3p4p5p3z3z7z';
  const O3 = '2m3m4m7p8p9p2s3s4s2z2z6z6z';
  it('天糊：親が配牌のままツモ＝例牌 10 番', () => {
    // 123m456m789m・555s・1p 単騎に 1p を引く
    const { s } = setup(['123m456m789m1p555s', O3, O2, O1], '1p');
    const tsumo = legalActions(s, 0).find((a) => a.type === 'tsumo');
    expect(tsumo).toBeTruthy();
    const after = run(s, 0, tsumo!);
    expect(after.result?.type).toBe('cnWin');
    if (after.result?.type === 'cnWin') expect(after.result.wins[0].score.fans.map((f) => f.id)).toContain('tianhu');
  });

  it('3 番に届かないとツモれない（門前清＋自摸の 2 番）。三元牌の刻子が 1 つあれば 3 番でツモれる', () => {
    // 1 巡回ったことにする（天糊にしない）
    const later = (hand: string, draw: string) => {
      const { s } = setup([hand, O3, O2, O1], draw);
      return { ...s, discards: s.discards.map(() => [999]) } as GameState;
    };
    expect(legalActions(later('111m456m789m1p1p5s5s', '5s'), 0).some((a) => a.type === 'tsumo')).toBe(false);
    expect(legalActions(later('555z456m789m1p1p5s5s', '5s'), 0).some((a) => a.type === 'tsumo')).toBe(true);
  });
});

describe('香港の払い（手順3・得分授受法）', () => {
  const later = (s: GameState) => ({ ...s, discards: s.discards.map(() => [999]) }) as GameState;
  it('ツモ：3 人が出銃の点の半分ずつ（3 番＝32 点→16 点ずつ）', () => {
    const { s } = setup(['555z456m789m1p1p5s5s', '2m3m4m7p8p9p2s3s4s2z2z6z6z', '1p2p3p4m5m6m7m3p4p5p3z3z7z', '1s2s6s7s8s9s9p8p7p4z4z6z7z'], '5s');
    const t = later(s);
    const after = run(t, 0, legalActions(t, 0).find((a) => a.type === 'tsumo')!);
    expect(after.result?.type === 'cnWin' && after.result.wins[0].pays).toEqual([48, -16, -16, -16]);
  });
  it('ロン：放銃者が全額（全銃）', () => {
    // 席 1：555z 234m 789p と 6z6z・2s2s のシャンポン。親が 6z を切る → 三元牌 2 組＋門前清＝3 番 32 点
    const { s } = setup(['111m4p5p6p7s8s9s3z3z6z9m', '555z2m3m4m7p8p9p6z6z2s2s', '1p2p3p4m5m6m7m3p4p5p3z7z7z', '1s1s6s7s8s9s9p8p7p4z4z4z1z'], '9m');
    let t = run(later(s), 0, { type: 'discard', tile: tileOf(s, 0, BASE.z + 5) });
    expect(legalActions(t, 1).some((a) => a.type === 'ron')).toBe(true);
    t = run(t, 1, { type: 'ron' });
    for (const seat of [2, 3] as Seat[]) if (t.phase === 'claim' && t.claim?.replies[seat] === null) t = run(t, seat, { type: 'pass' });
    expect(t.result?.type === 'cnWin' && t.result.wins[0].pays).toEqual([-32, 32, 0, 0]);
  });
  it('搶槓：カンした人がツモと同じ額（3 人分）を 1 人で払う（搶槓當自摸）', () => {
    // 席 0：6p をポン済みで 4 枚目を引いた。席 1：555z 666z 234m 78p 22s（6p・9p 待ち）→ 6p の加槓を搶槓
    // 番＝三元牌 2＋門前清 1＋搶槓 1＝4 番 64 点 → ツモの 3 人分（32×3＝96）をカンした人が払う
    const { s } = setup(['6p6p6p1m1m1m9m9m3z3z4s5s6s', '555z666z2m3m4m7p8p2s2s', '1p2p3p4m5m6m7m3p4p5p3z7z7z', '1s1s6s7s8s9s9p8p7p4z4z4z1z'], '6p');
    const six = s.hands[0].filter((t) => kindOf(t) === BASE.p + 5);
    const ponTiles = six.filter((t) => t !== s.drawn[0]);
    const start: GameState = {
      ...later(s),
      hands: s.hands.map((h, i) => (i === 0 ? h.filter((t) => !ponTiles.includes(t)) : h)),
      melds: [[{ type: 'pon', tiles: ponTiles, called: ponTiles[0], from: 1 }], [], [], []],
    };
    let t = run(start, 0, { type: 'kan', kan: 'kakan', tiles: [s.drawn[0]!] });
    expect(t.phase).toBe('claim');
    expect(legalActions(t, 1).some((a) => a.type === 'ron')).toBe(true);
    t = run(t, 1, { type: 'ron' });
    for (const seat of [2, 3] as Seat[]) if (t.phase === 'claim' && t.claim?.replies[seat] === null) t = run(t, seat, { type: 'pass' });
    expect(t.result?.type).toBe('cnWin');
    if (t.result?.type === 'cnWin') {
      expect(t.result.wins[0].score.fans.map((f) => f.id)).toContain('qianggangHk');
      expect(t.result.wins[0].score.points).toBe(64);
      expect(t.result.wins[0].pays).toEqual([-96, 96, 0, 0]);
    }
  });
});

describe('香港の包牌（手順4・得分授受法 2・3）', () => {
  const st = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: HK } });
  const m = (type: OpenMeld['type'], code: string): OpenMeld => {
    const kind = k(code);
    const tiles = type === 'chi' ? [0, 1, 2].map((i) => (kind + i) * 4) : [kind * 4, kind * 4 + 1, kind * 4 + 2];
    return { type, tiles, called: tiles[0], from: 0 };
  };
  it('十二章包：4 組目の面子を鳴かせた人。3 組目までは包なし', () => {
    expect(paoFromCall(st, [m('pon', '1m'), m('chi', '2p'), m('pon', '9s')], 3)).toBeNull();
    expect(paoFromCall(st, [m('pon', '1m'), m('chi', '2p'), m('pon', '9s'), m('chi', '4s')], 3)).toEqual({ seat: 3, yaku: 'twelve' });
  });
  it('大三元包：3 組目の三元牌を鳴かせた人（2 組目までは包なし）', () => {
    expect(paoFromCall(st, [m('pon', '5z'), m('pon', '6z')], 2)).toBeNull();
    expect(paoFromCall(st, [m('pon', '5z'), m('pon', '6z'), m('pon', '7z')], 2)).toEqual({ seat: 2, yaku: 'dragons' });
  });
  it('包後不包先：大三元包のあとに十二章包が成立したら、後の十二章包だけ（鳴いた局面で）', () => {
    const { s } = setup([H0, H1, H2, H3], '9s');
    const mine = s.hands[1].filter((t) => kindOf(t) === BASE.z + 1); // 2z を 2 枚
    const other = s.hands[1].filter((t) => kindOf(t) === BASE.m + 2 || kindOf(t) === BASE.m + 3);
    const t0: GameState = {
      ...s,
      discards: s.discards.map(() => [999]),
      hands: s.hands.map((h, i) => (i === 1 ? [...mine, ...other] : h)),
      melds: [[], [m('pon', '5z'), m('pon', '6z'), m('pon', '7z')], [], []],
      pao: [null, { seat: 3, yaku: 'dragons' }, null, null],
      phase: 'claim',
      turn: 0,
      drawn: [null, null, null, null],
      claim: { kind: 'discard', from: 0, tile: BASE.z * 4 + 4 + 1, replies: ['self', null, 'pass', 'pass'], rons: [], calls: [] },
    };
    const t = run(t0, 1, { type: 'pon', tiles: mine });
    expect(t.melds[1]).toHaveLength(4);
    expect(t.pao[1]).toEqual({ seat: 0, yaku: 'twelve' });
  });
  it('包牌の無いルール（四川）では包なし', () => {
    const sc = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: rulesOfCnSet('sichuan') } });
    expect(paoFromCall(sc, [m('pon', '1m'), m('pon', '2p'), m('pon', '9s'), m('pon', '4s')], 3)).toBeNull();
  });
  it('包牌が成立した人のツモは、包の人が 3 人分を 1 人で払う。ロンは放銃者が払う（包は関わらない）', () => {
    const { s } = setup(['555z456m789m1p1p5s5s', '2m3m4m7p8p9p2s3s4s2z2z6z6z', '1p2p3p4m5m6m7m3p4p5p3z3z7z', '1s2s6s7s8s9s9p8p7p4z4z6z7z'], '5s');
    const t: GameState = { ...s, discards: s.discards.map(() => [999]), pao: [{ seat: 2, yaku: 'twelve' }, null, null, null] };
    const after = run(t, 0, legalActions(t, 0).find((a) => a.type === 'tsumo')!);
    expect(after.result?.type === 'cnWin' && after.result.wins[0].pays).toEqual([48, 0, -48, 0]);
  });
});

describe('香港の細かい決まり（手順5）', () => {
  const later = (s: GameState) => ({ ...s, discards: s.discards.map(() => [999]) }) as GameState;
  const claimOf = (s: GameState, from: Seat, tile: TileId): GameState => ({
    ...s,
    phase: 'claim',
    turn: from,
    drawn: [null, null, null, null],
    claim: { kind: 'discard', from, tile, replies: [0, 1, 2, 3].map((x) => (x === from ? 'self' : null)) as Claim['replies'], rons: [], calls: [] },
  });
  it('同巡の跟張：ロンできた牌を見送ったら、自分が引くまで同じ種類ではロンできない（ほかの待ちはロンできる）', () => {
    // 席 1：555z 234m 789p と 6z6z・7z7z のシャンポン（6z・7z 待ち。どちらでロンしても三元牌 2 組＋門前清＝3 番）
    const { s } = setup(['111m4p5p6p7s8s9s3z3z9m9m1p', '555z2m3m4m7p8p9p6z6z7z7z', '1p2p3p4m5m6m7m3p4p5p3z4z9s', '1s1s6s7s8s9s9p8p7p4z4z4z1z'], '5m');
    const base = later(s);
    const z6a = BASE.z * 4 + 5 * 4 + 1;
    const z6b = BASE.z * 4 + 5 * 4 + 0;
    const z7 = BASE.z * 4 + 6 * 4 + 1;
    const c1 = claimOf(base, 3, z6a);
    expect(legalActions(c1, 1).some((a) => a.type === 'ron')).toBe(true);
    const passed = run(c1, 1, { type: 'pass' });
    expect(passed.cnMissedKinds[1]).toEqual([BASE.z + 5]);
    // 同じ巡で親が 6z を切った：ロンできない／7z ならロンできる
    expect(legalActions(claimOf(passed, 0, z6b), 1).some((a) => a.type === 'ron')).toBe(false);
    expect(legalActions(claimOf(passed, 0, z7), 1).some((a) => a.type === 'ron')).toBe(true);
    // 自分が引けば解ける
    const drew = apply({ ...passed, phase: 'draw', turn: 1, claim: null, wall: null }, { seq: passed.nextSeq, to: [1], ev: { type: 'draw', seat: 1, tile: BASE.m * 4 + 8 * 4 } });
    expect(drew.cnMissedKinds[1]).toEqual([]);
  });

  it('十三么九だけは暗槓の牌でロンできる（搶槓。カンした人がツモの 3 人分＝256×3＝768 点を払う）', () => {
    const { s } = setup(['1m1m1m1m2m3m4m5m6m7m8m2p3p', '9m1p9p1s9s1z2z3z4z5z6z7z7z', '2s3s4s5s6s7s8s2p3p4p5p6p7p', '5m6m7m8m5p6p7p8p5s6s7s8s9m'], '4p');
    const ones = s.hands[0].filter((t) => kindOf(t) === BASE.m);
    let t = run(later(s), 0, { type: 'kan', kan: 'ankan', tiles: ones });
    expect(t.phase).toBe('claim');
    expect(t.claim?.kind).toBe('ankan');
    // 十三么九の席 1 はロンできる。ほかの形の席はできない
    expect(legalActions(t, 1).some((a) => a.type === 'ron')).toBe(true);
    expect(legalActions(t, 2).some((a) => a.type === 'ron')).toBe(false);
    t = run(t, 1, { type: 'ron' });
    for (const seat of [2, 3] as Seat[]) if (t.phase === 'claim' && t.claim?.replies[seat] === null) t = run(t, seat, { type: 'pass' });
    expect(t.result?.type).toBe('cnWin');
    if (t.result?.type === 'cnWin') {
      expect(t.result.wins[0].score.fans.map((f) => f.id)).toContain('shisanyao');
      expect(t.result.wins[0].rob).toBe(true);
      expect(t.result.wins[0].pays).toEqual([-768, 768, 0, 0]);
    }
  });

  it('暗槓のロンを待つのは、ルールの「十三么の暗槓ロン」が「あり」のときだけ（四川は待たない）', () => {
    const off: Rules = HK.family === 'cn' ? { family: 'cn', values: { ...HK.values, kokushi13: 'off' } } : HK;
    const { s } = setup(['1m1m1m1m2m3m4m5m6m7m8m2p3p', '9m1p9p1s9s1z2z3z4z5z6z7z7z', '2s3s4s5s6s7s8s2p3p4p5p6p7p', '5m6m7m8m5p6p7p8p5s6s7s8s9m'], '4p', off);
    const ones = s.hands[0].filter((t) => kindOf(t) === BASE.m);
    const t = run(later(s), 0, { type: 'kan', kan: 'ankan', tiles: ones });
    expect(t.phase).toBe('draw');
  });
});

describe('香港の鳴牌禁例（跟張で包牌が生じる鳴き）', () => {
  const claimAt = (s: GameState, from: Seat, tile: TileId): GameState => ({
    ...s,
    phase: 'claim',
    turn: from,
    drawn: [null, null, null, null],
    claim: { kind: 'discard', from, tile, replies: [0, 1, 2, 3].map((x) => (x === from ? 'self' : null)) as Claim['replies'], rons: [], calls: [] },
  });
  const pons = (st: GameState, seat: Seat) => legalActions(st, seat).filter((a) => a.type === 'pon');
  // 席 1：白・發をポン済み、手に 中中・9m9m・1s2s3s。席 3 と親が 中・9m を切る
  function base(): GameState {
    const { s } = setup([H0, H1, H2, H3], '9s');
    const dragonPon = (kind: number): OpenMeld => ({ type: 'pon', tiles: [kind * 4, kind * 4 + 1, kind * 4 + 2], called: kind * 4, from: 0 });
    return {
      ...s,
      discards: s.discards.map(() => [999]),
      hands: s.hands.map((h, i) => (i === 1 ? [135, 134, 35, 34, 72, 76, 80] : h)),
      melds: [[], [dragonPon(31), dragonPon(32)], [], []],
    };
  }
  it('3 組目の三元牌（大三元包になる）を一度見送ったら、自分が引く前に出た同じ牌はポンできない', () => {
    const first = claimAt(base(), 3, 133);
    expect(pons(first, 1)).toHaveLength(1);
    const passed = run(first, 1, { type: 'pass' });
    expect(passed.cnFollowKinds[1]).toContain(33);
    expect(pons(claimAt(passed, 0, 132), 1)).toHaveLength(0);
  });
  it('見送っていなければポンできる（包牌は成立する）。包が生じない跟張（9m）は見送ったあとでもポンできる', () => {
    expect(pons(claimAt(base(), 0, 132), 1)).toHaveLength(1);
    const passed = run(claimAt(base(), 3, 33), 1, { type: 'pass' });
    expect(passed.cnFollowKinds[1]).toContain(8);
    expect(pons(claimAt(passed, 0, 32), 1)).toHaveLength(1);
  });
  it('自分が引けば跟張は消える', () => {
    const passed = run(claimAt(base(), 3, 133), 1, { type: 'pass' });
    const drew = apply({ ...passed, phase: 'draw', turn: 1, claim: null, wall: null }, { seq: passed.nextSeq, to: [1], ev: { type: 'draw', seat: 1, tile: 9 * 4 } });
    expect(drew.cnFollowKinds[1]).toEqual([]);
  });
});
