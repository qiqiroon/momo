// カンの検査（段階3の 3）。暗槓・加槓・大明槓・嶺上牌・カンドラ・槍槓・リーチのあとの暗槓。
// 配る牌と王牌を指定した局面を出来事の列で組む（山の頭は使わない＝ツモは出来事を直接積む）。
import { doraIndicatorAt, uraIndicatorAt } from './dora';
import type { Envelope, GameEvent, Seat } from './events';
import { act, advance, callOptions, kanOptions, legalActions, type Action } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, riichiAnkanKeepsWait, type GameState } from './state';
import { kindOf, type TileId } from './tiles';

const BASE = { m: 0, p: 9, s: 18, z: 27 } as const;
const k = (s: string) => BASE[s[1] as 'm'] + Number(s[0]) - 1;

/** 背番号を配る係。同じ種類は 4 枚目→3 枚目…の順に使う（赤5＝1 枚目は最後に使う）。
 *  fill(n, avoid)＝1 枚は残して、種類を替えながら n 枚（ほかの人の邪魔をしない数合わせの手牌） */
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
        if (avoid.includes(kind) || u >= 3) continue;
        used.set(kind, u + 1);
        out.push(kind * 4 + 3 - u);
      }
    }
    if (out.length < n) throw new Error('数合わせの牌が足りない');
    return out;
  };
  return Object.assign(take, { fill });
}

const rulesWith = (values: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...values } } : GENERAL_RULES;

class Table {
  s: GameState = initialState();
  /** あとでツモる牌（配る前に取っておく） */
  reserve: TileId[] = [];
  constructor(readonly d: ReturnType<typeof dealer>) {}
  push(ev: GameEvent, to: Envelope['to'] = 'all') {
    this.s = apply(this.s, { seq: this.s.nextSeq, to, ev });
  }
  apply(envs: Envelope[]) {
    for (const e of envs) this.s = apply(this.s, e);
    return envs;
  }
  do(seat: Seat, a: Action) {
    return this.apply(act(this.s, seat, a));
  }
  /** 返事がまだの人は全員見送る */
  passAll() {
    for (const seat of [0, 1, 2, 3] as Seat[]) if (this.s.phase === 'claim' && this.s.claim?.replies[seat] === null) this.do(seat, { type: 'pass' });
  }
  /** 取っておいた牌（無ければ新しく）を 1 枚出す */
  next(tile: string): TileId {
    const i = this.reserve.findIndex((x) => kindOf(x) === k(tile));
    return i >= 0 ? this.reserve.splice(i, 1)[0] : this.d(tile)[0];
  }
  /** 番の人が tile をツモって、そのまま切る（ほかの人は見送る） */
  cycle(tile: string) {
    const seat = this.s.turn;
    const t = this.next(tile);
    this.push({ type: 'draw', seat, tile: t }, [seat]);
    this.do(seat, { type: 'discard', tile: t });
    this.passAll();
  }
  draw(tile: string): TileId {
    const t = this.next(tile);
    this.push({ type: 'draw', seat: this.s.turn, tile: t }, [this.s.turn]);
    return t;
  }
}

/**
 * 4 人に配り、王牌を置いた局面（親＝席 0 がツモる前）。dead＝王牌 14 枚（嶺上牌 4 枚・ドラ表示牌と裏ドラ表示牌 10 枚の順）。
 * 手牌が null の席は数合わせ（avoid の種類と、あとでツモる reserve の牌は使わない）
 */
function setup(hands: (string | null)[], dead: string, rules: Rules = GENERAL_RULES, reserve = '') {
  const d = dealer();
  const t = new Table(d);
  t.push({ type: 'gameStart', rules });
  t.push({ type: 'roundStart', roundIndex: 0, dealer: 0 });
  const named = hands.map((h) => (h === null ? null : d(h)));
  const deadTiles = d(dead);
  const spare = d(reserve);
  const avoid = [...new Set(named.flatMap((h) => (h ?? []).map(kindOf)))];
  named.forEach((h, seat) => t.push({ type: 'deal', seat: seat as Seat, tiles: h ?? d.fill(13, avoid) }, [seat as Seat]));
  t.reserve = spare;
  if (deadTiles.length !== 14) throw new Error('王牌は 14 枚');
  // 山の頭（ツモる側）は使わないので、数合わせの値を入れておく
  const wall = [...new Array<TileId>(136 - 14).fill(-2), ...deadTiles];
  t.s = { ...t.s, wall };
  t.push({ type: 'doraReveal', tile: doraIndicatorAt(wall, 0) });
  return t;
}

// 王牌：嶺上牌 4 枚（9s・8s・7s・6s）＋ドラ表示牌と裏ドラ表示牌（7z/7z, 6z/6z, 3z/3z, 2z/2z, 8p/8p）
const DEAD = '9s8s7s6s' + '7z7z' + '6z6z' + '3z3z' + '2z2z' + '8p8p';

describe('暗槓', () => {
  it('暗槓→（国士無双のロンの確認）→カンドラをすぐめくる→嶺上牌を引く→嶺上開花', () => {
    const t = setup(['1m1m1m2m3m4m5p6p7p2s3s4s9s', null, null, null], DEAD.replace('9s', '9s'));
    t.draw('1m');
    const kans = kanOptions(t.s, 0);
    expect(kans).toHaveLength(1);
    expect(kans[0].type === 'kan' && kans[0].kan).toBe('ankan');
    t.do(0, kans[0]);
    // 一般ルールは国士無双の暗槓ロンあり＝ほかの 3 人の返事を待つ（国士無双でないのでロンはできない）
    expect(t.s.phase).toBe('claim');
    expect(t.s.claim?.kind).toBe('ankan');
    expect(legalActions(t.s, 1)).toEqual([{ type: 'pass' }]);
    t.passAll();
    expect(t.s.phase).toBe('draw');
    expect(t.s.rinshanDue).toBe(true);
    const envs = advance(t.s);
    // 暗槓のカンドラはすぐ＝嶺上牌の前にめくる
    expect(envs.map((e) => e.ev.type)).toEqual(['doraReveal', 'draw']);
    t.apply(envs);
    expect(t.s.doraIndicators).toEqual([doraIndicatorAt(t.s.wall!, 0), doraIndicatorAt(t.s.wall!, 1)]);
    // 嶺上牌は王牌の頭の 1 枚目（9s）＝9s の単騎待ちが嶺上開花
    expect(kindOf(t.s.drawn[0]!)).toBe(k('9s'));
    expect(t.s.rinshanDraw).toBe(true);
    expect(t.s.melds[0][0].type).toBe('ankan');
    const tsumo = legalActions(t.s, 0).find((a) => a.type === 'tsumo');
    expect(tsumo).toBeDefined();
    t.do(0, tsumo!);
    const r = t.s.result;
    expect(r?.type).toBe('tsumo');
    if (r?.type !== 'tsumo') return;
    const ids = r.score.yaku.map((y) => y.id);
    expect(ids).toContain('rinshan');
    // 暗槓は鳴きではない＝門前のまま（門前ツモが付く）
    expect(ids).toContain('menzenTsumo');
  });

  it('国士無双は暗槓の牌でロンできる（ルールが「あり」のとき）。「なし」ならできない', () => {
    // 国士無双の 9m 待ち（9m だけ持っていない）。席 0 が 9m を暗槓する
    const kokushi = '1m1m1p9p1s9s1z2z3z4z5z6z7z';
    const t = setup(['9m9m9m2m3m4m5p6p7p2s3s4s8s', kokushi, null, null], DEAD);
    t.draw('9m');
    t.do(0, kanOptions(t.s, 0)[0]);
    expect(legalActions(t.s, 1).map((a) => a.type)).toContain('ron');
    // 国士無双でない人は、暗槓の牌ではロンできない
    expect(legalActions(t.s, 2).map((a) => a.type)).toEqual(['pass']);
    t.do(1, { type: 'ron' });
    t.passAll();
    const r = t.s.result;
    expect(r?.type === 'ron' && r.robbed).toBe('ankan');
    // 暗槓の牌へのロンは槍槓ではない（国士無双だけ）
    expect(r?.type === 'ron' && r.wins[0].score.yaku.map((y) => y.id)).toEqual(['kokushi']);

    const off = setup(['9m9m9m2m3m4m5p6p7p2s3s4s8s', kokushi, null, null], DEAD, rulesWith({ kokushiAnkan: 'off' }));
    off.draw('9m');
    off.do(0, kanOptions(off.s, 0)[0]);
    // 「なし」なら返事を待たずに嶺上牌へ
    expect(off.s.phase).toBe('draw');
    expect(off.s.rinshanDue).toBe(true);
  });

  it('5 回目のカンはできない', () => {
    const t = setup(['1m1m1m2m3m4m5p6p7p2s3s4s9s', null, null, null], DEAD);
    t.s = { ...t.s, kans: 4 };
    t.draw('1m');
    expect(kanOptions(t.s, 0)).toEqual([]);
  });
});

describe('大明槓とカンドラの時機', () => {
  // 席 0 が 5z を切る。席 2 が 5z を 3 枚持っている
  const S2 = '5z5z5z1m2m3m4p5p6p7s8s9s9m';
  const S2b = '5z5z5z1m2m3m4p5p6p7s8s7m9m'; // 9m 単騎でなく 7m9m のカンチャン（8m 待ち）


  it('大明槓は切られた牌への返事。鳴くと嶺上牌を引く', () => {
    const t = setup(['1m1m2m2m3m3m4m4m5m5m6m6m7m', null, S2, null], DEAD);
    const tile = t.draw('5z');
    t.do(0, { type: 'discard', tile });
    const opts = callOptions(t.s, 2);
    const kan = opts.find((a) => a.type === 'kan');
    expect(kan).toBeDefined();
    expect(opts.map((a) => a.type)).toContain('pon');
    t.do(2, kan!);
    t.passAll();
    expect(t.s.turn).toBe(2);
    expect(t.s.phase).toBe('draw');
    expect(t.s.melds[2][0]).toMatchObject({ type: 'minkan', from: 0, called: tile });
    expect(t.s.calledAway[0]).toEqual([0]);
  });

  function minkanThenRinshan(rules: Rules = GENERAL_RULES, s2 = S2) {
    const t = setup(['1m1m2m2m3m3m4m4m5m5m6m6m7m', null, s2, null], DEAD.replace('9s', '9m'), rules);
    const tile = t.draw('5z');
    t.do(0, { type: 'discard', tile });
    t.do(2, callOptions(t.s, 2).find((a) => a.type === 'kan')!);
    t.passAll();
    const envs = t.apply(advance(t.s));
    return { t, envs };
  }

  it('一般ルール（明槓は打牌のとき）：嶺上牌の前にはめくらず、打牌のときにめくる', () => {
    const { t, envs } = minkanThenRinshan(GENERAL_RULES, S2b);
    expect(envs.map((e) => e.ev.type)).toEqual(['draw']);
    expect(t.s.doraIndicators).toHaveLength(1);
    expect(t.s.pendingDora).toBe(1);
    const out = t.do(2, { type: 'discard', tile: t.s.drawn[2]! });
    expect(out.map((e) => e.ev.type)).toEqual(['discard', 'doraReveal']);
    expect(t.s.doraIndicators).toHaveLength(2);
    expect(t.s.pendingDora).toBe(0);
    // 打牌への返事を待っている間に、もうめくれている（この打牌へのロンにも乗る）
    expect(t.s.phase).toBe('claim');
  });

  it('一般ルール：明槓のあとの嶺上開花にはカンドラが乗らない（めくる前にアガる）', () => {
    const { t } = minkanThenRinshan();
    // 嶺上牌 9m で 9m 単騎がアガリ
    expect(kindOf(t.s.drawn[2]!)).toBe(k('9m'));
    const tsumo = legalActions(t.s, 2).find((a) => a.type === 'tsumo');
    expect(tsumo).toBeDefined();
    t.do(2, tsumo!);
    expect(t.s.doraIndicators).toHaveLength(1);
    const r = t.s.result;
    expect(r?.type === 'tsumo' && r.score.yaku.map((y) => y.id)).toContain('rinshan');
  });

  it('「どのカンもすぐ」なら、大明槓でも嶺上牌の前にめくる', () => {
    const { t, envs } = minkanThenRinshan(rulesWith({ kandoraWhen: 'now' }), S2b);
    expect(envs.map((e) => e.ev.type)).toEqual(['doraReveal', 'draw']);
    expect(t.s.doraIndicators).toHaveLength(2);
    const out = t.do(2, { type: 'discard', tile: t.s.drawn[2]! });
    expect(out.map((e) => e.ev.type)).toEqual(['discard']);
  });

  it('カンドラ「なし」ならカンしてもめくらない', () => {
    const { t, envs } = minkanThenRinshan(rulesWith({ kandora: 'off' }), S2b);
    expect(envs.map((e) => e.ev.type)).toEqual(['draw']);
    t.do(2, { type: 'discard', tile: t.s.drawn[2]! });
    expect(t.s.doraIndicators).toHaveLength(1);
  });

  it('明槓のカンドラをめくる前に続けて暗槓すると、前の分をめくってから嶺上牌を引く', () => {
    // 席 2：5z 3 枚で大明槓 → 嶺上牌 1z → 1z を 4 枚にして暗槓
    const t = setup(['1m1m2m2m3m3m4m4m5m5m6m6m7m', null, '5z5z5z1z1z1z4p5p6p7s8s9s9m', null], '1z' + '9s8s7s' + DEAD.slice(8));
    const tile = t.draw('5z');
    t.do(0, { type: 'discard', tile });
    t.do(2, callOptions(t.s, 2).find((a) => a.type === 'kan')!);
    t.passAll();
    t.apply(advance(t.s)); // 明槓の嶺上（めくらない）
    expect(t.s.pendingDora).toBe(1);
    const ankan = kanOptions(t.s, 2).find((a) => a.type === 'kan' && a.kan === 'ankan');
    expect(ankan).toBeDefined();
    t.do(2, ankan!);
    t.passAll();
    const envs = t.apply(advance(t.s));
    // 前の明槓の分＋暗槓の分＝2 枚めくってから嶺上牌
    expect(envs.map((e) => e.ev.type)).toEqual(['doraReveal', 'doraReveal', 'draw']);
    expect(t.s.doraIndicators).toHaveLength(3);
    expect(t.s.rinshanTaken).toBe(2);
    expect(kindOf(t.s.drawn[2]!)).toBe(k('9s'));
  });

  it('ロンはカンより先', () => {
    // 席 2 は 6p を 3 枚（大明槓できる）、席 3 は 7p8p で 6p・9p 待ち（タンヤオ）
    const s3 = '2m3m4m5m6m7m3s4s5s6s6s7p8p';
    const t = setup(['1m1m1m9m9m9m1s1s1s9s9s1z1z', null, '6p6p6p1z2m3m4m4s5s6s7s8s9s', s3], DEAD, GENERAL_RULES, '6p');
    const tile = t.draw('6p');
    t.do(0, { type: 'discard', tile });
    t.do(2, callOptions(t.s, 2).find((a) => a.type === 'kan')!);
    t.do(3, { type: 'ron' });
    t.passAll();
    expect(t.s.result?.type).toBe('ron');
    expect(t.s.melds[2]).toEqual([]);
  });
});

describe('加槓と槍槓', () => {
  // 席 1 が 2p をポンし、あとで 4 枚目の 2p を引いて加槓する。席 3 は 3p4p で 2p・5p 待ち
  const S0 = '1m1m1m9m9m9m1s1s1s9s9s9s1z';
  const S1 = '2p2p6p7p8p2s3s4s6m7m8m5z5z';
  const S3 = '3p4p1m2m3m4m5m6m6s7s8s4z4z';

  function ponThenKakan(rules: Rules = GENERAL_RULES) {
    const t = setup([S0, S1, null, S3], DEAD, rules, '2p2p');
    const tile = t.draw('2p');
    t.do(0, { type: 'discard', tile });
    t.do(1, callOptions(t.s, 1).find((a) => a.type === 'pon')!);
    t.passAll();
    // 席 1 は 5z を切る。その後 席 2・席 3・席 0 が字牌をツモ切り
    t.do(1, { type: 'discard', tile: t.s.hands[1].find((x) => kindOf(x) === k('5z'))! });
    t.passAll();
    t.cycle('1z');
    t.cycle('1z');
    t.cycle('1z');
    t.draw('2p');
    const kakan = kanOptions(t.s, 1).find((a) => a.type === 'kan' && a.kan === 'kakan');
    expect(kakan).toBeDefined();
    t.do(1, kakan!);
    return t;
  }

  it('加槓の牌で槍槓できる（槍槓が役になる）。崩れたカンのカンドラはめくらない', () => {
    const t = ponThenKakan();
    expect(t.s.phase).toBe('claim');
    expect(t.s.claim?.kind).toBe('kakan');
    // 加槓の牌は鳴けない（ロンか見送るだけ）
    expect(legalActions(t.s, 3).map((a) => a.type)).toEqual(['ron', 'pass']);
    t.do(3, { type: 'ron' });
    t.passAll();
    const r = t.s.result;
    expect(r?.type).toBe('ron');
    if (r?.type !== 'ron') return;
    expect(r.robbed).toBe('kakan');
    expect(r.wins[0].score.yaku.map((y) => y.id)).toContain('chankan');
    expect(t.s.doraIndicators).toHaveLength(1);
  });

  it('誰もロンしなければ嶺上牌を引く。明槓扱いなので一般ルールではカンドラは打牌のとき', () => {
    const t = ponThenKakan();
    t.passAll();
    expect(t.s.melds[1][0]).toMatchObject({ type: 'kakan', from: 0 });
    expect(t.s.melds[1][0].tiles).toHaveLength(4);
    const envs = t.apply(advance(t.s));
    expect(envs.map((e) => e.ev.type)).toEqual(['draw']);
    const out = t.do(1, { type: 'discard', tile: t.s.drawn[1]! });
    expect(out.map((e) => e.ev.type)).toEqual(['discard', 'doraReveal']);
  });

  it('槍槓で崩れたカンのカンドラ「めくる」なら、ロンの前にめくる', () => {
    const t = ponThenKakan(rulesWith({ chankanDora: 'yes' }));
    const out = t.do(3, { type: 'ron' });
    expect(out.map((e) => e.ev.type)).toEqual(['doraReveal', 'ron']);
    expect(t.s.doraIndicators).toHaveLength(2);
  });

  it('一発と槍槓：一般ルールは複合する。「しない」なら一発が付かない。加槓の時点で消えるルールなら付かない', () => {
    const withIppatsu = (rules: Rules) => {
      const t = ponThenKakan(rules);
      // 席 3 がリーチして一発が残っている局面にする（宣言の流れは riichi.test で確かめている）
      t.s = { ...t.s, riichi: ['none', 'none', 'none', 'riichi'], riichiAt: [null, null, null, 0], ippatsu: rules.family === 'jp' && rules.values.ippatsuKakan === 'at' ? t.s.ippatsu : [false, false, false, true] };
      t.do(3, { type: 'ron' });
      t.passAll();
      const r = t.s.result;
      return r?.type === 'ron' ? r.wins[0].score.yaku.map((y) => y.id) : [];
    };
    expect(withIppatsu(GENERAL_RULES)).toEqual(expect.arrayContaining(['riichi', 'ippatsu', 'chankan']));
    expect(withIppatsu(rulesWith({ ippatsuChankan: 'no' }))).not.toContain('ippatsu');
    expect(withIppatsu(rulesWith({ ippatsuKakan: 'at' }))).not.toContain('ippatsu');
  });

  it('加槓のあと誰もロンしなければ、一発はそこで消える', () => {
    const t = ponThenKakan();
    t.s = { ...t.s, ippatsu: [false, false, false, true] };
    t.passAll();
    expect(t.s.ippatsu).toEqual([false, false, false, false]);
  });

  it('加槓の牌を見逃すとフリテン', () => {
    const t = ponThenKakan();
    t.passAll();
    expect(t.s.missedTurn[3]).toBe(true);
  });
});

describe('リーチのあとの暗槓', () => {
  it('待ちが変わらなければできる・変わるならできない', () => {
    const d = dealer();
    const wait = d('1m1m1m2m3m4m5p6p7p2s3s9s9s'); // 1s・4s 待ち。1m の暗槓で待ちは変わらない
    expect(riichiAnkanKeepsWait(wait, k('1m'), 'wait')).toBe(true);
    const d2 = dealer();
    const change = d2('1m1m1m2m3m5p6p7p2s3s4s9s9s'); // 1m・4m・9s 待ち。1m を暗槓すると 1m・4m 待ちに変わる
    expect(riichiAnkanKeepsWait(change, k('1m'), 'wait')).toBe(false);
  });

  it('条件「刻子としか読めない形だけ」：待ちが同じでも、順子にも読めるならできない', () => {
    const d = dealer();
    const hand = d('1m1m1m2m2m2m3m3m5p6p7p9s9s');
    expect(riichiAnkanKeepsWait(hand, k('1m'), 'wait')).toBe(true);
    expect(riichiAnkanKeepsWait(hand, k('1m'), 'shape')).toBe(false);
  });

  it('リーチしている人は、ツモった牌でだけ・待ちが変わらないときだけ暗槓できる。ルールが「できない」ならできない', () => {
    const play = (rules: Rules, hand: string) => {
      const t = setup([hand, null, null, null], DEAD, rules);
      t.s = { ...t.s, riichi: ['riichi', 'none', 'none', 'none'], riichiAt: [0, null, null, null] };
      t.draw('1m');
      return kanOptions(t.s, 0);
    };
    expect(play(GENERAL_RULES, '1m1m1m2m3m4m5p6p7p2s3s9s9s')).toHaveLength(1);
    expect(play(GENERAL_RULES, '1m1m1m2m3m5p6p7p2s3s4s9s9s')).toHaveLength(0);
    expect(play(rulesWith({ riichiAnkan: 'ng' }), '1m1m1m2m3m4m5p6p7p2s3s9s9s')).toHaveLength(0);
  });

  it('暗槓していてもリーチできる（暗槓は鳴きに数えない）', () => {
    const t = setup(['1m1m1m2m3m4m5p6p7p2s3s9s9s', null, null, null], DEAD);
    t.draw('1m');
    t.do(0, kanOptions(t.s, 0)[0]);
    t.passAll();
    t.apply(advance(t.s)); // 嶺上牌 9s
    // 9s を引いて 9s9s9s＋2s3s＝1s・4s 待ち…ではなく、2s3s のどちらかを切ればリーチできる形
    const riichi = legalActions(t.s, 0).filter((a) => a.type === 'riichi');
    expect(riichi.length).toBeGreaterThan(0);
  });
});

describe('天和・地和と暗槓', () => {
  it('一般ルール（暗槓すると消える）：ほかの人が暗槓すると地和は付かない', () => {
    const t = setup(['1m1m1m2m3m4m5p6p7p2s3s4s9s', null, null, null], DEAD);
    t.draw('1m');
    t.do(0, kanOptions(t.s, 0)[0]);
    expect(t.s.anyCall).toBe(true);
    const kept = setup(['1m1m1m2m3m4m5p6p7p2s3s4s9s', null, null, null], DEAD, rulesWith({ tenhouAnkan: 'kept' }));
    kept.draw('1m');
    kept.do(0, kanOptions(kept.s, 0)[0]);
    expect(kept.s.anyCall).toBe(false);
  });
});

describe('裏ドラはカンの数だけ', () => {
  it('カンドラ 2 枚のときリーチでアガると裏ドラも 2 枚めくる', () => {
    const t = setup(['1m1m1m2m3m4m5p6p7p2s3s4s9s', null, null, null], DEAD);
    t.s = { ...t.s, riichi: ['riichi', 'none', 'none', 'none'], riichiAt: [0, null, null, null] };
    t.draw('1m');
    t.do(0, kanOptions(t.s, 0)[0]);
    t.passAll();
    t.apply(advance(t.s));
    const out = t.do(0, { type: 'tsumo' });
    const ev = out[0].ev;
    expect(ev.type === 'tsumo' && ev.ura).toEqual([uraIndicatorAt(t.s.wall!, 0), uraIndicatorAt(t.s.wall!, 1)]);
  });
});
