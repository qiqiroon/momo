// あと 1 枚で付く役の手がかり（訂正26100917・Q8=B）の検査
import type { GameEvent } from './events';
import { establishedYaku, yakuHints } from './hints';
import { GENERAL_RULES } from './rules';
import { apply, initialState, type GameState } from './state';

/** 席 0（親）に牌の種類の並びを配った局面（ほかの席には配らない＝手がかりは自分の手だけで決まる） */
function dealt(kinds: number[]): GameState {
  let s = initialState();
  let seq = 0;
  const push = (ev: GameEvent) => (s = apply(s, { seq: seq++, to: 'all', ev }));
  const used = new Map<number, number>();
  const tiles = kinds.map((k) => {
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return k * 4 + n;
  });
  push({ type: 'gameStart', rules: GENERAL_RULES });
  push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  push({ type: 'deal', seat: 0, tiles });
  return s;
}
const ids = (s: GameState) => Object.fromEntries(yakuHints(s, 0).map((h) => [h.id, h.kinds]));

describe('あと 1 枚で付く役', () => {
  it('テンパイ：待ちの牌ごとの役（平和は 1萬・4萬のどちらでも付く）', () => {
    // 2萬3萬 456筒 789索 234索 55萬 → 1萬・4萬待ち
    const h = ids(dealt([1, 2, 12, 13, 14, 24, 25, 26, 19, 20, 21, 4, 4]));
    expect(h.pinfu).toEqual([0, 3]);
    expect(h.riichi).toBeUndefined(); // 場面で付く役は出さない
  });

  it('テンパイでなくても：役牌の対子・一気通貫の 8 種類・三色同順の 8 種類', () => {
    // 白白・1〜8萬・東南西（バラバラ）
    const h = ids(dealt([31, 31, 0, 1, 2, 3, 4, 5, 6, 7, 27, 28, 29]));
    expect(h.haku).toEqual([31]);
    expect(h.ittsu).toEqual([8]);
    // 123萬 123筒 12索（3索が足りない）
    const h2 = ids(dealt([0, 1, 2, 9, 10, 11, 18, 19, 27, 28, 29, 30, 33]));
    expect(h2.sanshoku).toEqual([20]);
  });

  it('場風・自風の対子（東場の親＝東は両方）。三元牌 2 種類が刻子で 1 種類が対子なら大三元', () => {
    const h = ids(dealt([27, 27, 31, 31, 31, 32, 32, 32, 33, 33, 0, 9, 18]));
    expect(h.roundWind).toEqual([27]);
    expect(h.seatWind).toEqual([27]);
    expect(h.daisangen).toEqual([33]);
    expect(h.chun).toEqual([33]);
  });

  it('何も無い手では出さない。アガれる牌が無ければ「成立」も無い', () => {
    const s = dealt([0, 4, 8, 9, 13, 17, 18, 22, 26, 27, 28, 29, 30]);
    expect(yakuHints(s, 0)).toEqual([]);
    expect(establishedYaku(s, 0, 'tsumo')).toBeNull();
  });
});
