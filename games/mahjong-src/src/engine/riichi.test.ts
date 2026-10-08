// リーチ・一発・裏ドラの検査。配る牌を指定した局面を出来事の列で組む（山の種は渡さない＝山の並びは使わない）。
import { waitKinds } from './agari';
import type { Envelope, GameEvent, Seat } from './events';
import { act, legalActions, riichiTiles } from './round';
import { GENERAL_RULES } from './rules';
import { apply, initialState, type GameState } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

/** 背番号を配る係。同じ種類は 4 枚目→3 枚目…の順に使う（赤5＝1 枚目は最後まで使わない） */
function dealer() {
  const used = new Map<number, number>();
  const take = (kind: number): TileId => {
    const n = used.get(kind) ?? 0;
    if (n >= 4) throw new Error(`5 枚目は無い（${kind}）`);
    used.set(kind, n + 1);
    return kind * 4 + 3 - n;
  };
  const tiles = (s: string): TileId[] => {
    const out: TileId[] = [];
    for (const [, nums, suit] of s.matchAll(/(\d+)([mpsz])/g)) for (const d of nums) out.push(take(BASE[suit as 'm'] + Number(d) - 1));
    return out;
  };
  return { tiles, take };
}

class Table {
  s: GameState = initialState();
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    this.s = apply(this.s, { seq: this.s.nextSeq, to, ev });
    // 切られた牌には、ほかの 3 人とも見送る（返事そのものの検査は ron.test.ts）
    if (ev.type === 'discard') {
      for (const d of [1, 2, 3]) {
        const seat = ((ev.seat + d) % 4) as Seat;
        this.s = apply(this.s, { seq: this.s.nextSeq, to: 'all', ev: { type: 'pass', seat } });
      }
    }
  }
}

/** 席 0（親）に hand を配り、ほかの 3 人には持ち主の無い牌を配って、席 0 が draw をツモったところ */
function setup(hand: string, draw: string, others = ['2m2m2m3m3m3m4m4m4m6m6m6m7m', '2p2p2p3p3p3p4p4p4p6p6p6p7p', '2s2s2s3s3s3s4s4s4s6s6s6s7s']) {
  const d = dealer();
  const t = new Table();
  t.push({ type: 'gameStart', rules: GENERAL_RULES });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  t.push({ type: 'deal', seat: 0, tiles: d.tiles(hand) }, [0]);
  others.forEach((h, i) => t.push({ type: 'deal', seat: (i + 1) as Seat, tiles: d.tiles(h) }, [(i + 1) as Seat]));
  t.push({ type: 'doraReveal', tile: d.take(k('8s')) });
  t.push({ type: 'draw', seat: 0, tile: d.tiles(draw)[0] }, [0]);
  return { t, d };
}

/** 席 1〜3 が 1 枚ずつツモ切りして、席 0 の番に戻す */
function goAround(t: Table, d: ReturnType<typeof dealer>, draws: string[]) {
  draws.forEach((x, i) => {
    const seat = (i + 1) as Seat;
    const tile = d.tiles(x)[0];
    t.push({ type: 'draw', seat, tile }, [seat]);
    t.push({ type: 'discard', seat, tile, tsumogiri: true });
  });
}

describe('テンパイと待ち', () => {
  it('シャンポン・ノベタン・七対子の単騎・国士の十三面', () => {
    const { tiles } = dealer();
    expect(waitKinds(tiles('123m456p789s1z1z2z2z'))).toEqual([k('1z'), k('2z')]);
    // 3456789s は 3・6・9 索の三面張
    expect(waitKinds(tiles('123m456p789s3456s'))).toEqual([k('3s'), k('6s'), k('9s')]);
    expect(waitKinds(dealer().tiles('1m1m4m4m7m7m2p2p5p5p8p8p9s'))).toEqual([k('9s')]);
    expect(waitKinds(dealer().tiles('19m19p19s1234567z'))).toHaveLength(13);
    expect(waitKinds(dealer().tiles('123m456p789s1z3z5z7z'))).toEqual([]);
  });

  it('自分の手で 4 枚とも使っている牌は待ちにならない', () => {
    // 1111m＝刻子＋1 枚で 1m の単騎に見えるが、1m はもう無い＝テンパイでない
    expect(waitKinds(dealer().tiles('1111m234p567p789s'))).toEqual([]);
  });
});

describe('リーチ', () => {
  it('切ったあとテンパイになる牌でだけリーチできる', () => {
    const { t } = setup('123m456p789s1z1z2z2z', '3z');
    // 3z を切ればシャンポン待ち。ほかの牌を切るとテンパイが崩れる
    expect(riichiTiles(t.s, 0).map(kindOf)).toEqual([k('3z')]);
    expect(legalActions(t.s, 0).filter((a) => a.type === 'riichi')).toHaveLength(1);
  });

  it('最初の打牌でのリーチはダブル立直。宣言牌の位置と一発が付く', () => {
    const { t } = setup('123m456p789s1z1z2z2z', '3z');
    const tile = t.s.drawn[0]!;
    for (const e of act(t.s, 0, { type: 'riichi', tile })) t.s = apply(t.s, e);
    expect(t.s.riichi[0]).toBe('double');
    expect(t.s.riichiAt[0]).toBe(0);
    expect(t.s.ippatsu[0]).toBe(true);
  });

  it('リーチのあとはツモった牌しか切れない（選べることもツモ切りとツモだけ）', () => {
    const { t, d } = setup('123m456p789s1z1z2z2z', '3z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true, riichi: true });
    goAround(t, d, ['9p', '9m', '8m']);
    t.push({ type: 'draw', seat: 0, tile: d.tiles('5z')[0] }, [0]);
    expect(legalActions(t.s, 0)).toEqual([{ type: 'discard', tile: t.s.drawn[0] }]);
    expect(() => act(t.s, 0, { type: 'discard', tile: t.s.hands[0][0] })).toThrow(/ツモった牌しか/);
    expect(() => t.push({ type: 'discard', seat: 0, tile: t.s.hands[0][0], tsumogiri: false })).toThrow(/ツモった牌以外/);
    // ツモ切りすると一発が消える
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true });
    expect(t.s.ippatsu[0]).toBe(false);
    expect(t.s.riichi[0]).toBe('double');
  });

  it('テンパイでないのにリーチした出来事は止める', () => {
    const { t } = setup('123m456p789s1z1z2z2z', '3z');
    expect(() => t.push({ type: 'discard', seat: 0, tile: t.s.hands[0][0], tsumogiri: false, riichi: true })).toThrow(/テンパイでない/);
  });

  it('一般ルール（ツモ番の無いリーチはできない）：ツモれる牌が 3 枚以下ならリーチできない', () => {
    const { t } = setup('123m456p789s1z1z2z2z', '3z');
    const near = { ...t.s, wallLeft: 14 + 3 };
    expect(riichiTiles(near, 0)).toEqual([]);
    expect(riichiTiles({ ...t.s, wallLeft: 14 + 4 }, 0).length).toBeGreaterThan(0);
  });

  it('ツモ番の無いリーチ「できる」なら、山に 1 枚あればリーチできる。海底牌を引いたあとはできない', () => {
    const { t } = setup('123m456p789s1z1z2z2z', '3z');
    const rules = GENERAL_RULES.family === 'jp' ? { family: 'jp' as const, values: { ...GENERAL_RULES.values, riichiNoDraw: 'ok' } } : GENERAL_RULES;
    expect(riichiTiles({ ...t.s, rules, wallLeft: 14 + 1 }, 0).length).toBeGreaterThan(0);
    expect(riichiTiles({ ...t.s, rules, wallLeft: 14 }, 0)).toEqual([]);
  });
});

describe('一発と裏ドラ', () => {
  /** 席 0 がリーチ（ダブル立直）し、一巡して 1z をツモったところ */
  function riichiThenDraw() {
    const { t, d } = setup('123m456p789s1z1z2z2z', '3z');
    t.push({ type: 'discard', seat: 0, tile: t.s.drawn[0]!, tsumogiri: true, riichi: true });
    goAround(t, d, ['9p', '9m', '8m']);
    t.push({ type: 'draw', seat: 0, tile: d.tiles('1z')[0] }, [0]);
    return { t, d };
  }

  it('一巡目のツモはダブル立直・一発・門前清自摸和が付き、裏ドラも数える', () => {
    const { t, d } = riichiThenDraw();
    expect(legalActions(t.s, 0)).toContainEqual({ type: 'tsumo' });
    // 裏ドラ表示が 9z… は無いので、北（4z）→ 東（1z）が裏ドラ。1z の刻子で 3 枚
    const ura = [d.tiles('4z')[0]];
    t.push({ type: 'tsumo', seat: 0, hand: t.s.hands[0].slice(), winTile: t.s.drawn[0]!, ura });
    if (t.s.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    const ids = t.s.result.score.yaku.map((y) => y.id).sort();
    expect(ids).toEqual(['doubleRiichi', 'ippatsu', 'menzenTsumo', 'roundWind', 'seatWind'].sort());
    expect(t.s.result.score.dora.ura).toBe(3);
  });

  it('裏ドラ表示牌の枚数がドラ表示牌と違うと止める。リーチしていない人は裏ドラをめくれない', () => {
    const { t } = riichiThenDraw();
    expect(() => t.push({ type: 'tsumo', seat: 0, hand: t.s.hands[0].slice(), winTile: t.s.drawn[0]!, ura: [] })).toThrow(/裏ドラ表示牌の枚数/);

    const plain = setup('123m456p789s1z1z1z2z', '2z').t;
    const tile = plain.s.drawn[0]!;
    expect(() => plain.push({ type: 'tsumo', seat: 0, hand: plain.s.hands[0].slice(), winTile: tile, ura: [5] })).toThrow(/裏ドラ表示牌の枚数/);
  });

  it('一発が「なし」のルールでは一発が付かない', () => {
    const { t } = riichiThenDraw();
    const rules = GENERAL_RULES.family === 'jp' ? { family: 'jp' as const, values: { ...GENERAL_RULES.values, ippatsu: 'off' } } : GENERAL_RULES;
    const s = { ...t.s, rules };
    const after = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'tsumo', seat: 0, hand: s.hands[0].slice(), winTile: s.drawn[0]!, ura: [100] } });
    if (after.result?.type !== 'tsumo') throw new Error('ツモアガリのはず');
    expect(after.result.score.yaku.map((y) => y.id)).not.toContain('ippatsu');
  });
});
