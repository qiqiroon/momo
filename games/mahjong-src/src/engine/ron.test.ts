// 切られた牌への返事（見送る・ロン）の検査。配る牌を指定した局面を出来事の列で組む（段階3の 1）。
import type { Envelope, GameEvent, Seat } from './events';
import { act, canRon, legalActions } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, viewFor, type GameState } from './state';
import type { TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;

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

const withRule = (key: string, value: string): Rules => {
  if (GENERAL_RULES.family !== 'jp') throw new Error('日本式のはず');
  return { family: 'jp', values: { ...GENERAL_RULES.values, [key]: value } };
};

class Table {
  s: GameState = initialState();
  log: Envelope[] = [];
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    const env = { seq: this.s.nextSeq, to, ev };
    this.s = apply(this.s, env);
    this.log.push(env);
  }
  /** 席の返事を、進行役と同じ道（act）で出す */
  reply(seat: Seat, type: 'pass' | 'ron') {
    for (const e of act(this.s, seat, { type })) {
      this.s = apply(this.s, e);
      this.log.push(e);
    }
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
  // 山の並びは種から作らない（配る牌を指定したため）。act の ron は進行役の確認に山を要るので、空の山を置く（裏ドラはリーチしたときだけ使う）
  t.s = { ...t.s, wall: [] };
  return { t, d, tile };
}

const DEALER = '1m1m1m9m9m9m1p1p1p9p9p9p1z';
const QUIET2 = '2z2z3z3z4z4z6z6z1s1s9s9s7z';
const QUIET3 = '1m2m7m7m8p8p3s3s5z5z6z1z9m';
/** 2p・5s のシャンポン待ち。タンヤオ */
const TANYAO = '2m3m4m4p5p6p6s7s8s2p2p5s5s';

describe('切られた牌への返事', () => {
  it('切った直後は返事待ち。全員見送ると次の人のツモへ', () => {
    // 5z は誰の待ちでもない（QUIET2 は七対子の 7z 単騎）
    const { t } = setup([DEALER, QUIET2, QUIET3, '2m3m4m4p5p6p6s7s8s2p2p3z3z'], '5z');
    expect(t.s.phase).toBe('claim');
    expect(legalActions(t.s, 0)).toEqual([]); // 切った本人は返事しない
    for (const seat of [1, 2, 3] as const) {
      // ロンは無い（ポン・チーできる人はいてもよい）。見送りは必ず選べる
      const types = legalActions(t.s, seat).map((a) => a.type);
      expect(types).not.toContain('ron');
      expect(types).toContain('pass');
      t.reply(seat, 'pass');
    }
    expect(t.s.phase).toBe('draw');
    expect(t.s.turn).toBe(1);
    expect(t.s.claim).toBeNull();
  });

  it('同じ席が 2 回返事をすると止める', () => {
    const { t } = setup([DEALER, QUIET2, QUIET3, '2m3m4m4p5p6p6s7s8s2p2p3z3z'], '7z');
    t.reply(1, 'pass');
    expect(() => t.push({ type: 'pass', seat: 1 })).toThrow(/もう返事をした/);
    expect(() => t.push({ type: 'pass', seat: 0 })).toThrow(/切った本人/);
  });
});

describe('ロン', () => {
  it('待ち牌が切られたらロンできる。子の 40 符 1 翻（タンヤオ）は 1300 点を切った人から', () => {
    const { t } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    expect(canRon(t.s, 1)).toBe(true);
    const types = legalActions(t.s, 1).map((a) => a.type);
    expect(types[0]).toBe('ron');
    expect(types[types.length - 1]).toBe('pass');
    t.reply(1, 'ron');
    expect(t.s.phase).toBe('claim'); // ほかの 2 人の返事がまだ
    t.reply(2, 'pass');
    t.reply(3, 'pass');
    const r = t.s.result;
    if (r?.type !== 'ron') throw new Error('ロンのはず');
    expect(r.from).toBe(0);
    expect(r.wins.map((w) => w.seat)).toEqual([1]);
    const score = r.wins[0].score;
    expect(score.yaku.map((y) => y.id)).toEqual(['tanyao']);
    expect([score.fu, score.han]).toEqual([40, 1]);
    expect(score.payment).toEqual({ type: 'ron', amount: 1300 });
  });

  it('ロンと言った人の手牌は全員に見える。結果はどの席から見ても同じ', () => {
    const { t } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    t.reply(1, 'ron');
    t.reply(2, 'pass');
    t.reply(3, 'pass');
    const views = ([0, 1, 2, 3] as const).map((seat) => viewFor(t.log, seat));
    for (const v of views) {
      expect(v.hands[1]).toEqual(t.s.hands[1]);
      expect(JSON.stringify(v.result)).toBe(JSON.stringify(t.s.result));
    }
  });

  it('役が無ければロンできない（見送るだけ）', () => {
    // 789s と 9m 入り＝タンヤオなし・門前のロンで役なし
    const { t } = setup([DEALER, '2m3m4m4p5p6p7s8s9s7m7m5s5s', QUIET2, QUIET3], '5s');
    expect(canRon(t.s, 1)).toBe(false);
    expect(legalActions(t.s, 1).map((a) => a.type)).not.toContain('ron');
    expect(() => act(t.s, 1, { type: 'ron' })).toThrow(/ロンできない/);
  });

  it('最後の捨て牌なら河底撈魚が付いて、役の無い手でもロンできる', () => {
    const { t } = setup([DEALER, '2m3m4m4p5p6p7s8s9s7m7m5s5s', QUIET2, QUIET3], '5s');
    t.s = { ...t.s, wallLeft: 14 }; // 山を尽きさせる（ツモれる牌 0）
    expect(canRon(t.s, 1)).toBe(true);
    t.reply(1, 'ron');
    t.reply(2, 'pass');
    t.reply(3, 'pass');
    if (t.s.result?.type !== 'ron') throw new Error('ロンのはず');
    expect(t.s.result.wins[0].score.yaku.map((y) => y.id)).toEqual(['houtei']);
  });
});

describe('ロンとフリテン', () => {
  it('自分の河に待ち牌があればロンできない。ロンの出来事が来ても止める', () => {
    const { t } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    // 席 1 の河に 2p（シャンポンのもう一方の待ち）があることにする（背番号 40＝2p の 1 枚目）
    t.s = { ...t.s, discards: [t.s.discards[0], [10 * 4 + 0], t.s.discards[2], t.s.discards[3]] };
    expect(canRon(t.s, 1)).toBe(false);
    expect(() => t.push({ type: 'ron', seat: 1, hand: t.s.hands[1].slice(), ura: [] })).toThrow(/フリテン/);
  });

  it('待ち牌を見送ると同じ巡のあいだフリテン。自分が切ると解ける', () => {
    const { t, d } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    t.reply(1, 'pass');
    expect(t.s.missedTurn[1]).toBe(true);
    expect(t.s.missedRiichi[1]).toBe(false);
    t.reply(2, 'pass');
    t.reply(3, 'pass');
    // 席 1 がツモって切ると解ける
    const tile = d('7z')[0];
    t.push({ type: 'draw', seat: 1, tile }, [1]);
    expect(t.s.missedTurn[1]).toBe(true);
    t.push({ type: 'discard', seat: 1, tile, tsumogiri: true });
    expect(t.s.missedTurn[1]).toBe(false);
  });

  it('見逃しのフリテンは、同じ巡のうちにほかの人が切った待ち牌でもロンできない', () => {
    const { t } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    t.reply(1, 'pass');
    expect(t.s.missedTurn[1]).toBe(true);
    // 同じ巡（席 1 が次に切る前）にもう一度待ち牌が出て、席 1 に返事が回ってきたとする
    expect(canRon({ ...t.s, claim: { ...t.s.claim!, replies: ['self', null, null, null] } }, 1)).toBe(false);
  });

  it('リーチのあとに見送ると、局の終わりまでフリテン（自分が切っても解けない）', () => {
    const { t, d } = setup([DEALER, TANYAO, QUIET2, QUIET3], '5s');
    t.s = { ...t.s, riichi: ['none', 'riichi', 'none', 'none'], riichiAt: [null, 0, null, null], discards: [t.s.discards[0], [d('7z')[0]], [], []] };
    t.reply(1, 'pass');
    expect(t.s.missedRiichi[1]).toBe(true);
    expect(canRon({ ...t.s, missedTurn: [false, false, false, false], claim: { ...t.s.claim!, replies: ['self', null, null, null] } }, 1)).toBe(false);
  });
});

describe('同じ牌で 2 人以上がロン', () => {
  // 3 人とも 5s 単騎（タンヤオ）。5s は 3 人の手に 1 枚ずつ＋切られる 1 枚
  const W1 = '2m3m4m3p4p5p6s7s8s4m5m6m5s';
  const W2 = '2p3p4p6m7m8m6p7p8p3s3s3s5s';
  const W3 = '4p5p6p2m2m2m7s7s7s8p8p8p5s';

  function ronAll(rules: Rules, seats: Seat[], hands: [string, string, string, string]) {
    const { t } = setup(hands, '5s', rules);
    for (const seat of [1, 2, 3] as const) t.reply(seat, seats.includes(seat) ? 'ron' : 'pass');
    return t.s;
  }

  it('2 人：ダブロン（一般ルール）なら 2 人ともアガる。並びは切った人の下家から', () => {
    const s = ronAll(GENERAL_RULES, [2, 3], [DEALER, QUIET2, W2, W3]);
    if (s.result?.type !== 'ron') throw new Error('ロンのはず');
    expect(s.result.wins.map((w) => w.seat)).toEqual([2, 3]);
  });

  it('2 人：頭ハネなら、切った人の下家に近い 1 人だけ', () => {
    const s = ronAll(withRule('double', 'atama'), [2, 3], [DEALER, QUIET2, W2, W3]);
    if (s.result?.type !== 'ron') throw new Error('ロンのはず');
    expect(s.result.wins.map((w) => w.seat)).toEqual([2]);
  });

  it('3 人：流局（一般ルール）／3 人ともアガリ／頭ハネ', () => {
    const hands: [string, string, string, string] = [DEALER, W1, W2, W3];
    const a = ronAll(GENERAL_RULES, [1, 2, 3], hands);
    expect(a.result).toEqual({ type: 'tripleRon', from: 0, seats: [1, 2, 3] });
    expect(a.phase).toBe('ended');
    const b = ronAll(withRule('triple', 'all'), [1, 2, 3], hands);
    if (b.result?.type !== 'ron') throw new Error('ロンのはず');
    expect(b.result.wins.map((w) => w.seat)).toEqual([1, 2, 3]);
    const c = ronAll(withRule('triple', 'atama'), [1, 2, 3], hands);
    if (c.result?.type !== 'ron') throw new Error('ロンのはず');
    expect(c.result.wins.map((w) => w.seat)).toEqual([1]);
  });
});
