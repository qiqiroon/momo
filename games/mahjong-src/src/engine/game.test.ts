// 局の進め方の検査（段階4の 2）。局が終わった局面を直接作り、次に起きることを確かめる。
import type { Seat } from './events';
import { nextStep, RETURN_POINTS } from './game';
import { act, legalActions, nextHand } from './round';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, type GameState, type RoundResult } from './state';
import type { ScoreResult } from './score';

const rulesWith = (values: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...values } } : GENERAL_RULES;

// 点数の中身は局の進め方に関わらない（アガった人だけ見る）
const SCORE = {} as ScoreResult;
const tsumo = (seat: Seat): RoundResult => ({ type: 'tsumo', seat, winTile: 0, ura: [], score: SCORE });
const ron = (from: Seat, ...seats: Seat[]): RoundResult => ({ type: 'ron', from, winTile: 0, wins: seats.map((seat) => ({ seat, ura: [], score: SCORE })) });
const exhaust = (tenpai: boolean[]): RoundResult => ({ type: 'exhaust', tenpai, payments: [0, 0, 0, 0] });

/** 局が終わった局面。roundIndex の親は roundIndex % 4 */
function ended(result: RoundResult, opts: { roundIndex?: number; honba?: number; scores?: number[]; rules?: Rules } = {}): GameState {
  const s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: opts.rules ?? GENERAL_RULES } });
  const roundIndex = opts.roundIndex ?? 0;
  return {
    ...s,
    phase: 'ended',
    roundIndex,
    dealer: (roundIndex % 4) as Seat,
    honba: opts.honba ?? 0,
    scores: opts.scores ?? [25000, 25000, 25000, 25000],
    result,
    settlement: [0, 0, 0, 0],
  };
}

describe('親の交代と本場', () => {
  it('子がアガったら親が流れて本場は 0。親がアガったら連荘で本場が 1 つ増える', () => {
    expect(nextStep(ended(tsumo(1), { honba: 2 }))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 0 });
    expect(nextStep(ended(ron(2, 0), { honba: 2 }))).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 3 });
  });

  it('ダブロンで親がアガった人に入っていれば連荘', () => {
    expect(nextStep(ended(ron(1, 2, 0)))).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 1 });
    expect(nextStep(ended(ron(0, 1, 2)))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 0 });
  });

  it('流局：親がテンパイなら連荘、ノーテンなら親が流れる。どちらも本場は増える', () => {
    expect(nextStep(ended(exhaust([true, false, false, false]), { honba: 1 }))).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 2 });
    expect(nextStep(ended(exhaust([false, true, false, false]), { honba: 1 }))).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 2 });
  });

  it('親の連荘「アガったときだけ」なら、流局で親がテンパイでも流れる', () => {
    const s = ended(exhaust([true, false, false, false]), { rules: rulesWith({ renchan: 'agari' }) });
    expect(nextStep(s)).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 1 });
  });

  it('途中流局：一般ルールは連荘。「親が流れる」なら流れる。3 人同時ロンの流局も同じ', () => {
    expect(nextStep(ended({ type: 'abort', reason: 'sufon' }))).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 1 });
    expect(nextStep(ended({ type: 'tripleRon', from: 0, seats: [1, 2, 3] }))).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 1 });
    const pass = ended({ type: 'abort', reason: 'kyushu', seat: 2 }, { rules: rulesWith({ abortRenchan: 'pass' }) });
    expect(nextStep(pass)).toEqual({ type: 'round', roundIndex: 1, dealer: 1, honba: 1 });
  });

  it('本場「なし」なら本場はいつも 0', () => {
    const s = ended(tsumo(0), { honba: 0, rules: rulesWith({ honba: 'off' }) });
    expect(nextStep(s)).toEqual({ type: 'round', roundIndex: 0, dealer: 0, honba: 0 });
  });
});

describe('飛び', () => {
  it('0 点未満の人がいれば終わり。0 点ちょうどは一般ルールでは続ける・「0 点で終了」なら終わり・飛び「なし」なら続ける', () => {
    expect(nextStep(ended(tsumo(1), { scores: [-100, 50100, 25000, 25000] }))).toEqual({ type: 'end', reason: 'tobi' });
    expect(nextStep(ended(tsumo(1), { scores: [0, 50000, 25000, 25000] })).type).toBe('round');
    expect(nextStep(ended(tsumo(1), { scores: [0, 50000, 25000, 25000], rules: rulesWith({ zero: 'end' }) }))).toEqual({ type: 'end', reason: 'tobi' });
    expect(nextStep(ended(tsumo(1), { scores: [-100, 50100, 25000, 25000], rules: rulesWith({ tobi: 'off' }) })).type).toBe('round');
  });
});

describe('オーラスと延長（西入）', () => {
  const S4 = 7; // 南 4 局（親は席 3）
  it('南 4 局で親が流れ、誰かが返し点（30000）以上なら終わり', () => {
    expect(RETURN_POINTS).toBe(30000);
    expect(nextStep(ended(tsumo(0), { roundIndex: S4, scores: [30000, 25000, 25000, 20000] }))).toEqual({ type: 'end', reason: 'last' });
  });

  it('誰も返し点に届かなければ西入（西 1 局へ）。西入「なし」なら終わり', () => {
    expect(nextStep(ended(tsumo(0), { roundIndex: S4, scores: [29900, 25100, 25000, 20000] }))).toEqual({ type: 'round', roundIndex: 8, dealer: 0, honba: 0 });
    const off = ended(tsumo(0), { roundIndex: S4, scores: [29900, 25100, 25000, 20000], rules: rulesWith({ west: 'off' }) });
    expect(nextStep(off)).toEqual({ type: 'end', reason: 'last' });
  });

  it('西入の終わり方「返し点を超えたら終了」：西のどの局でも、親が流れて誰かが返し点以上なら終わり。西 4 局で終わり', () => {
    expect(nextStep(ended(tsumo(2), { roundIndex: 8, scores: [20000, 25000, 30000, 25000] }))).toEqual({ type: 'end', reason: 'extension' });
    expect(nextStep(ended(tsumo(2), { roundIndex: 8, scores: [20000, 25000, 29000, 26000] })).type).toBe('round');
    expect(nextStep(ended(tsumo(0), { roundIndex: 11, scores: [29000, 25000, 21000, 25000] }))).toEqual({ type: 'end', reason: 'extension' });
  });

  it('西入の終わり方「西 4 局まで打つ」：返し点に届いても西 4 局まで続ける', () => {
    const full = rulesWith({ westEnd: 'full' });
    expect(nextStep(ended(tsumo(2), { roundIndex: 8, scores: [20000, 25000, 30000, 25000], rules: full })).type).toBe('round');
    expect(nextStep(ended(tsumo(0), { roundIndex: 11, scores: [29000, 25000, 21000, 25000], rules: full }))).toEqual({ type: 'end', reason: 'extension' });
  });

  it('東風戦は東 4 局がオーラス。延長は南入', () => {
    const east = rulesWith({ length: 'east' });
    expect(nextStep(ended(tsumo(0), { roundIndex: 3, scores: [30000, 25000, 25000, 20000], rules: east }))).toEqual({ type: 'end', reason: 'last' });
    expect(nextStep(ended(tsumo(0), { roundIndex: 3, scores: [29000, 26000, 25000, 20000], rules: east }))).toEqual({ type: 'round', roundIndex: 4, dealer: 0, honba: 0 });
  });
});

describe('アガリやめ・テンパイやめ', () => {
  const S4 = 7;
  const TOP = [20000, 20000, 20000, 40000]; // 親（席 3）がトップで返し点以上

  it('一般ルール（本人が選ぶ）：トップの親がアガったら、やめるか続けるかを選ぶ番になる', () => {
    const s = ended(tsumo(3), { roundIndex: S4, scores: TOP });
    expect(nextStep(s)).toEqual({ type: 'yame', seat: 3 });
    expect(legalActions(s, 3)).toEqual([{ type: 'yame', stop: true }, { type: 'yame', stop: false }]);
    expect(legalActions(s, 0)).toEqual([]);
    expect(nextStep({ ...s, yame: true })).toEqual({ type: 'end', reason: 'yame' });
    expect(nextStep({ ...s, yame: false })).toEqual({ type: 'round', roundIndex: S4, dealer: 3, honba: 1 });
  });

  it('やめるかの返事は出来事になり、局面がそれを覚える', () => {
    const s = ended(tsumo(3), { roundIndex: S4, scores: TOP });
    let t = s;
    for (const e of act(s, 3, { type: 'yame', stop: true })) t = apply(t, e);
    expect(t.yame).toBe(true);
    const end = nextHand(t, 'seed');
    expect(end.map((e) => e.ev)).toEqual([{ type: 'gameEnd', reason: 'yame' }]);
    for (const e of end) t = apply(t, e);
    expect(t.phase).toBe('gameover');
    expect(t.gameOver).toBe('yame');
  });

  it('「自動で終了」なら選ばずに終わり。「なし」なら連荘で続く', () => {
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: TOP, rules: rulesWith({ agariyame: 'auto' }) }))).toEqual({ type: 'end', reason: 'yame' });
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: TOP, rules: rulesWith({ agariyame: 'off' }) })).type).toBe('round');
  });

  it('テンパイやめは流局で親がテンパイのとき（ルールは別の項目）', () => {
    const s = ended(exhaust([false, false, false, true]), { roundIndex: S4, scores: TOP, rules: rulesWith({ agariyame: 'off', tenpaiyame: 'auto' }) });
    expect(nextStep(s)).toEqual({ type: 'end', reason: 'yame' });
  });

  it('親がトップでない（同点も含む）・親が返し点未満なら、やめられずに連荘（西入なしでも同じ）', () => {
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: [40000, 20000, 20000, 20000] })).type).toBe('round');
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: [30000, 20000, 20000, 30000] })).type).toBe('round');
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: [24000, 24000, 24000, 28000] })).type).toBe('round');
    // 西入なしでも、返し点未満ならやめられない（天鳳の条文どおり「原点以上のトップ」）
    expect(nextStep(ended(tsumo(3), { roundIndex: S4, scores: [24000, 24000, 24000, 28000], rules: rulesWith({ west: 'off' }) })).type).toBe('round');
  });

  it('途中流局で親が続くときはやめられない', () => {
    expect(nextStep(ended({ type: 'abort', reason: 'kyushu', seat: 3 }, { roundIndex: S4, scores: TOP })).type).toBe('round');
  });
});

describe('出来事の見張り', () => {
  it('局の進め方と違う局・本場・対局の終わりは止める', () => {
    const s = ended(tsumo(1), { honba: 2 });
    expect(() => apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'roundStart', roundIndex: 0, dealer: 0, honba: 3 } })).toThrow(/局の進め方/);
    expect(() => apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: 'last' } })).toThrow(/終わる時ではない/);
    const ok = apply(s, { seq: s.nextSeq, to: 'all', ev: { type: 'roundStart', roundIndex: 1, dealer: 1, honba: 0 } });
    expect(ok.handCount).toBe(1);
    expect(ok.scores).toEqual(s.scores);
  });

  it('連荘でも山の種は局ごとに変わる（局の番号が同じでも別の山）', () => {
    const s = ended(tsumo(0), { honba: 0 });
    const a = nextHand({ ...s, handCount: 1 }, 'g');
    const b = nextHand({ ...s, handCount: 2 }, 'g');
    const seedOf = (envs: typeof a) => envs.find((e) => e.ev.type === 'wallSeed')!.ev;
    expect(seedOf(a)).not.toEqual(seedOf(b));
  });
});
