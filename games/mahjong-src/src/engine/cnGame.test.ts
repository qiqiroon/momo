// 中国式の局の進め方と終局の検査（段階9 手順6・MIL §6）。局が終わった局面を直接作り、次に起きることと順位を確かめる。
import type { Seat } from './events';
import { finalResult } from './final';
import { cnRoundsTotal, nextStep } from './game';
import { rulesOfCnSet } from './ruleSets';
import type { Rules } from './rules';
import { translate } from '../i18n/strings';
import { roundName } from '../ui/roundName';
import type { CnScore } from './sichuan';
import { apply, initialState, type CnWin, type GameState, type RoundResult } from './state';

const SICHUAN = rulesOfCnSet('sichuan');
const cnWith = (base: Rules, values: Record<string, string>): Rules =>
  base.family === 'cn' ? { family: 'cn', values: { ...base.values, ...values } } : base;

// 点数の中身は局の進め方に関わらない（誰がどこからアガったかだけ見る）
const SCORE = {} as CnScore;
let tileNo = 0;
const tsumo = (seat: Seat): CnWin => ({ seat, from: null, winTile: tileNo++, score: SCORE, pays: [0, 0, 0, 0] });
/** 同じ捨て牌へのロン（同時にアガった人は同じ牌） */
const rons = (from: Seat, ...seats: Seat[]): CnWin[] => {
  const tile = tileNo++;
  return seats.map((seat) => ({ seat, from, winTile: tile, score: SCORE, pays: [0, 0, 0, 0] }));
};
const cnWin = (...wins: CnWin[]): RoundResult => ({ type: 'cnWin', wins });

function ended(result: RoundResult, opts: { roundIndex?: number; dealer?: Seat; scores?: number[]; rules?: Rules } = {}): GameState {
  const s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: opts.rules ?? SICHUAN } });
  return { ...s, phase: 'ended', roundIndex: opts.roundIndex ?? 0, dealer: opts.dealer ?? 0, scores: opts.scores ?? [0, 0, 0, 0], result, settlement: [0, 0, 0, 0] };
}

describe('四川：最初にアガった人が次の親（MIL §6）', () => {
  it('最初にアガった人が次の親。あとからアガった人は関わらない。局の番号は毎局 1 つ進む', () => {
    expect(nextStep(ended(cnWin(tsumo(2), tsumo(1)), { dealer: 0 }))).toEqual({ type: 'round', roundIndex: 1, dealer: 2, honba: 0 });
    expect(nextStep(ended(cnWin(...rons(3, 1), tsumo(0)), { dealer: 0, roundIndex: 5 }))).toEqual({ type: 'round', roundIndex: 6, dealer: 1, honba: 0 });
  });

  it('親が最初にアガれば親のまま。それでも局の番号は進む（局の数で数える＝利用者 Q1=A）', () => {
    expect(nextStep(ended(cnWin(tsumo(0), tsumo(3)), { dealer: 0, roundIndex: 2 }))).toEqual({ type: 'round', roundIndex: 3, dealer: 0, honba: 0 });
  });

  it('最初のアガリが同時に 2 人以上なら放銃者が次の親（親がアガっていても）', () => {
    expect(nextStep(ended(cnWin(...rons(2, 3, 0)), { dealer: 0 }))).toEqual({ type: 'round', roundIndex: 1, dealer: 2, honba: 0 });
    // 同じ人があとで別の牌を放銃しても、最初のアガリには数えない
    expect(nextStep(ended(cnWin(...rons(2, 3), ...rons(2, 1)), { dealer: 0 }))).toEqual({ type: 'round', roundIndex: 1, dealer: 3, honba: 0 });
  });

  it('誰もアガらなければ親は変わらない（局の番号は進む）', () => {
    expect(nextStep(ended(cnWin(), { dealer: 1, roundIndex: 4 }))).toEqual({ type: 'round', roundIndex: 5, dealer: 1, honba: 0 });
    // 精算の無いルールの流局（結果の形が exhaust）でも同じ
    const plain = cnWith(SICHUAN, { chajiao: 'off', huazhu: 'off', kanPay: 'off' });
    expect(nextStep(ended({ type: 'exhaust', tenpai: [false, false, false, false], payments: [0, 0, 0, 0] }, { dealer: 1, rules: plain }))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 0 });
  });

  it('同時アガリが「親が含まれれば連荘」なら、親が入っていれば親のまま・入っていなければ放銃者', () => {
    const r = cnWith(SICHUAN, { multiDealer: 'dealerWin' });
    expect(nextStep(ended(cnWin(...rons(2, 3, 0)), { dealer: 0, rules: r }))).toEqual({ type: 'round', roundIndex: 1, dealer: 0, honba: 0 });
    expect(nextStep(ended(cnWin(...rons(0, 1, 3)), { dealer: 0, rules: r }))).toEqual({ type: 'round', roundIndex: 1, dealer: 0, honba: 0 });
    expect(nextStep(ended(cnWin(...rons(1, 2, 3)), { dealer: 0, rules: r }))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 0 });
  });
});

describe('ほかの親の決め方', () => {
  it('連荘なし（国標）：誰がアガっても・流局でも下家へ。局の番号は 1 つ進む', () => {
    const r = cnWith(SICHUAN, { dealer: 'rotate' });
    expect(nextStep(ended(cnWin(tsumo(0)), { dealer: 0, rules: r }))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 0 });
    expect(nextStep(ended(cnWin(), { dealer: 3, roundIndex: 3, rules: r }))).toEqual({ type: 'round', roundIndex: 4, dealer: 0, honba: 0 });
  });

  it('親がアガれば連荘（香港）：連荘は局の番号を進めない・子のアガリと流局は下家へ', () => {
    const r = cnWith(SICHUAN, { dealer: 'renchan' });
    expect(nextStep(ended(cnWin(tsumo(0)), { dealer: 0, roundIndex: 2, rules: r }))).toEqual({ type: 'round', roundIndex: 2, dealer: 0, honba: 0 });
    expect(nextStep(ended(cnWin(tsumo(2)), { dealer: 0, roundIndex: 2, rules: r }))).toEqual({ type: 'round', roundIndex: 3, dealer: 1, honba: 0 });
    expect(nextStep(ended(cnWin(), { dealer: 0, roundIndex: 2, rules: r }))).toEqual({ type: 'round', roundIndex: 3, dealer: 1, honba: 0 });
  });
});

describe('長さと終わり', () => {
  it('4 圏＝16 局・1 圏＝4 局。最後の局が終われば終わり', () => {
    expect(cnRoundsTotal(ended(cnWin()))).toBe(16);
    expect(nextStep(ended(cnWin(tsumo(1)), { roundIndex: 14 }))).toEqual({ type: 'round', roundIndex: 15, dealer: 1, honba: 0 });
    expect(nextStep(ended(cnWin(tsumo(1)), { roundIndex: 15 }))).toEqual({ type: 'end', reason: 'last' });
    const one = cnWith(SICHUAN, { length: '1' });
    expect(nextStep(ended(cnWin(), { roundIndex: 3, rules: one }))).toEqual({ type: 'end', reason: 'last' });
  });

  it('親がアガれば連荘のとき、最後の局で親が続けば終わらない', () => {
    const r = cnWith(SICHUAN, { dealer: 'renchan' });
    expect(nextStep(ended(cnWin(tsumo(3)), { dealer: 3, roundIndex: 15, rules: r }))).toEqual({ type: 'round', roundIndex: 15, dealer: 3, honba: 0 });
  });

  it('飛び：四川は「なし」＝マイナスでも続く。「あり」なら 0 点未満で終わる', () => {
    expect(nextStep(ended(cnWin(tsumo(1)), { scores: [-30, 10, 10, 10] })).type).toBe('round');
    const r = cnWith(SICHUAN, { tobi: 'on' });
    expect(nextStep(ended(cnWin(tsumo(1)), { scores: [-30, 10, 10, 10], rules: r }))).toEqual({ type: 'end', reason: 'tobi' });
    expect(nextStep(ended(cnWin(tsumo(1)), { scores: [0, 0, 0, 0], rules: r })).type).toBe('round');
  });

  it('持ち点は 0 点から', () => {
    expect(ended(cnWin()).scores).toEqual([0, 0, 0, 0]);
    const s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: SICHUAN } });
    expect(s.scores).toEqual([0, 0, 0, 0]);
  });
});

describe('終局の順位', () => {
  const over = (scores: number[], chicha: Seat = 0, rules: Rules = SICHUAN): GameState => ({ ...ended(cnWin(), { rules }), phase: 'gameover', gameOver: 'last', scores, chicha });
  const ranks = (s: GameState) => finalResult(s).map((r) => [r.seat, r.rank, r.total]);

  it('点の多い順。最終の点は持ち点そのもの', () => {
    expect(ranks(over([-12, 30, 5, -23]))).toEqual([[1, 1, 30], [2, 2, 5], [0, 3, -12], [3, 4, -23]]);
  });

  it('同点は起家に近い人が上（起家が席 2 なら 2→3→0→1 の順）', () => {
    expect(ranks(over([4, 4, -8, 0], 0))).toEqual([[0, 1, 4], [1, 2, 4], [3, 3, 0], [2, 4, -8]]);
    expect(ranks(over([4, 4, -8, 0], 1))).toEqual([[1, 1, 4], [0, 2, 4], [3, 3, 0], [2, 4, -8]]);
    expect(ranks(over([5, 0, 0, -5], 2))).toEqual([[0, 1, 5], [2, 2, 0], [1, 3, 0], [3, 4, -5]]);
  });

  it('同点を「同じ順位」にするルールなら同じ順位（次は人数ぶん飛ぶ）', () => {
    const r = cnWith(SICHUAN, { tieCn: 'same' });
    expect(ranks(over([4, 4, -8, 0], 1, r))).toEqual([[1, 1, 4], [0, 1, 4], [3, 3, 0], [2, 4, -8]]);
  });
});

describe('局数の上限（香港＝24 局・利用者 Q4=A）', () => {
  const HKR = rulesOfCnSet('hk');
  it('24 局目を打ち終えたら、4 圏の途中でも終わる（23 局目までは続く）', () => {
    expect(nextStep({ ...ended(cnWin(tsumo(0)), { dealer: 0, roundIndex: 9, rules: HKR }), handCount: 23 })).toEqual({ type: 'round', roundIndex: 9, dealer: 0, honba: 0 });
    expect(nextStep({ ...ended(cnWin(tsumo(0)), { dealer: 0, roundIndex: 9, rules: HKR }), handCount: 24 })).toEqual({ type: 'end', reason: 'cap' });
  });
  it('上限「なし」（四川）なら局の数では終わらない', () => {
    expect(nextStep({ ...ended(cnWin(tsumo(1)), { roundIndex: 9 }), handCount: 30 }).type).toBe('round');
  });
});

describe('局の名前（利用者 Q5=A）', () => {
  const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate('ja', k, v);
  it('親が回るルール（香港）は風の名前で、連荘には数を付ける。四川は「第n圏 m局」のまま', () => {
    const HKR = rulesOfCnSet('hk');
    expect(roundName({ ...ended(cnWin(), { rules: HKR, roundIndex: 5 }), repeat: 0 }, t)).toBe('南2局');
    expect(roundName({ ...ended(cnWin(), { rules: HKR, roundIndex: 12 }), repeat: 2 }, t)).toBe('北1局・連荘2');
    expect(roundName({ ...ended(cnWin(), { roundIndex: 5 }), repeat: 1 }, t)).toBe('第2圏 2局');
  });
  it('連荘の回数：同じ局の番号の局が続いたら 1 ずつ増え、変わったら 0', () => {
    let s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: rulesOfCnSet('hk') } });
    s = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'roundStart', roundIndex: 0, dealer: 0 } });
    expect(s.repeat).toBe(0);
  });
});

describe('国標の順位（標準分）', () => {
  const MCRR = rulesOfCnSet('mcr');
  const over = (scores: number[], rules: Rules = MCRR): GameState => ({ ...ended(cnWin(), { rules }), phase: 'gameover', gameOver: 'last', scores, chicha: 0 });
  it('持ち点 500 から。順位は点の多い順で、標準分は 4・2・1・0', () => {
    expect(apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: MCRR } }).scores).toEqual([500, 500, 500, 500]);
    expect(finalResult(over([480, 560, 500, 460])).map((r) => [r.seat, r.rank, r.total])).toEqual([[1, 1, 4], [2, 2, 2], [0, 3, 1], [3, 4, 0]]);
  });
  it('同点は起家に近い人が上（国標の決め方は 1 対局では決まらない）', () => {
    expect(finalResult(over([500, 500, 520, 480])).map((r) => [r.seat, r.total])).toEqual([[2, 4], [0, 2], [1, 1], [3, 0]]);
  });
  it('同点を同じ順位にするルールなら、標準分を分け合う（2 位と 3 位なら 1.5 ずつ）', () => {
    const r: Rules = MCRR.family === 'cn' ? { family: 'cn', values: { ...MCRR.values, tieCn: 'same' } } : MCRR;
    expect(finalResult(over([500, 500, 520, 480], r)).map((x) => [x.seat, x.rank, x.total])).toEqual([[2, 1, 4], [0, 2, 1.5], [1, 2, 1.5], [3, 4, 0]]);
  });
});
