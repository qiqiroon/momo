// 終局の検査（段階4の 3）。順位・供託・端数・ウマ・オカを、手で計算した値と突き合わせる。
import { finalResult, roundThousands } from './final';
import { GENERAL_RULES, type Rules } from './rules';
import { apply, initialState, type GameState } from './state';

const rulesWith = (values: Record<string, string>): Rules =>
  GENERAL_RULES.family === 'jp' ? { family: 'jp', values: { ...GENERAL_RULES.values, ...values } } : GENERAL_RULES;

/** 対局が終わった局面（持ち点と卓の供託を指定） */
function over(scores: number[], kyotaku = 0, rules: Rules = GENERAL_RULES): GameState {
  const s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules } });
  return { ...s, phase: 'gameover', gameOver: 'last', scores, kyotaku };
}

/** 席ごとの [順位, 最終得点] */
const table = (s: GameState) => Object.fromEntries(finalResult(s).map((r) => [r.seat, [r.rank, r.total]]));

describe('端数の丸め', () => {
  it('五捨六入：百の位が 5 以下は切り捨て・6 以上は切り上げ。マイナスは絶対値で丸める', () => {
    expect(roundThousands(28500, 'gosha')).toBe(28);
    expect(roundThousands(28600, 'gosha')).toBe(29);
    expect(roundThousands(-1500, 'gosha')).toBe(-1);
    expect(roundThousands(-1600, 'gosha')).toBe(-2);
    expect(roundThousands(28500, 'shisha')).toBe(29);
    expect(roundThousands(28900, 'kiri')).toBe(28);
    expect(roundThousands(28300, 'none')).toBe(28.3);
  });
});

describe('一般ルール（25000 持ち 30000 返し・オカ 20・ウマ 10-20・五捨六入）', () => {
  it('トップ以外を丸め、トップは合計 0 に合わせる。ウマとオカを足す', () => {
    // 2 位 28300→28（−2）・3 位 17500→17（−13）・4 位 9000（−21）。トップは −20−(−36)＝+16
    const s = over([45200, 28300, 17500, 9000]);
    expect(table(s)).toEqual({ 0: [1, 56], 1: [2, 8], 2: [3, -23], 3: [4, -41] });
    const top = finalResult(s)[0];
    expect([top.base, top.uma, top.oka]).toEqual([16, 20, 20]);
  });

  it('卓に残った供託はトップが取る（取ってから素点を出す）', () => {
    const s = over([40000, 30000, 20000, 9000], 1);
    const top = finalResult(s)[0];
    expect(top.kyotaku).toBe(1000);
    // 2 位 0・3 位 −10・4 位 −21 → トップ −20−(−31)＝+11
    expect(table(s)).toEqual({ 0: [1, 51], 1: [2, 10], 2: [3, -20], 3: [4, -41] });
  });

  it('供託「誰にも加えない」なら、残った分は誰のものにもならない（トップは丸めの差だけ受け持つ）', () => {
    const s = over([40000, 30000, 20000, 9000], 1, rulesWith({ kyotaku: 'none' }));
    expect(finalResult(s)[0].kyotaku).toBe(0);
    // 丸める前の合計は (99000−120000)/1000＝−21。2〜4 位は 0・−10・−21 → トップ −21−(−31)＝+10
    expect(table(s)[0]).toEqual([1, 50]);
  });

  it('同点（一般ルール＝起家に近い人が上）：席順で順位を付ける', () => {
    const s = over([20000, 30000, 30000, 20000]);
    expect(finalResult(s).map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [2, 2],
      [0, 3],
      [3, 4],
    ]);
  });
});

describe('ほかのセットの値', () => {
  it('同点で「順位点を分け合う」：その順位のウマ・オカを等分する', () => {
    // 1 位・2 位が同点：ウマ (20+10)/2＝15 ずつ、オカ 20/2＝10 ずつ
    const s = over([30000, 30000, 20000, 20000], 0, rulesWith({ tie: 'split', hasu: 'none' }));
    const rows = finalResult(s);
    expect(rows.map((r) => r.rank)).toEqual([1, 1, 3, 3]);
    expect(rows.slice(0, 2).map((r) => [r.uma, r.oka])).toEqual([
      [15, 10],
      [15, 10],
    ]);
    // 3 位・4 位：ウマ (−10−20)/2＝−15 ずつ
    expect(rows.slice(2).map((r) => r.uma)).toEqual([-15, -15]);
    expect(Math.round(rows.reduce((a, r) => a + r.total, 0) * 10) / 10).toBe(0);
  });

  it('割り切れない等分は 0.1 単位で、端数は起家に近い人へ（3 人同点）', () => {
    // 2〜4 位が同点：ウマ (10−10−20)/3＝−6.666… → −6.6・−6.7・−6.7（起家に近い席 1 が −6.6）
    const s = over([40000, 20000, 20000, 20000], 0, rulesWith({ tie: 'split', hasu: 'none' }));
    const rows = finalResult(s);
    expect(rows.slice(1).map((r) => [r.seat, r.uma])).toEqual([
      [1, -6.6],
      [2, -6.7],
      [3, -6.7],
    ]);
  });

  it('端数「丸めない」：小数のまま（Mリーグ・天鳳など）', () => {
    const s = over([45200, 28300, 17500, 9000], 0, rulesWith({ hasu: 'none' }));
    expect(table(s)).toEqual({ 0: [1, 55.2], 1: [2, 8.3], 2: [3, -22.5], 3: [4, -41] });
  });

  it('30000 持ち・オカなし・ウマ 10-30', () => {
    const s = over([50000, 30000, 25000, 15000], 0, rulesWith({ start: '30', oka: 'off', uma: '10-30', hasu: 'none' }));
    expect(table(s)).toEqual({ 0: [1, 50], 1: [2, 10], 2: [3, -15], 3: [4, -45] });
  });

  it('返し点「なし」（健康麻将）：素点÷1000＋ウマ（4-12）', () => {
    const s = over([37600, 30000, 20000, 12400], 0, rulesWith({ kaeshi: 'none', oka: 'off', uma: '4-12', hasu: 'none' }));
    expect(table(s)).toEqual({ 0: [1, 49.6], 1: [2, 34], 2: [3, 16], 3: [4, 0.4] });
  });

  it('浮きウマ：返し点以上の人数で表が変わる（1 人浮き +12・−1・−3・−8）', () => {
    const s = over([40000, 29000, 21000, 30000 - 20000], 0, rulesWith({ start: '30', oka: 'off', uma: 'float', hasu: 'none' }));
    expect(finalResult(s).map((r) => r.uma)).toEqual([12, -1, -3, -8]);
  });
});
