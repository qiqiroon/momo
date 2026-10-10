// 喰い替え禁止・途中流局・形式テンパイの検査（段階3の 5）。
import type { Envelope, GameEvent, Seat } from './events';
import { act, callOptions, legalActions, type Action } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, kuikaeKinds, tenpaiForDeclare, type GameState, type OpenMeld } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

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

const rulesWith = (values: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...values } } : GENERAL_RULES;

class Table {
  s: GameState = initialState();
  readonly d = dealer();
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    this.s = apply(this.s, { seq: this.s.nextSeq, to, ev });
  }
  do(seat: Seat, a: Action) {
    for (const e of act(this.s, seat, a)) this.s = apply(this.s, e);
  }
  passAll() {
    for (const seat of [0, 1, 2, 3] as Seat[]) if (this.s.phase === 'claim' && this.s.claim?.replies[seat] === null) this.do(seat, { type: 'pass' });
  }
  draw(tile: string): TileId {
    const t = this.d(tile)[0];
    this.push({ type: 'draw', seat: this.s.turn, tile: t }, [this.s.turn]);
    return t;
  }
  /** 番の人が tile をツモって、そのまま切る（ほかの人は見送る） */
  cycle(tile: string) {
    const t = this.draw(tile);
    this.do(this.s.turn, { type: 'discard', tile: t });
    this.passAll();
  }
}

function setup(hands: [string, string, string, string], rules: Rules = GENERAL_RULES) {
  const t = new Table();
  t.push({ type: 'gameStart', rules });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  hands.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: t.d(h) }, [seat as Seat]));
  t.push({ type: 'doraReveal', tile: t.d('9p')[0] });
  t.s = { ...t.s, wall: [] };
  return t;
}

// どの席も、ほかの人の邪魔をしない手（数牌がばらばら）
const A = '1m4m7m2p5p8p3s6s9s1z2z3z5z';
const B = '2m5m8m3p6p9p1s4s7s6z7z5z5z';
const C = '3m6m9m1p4p7p2s5s8s6z7z2z3z';
const D = '1m4m7m2p5p8p3s6s9s1s4s7s6z';

describe('喰い替え禁止', () => {
  it('切れない牌の種類：ポンはその牌、チーは鳴いた牌と両面の反対側（筋）', () => {
    const d = dealer();
    const [m2, m3, m4] = d('2m3m4m');
    expect(kuikaeKinds('pon', m2, [])).toEqual([k('2m')]);
    expect(kuikaeKinds('chi', m2, [m3, m4]).sort()).toEqual([k('2m'), k('5m')]);
    const [p7, p8, p9] = d('7p8p9p');
    expect(kuikaeKinds('chi', p9, [p7, p8]).sort()).toEqual([k('6p'), k('9p')]);
    const [s2, s3, s4] = d('2s3s4s');
    // カンチャン（2s4s で 3s）は筋が無い
    expect(kuikaeKinds('chi', s3, [s2, s4])).toEqual([k('3s')]);
    const [z1, z2, z3] = d('1s2s3s');
    // 1s2s で 3s をチー：反対側は 0s で無い
    expect(kuikaeKinds('chi', z3, [z1, z2])).toEqual([k('3s')]);
  });

  function chiOf2m(rules: Rules) {
    // 席 1 が 3m4m で 2m をチー。手に 2m と 5m がある
    const t = setup(['1z1z1z9m9m9m1s1s1s9s9s9s7z', '3m4m2m5m6p7p8p2s3s4s7s7s8s', B.replace('2m5m', '6z6z'), C.replace('3m6m', '4z4z')], rules);
    const tile = t.draw('2m');
    t.do(0, { type: 'discard', tile });
    const chi = callOptions(t.s, 1).find((a) => a.type === 'chi' && a.tiles.every((x) => kindOf(x) === k('3m') || kindOf(x) === k('4m')))!;
    t.do(1, chi);
    t.passAll();
    return t;
  }

  it('一般ルール（禁止）：チーした直後は 2m・5m を切れない。切ろうとすると止める', () => {
    const t = chiOf2m(GENERAL_RULES);
    expect(t.s.turn).toBe(1);
    const tiles = legalActions(t.s, 1).flatMap((a) => (a.type === 'discard' ? [kindOf(a.tile)] : []));
    expect(tiles).not.toContain(k('2m'));
    expect(tiles).not.toContain(k('5m'));
    expect(tiles).toContain(k('6p'));
    const m2 = t.s.hands[1].find((x) => kindOf(x) === k('2m'))!;
    expect(() => act(t.s, 1, { type: 'discard', tile: m2 })).toThrow();
    // 切ったら解ける
    t.do(1, { type: 'discard', tile: t.s.hands[1].find((x) => kindOf(x) === k('6p'))! });
    expect(t.s.kuikaeBan).toEqual([]);
  });

  it('「許す」なら切れる', () => {
    const t = chiOf2m(rulesWith({ kuikae: 'ok' }));
    const tiles = legalActions(t.s, 1).flatMap((a) => (a.type === 'discard' ? [kindOf(a.tile)] : []));
    expect(tiles).toContain(k('2m'));
    expect(tiles).toContain(k('5m'));
  });

  it('鳴いたあと切れる牌が 1 枚も無いなら鳴けない', () => {
    const t = setup([A, '3m4m2m5m6p7p8p2s3s4s7s7s8s', B.replace('2m5m', '6z6z'), C.replace('3m6m', '4z4z')]);
    const tile = t.draw('2m');
    t.do(0, { type: 'discard', tile });
    // 席 1 の手牌を 3m4m・2m・5m の 4 枚だけにする（3 組鳴いたあとの形）
    const hand = t.s.hands[1].filter((x) => [k('2m'), k('3m'), k('4m'), k('5m')].includes(kindOf(x)));
    t.s = { ...t.s, hands: t.s.hands.map((h, i) => (i === 1 ? hand : h)) };
    expect(callOptions(t.s, 1).filter((a) => a.type === 'chi')).toEqual([]);
    expect(callOptions({ ...t.s, rules: rulesWith({ kuikae: 'ok' }) }, 1).filter((a) => a.type === 'chi')).not.toEqual([]);
  });
});

describe('九種九牌', () => {
  const NINE = '1m9m1p9p1s9s1z2z3z5m5m6p6p';
  it('最初のツモで么九牌 9 種類以上なら流せる（本人が選ぶ）。流すと手牌を開けて途中流局', () => {
    const t = setup([NINE, B, C.replace('2z3z', '4z4z'), D]);
    t.draw('8s');
    expect(legalActions(t.s, 0).map((a) => a.type)).toContain('kyushu');
    expect(legalActions(t.s, 0).map((a) => a.type)).toContain('discard');
    t.do(0, { type: 'kyushu' });
    expect(t.s.result).toEqual({ type: 'abort', reason: 'kyushu', seat: 0 });
    expect(t.s.opened[0]).toBe(true);
  });

  it('8 種類なら流せない／「必ず流す」なら流すしかない／「なし」なら流せない', () => {
    const eight = setup(['1m9m1p9p1s9s1z2z5m5m6p6p7p', B, C, D]);
    eight.draw('8s');
    expect(legalActions(eight.s, 0).map((a) => a.type)).not.toContain('kyushu');

    const force = setup([NINE, B, C.replace('2z3z', '4z4z'), D], rulesWith({ kyushuHow: 'must' }));
    force.draw('8s');
    expect(legalActions(force.s, 0)).toEqual([{ type: 'kyushu' }]);
    expect(() => act(force.s, 0, { type: 'discard', tile: force.s.drawn[0]! })).toThrow();

    const off = setup([NINE, B, C.replace('2z3z', '4z4z'), D], rulesWith({ kyushu: 'off' }));
    off.draw('8s');
    expect(legalActions(off.s, 0).map((a) => a.type)).not.toContain('kyushu');
  });

  it('2 回目のツモ・誰かが鳴いたあとは流せない', () => {
    const t = setup([A, B, C, NINE.replace('5m5m6p6p', '4m4m6p7p')]);
    t.cycle('8s');
    t.cycle('8s');
    t.cycle('8s');
    t.draw('8m');
    expect(legalActions(t.s, 3).map((a) => a.type)).toContain('kyushu');
    t.s = { ...t.s, anyCall: true };
    expect(legalActions(t.s, 3).map((a) => a.type)).not.toContain('kyushu');
  });
});

describe('四風連打', () => {
  it('鳴きが無いまま 4 人の最初の打牌が同じ風牌なら、4 枚目が通ったところで途中流局', () => {
    const t = setup([A.replace('1z', '8m'), B, C, D]);
    for (let i = 0; i < 3; i++) t.cycle('4z');
    expect(t.s.phase).toBe('draw');
    t.cycle('4z');
    expect(t.s.result).toEqual({ type: 'abort', reason: 'sufon' });
  });

  it('3 枚目までに違う牌が入る・「なし」のルールなら続く', () => {
    const t = setup([A.replace('1z', '8m'), B, C, D], rulesWith({ sufon: 'off' }));
    for (let i = 0; i < 4; i++) t.cycle('4z');
    expect(t.s.result).toBeNull();
    const t2 = setup([A, B, C, D]);
    t2.cycle('4z');
    t2.cycle('4z');
    t2.cycle('8m');
    t2.cycle('4z');
    expect(t2.s.result).toBeNull();
  });
});

describe('四家立直', () => {
  // 席 3 は 1m・4m 待ちのテンパイ形（2m3m＋…）。ほか 3 人はリーチしている局面にする
  const TENPAI = '2m3m5p6p7p2s3s4s6s7s8s9s9s';
  function threeRiichi(rules: Rules) {
    const t = setup([A, B, C, TENPAI], rules);
    t.cycle('8m');
    t.cycle('8m');
    t.cycle('8m');
    t.s = { ...t.s, riichi: ['riichi', 'riichi', 'riichi', 'none'], riichiAt: [0, 0, 0, null] };
    const tile = t.draw('5z');
    t.do(3, { type: 'riichi', tile });
    return t;
  }

  it('一般ルール（4 人目の宣言牌が通ったとき）：返事のあとで途中流局', () => {
    const t = threeRiichi(GENERAL_RULES);
    expect(t.s.phase).toBe('claim');
    t.passAll();
    expect(t.s.result).toEqual({ type: 'abort', reason: 'suricchi' });
  });

  it('「4 人目が宣言したとき」なら宣言した時点で流局（返事を待たない）', () => {
    const t = threeRiichi(rulesWith({ suricchiWhen: 'declare' }));
    expect(t.s.result).toEqual({ type: 'abort', reason: 'suricchi' });
  });

  it('「なし」なら続く', () => {
    const t = threeRiichi(rulesWith({ suricchi: 'off' }));
    t.passAll();
    expect(t.s.result).toBeNull();
    expect(t.s.phase).toBe('draw');
  });
});

describe('四開槓', () => {
  const ankan = (seat: Seat, kind: string, d: (s: string) => TileId[]): OpenMeld => ({ type: 'ankan', tiles: d(kind.repeat(4)), called: null, from: seat });

  function fourthKan(owners: Seat[], rules: Rules) {
    // 席 0 は 6m を 3 枚。9m・6p・6s は誰も持っていない（前の 3 回のカンに使う）
    const t = setup(
      ['6m6m6m1m2m3m1p2p3p1s2s3s4z', '5m5m5m7p8p9p7s8s9s2z2z3z3z', '4m5m4p5p4s5s5z5z6z6z7z7z1z', '2m3m4m2p3p4p2s3s4s1z2z3z5z'],
      rules,
    );
    // 前の 3 回のカンを局面に置く（持ち主は owners）
    const melds = t.s.melds.map((m) => m.slice());
    ['9m', '6p', '6s'].forEach((kind, i) => melds[owners[i]].push(ankan(owners[i], kind, t.d)));
    t.s = { ...t.s, melds, kans: 3, rinshanTaken: 3, doraIndicators: [...t.s.doraIndicators, ...t.d('1z2z3z')] };
    t.draw('6m');
    t.do(0, legalActions(t.s, 0).find((a) => a.type === 'kan')!);
    t.passAll(); // 国士無双の暗槓ロンの確認
    return t;
  }

  it('2 人以上で 4 回カンしたら、そのあとの打牌が通ったところで途中流局', () => {
    const t = fourthKan([1, 2, 1], GENERAL_RULES);
    expect(t.s.kans).toBe(4);
    t.push({ type: 'doraReveal', tile: t.d('2p')[0] });
    t.push({ type: 'draw', seat: 0, tile: t.d('3p')[0], rinshan: true }, [0]);
    t.do(0, { type: 'discard', tile: t.s.drawn[0]! });
    t.passAll();
    expect(t.s.result).toEqual({ type: 'abort', reason: 'sukan' });
  });

  it('1 人で 4 回なら続く（四槓子の見込み）。5 回目のカンはできない', () => {
    const t = fourthKan([0, 0, 0], GENERAL_RULES);
    t.push({ type: 'doraReveal', tile: t.d('2p')[0] });
    t.push({ type: 'draw', seat: 0, tile: t.d('3p')[0], rinshan: true }, [0]);
    t.do(0, { type: 'discard', tile: t.s.drawn[0]! });
    t.passAll();
    expect(t.s.result).toBeNull();
  });

  it('「なし」なら 2 人でも続く', () => {
    const t = fourthKan([1, 2, 1], rulesWith({ sukan: 'off' }));
    t.push({ type: 'doraReveal', tile: t.d('2p')[0] });
    t.push({ type: 'draw', seat: 0, tile: t.d('3p')[0], rinshan: true }, [0]);
    t.do(0, { type: 'discard', tile: t.s.drawn[0]! });
    t.passAll();
    expect(t.s.result).toBeNull();
  });
});

describe('形式テンパイ', () => {
  function openHand(rules: Rules, hand: string) {
    const d = dealer();
    let s = initialState();
    s = apply(s, { seq: 0, to: 'all', ev: { type: 'gameStart', rules } });
    s = apply(s, { seq: 1, to: 'all', ev: { type: 'roundStart', roundIndex: 0, dealer: 0 } });
    const pon: OpenMeld = { type: 'pon', tiles: d('2p2p2p'), called: 0, from: 1 };
    s = { ...s, melds: [[], [], [pon], []], anyCall: true };
    return { s, hand: d(hand) };
  }

  it('鳴いて役の無いテンパイ：「あり」（一般ルール）ならテンパイ、「なし」ならノーテン', () => {
    // 2p ポン＋3m4m 6m7m8m 2s3s4s 9p9p（2m・5m 待ち。9p があるのでタンヤオにならない＝役なし）
    const on = openHand(GENERAL_RULES, '3m4m6m7m8m2s3s4s9p9p');
    expect(tenpaiForDeclare(on.s, 2, on.hand)).toBe(true);
    const off = openHand(rulesWith({ keishiki: 'off' }), '3m4m6m7m8m2s3s4s9p9p');
    expect(tenpaiForDeclare(off.s, 2, off.hand)).toBe(false);
  });

  it('「なし」でも、役の付く待ちがあればテンパイ（タンヤオ）', () => {
    const off = openHand(rulesWith({ keishiki: 'off' }), '3m4m6m7m8m2s3s4s5p5p');
    expect(tenpaiForDeclare(off.s, 2, off.hand)).toBe(true);
  });
});
