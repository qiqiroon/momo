// チー・ポンの検査（段階3の 2）。配る牌を指定した局面を出来事の列で組む。
import type { Envelope, GameEvent, Seat } from './events';
import { act, callOptions, legalActions, riichiTiles, type Action } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, scoreRon, type GameState } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

/** 背番号を配る係。同じ種類は 4 枚目→3 枚目…の順に使う（赤5＝1 枚目は最後に使う） */
function dealer() {
  const used = new Map<number, number>();
  return (s: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) {
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
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    this.s = apply(this.s, { seq: this.s.nextSeq, to, ev });
  }
  do(seat: Seat, a: Action) {
    for (const e of act(this.s, seat, a)) this.s = apply(this.s, e);
  }
}

/** 4 人に配って、席 0（親）が draw をツモって切ったところ（返事を待っている） */
function setup(hands: [string, string, string, string], draw: string, rules: Rules = GENERAL_RULES) {
  const d = dealer();
  const t = new Table();
  t.push({ type: 'gameStart', rules });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: d(h) }, [seat as Seat]));
  t.push({ type: 'doraReveal', tile: d('8s')[0] });
  const tile = d(draw)[0];
  t.push({ type: 'draw', seat: 0, tile }, [0]);
  t.push({ type: 'discard', seat: 0, tile, tsumogiri: true });
  t.s = { ...t.s, wall: [] };
  return { t, d, tile };
}

const DEALER = '1m1m1m9m9m9m1p1p1p9p9p9p1z';
/** 席 1（下家）：3m4m を持つ＝2m・5m でチーできる。5z5z を持つ＝5z でポンできる */
const S1 = '3m4m6p7p8p2s3s4s5z5z7s7s8s';
const S2 = '2z2z3z3z4z4z6z6z1s1s9s9s7z';
const S3 = '6m7m8m2p3p4p6s6s6z3s3s4p5p';

describe('チー・ポンできること', () => {
  it('下家はチーとポン、ほかの人はポンだけ', () => {
    const { t } = setup([DEALER, S1, S2, S3], '2m');
    const a1 = callOptions(t.s, 1);
    expect(a1.map((a) => a.type)).toEqual(['chi']);
    expect(a1[0].type === 'chi' && a1[0].tiles.map(kindOf).sort()).toEqual([k('3m'), k('4m')]);
    // 席 3 は 6m7m8m を持つが、2m とは続かない＝何もできない
    expect(callOptions(t.s, 3)).toEqual([]);
  });

  it('ポンは誰でもできる。チーは上家の牌だけ', () => {
    const { t } = setup([DEALER, S1, S2, S3], '5z');
    expect(callOptions(t.s, 1).map((a) => a.type)).toEqual(['pon']);
    const { t: t2 } = setup([DEALER, S2, S1, S3], '2m');
    // 席 2 は 3m4m を持つが、席 0 は上家ではない（対面）＝チーできない
    expect(callOptions(t2.s, 2)).toEqual([]);
  });

  it('同じ形でも赤5を出すかどうかは別の候補になる', () => {
    // 席 1 が 4m・5m・赤5m・6m を持つ：3m は 4m5m／4m 赤5m でチー、7m は 5m6m／赤5m6m でチー
    const { t } = setup([DEALER, '4m5m5m6m6p7p8p2s3s4s5z5z5s', S2, S3], '3m');
    // 5m は 2 枚（4 枚目と 3 枚目）＝赤ではない。赤は 1 枚目なので、この手には入っていない
    expect(callOptions(t.s, 1).filter((a) => a.type === 'chi')).toHaveLength(1);
    const red = 4 * 4; // 赤5m
    const s = { ...t.s, hands: t.s.hands.map((h, seat) => (seat === 1 ? [...h.slice(0, 2), red, ...h.slice(3)] : h)) };
    // 5m の 1 枚を赤に替えると、4m+5m と 4m+赤5m の 2 つに分かれる
    expect(callOptions(s, 1).filter((a) => a.type === 'chi')).toHaveLength(2);
  });

  it('リーチしている人・山が尽きたあとの捨て牌は鳴けない', () => {
    const { t } = setup([DEALER, S1, S2, S3], '5z');
    expect(callOptions({ ...t.s, riichi: ['none', 'riichi', 'none', 'none'] }, 1)).toEqual([]);
    expect(callOptions({ ...t.s, wallLeft: 14 }, 1)).toEqual([]);
    expect(() => t.push({ type: 'call', seat: 1, meld: 'pon', tiles: t.s.hands[1].slice(0, 2) })).toThrow(/ポンは同じ牌/);
  });
});

describe('鳴いたあと', () => {
  it('ポンすると鳴いた人の番になり、ツモらずに切る。鳴いた牌は河から持っていかれる', () => {
    const { t } = setup([DEALER, S1, S2, S3], '5z');
    const pon = callOptions(t.s, 1)[0];
    t.do(1, pon);
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    expect(t.s.phase).toBe('discard');
    expect(t.s.turn).toBe(1);
    expect(t.s.drawn[1]).toBeNull();
    expect(t.s.hands[1]).toHaveLength(11);
    expect(t.s.melds[1]).toHaveLength(1);
    expect(t.s.melds[1][0]).toMatchObject({ type: 'pon', from: 0 });
    expect(t.s.calledAway[0]).toEqual([0]);
    expect(t.s.discards[0]).toHaveLength(1); // 河の並びには残す（フリテンの判定のため）
    // ツモはできない・どの牌でも切れる
    expect(legalActions(t.s, 1).every((a) => a.type === 'discard')).toBe(true);
    expect(riichiTiles(t.s, 1)).toEqual([]);
  });

  it('ポンとチーが同じ牌に出たら、ポンが先', () => {
    // 席 1 は 3m4m でチー、席 2 は 2m2m でポン
    const { t } = setup([DEALER, S1, '2m2m3z3z4z4z6z6z1s1s9s9s7z', S3], '2m');
    t.do(1, callOptions(t.s, 1).find((a) => a.type === 'chi')!);
    t.do(2, callOptions(t.s, 2).find((a) => a.type === 'pon')!);
    t.do(3, { type: 'pass' });
    expect(t.s.turn).toBe(2);
    expect(t.s.melds[1]).toEqual([]);
    expect(t.s.melds[2][0].type).toBe('pon');
  });

  it('ロンとポンが同じ牌に出たら、ロンが先', () => {
    // 席 2 は 7s8s で 6s・9s 待ち（6s ならタンヤオ）、席 3 は 6s6s でポンできる
    const { t } = setup([DEALER, S1, '2m3m4m6p7p8p3s4s5s7s8s5p5p', S3], '6s');
    expect(scoreRon(t.s, 2, t.s.hands[2], t.s.claim!.tile)).not.toBeNull();
    t.do(1, { type: 'pass' });
    t.do(2, { type: 'ron' });
    t.do(3, callOptions(t.s, 3).find((a) => a.type === 'pon')!);
    expect(t.s.result?.type).toBe('ron');
    expect(t.s.melds[3]).toEqual([]);
  });

  it('鳴きが入ると一発は消え、鳴きがあったことを覚える（天和・地和・ダブル立直が付かなくなる元）', () => {
    const { t } = setup([DEALER, S1, S2, S3], '5z');
    t.s = { ...t.s, ippatsu: [false, false, true, false] };
    t.do(1, callOptions(t.s, 1)[0]);
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    expect(t.s.ippatsu).toEqual([false, false, false, false]);
    expect(t.s.anyCall).toBe(true);
  });

  it('鳴いた手のアガリ：鳴いた白の刻子で役牌が付き、門前の役（門前清自摸和・平和）は付かない', () => {
    // 席 1 が 5z をポンして 7s を切り、2s3s4s 6p7p8p 3m4m 8s8s… の形から 2m・5m でロン
    const { t } = setup([DEALER, '3m4m6p7p8p2s3s4s5z5z8s8s7s', S2, S3], '5z');
    t.do(1, callOptions(t.s, 1)[0]);
    t.do(2, { type: 'pass' });
    t.do(3, { type: 'pass' });
    const seven = t.s.hands[1].find((x) => kindOf(x) === k('7s'))!;
    t.do(1, { type: 'discard', tile: seven });
    // 席 1 の返事待ちを抜けて、席 2 が 5m を切ったことにする
    for (const seat of [2, 3, 0] as const) if (t.s.claim?.replies[seat] === null) t.do(seat, { type: 'pass' });
    const five = 4 * 4 + 1; // 5m（赤ではない 2 枚目）
    t.push({ type: 'draw', seat: 2, tile: five }, [2]);
    t.push({ type: 'discard', seat: 2, tile: five, tsumogiri: true });
    const score = scoreRon(t.s, 1, t.s.hands[1], five);
    expect(score).not.toBeNull();
    const ids = score!.yaku.map((y) => y.id);
    expect(ids).toContain('haku');
    expect(ids).not.toContain('pinfu');
    expect(ids).not.toContain('menzenTsumo');
  });

  it('待ちの牌を鳴いてロンしなかったら見逃し（同じ巡のフリテン）', () => {
    // 席 1 は 5z5z と 8s8s のシャンポン待ち。5z をポンすると見逃し
    const { t } = setup([DEALER, '2m3m4m6p7p8p2s3s4s5z5z8s8s', S2, S3], '5z');
    t.do(1, callOptions(t.s, 1).find((a) => a.type === 'pon')!);
    expect(t.s.missedTurn[1]).toBe(true);
  });
});
