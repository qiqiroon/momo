// 点数の計算の検査。期待値は手で計算した値（早見表とも突き合わせ済み）。
import { countDora, doraIndicatorAt, doraOf, uraIndicatorAt } from './dora';
import { GENERAL_RULES, type Rules } from './rules';
import { baseOf, scoreWin, type WinInput } from './score';
import type { Meld, WinContext } from './yaku';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

/** "123m456p0s11z" を背番号の並びにする（0＝赤5。同じ種類は 2 枚目・3 枚目…の背番号を使い、赤5 は 1 枚目） */
function ids(s: string): number[] {
  const used = new Map<number, number>();
  const out: number[] = [];
  for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of nums) {
      const red = d === '0';
      const kind = BASE[suit as 'm'] + (red ? 5 : Number(d)) - 1;
      if (red) {
        out.push(kind * 4);
        continue;
      }
      const n = used.get(kind) ?? 1; // 1 枚目は赤5の候補なので 2 枚目から使う（5 以外も同じ並べ方で困らない）
      used.set(kind, n + 1);
      out.push(kind * 4 + (n % 4));
    }
  }
  return out;
}
const counts = (s: string) => {
  const c = new Array<number>(34).fill(0);
  for (const id of ids(s)) c[Math.floor(id / 4)]++;
  return c;
};
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;
/** ドラ表示牌（背番号）。種類の 4 枚目を使う＝手牌と重ならない */
const ind = (s: string) => k(s) * 4 + 3;

const withRule = (patch: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...patch } } : GENERAL_RULES;

function input(hand: string, win: string, more: Partial<WinContext> & { indicators?: string[]; dealer?: boolean; melds?: Meld[]; meldTiles?: string } = {}): WinInput {
  const { indicators = ['1z'], dealer = false, meldTiles = '', ...ctx } = more;
  return {
    ctx: { concealed: counts(hand), melds: [], winTile: k(win), tsumo: false, seatWind: dealer ? 27 : 28, roundWind: 27, rules: GENERAL_RULES, ...ctx },
    tiles: ids(hand + meldTiles),
    indicators: indicators.map(ind),
    ura: [],
    dealer,
  };
}

function score(i: WinInput) {
  const r = scoreWin(i);
  if (!r) return null;
  return { han: r.han, fu: r.fu, limit: r.limit, payment: r.payment, total: r.total };
}

describe('ドラ', () => {
  it('表示牌の次がドラ（9 の次は 1・北の次は東・中の次は白）', () => {
    expect(doraOf(k('3m'))).toBe(k('4m'));
    expect(doraOf(k('9m'))).toBe(k('1m'));
    expect(doraOf(k('9s'))).toBe(k('1s'));
    expect(doraOf(k('4z'))).toBe(k('1z'));
    expect(doraOf(k('1z'))).toBe(k('2z'));
    expect(doraOf(k('7z'))).toBe(k('5z'));
    expect(doraOf(k('5z'))).toBe(k('6z'));
  });

  it('ドラ・赤ドラ・裏ドラを数える。カンドラ・裏ドラが「なし」なら数えない', () => {
    const tiles = ids('110m55p');
    const two = [ind('9m'), ind('4p')]; // ドラ＝1m（2 枚）と 5p（2 枚）
    const ura = [ind('4m'), ind('9m')]; // 裏＝5m（赤の 1 枚）と 1m（2 枚）
    expect(countDora(tiles, two, ura, GENERAL_RULES)).toEqual({ dora: 4, aka: 1, ura: 3 });
    expect(countDora(tiles, two, ura, withRule({ kandora: 'off' }))).toEqual({ dora: 2, aka: 1, ura: 1 });
    expect(countDora(tiles, two, ura, withRule({ ura: 'off' }))).toEqual({ dora: 4, aka: 1, ura: 0 });
    expect(countDora(tiles, two, ura, withRule({ aka: 'off' }))).toEqual({ dora: 4, aka: 0, ura: 3 });
  });

  it('表示牌は王牌（山の最後の 14 枚）の決まった場所：ドラは 5・7・9…枚目、裏はその次', () => {
    const wall = Array.from({ length: 136 }, (_, i) => i);
    expect(doraIndicatorAt(wall, 0)).toBe(122 + 4);
    expect(uraIndicatorAt(wall, 0)).toBe(122 + 5);
    expect(doraIndicatorAt(wall, 4)).toBe(122 + 12);
    expect(() => doraIndicatorAt(wall, 5)).toThrow();
  });
});

describe('符と点数', () => {
  it('平和ツモ（子）＝20 符 2 翻＝400・700（合計 1500）', () => {
    expect(score(input('123m456p789s234s55p', '4s', { tsumo: true }))).toEqual({
      han: 2, fu: 20, limit: 'none', payment: { type: 'tsumo', fromDealer: 700, fromOthers: 400 }, total: 1500,
    });
  });

  it('平和ツモ（親）＝20 符 2 翻＝700 オール（合計 2100）', () => {
    expect(score(input('123m456p789s234s55p', '4s', { tsumo: true, dealer: true }))).toEqual({
      han: 2, fu: 20, limit: 'none', payment: { type: 'tsumo', fromDealer: 0, fromOthers: 700 }, total: 2100,
    });
  });

  it('七対子のロン（子）＝25 符 2 翻＝1600', () => {
    expect(score(input('2244m5566p7788s33z', '3z'))).toMatchObject({ han: 2, fu: 25, total: 1600 });
  });

  it('門前ロン・中の暗刻・嵌張＝40 符。1 翻で 1300、ツモなら 40 符 2 翻で 700・1300', () => {
    expect(score(input('234m456p789s777z11s', '3m'))).toMatchObject({ han: 1, fu: 40, total: 1300 });
    expect(score(input('234m456p789s777z11s', '3m', { tsumo: true }))).toEqual({
      han: 2, fu: 40, limit: 'none', payment: { type: 'tsumo', fromDealer: 1300, fromOthers: 700 }, total: 2700,
    });
  });

  it('鳴いて 20 符にしかならない手は 30 符（喰いタンの両面ロン＝1000）', () => {
    const melds: Meld[] = [{ type: 'chi', first: k('2m'), open: true }];
    expect(score(input('567p678s345s22p', '5p', { melds, meldTiles: '234m' }))).toMatchObject({ han: 1, fu: 30, total: 1000 });
  });

  it('連風牌の雀頭：2 符なら 40 符（親 1 翻ロン 2000）、4 符なら 50 符（2400）', () => {
    const base = { dealer: true } as const; // 東場の東家
    expect(score(input('234m456p789s777z11z', '2m', base))).toMatchObject({ han: 1, fu: 40, total: 2000 });
    expect(score(input('234m456p789s777z11z', '2m', { ...base, rules: withRule({ renpu: '4' }) }))).toMatchObject({ han: 1, fu: 50, total: 2400 });
  });

  it('30 符 4 翻の子のロン：切り上げ満貫ありで 8000、なしで 7700', () => {
    // 断么九＋平和＋ドラ 2（表示 4m → 5m の対子）
    const i = input('234m567p345s678s55m', '2m', { indicators: ['4m'] });
    expect(score(i)).toMatchObject({ han: 4, fu: 30, limit: 'mangan', total: 8000 });
    expect(score({ ...i, ctx: { ...i.ctx, rules: withRule({ kiriage: 'off' }) } })).toMatchObject({ han: 4, fu: 30, limit: 'none', total: 7700 });
  });

  it('赤ドラも翻に入る（赤なしのルールでは入らない）', () => {
    const i = input('234m067p345s678s55m', '2m'); // 断么九＋平和＋赤 1
    expect(score(i)).toMatchObject({ han: 3, fu: 30, total: 3900 });
    expect(score({ ...i, ctx: { ...i.ctx, rules: withRule({ aka: 'off' }) } })).toMatchObject({ han: 2, total: 2000 });
  });

  it('清一色＋平和の子のロン＝7 翻＝跳満 12000', () => {
    expect(score(input('123m345m567m789m22m', '9m'))).toMatchObject({ limit: 'haneman', total: 12000 });
  });

  it('役満の子のツモ＝8000・16000（合計 32000）', () => {
    expect(score(input('555z666z777z234p11m', '4p', { tsumo: true }))).toEqual({
      han: 0, fu: 0, limit: 'yakuman', payment: { type: 'tsumo', fromDealer: 16000, fromOthers: 8000 }, total: 32000,
    });
  });

  it('ドラだけでは役にならない（アガれない）', () => {
    // 雀頭が自風の南なので平和にならない＝役なし。ドラは南の対子で 2 つあるがアガれない
    expect(scoreWin(input('123m456p789s234s22z', '4s', { indicators: ['1z'] }))).toBeNull();
  });

  it('縛り 2 翻：平和のロン（1 翻）はアガれない', () => {
    expect(scoreWin(input('123m456p789s234s55p', '4s', { rules: withRule({ shibari: '2' }) }))).toBeNull();
    expect(scoreWin(input('123m456p789s234s55p', '4s'))).not.toBeNull();
  });

  it('翻と符から点数の段階を決める（数え役満は「なし」なら三倍満）', () => {
    expect(baseOf(4, 40, GENERAL_RULES)).toEqual({ limit: 'mangan', base: 2000 });
    expect(baseOf(3, 70, GENERAL_RULES)).toEqual({ limit: 'mangan', base: 2000 });
    expect(baseOf(3, 50, GENERAL_RULES)).toEqual({ limit: 'none', base: 1600 });
    expect(baseOf(5, 30, GENERAL_RULES).limit).toBe('mangan');
    expect(baseOf(7, 30, GENERAL_RULES).limit).toBe('haneman');
    expect(baseOf(10, 30, GENERAL_RULES).limit).toBe('baiman');
    expect(baseOf(12, 30, GENERAL_RULES).limit).toBe('sanbaiman');
    expect(baseOf(13, 30, GENERAL_RULES)).toEqual({ limit: 'kazoe', base: 8000 });
    expect(baseOf(13, 30, withRule({ kazoe: 'off' }))).toEqual({ limit: 'sanbaiman', base: 6000 });
  });

  it('読み方が 2 通りある手は高いほう：111222333m は三暗刻（40 符 3 翻）で数える', () => {
    // 三暗刻＋ツモ＝40 符 3 翻＝1300・2600（合計 5200）。順子 3 つの読み方（一盃口＋ツモ＝30 符 2 翻）より高い
    expect(score(input('111222333m789p55s', '5s', { tsumo: true }))).toEqual({
      han: 3, fu: 40, limit: 'none', payment: { type: 'tsumo', fromDealer: 2600, fromOthers: 1300 }, total: 5200,
    });
  });
});
