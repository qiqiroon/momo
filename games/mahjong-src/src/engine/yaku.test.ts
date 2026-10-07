import { isWinningHand } from './agari';
import { createRng } from './rng';
import { GENERAL_RULES, type Rules } from './rules';
import { bestYaku, judgeAll, type Meld, type WinContext, type YakuId } from './yaku';

/** "123m456p789s11z" のような書き方を枚数にする */
function hand(s: string): number[] {
  const c = new Array<number>(34).fill(0);
  for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[suit as 'm']!;
    for (const d of nums) c[base + Number(d) - 1]++;
  }
  return c;
}

/** "5m" → 種類の番号 */
const k = (s: string) => ({ m: 0, p: 9, s: 18, z: 27 }[s[1] as 'm']! + Number(s[0]) - 1);

const withRule = (patch: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...patch } } : GENERAL_RULES;

function ctx(h: string, win: string, more: Partial<WinContext> = {}): WinContext {
  return {
    concealed: hand(h),
    melds: [],
    winTile: k(win),
    tsumo: false,
    seatWind: 28, // 南家
    roundWind: 27, // 東場
    rules: GENERAL_RULES,
    ...more,
  };
}

/** 選ばれた候補の役の名前（並びは問わない）と翻・役満 */
function best(c: WinContext): { ids: YakuId[]; han: number; yakuman: number } {
  const r = bestYaku(c);
  if (!r) throw new Error('アガリの形でない');
  return { ids: r.yaku.map((y) => y.id).sort(), han: r.han, yakuman: r.yakuman };
}
const ids = (...xs: YakuId[]) => xs.slice().sort();

describe('ふつうの役', () => {
  it('平和：両面待ちだけ。ツモなら門前清自摸和も付く', () => {
    expect(best(ctx('123m456p789s234s55p', '4s'))).toEqual({ ids: ids('pinfu'), han: 1, yakuman: 0 });
    expect(best(ctx('123m456p789s234s55p', '4s', { tsumo: true }))).toEqual({ ids: ids('pinfu', 'menzenTsumo'), han: 2, yakuman: 0 });
    // 12m の辺張で 3m → 平和にならない＝役なし
    expect(best(ctx('123m456p789s234s55p', '3m'))).toEqual({ ids: [], han: 0, yakuman: 0 });
    // 雀頭が役牌（自風の南）なら平和にならない
    expect(best(ctx('123m456p789s234s22z', '4s')).ids).toEqual([]);
  });

  it('喰いタン：「あり」なら鳴いても断么九・「なし」なら役なし', () => {
    const melds: Meld[] = [{ type: 'chi', first: k('2m'), open: true }];
    expect(best(ctx('567p678s345s22p', '2p', { melds }))).toEqual({ ids: ids('tanyao'), han: 1, yakuman: 0 });
    expect(best(ctx('567p678s345s22p', '2p', { melds, rules: withRule({ kuitan: 'off' }) })).ids).toEqual([]);
  });

  it('七対子と二盃口の両方に読める手は、高いほう（二盃口）を選ぶ', () => {
    expect(best(ctx('223344m556677p55s', '5s'))).toEqual({ ids: ids('tanyao', 'ryanpeikou'), han: 4, yakuman: 0 });
    // 候補には七対子の読み方も入っている
    expect(judgeAll(ctx('223344m556677p55s', '5s')).some((r) => r.reading.form === 'chiitoitsu')).toBe(true);
  });

  it('七対子＋混老頭＋ツモ', () => {
    expect(best(ctx('1199m1199p1199s11z', '1z', { tsumo: true }))).toEqual({
      ids: ids('chiitoitsu', 'honroutou', 'menzenTsumo'), han: 5, yakuman: 0,
    });
  });

  it('三暗刻：ロンで仕上がった刻子は数えない・ツモなら数える', () => {
    expect(best(ctx('111m222p333s456s77z', '3s')).ids).toEqual([]);
    expect(best(ctx('111m222p333s456s77z', '3s', { tsumo: true }))).toEqual({ ids: ids('sanankou', 'menzenTsumo'), han: 3, yakuman: 0 });
  });

  it('一気通貫＋混一色＋場風・自風（東場の東家）', () => {
    expect(best(ctx('123456789m111z22z', '9m', { seatWind: 27 }))).toEqual({
      ids: ids('ittsu', 'honitsu', 'roundWind', 'seatWind'), han: 7, yakuman: 0,
    });
  });

  it('清一色（断么九は付かない手）', () => {
    expect(best(ctx('123345567888m99m', '8m'))).toEqual({ ids: ids('chinitsu'), han: 6, yakuman: 0 });
  });

  it('純全帯么九＋三色同順', () => {
    expect(best(ctx('123m123p123s789p99m', '9m'))).toEqual({ ids: ids('junchan', 'sanshoku'), han: 5, yakuman: 0 });
  });

  it('混全帯么九＋場風（順子があるので混老頭ではない）', () => {
    expect(best(ctx('123m789p111z999s22z', '2z'))).toEqual({ ids: ids('chanta', 'roundWind'), han: 3, yakuman: 0 });
  });

  it('混老頭＋対々和（刻子だけ＝順子が無いので混全帯么九は付かない）', () => {
    expect(best(ctx('111m999p111z999s22z', '9s'))).toEqual({
      ids: ids('honroutou', 'toitoi', 'sanankou', 'roundWind'), han: 7, yakuman: 0,
    });
  });

  it('小三元＋白＋發＋混一色', () => {
    expect(best(ctx('555z666z77z123m456m', '7z'))).toEqual({
      ids: ids('shousangen', 'haku', 'hatsu', 'honitsu'), han: 7, yakuman: 0,
    });
  });

  it('鳴いた手：一気通貫・混一色は1翻下がる', () => {
    const melds: Meld[] = [{ type: 'pon', first: k('5z'), open: true }];
    expect(best(ctx('123456789m22z', '9m', { melds }))).toEqual({ ids: ids('ittsu', 'honitsu', 'haku'), han: 4, yakuman: 0 });
  });

  it('状況の役：リーチ・一発・海底・嶺上・ダブルリーチ', () => {
    const h = '123m456p789s234s55p';
    expect(best(ctx(h, '4s', { riichi: 'riichi', ippatsu: true })).ids).toEqual(ids('riichi', 'ippatsu', 'pinfu'));
    expect(best(ctx(h, '4s', { riichi: 'double', tsumo: true, haitei: true })).ids).toEqual(ids('doubleRiichi', 'menzenTsumo', 'haitei', 'pinfu'));
    expect(best(ctx(h, '4s', { riichi: 'riichi', ippatsu: true, rules: withRule({ ippatsu: 'off' }) })).ids).toEqual(ids('riichi', 'pinfu'));
    // 嶺上でアガったら海底は付かない
    expect(best(ctx(h, '4s', { tsumo: true, rinshan: true, haitei: true })).ids).toEqual(ids('menzenTsumo', 'rinshan', 'pinfu'));
    // 河底はロンだけ
    expect(best(ctx(h, '4s', { houtei: true })).ids).toEqual(ids('houtei', 'pinfu'));
  });
});

describe('役満', () => {
  it('四暗刻：ツモなら役満・ロン（シャンポン）なら三暗刻＋対々和', () => {
    expect(best(ctx('111m222p333s444s55z', '4s', { tsumo: true }))).toEqual({ ids: ids('suuankou'), han: 0, yakuman: 1 });
    expect(best(ctx('111m222p333s444s55z', '4s'))).toEqual({ ids: ids('sanankou', 'toitoi'), han: 4, yakuman: 0 });
  });

  it('ダブル役満が「なし」なら単騎・十三面・純正も1倍、「あり」なら2倍', () => {
    const on = withRule({ doubleYakuman: 'on' });
    expect(best(ctx('111m222p333s444s55z', '5z')).yakuman).toBe(1);
    expect(best(ctx('111m222p333s444s55z', '5z', { rules: on })).yakuman).toBe(2);
    expect(best(ctx('19m19p19s1234567z1m', '1m')).yakuman).toBe(1);
    expect(best(ctx('19m19p19s1234567z1m', '1m', { rules: on })).yakuman).toBe(2);
    // 十三面でない国士（1m を 2 枚持っていて 7z 単騎）
    expect(best(ctx('19m19p19s1234567z1m', '7z', { rules: on })).yakuman).toBe(1);
    expect(best(ctx('11123455678999m', '5m', { rules: on }))).toEqual({ ids: ids('chuuren'), han: 0, yakuman: 2 }); // 純正（9面待ち）
    expect(best(ctx('11123456789999m', '1m', { rules: on }))).toEqual({ ids: ids('chuuren'), han: 0, yakuman: 1 });
  });

  it('役満どうしの複合：「あり」なら足す・「なし」なら1つだけ', () => {
    // 2z 単騎のロン＝四暗刻も付く
    expect(best(ctx('555666777z111z22z', '2z'))).toEqual({ ids: ids('daisangen', 'tsuuiisou', 'suuankou'), han: 0, yakuman: 3 });
    // 1z のロン（シャンポン）なら四暗刻は付かない
    expect(best(ctx('555666777z111z22z', '1z'))).toEqual({ ids: ids('daisangen', 'tsuuiisou'), han: 0, yakuman: 2 });
    expect(best(ctx('555666777z111z22z', '2z', { rules: withRule({ yakumanMix: 'off' }) })).yakuman).toBe(1);
  });

  it('緑一色・清老頭・小四喜・大四喜', () => {
    expect(best(ctx('223344s666s888s66z', '6z')).ids).toEqual(ids('ryuuiisou'));
    expect(best(ctx('111999m111999p11s', '9p')).ids).toEqual(ids('chinroutou'));
    expect(best(ctx('111222333z44z123m', '3m')).ids).toEqual(ids('shousuushii'));
    expect(best(ctx('111222333444z55m', '4z')).ids).toEqual(ids('daisuushii')); // シャンポンのロン＝四暗刻は付かない
  });

  it('天和・地和は状況で付き、ほかの役は数えない', () => {
    expect(best(ctx('123m456p789s234s55p', '4s', { tsumo: true, tenhou: true })).ids).toEqual(ids('tenhou'));
    expect(best(ctx('123m456p789s234s55p', '4s', { tsumo: true, chiihou: true })).ids).toEqual(ids('chiihou'));
  });
});

describe('全体の決まり', () => {
  /** アガリ形を作り、ときどき 1 枚入れ替える（アガリでなくなるものも混ぜる） */
  function randomHands(n: number, seed: string): { c: number[]; win: number }[] {
    const rng = createRng(seed);
    const pick = (m: number) => Math.floor(rng() * m);
    const out: { c: number[]; win: number }[] = [];
    while (out.length < n) {
      const c = new Array<number>(34).fill(0);
      const add = (x: number, m: number) => (c[x] + m <= 4 ? ((c[x] += m), true) : false);
      while (!add(pick(34), 2));
      for (let m = 0; m < 4; ) {
        if (pick(3) === 0) { if (add(pick(34), 3)) m++; continue; }
        const x = pick(3) * 9 + pick(7);
        if (c[x] < 4 && c[x + 1] < 4 && c[x + 2] < 4) { c[x]++; c[x + 1]++; c[x + 2]++; m++; }
      }
      if (out.length % 3 === 2) {
        const has = c.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
        const from = has[pick(has.length)];
        const to = pick(34);
        if (c[to] < 4) { c[from]--; c[to]++; }
      }
      const has = c.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      out.push({ c, win: has[pick(has.length)] });
    }
    return out;
  }

  it('候補があるのは、アガリの形のときだけ（3000 手）', () => {
    let wins = 0;
    let losses = 0;
    for (const { c, win } of randomHands(3000, 'yaku-shape')) {
      const tiles = c.flatMap((m, kind) => Array.from({ length: m }, (_, i) => kind * 4 + i));
      const w = isWinningHand(tiles);
      expect(judgeAll({ concealed: c, melds: [], winTile: win, tsumo: true, seatWind: 28, roundWind: 27, rules: GENERAL_RULES }).length > 0).toBe(w);
      if (w) wins++; else losses++;
    }
    expect(wins).toBeGreaterThan(1500); // 走った件数を見る
    expect(losses).toBeGreaterThan(300);
  });

  it('門前でツモったアガリには、必ず役が1つ以上ある（3000 手）', () => {
    let n = 0;
    for (const { c, win } of randomHands(3000, 'yaku-tsumo')) {
      const r = bestYaku({ concealed: c, melds: [], winTile: win, tsumo: true, seatWind: 28, roundWind: 27, rules: GENERAL_RULES });
      if (!r) continue;
      expect(r.han + r.yakuman).toBeGreaterThan(0);
      if (r.yakuman === 0) expect(r.yaku.some((y) => y.id === 'menzenTsumo')).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(1500);
  });

  it('同時に付かない組：二盃口と一盃口・清一色と混一色・純全と混全・ダブルリーチとリーチ・役満とふつうの役', () => {
    const excl: [YakuId, YakuId][] = [
      ['ryanpeikou', 'iipeikou'], ['chinitsu', 'honitsu'], ['junchan', 'chanta'], ['doubleRiichi', 'riichi'],
      ['honroutou', 'chanta'], ['honroutou', 'junchan'], ['chiitoitsu', 'pinfu'],
    ];
    let n = 0;
    for (const { c, win } of randomHands(3000, 'yaku-excl')) {
      for (const r of judgeAll({ concealed: c, melds: [], winTile: win, tsumo: false, seatWind: 27, roundWind: 27, riichi: 'double', rules: GENERAL_RULES })) {
        const got = new Set(r.yaku.map((y) => y.id));
        for (const [a, b] of excl) expect(got.has(a) && got.has(b)).toBe(false);
        if (r.yakuman > 0) expect(r.yaku.every((y) => y.yakuman > 0)).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(1500);
  });
});
