// 点棒の動きの検査（段階4の 1）。持ち点・リーチ棒（供託）・本場・アガリと流局の支払い・流し満貫・責任払い（包）。
// 点数は手で計算した値と突き合わせる。
import type { Envelope, GameEvent, Seat } from './events';
import { act, callOptions, canRon, legalActions, riichiTiles, type Action } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, nagashiSeats, type GameState } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

/** 背番号を配る係（同じ種類は 4 枚目から使う）。fill は使っていない種類から数合わせの牌を出す */
function dealer() {
  const used = new Map<number, number>();
  const take = (s: string): TileId[] => {
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
  const fill = (n: number, avoid: readonly number[]): TileId[] => {
    const out: TileId[] = [];
    const order = Array.from({ length: 34 }, (_, i) => (i * 7) % 34);
    for (let pass = 0; pass < 3 && out.length < n; pass++) {
      for (const kind of order) {
        if (out.length >= n) break;
        const u = used.get(kind) ?? 0;
        if (avoid.includes(kind) || u >= 2) continue;
        used.set(kind, u + 1);
        out.push(kind * 4 + 3 - u);
      }
    }
    return out;
  };
  return Object.assign(take, { fill });
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
  /** 番の人が tile をツモって、そのまま切る */
  drawDiscard(tile: string): TileId {
    const t = this.draw(tile);
    this.do(this.s.turn, { type: 'discard', tile: t });
    return t;
  }
}

/** 配って、ドラ表示牌（8s）をめくったところ（親＝席 0 がツモる前）。null の席は数合わせ。honba＝本場 */
function setup(hands: (string | null)[], opts: { rules?: Rules; honba?: number; reserve?: string } = {}) {
  const t = new Table();
  t.push({ type: 'gameStart', rules: opts.rules ?? GENERAL_RULES });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0, honba: opts.honba ?? 0 });
  const named = hands.map((h) => (h === null ? null : t.d(h)));
  t.d(opts.reserve ?? '');
  const ind = t.d('8s');
  const avoid = [...new Set(named.flatMap((h) => (h ?? []).map(kindOf))), k('9s')];
  named.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: h ?? t.d.fill(13, avoid) }, [seat as Seat]));
  t.push({ type: 'doraReveal', tile: ind[0] });
  t.s = { ...t.s, wall: [] };
  return t;
}

/** 卓に前の局のリーチ棒が n 本ある局面にする（席 3 が出したことにする＝点の合計は変わらない） */
const withKyotaku = (s: GameState, n: number): GameState => ({ ...s, kyotaku: n, scores: s.scores.map((p, i) => (i === 3 ? p - 1000 * n : p)) });

const DEALER = '1m1m1m9m9m9m1s1s1s9s9s3s3s';
/** 2p・5s のシャンポン待ち。タンヤオ（子のロン 40 符 1 翻＝1300） */
const TANYAO = '2m3m4m4p5p6p6s7s8s2p2p5s5s';

describe('持ち点', () => {
  it('対局の始まりは全員ルールの持ち点（一般ルール 25000）', () => {
    const t = setup([DEALER, TANYAO, null, null]);
    expect(t.s.scores).toEqual([25000, 25000, 25000, 25000]);
    const t30 = setup([DEALER, TANYAO, null, null], { rules: rulesWith({ start: '30' }) });
    expect(t30.s.scores).toEqual([30000, 30000, 30000, 30000]);
  });
});

describe('ロンの支払い', () => {
  it('1300 のロン＋2 本場（600）＋供託 1 本（1000）は、切った人が 1900 払い、アガった人が 2900 受け取る', () => {
    const t = setup([DEALER, TANYAO, null, null], { honba: 2 });
    t.s = withKyotaku(t.s, 1);
    t.drawDiscard('5s');
    t.do(1, { type: 'ron' });
    t.passAll();
    expect(t.s.settlement).toEqual([-1900, 2900, 0, 0]);
    expect(t.s.scores).toEqual([23100, 27900, 25000, 24000]);
    expect(t.s.kyotaku).toBe(0);
  });

  it('本場「なし」のルールなら本場の点は動かない', () => {
    const t = setup([DEALER, TANYAO, null, null], { honba: 2, rules: rulesWith({ honba: 'off' }) });
    t.drawDiscard('5s');
    t.do(1, { type: 'ron' });
    t.passAll();
    expect(t.s.settlement).toEqual([-1300, 1300, 0, 0]);
  });

  it('縛り「5本場から2翻」：5 本場では 1 翻のタンヤオでロンできない（4 本場ならできる）', () => {
    const five = setup([DEALER, TANYAO, null, null], { honba: 5, rules: rulesWith({ shibari: '5h2' }) });
    five.drawDiscard('5s');
    expect(canRon(five.s, 1)).toBe(false);
    const four = setup([DEALER, TANYAO, null, null], { honba: 4, rules: rulesWith({ shibari: '5h2' }) });
    four.drawDiscard('5s');
    expect(canRon(four.s, 1)).toBe(true);
  });
});

describe('ツモの支払い', () => {
  it('親の 30 符 2 翻ツモ（1000 オール）＋1 本場＋供託 2 本：子は 1100 ずつ払い、親は 3300＋2000 を受け取る', () => {
    const t = setup([TANYAO, null, null, null], { honba: 1 });
    // 配牌のままのツモは天和になるので、それまでに鳴きがあった局面にする（門前は崩れない）
    t.s = { ...withKyotaku(t.s, 2), anyCall: true };
    t.draw('5s');
    t.do(0, { type: 'tsumo' });
    const r = t.s.result;
    if (r?.type !== 'tsumo') throw new Error('ツモのはず');
    expect([r.score.fu, r.score.han]).toEqual([30, 2]);
    expect(t.s.settlement).toEqual([5300, -1100, -1100, -1100]);
    expect(t.s.scores.reduce((a, b) => a + b, 0) + t.s.kyotaku * 1000).toBe(100000);
  });
});

describe('リーチ棒', () => {
  // 席 0 は 1z・2z のシャンポン待ち。3z をツモってリーチ
  const RIICHI = '1m2m3m4p5p6p7s8s9s1z1z2z2z';
  // 席 1 は 3z 単騎の七対子
  const CHIITOI = '1p1p2p2p3p3p4s4s5s5s6s6s3z';

  it('宣言牌が通ったら 1000 点を卓に出す（供託）', () => {
    const t = setup([RIICHI, null, null, null]);
    const tile = t.draw('3z');
    t.do(0, { type: 'riichi', tile });
    expect(t.s.kyotaku).toBe(0); // 返事を待っている間はまだ
    t.passAll();
    expect(t.s.kyotaku).toBe(1);
    expect(t.s.scores[0]).toBe(24000);
    expect(t.s.riichiStick[0]).toBe(true);
  });

  it('宣言牌でロンされたらリーチ棒は出さない', () => {
    const t = setup([RIICHI, CHIITOI, null, null]);
    const tile = t.draw('3z');
    t.do(0, { type: 'riichi', tile });
    t.do(1, { type: 'ron' });
    t.passAll();
    expect(t.s.riichiStick[0]).toBe(false);
    expect(t.s.kyotaku).toBe(0);
    const r = t.s.result;
    if (r?.type !== 'ron') throw new Error('ロンのはず');
    expect(t.s.settlement).toEqual([-r.wins[0].score.total, r.wins[0].score.total, 0, 0]);
  });

  it('1000 点未満のリーチ：一般ルール（できない）はリーチできない。「できる」ならできる', () => {
    const t = setup([RIICHI, null, null, null]);
    t.s = { ...t.s, scores: [900, 25000, 25000, 25000 + 24100] };
    t.draw('3z');
    expect(riichiTiles(t.s, 0)).toEqual([]);
    expect(riichiTiles({ ...t.s, rules: rulesWith({ riichiUnder: 'ok' }) }, 0).length).toBeGreaterThan(0);
  });
});

describe('2 人以上がアガったときの本場と供託', () => {
  // 席 2・席 3 が 5s 単騎（タンヤオ）
  const W2 = '2p3p4p6m7m8m6p7p8p3s3s3s5s';
  const W3 = '4p5p6p2m2m2m7s7s7s8p8p8p5s';
  const HANDS = [DEALER.replace('3s3s', '1z1z'), null, W2, W3];

  function doubleRon(rules: Rules) {
    const t = setup(HANDS, { honba: 1, rules, reserve: '5s' });
    // 前の局のリーチ棒 1 本＋この局で席 3 が出したリーチ棒 1 本
    t.s = { ...withKyotaku(t.s, 2), riichiStick: [false, false, false, true], riichi: ['none', 'none', 'none', 'riichi'], riichiAt: [null, null, null, 0] };
    // リーチした席 3 のロンは裏ドラ表示牌をめくる＝山が要る（中身はどれでもよい）
    t.s = { ...t.s, wall: new Array<TileId>(136).fill(k('8m') * 4) };
    t.drawDiscard('5s');
    t.do(2, { type: 'ron' });
    t.do(3, { type: 'ron' });
    t.passAll();
    const r = t.s.result;
    if (r?.type !== 'ron') throw new Error('ロンのはず');
    return { t, a: r.wins[0].score.total, b: r.wins[1].score.total };
  }

  it('一般ルール（上家取り）：本場も供託も、切った人から見て最初の人（席 2）だけ', () => {
    const { t, a, b } = doubleRon(GENERAL_RULES);
    expect(t.s.settlement).toEqual([-(a + 300 + b), 0, a + 300 + 2000, b]);
  });

  it('EMA の決め方：本場はアガった全員に。この局でリーチした席 3 は自分のリーチ棒を取り戻し、残りは最初の人', () => {
    const { t, a, b } = doubleRon(rulesWith({ multiWinSticks: 'each' }));
    expect(t.s.settlement).toEqual([-(a + 300 + b + 300), 0, a + 300 + 1000, b + 300 + 1000]);
  });
});

describe('流し満貫', () => {
  /** 流局して宣言する局面（河は指定）。全員ノーテンと言える手にする */
  function exhaustWith(discards: string[], dealerSeat: Seat = 0) {
    const t = setup([null, null, null, null]);
    const rivers = discards.map((x) => t.d(x));
    t.s = { ...t.s, phase: 'declare', turn: dealerSeat, dealer: dealerSeat, discards: rivers, drawn: [null, null, null, null], wallLeft: 14 };
    while (t.s.phase === 'declare') {
      const opts = legalActions(t.s, t.s.turn);
      t.do(t.s.turn, opts.find((a) => a.type === 'noten') ?? opts[0]);
    }
    return t;
  }

  it('河が全部么九牌で鳴かれていなければ成り立つ。親なら 4000 オール（テンパイ料の代わり）', () => {
    const t = exhaustWith(['1m9m1z2z', '2m3m', '4p5p', '6s7s']);
    expect(nagashiSeats(t.s)).toEqual([0]);
    const r = t.s.result;
    expect(r?.type === 'exhaust' && r.nagashi).toEqual([0]);
    expect(t.s.settlement).toEqual([12000, -4000, -4000, -4000]);
  });

  it('子なら親 4000・子 2000。鳴かれていたら成り立たない。「なし」のルールなら成り立たない', () => {
    const t = exhaustWith(['2m3m', '1p9p7z', '4p5p', '6s7s']);
    expect(t.s.settlement).toEqual([-4000, 8000, -2000, -2000]);
    const called = setup([null, null, null, null]);
    called.s = { ...called.s, discards: [called.d('2m'), called.d('1p9p'), [], []], calledAway: [[], [0], [], []] };
    expect(nagashiSeats(called.s)).toEqual([]);
    const off = setup([null, null, null, null], { rules: rulesWith({ nagashi: 'off' }) });
    off.s = { ...off.s, discards: [off.d('1m'), [], [], []] };
    expect(nagashiSeats(off.s)).toEqual([]);
  });
});

describe('責任払い（包）', () => {
  // 席 1 は白（席 2 から）・發（席 3 から）をポン済みで、中を 2 枚。席 0 が切った中をポンすると、大三元の包は席 0
  // （包は 3 つ目が鳴きで確定したときだけ。前の 2 つも鳴いて見えている）
  const DSG = '7z7z2m3m4m9p1s';

  /** 席 0 の中を席 1 がポンし、1 枚切る（DSG なら 1s を切って 9p 単騎の大三元テンパイ） */
  function ponChun(rules: Rules = GENERAL_RULES, hand = DSG, out = '1s', honba = 0) {
    const t = setup([DEALER, hand, null, null], { rules, honba, reserve: '9p9p2z' });
    const melds = t.s.melds.map((m) => m.slice());
    const haku = t.d('5z5z5z');
    const hatsu = t.d('6z6z6z');
    melds[1] = [
      { type: 'pon', tiles: haku, called: haku[0], from: 2 },
      { type: 'pon', tiles: hatsu, called: hatsu[0], from: 3 },
    ];
    t.s = { ...t.s, melds, anyCall: true };
    t.drawDiscard('7z');
    t.do(1, callOptions(t.s, 1).find((a) => a.type === 'pon')!);
    t.passAll();
    t.do(1, { type: 'discard', tile: t.s.hands[1].find((x) => kindOf(x) === k(out))! });
    t.passAll();
    return t;
  }

  it('三元牌の 3 つ目を鳴かせた人が包になる', () => {
    const t = ponChun();
    expect(t.s.pao[1]).toEqual({ seat: 0, yaku: 'daisangen' });
  });

  it('ほかの人（席 2）からロン：役満 32000 を包の人と切った人で折半。本場は一般ルールでは包の人', () => {
    const t = ponChun(GENERAL_RULES, DSG, '1s', 1);
    t.drawDiscard('9p');
    t.do(1, { type: 'ron' });
    t.passAll();
    expect(t.s.settlement).toEqual([-16300, 32300, -16000, 0]);
  });

  it('包のときの積み棒が「放銃者」なら、本場は切った人', () => {
    const t = ponChun(rulesWith({ paoHonba: 'houju' }), DSG, '1s', 1);
    t.drawDiscard('9p');
    t.do(1, { type: 'ron' });
    t.passAll();
    expect(t.s.settlement).toEqual([-16000, 32300, -16300, 0]);
  });

  it('ツモなら包の人が全額（本場も）', () => {
    const t = ponChun(GENERAL_RULES, DSG, '1s', 1);
    t.drawDiscard('1z');
    t.passAll();
    t.drawDiscard('3z');
    t.passAll();
    t.drawDiscard('4z');
    t.passAll();
    t.draw('9p');
    t.do(1, { type: 'tsumo' });
    expect(t.s.settlement).toEqual([-32300, 32300, 0, 0]);
  });

  it('大三元＋字一色（2 倍役満）：「その役満分だけ包」なら包の人は半分の半分、「全額を包」なら折半', () => {
    // 白・發・中＋東の刻子＋南の単騎（すべて字牌）
    const HONORS = '7z7z1z1z1z2z4z';
    const part = ponChun(GENERAL_RULES, HONORS, '4z');
    part.drawDiscard('2z');
    part.do(1, { type: 'ron' });
    part.passAll();
    // 64000 のうち大三元の 32000 を折半（16000 ずつ）、残りの 32000 は切った人
    expect(part.s.settlement).toEqual([-16000, 64000, -48000, 0]);
    const all = ponChun(rulesWith({ paoMix: 'all' }), HONORS, '4z');
    all.drawDiscard('2z');
    all.do(1, { type: 'ron' });
    all.passAll();
    expect(all.s.settlement).toEqual([-32000, 64000, -32000, 0]);
  });

  it('包「なし」のルールなら包は決まらない', () => {
    const t = ponChun(rulesWith({ pao: 'none' }));
    expect(t.s.pao[1]).toBeNull();
  });
});
