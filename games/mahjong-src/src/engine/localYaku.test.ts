// 人和とローカル役 15 個（段階6の6a-3）の検査。値はルール設定 v0.03 §4「ローカル役」の表。
// どれも「あり」のときだけ付き、「なし」（どのセットでも既定）のときは付かないことを確かめる。
import { benchCpu } from '../cpu/bench';
import { playOne } from '../selfplay/run';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, scoreRon, scoreTsumo, type GameState, type OpenMeld } from './state';
import { scoreWin, type WinInput } from './score';
import { bestYaku, type Meld, type WinContext, type YakuId } from './yaku';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

function hand(s: string): number[] {
  const c = new Array<number>(34).fill(0);
  for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) for (const d of nums) c[BASE[suit as 'm'] + Number(d) - 1]++;
  return c;
}
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

const rules = (patch: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...patch } } : GENERAL_RULES;

function ctx(h: string, win: string, more: Partial<WinContext> = {}): WinContext {
  return { concealed: hand(h), melds: [], winTile: k(win), tsumo: false, seatWind: 28, roundWind: 27, rules: GENERAL_RULES, ...more };
}
const idsOf = (c: WinContext): YakuId[] => (bestYaku(c)?.yaku ?? []).map((y) => y.id);

/** その役を「あり」にしたら付き、既定（なし）では付かない */
function onlyWhenOn(id: YakuId, c: WinContext, extra: Record<string, string> = {}) {
  expect(idsOf({ ...c, rules: rules({ [id]: 'on', ...extra }) }), `${id} あり`).toContain(id);
  expect(idsOf({ ...c, rules: rules(extra) }), `${id} なし`).not.toContain(id);
}

const input = (c: WinContext, dealer = false): WinInput => ({ ctx: c, tiles: [], indicators: [], ura: [], dealer });

describe('ローカル役（1翻・2翻・3翻・5翻）', () => {
  it('燕返し：ほかの人のリーチ宣言牌でロン（1翻・ツモでは付かない）', () => {
    onlyWhenOn('tsubame', ctx('123m456p789s234s55p', '4s', { tsubame: true }));
    expect(idsOf(ctx('123m456p789s234s55p', '4s', { tsubame: false, rules: rules({ tsubame: 'on' }) }))).not.toContain('tsubame');
  });

  it('槓振り：カンした人の直後の捨て牌でロン（1翻）', () => {
    onlyWhenOn('kanburi', ctx('123m456p789s234s55p', '4s', { kanburi: true }));
  });

  it('十二落抬：4 つとも鳴いて裸単騎でロン（ツモ・暗槓を含むと付かない）', () => {
    const melds: Meld[] = [
      { type: 'pon', first: k('2m'), open: true },
      { type: 'pon', first: k('3p'), open: true },
      { type: 'chi', first: k('4s'), open: true },
      { type: 'pon', first: k('8s'), open: true },
    ];
    onlyWhenOn('shiiaru', ctx('55p', '5p', { melds }));
    const on = rules({ shiiaru: 'on' });
    expect(idsOf(ctx('55p', '5p', { melds, tsumo: true, rules: on }))).not.toContain('shiiaru');
    const withAnkan = melds.map((m, i) => (i === 0 ? { type: 'kan' as const, first: m.first, open: false } : m));
    expect(idsOf(ctx('55p', '5p', { melds: withAnkan, rules: on }))).not.toContain('shiiaru');
  });

  it('五門斉：萬・筒・索・風牌・三元牌を全部使う（2翻・七対子でも）', () => {
    onlyWhenOn('uumen', ctx('123m456p789s111z55z', '3m'));
    onlyWhenOn('uumen', ctx('1133m55p77s115577z', '7z'));
    // 三元牌が無ければ付かない
    expect(idsOf(ctx('123m456p789s111z22z', '3m', { rules: rules({ uumen: 'on' }) }))).not.toContain('uumen');
  });

  it('三連刻：数が続く刻子が 3 つ（2翻）', () => {
    onlyWhenOn('sanrenko', ctx('222333444m678p55s', '8p'));
  });

  it('一色三順：同じ順子が 3 つ（門前 3翻・鳴くと 2翻）。一盃口とは重ねない', () => {
    onlyWhenOn('isshoku3', ctx('123123123m456p55s', '6p'));
    const r = bestYaku(ctx('123123123m456p55s', '6p', { rules: rules({ isshoku3: 'on' }) }))!;
    expect(r.yaku.find((y) => y.id === 'isshoku3')?.han).toBe(3);
    expect(r.yaku.map((y) => y.id)).not.toContain('iipeikou');
    const open = bestYaku(ctx('123123m456p55s', '6p', { melds: [{ type: 'chi', first: k('1m'), open: true }], rules: rules({ isshoku3: 'on' }) }))!;
    expect(open.yaku.find((y) => y.id === 'isshoku3')?.han).toBe(2);
  });

  it('一筒摸月：海底のツモが一筒（5翻・ほかの役と足す）。嶺上牌では付かない', () => {
    const c = ctx('123p456p789s234s11m', '1p', { tsumo: true, haitei: true });
    onlyWhenOn('ipin', c);
    const r = bestYaku({ ...c, rules: rules({ ipin: 'on' }) })!;
    expect(r.yaku.find((y) => y.id === 'ipin')?.han).toBe(5);
    expect(r.yaku.map((y) => y.id)).toEqual(expect.arrayContaining(['haitei', 'menzenTsumo']));
    expect(idsOf({ ...c, rinshan: true, rules: rules({ ipin: 'on' }) })).not.toContain('ipin');
    // 一筒以外では付かない
    expect(idsOf(ctx('123p456p789s234s11m', '3p', { tsumo: true, haitei: true, rules: rules({ ipin: 'on' }) }))).not.toContain('ipin');
  });

  it('九筒撈魚：河底の九筒でロン（5翻）', () => {
    onlyWhenOn('chupin', ctx('789p456p789s234s11m', '9p', { houtei: true }));
    expect(idsOf(ctx('789p456p789s234s11m', '9p', { houtei: true, tsumo: true, rules: rules({ chupin: 'on' }) }))).not.toContain('chupin');
  });
});

describe('ローカル役（役満）', () => {
  it('大車輪・大竹林・大数隣：門前で 2〜8 を 2 枚ずつ', () => {
    for (const [id, h, w] of [
      ['daisharin', '22334455667788p', '8p'],
      ['daichikurin', '22334455667788s', '8s'],
      ['daisuurin', '22334455667788m', '8m'],
    ] as const) {
      const c = ctx(h, w);
      onlyWhenOn(id, c);
      expect(bestYaku({ ...c, rules: rules({ [id]: 'on' }) })!.yakuman).toBe(1);
    }
    // 筒子の形でも、大竹林だけ「あり」なら付かない
    expect(idsOf(ctx('22334455667788p', '8p', { rules: rules({ daichikurin: 'on' }) }))).not.toContain('daichikurin');
  });

  it('石の上にも三年：ダブル立直して海底か河底でアガる（ふつうのリーチでは付かない）', () => {
    onlyWhenOn('ishinoue', ctx('123m456p789s234s55p', '4s', { riichi: 'double', tsumo: true, haitei: true }));
    onlyWhenOn('ishinoue', ctx('123m456p789s234s55p', '4s', { riichi: 'double', houtei: true }));
    expect(idsOf(ctx('123m456p789s234s55p', '4s', { riichi: 'riichi', houtei: true, rules: rules({ ishinoue: 'on' }) }))).not.toContain('ishinoue');
    expect(idsOf(ctx('123m456p789s234s55p', '4s', { riichi: 'double', rules: rules({ ishinoue: 'on' }) }))).not.toContain('ishinoue');
  });

  it('四連刻：数が続く刻子が 4 つ', () => {
    onlyWhenOn('surenko', ctx('222333444555m66p', '5m'));
  });

  it('大七星：字牌 7 種の七対子＝ダブル役満（字一色の代わり）。ダブル役満が「なし」なら字一色のまま', () => {
    const c = ctx('11223344556677z', '7z');
    const on = bestYaku({ ...c, rules: rules({ daichisei: 'on', doubleYakuman: 'on' }) })!;
    expect(on.yaku.map((y) => y.id)).toEqual(['daichisei']);
    expect(on.yakuman).toBe(2);
    expect(idsOf({ ...c, rules: rules({ doubleYakuman: 'on' }) })).toEqual(['tsuuiisou']);
    expect(idsOf({ ...c, rules: rules({ daichisei: 'on' }) })).toEqual(['tsuuiisou']);
  });
});

describe('人和・八連荘（点数の側で決まるもの）', () => {
  const plain = () => ctx('123m456p789s234s55p', '4s', { jinho: true });

  it('人和が「なし」：ふつうの点数（平和のロン 30符1翻＝1000点）', () => {
    expect(scoreWin(input(plain()))!.total).toBe(1000);
  });

  it('人和が「満貫」：ほかの役・ドラと足さない満貫（子のロン 8000点）。ほかの読みが高ければそちら', () => {
    const r = scoreWin(input({ ...plain(), rules: rules({ jinho: 'mangan' }) }))!;
    expect(r.yaku.map((y) => y.id)).toEqual(['jinho']);
    expect(r.limit).toBe('mangan');
    expect(r.total).toBe(8000);
    // 清一色・二盃口などで倍満以上＝人和の満貫より高い
    const big = scoreWin(input({ ...ctx('22334455667788m', '8m', { jinho: true }), rules: rules({ jinho: 'mangan' }) }))!;
    expect(big.total).toBeGreaterThan(8000);
    expect(big.yaku.map((y) => y.id)).not.toContain('jinho');
  });

  it('人和が「役満」：役満（子のロン 32000点）', () => {
    const r = scoreWin(input({ ...plain(), rules: rules({ jinho: 'yakuman' }) }))!;
    expect(r.yaku.map((y) => y.id)).toEqual(['jinho']);
    expect(r.total).toBe(32000);
    // 人和の条件でなければ付かない
    expect(scoreWin(input({ ...plain(), jinho: false, rules: rules({ jinho: 'yakuman' }) }))!.total).toBe(1000);
  });

  it('八連荘：8 回目のアガリから役満。役には数えない（役が無ければアガれない）', () => {
    const on = rules({ parenchan: 'on' });
    expect(scoreWin(input({ ...plain(), streak: 7, rules: on }))!.total).toBe(1000);
    const r = scoreWin(input({ ...plain(), streak: 8, rules: on }))!;
    expect(r.yaku.map((y) => y.id)).toEqual(['parenchan']);
    expect(r.total).toBe(32000);
    expect(scoreWin(input({ ...plain(), streak: 9, rules: on }))!.total).toBe(32000);
    expect(scoreWin(input({ ...plain(), streak: 8 }))!.total).toBe(1000);
    // 役の無い形（辺張の 3m）は 8 回目でもアガれない
    expect(scoreWin(input({ ...ctx('123m456p789s234s55p', '3m'), streak: 8, rules: on }))).toBeNull();
  });
});

describe('続けてアガった回数（八連荘の数え方）', () => {
  it('アガった人が続けていれば +1・別の人なら 1 から・流局と途中流局で途切れる（自動対局 20 半荘で突き合わせ）', () => {
    let checked = 0;
    for (let i = 0; i < 20; i++) {
      const r = playOne(`streak-${i}`, GENERAL_RULES, benchCpu, true);
      expect(r.failure).toBeNull();
      let g = initialState();
      let want: { seat: number; n: number } | null = null;
      for (const e of r.log) {
        const prev = g.phase;
        g = apply(g, e);
        if (g.phase !== 'ended' || prev === 'ended') continue;
        const res = g.result!;
        const winners = res.type === 'tsumo' ? [res.seat] : res.type === 'ron' ? res.wins.map((w) => w.seat) : [];
        if (winners.length === 0) want = null;
        else want = want && winners.includes(want.seat as never) ? { seat: want.seat, n: want.n + 1 } : { seat: winners[0], n: 1 };
        expect(g.winStreak).toEqual(want);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);
});

describe('後付け「なし」＝片アガリ禁止（Q34＝A）', () => {
  const at = (atozuke: string, melds: OpenMeld[]): GameState => ({
    ...initialState(),
    rules: rules({ atozuke }),
    roundIndex: 0,
    dealer: 0,
    wallLeft: 70,
    anyCall: true,
    melds: [[], melds, [], []],
  });
  // 3萬をポン・手の中は 456筒 789索 中中 55索＝中と 5索のシャンポン待ち（5索では役が無い）
  const pon3m: OpenMeld = { type: 'pon', tiles: [8, 9, 10], called: 10, from: 0 };
  const hand = [48, 52, 56, 96, 100, 104, 132, 133, 88, 89];

  it('「あり」なら中でアガれる・「なし」なら片アガリなので中でもアガれない（ロンもツモも）', () => {
    expect(scoreRon(at('on', [pon3m]), 1, hand, 134)).not.toBeNull();
    expect(scoreRon(at('off', [pon3m]), 1, hand, 134)).toBeNull();
    expect(scoreTsumo(at('on', [pon3m]), 1, [...hand, 134], 134)).not.toBeNull();
    expect(scoreTsumo(at('off', [pon3m]), 1, [...hand, 134], 134)).toBeNull();
  });

  it('中を先にポンしていれば、どの待ちでも役が付くので「なし」でもアガれる', () => {
    const ponChun: OpenMeld = { type: 'pon', tiles: [132, 133, 134], called: 134, from: 0 };
    const h = [48, 52, 56, 96, 100, 104, 8, 9, 88, 89];
    expect(scoreRon(at('off', [ponChun]), 1, h, 90)).not.toBeNull();
    expect(scoreRon(at('off', [ponChun]), 1, h, 11)).not.toBeNull();
  });

  it('鳴いていない手（門前）は片アガリでもアガれる', () => {
    // 123萬 456筒 789索 中中 55索：中ならアガれる（5索は役なし）
    const h = [0, 4, 8, 48, 52, 56, 96, 100, 104, 132, 133, 88, 89];
    expect(scoreRon(at('off', []), 1, h, 134)).not.toBeNull();
  });
});
