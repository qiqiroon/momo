// アシストモードの役の候補一覧（設計 アシストモード v0.01 §4）の検査
import type { GameEvent } from '../engine/events';
import { GENERAL_RULES } from '../engine/rules';
import { apply, initialState, type GameState } from '../engine/state';
import { yakuPlan } from './yakuPlan';

/** 席 0（親）に牌の種類の並びを配った局面。others＝ほかの人の河（見えている牌）・mine＝自分の河 */
function dealt(kinds: number[], o: { others?: number[]; mine?: number[] } = {}): GameState {
  let s = initialState();
  let seq = 0;
  const push = (ev: GameEvent) => (s = apply(s, { seq: seq++, to: 'all', ev }));
  const used = new Map<number, number>();
  const id = (k: number) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return k * 4 + n;
  };
  const tiles = kinds.map(id);
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles });
  // 河は検査のために直接入れる（見えている牌の数え方だけを確かめる）
  return { ...s, discards: [(o.mine ?? []).map(id), (o.others ?? []).map(id), [], []] };
}
/** 行（役の組み合わせ）を key で引く */
const byKey = (s: GameState, limit = 10) => Object.fromEntries(yakuPlan(s, 0, { budgetMs: 100000, limit }).map((p) => [p.key, p]));

// 2萬3萬 456筒 789索 234索 55萬 → 1萬・4萬待ちの平和
const PINFU = [1, 2, 12, 13, 14, 24, 25, 26, 19, 20, 21, 4, 4];

describe('役の候補一覧', () => {
  it('テンパイ：平和はあと 1 枚・待ちは 1萬と 4萬で残りはそれぞれ 4 枚。見込みの点が付く', () => {
    const p = byKey(dealt(PINFU)).pinfu;
    expect(p.need).toBe(1);
    expect(p.tiles).toEqual([
      { kind: 0, left: 4 },
      { kind: 3, left: 4 },
    ]);
    expect(p.points).toBeGreaterThan(0);
    expect(p.furiten).toBe(false);
  });

  it('待ちの牌が場に見えている分だけ残りが減り、全部見えたら、その形では作れない（あと何枚が増える）', () => {
    expect(byKey(dealt(PINFU, { others: [0, 0] })).pinfu.tiles).toEqual([
      { kind: 3, left: 4 },
      { kind: 0, left: 2 },
    ]);
    const gone = byKey(dealt(PINFU, { others: [0, 0, 0, 0, 3, 3, 3, 3] })).pinfu;
    expect(gone === undefined || gone.need >= 2).toBe(true);
  });

  it('待ちが全部自分の捨て牌にあればフリテン（ツモのみ）', () => {
    const s = dealt(PINFU, { mine: [0, 3] });
    expect(byKey(s).pinfu.furiten).toBe(true);
  });

  it('あと何枚の少ない順、同じ枚数なら見込みの点の高い順。10 個まで', () => {
    const list = yakuPlan(dealt([0, 0, 3, 4, 4, 12, 12, 13, 17, 24, 29, 30, 31, 32]), 0, { budgetMs: 100000 });
    expect(list.length).toBe(10);
    for (let i = 1; i < list.length; i++) {
      const [a, b] = [list[i - 1], list[i]];
      expect(a.need < b.need || (a.need === b.need && a.points >= b.points)).toBe(true);
    }
  });

  it('1 行＝付く役の組み合わせ。待ち牌で役が変わるなら行を分け、それぞれの行にその組み合わせになる待ち牌だけを書く', () => {
    // 東東東 123萬 456萬 78萬 99萬（東場の親＝東は場風と自風）→ 3萬・6萬なら混一色＋場風＋自風、9萬ならさらに一気通貫
    const rows = yakuPlan(dealt([27, 27, 27, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8]), 0, { budgetMs: 100000, limit: 50 }).filter((p) => p.need === 1);
    const ittsu = rows.find((p) => p.ids.includes('ittsu') && p.ids.includes('honitsu'))!;
    const plain = rows.find((p) => !p.ids.includes('ittsu') && p.ids.includes('honitsu'))!;
    expect(ittsu.tiles.map((x) => x.kind)).toEqual([8]);
    expect(plain.tiles.map((x) => x.kind).sort()).toEqual([2, 5]);
    expect(ittsu.ids).toEqual(expect.arrayContaining(['roundWind', 'seatWind']));
    expect(ittsu.points).toBeGreaterThan(plain.points);
  });

  it('つぶれる役：14 枚の手で、1 枚しかない中を切ると役牌 中は遠くなる（余っている牌に中が無い）。2 枚ある牌は余っている', () => {
    // 1萬 56萬 12筒 68筒 1索 34索 西西 中 ＋ 7萬
    // 中を含む行（役牌 中・役牌 中＋…）はどれも、中を切ると遠くなる
    const rows = yakuPlan(dealt([0, 4, 5, 9, 10, 14, 16, 18, 20, 21, 29, 29, 33, 6]), 0, { budgetMs: 100000, limit: 30 }).filter((p) => p.ids.includes('chun'));
    expect(rows.length).toBeGreaterThan(0);
    for (const p of rows) expect(p.spare.has(33)).toBe(false);
    expect(rows.some((p) => p.spare.has(0))).toBe(true);
  });

  it('場面で付く役（立直・一発・門前清自摸和など）は出さない。中国式では空', () => {
    const ids = Object.keys(byKey(dealt(PINFU)));
    expect(ids).not.toContain('riichi');
    expect(ids).not.toContain('menzenTsumo');
    const cn = dealt(PINFU);
    expect(yakuPlan({ ...cn, rules: { ...cn.rules!, family: 'cn' } as never }, 0)).toEqual([]);
  });

  it('手牌が伏せている（CPU に任せているあいだ）なら空', () => {
    const s = dealt(PINFU);
    expect(yakuPlan({ ...s, hands: [s.hands[0].map(() => -1), [], [], []] }, 0)).toEqual([]);
  });
});
