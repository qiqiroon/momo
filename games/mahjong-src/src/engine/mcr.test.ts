// 国標麻将（MCR・段階9 国標の手順1：花牌と補花）の検査。
// 原典：国家体育総局『中国麻将竞赛规则（试行）』1998（第五条二十・第六条五(六)）／EMA 英語版（WMO 2006）／MIL 补充细则 2023（第15項）。
import type { Envelope, Seat } from './events';
import { advance, act, legalActions, startRound } from './round';
import { rulesOfCnSet } from './ruleSets';
import { apply, initialState, liveWallLeft, type GameState } from './state';
import { checkState } from './invariants';
import { isFlower, kindOf, tileSetFor } from './tiles';

const MCR = rulesOfCnSet('mcr');

function begin(seed: string): { s: GameState; log: Envelope[] } {
  let s = apply(initialState(), { seq: 0, to: 'all', ev: { type: 'gameStart', rules: MCR } });
  const log: Envelope[] = [];
  for (const e of startRound(s, seed, 0, 0)) {
    s = apply(s, e);
    log.push(e);
  }
  return { s, log };
}
const step = (s: GameState, log: Envelope[]) => {
  for (const e of advance(s)) {
    s = apply(s, e);
    log.push(e);
  }
  return s;
};

describe('国標のセットの値', () => {
  it('144 枚（花牌 8 枚あり）・補充は山の尻から・チーあり・最後の 1 枚での鳴きは禁止', () => {
    expect(tileSetFor(MCR)).toHaveLength(144);
    expect(MCR.family === 'cn' && MCR.values).toMatchObject({ flower: 'on', flowerRefill: 'back', chi: 'on', lastTile: 'ng', minFan: '8', dealer: 'rotate', multiWin: 'atama', start: '500' });
  });
});

describe('補花（花牌を表にして補充を引く）', () => {
  // 花牌の多い山を探す（種を順に試して、配牌に花牌がある局）
  const seeds = Array.from({ length: 40 }, (_, i) => `mcr-flower-${i}`);

  it('配り終えたあと、親から順に花牌を表にして補充を引く。補充は山の尻から順。終わると手に花牌は無い', () => {
    let tested = 0;
    for (const seed of seeds) {
      let { s, log } = begin(seed);
      const dealtFlowers = s.hands.map((h) => h.filter((t) => isFlower(kindOf(t))).length);
      if (dealtFlowers.every((n) => n === 0)) continue;
      tested++;
      const wall = s.wall!;
      const order: Seat[] = [];
      let backIdx = 0;
      // 親が 14 枚目を引いて切る番になるまで進める
      while (s.phase === 'deal') {
        const before = log.length;
        s = step(s, log);
        for (const e of log.slice(before)) {
          if (e.ev.type === 'flower' && s.phase === 'deal') order.push(e.ev.seat);
          if (e.ev.type === 'draw' && e.ev.flower) {
            expect(e.ev.tile).toBe(wall[wall.length - 1 - backIdx]);
            backIdx++;
          }
        }
        expect(checkState(s, [])).toEqual([]);
      }
      // 親から順（席の並びが戻らない。補充がまた花牌なら同じ席が続ける）
      const rel = order.map((x) => (x - s.dealer + 4) % 4);
      expect(rel).toEqual(rel.slice().sort((a, b) => a - b));
      // 配牌の花牌は全部表になった（補充で引いた花牌も）
      const shown = s.flowers.map((f) => f.length);
      dealtFlowers.forEach((n, seat) => expect(shown[seat]).toBeGreaterThanOrEqual(n));
      expect(s.hands.flat().filter((t) => isFlower(kindOf(t)) && !s.drawn.includes(t))).toEqual([]);
    }
    expect(tested).toBeGreaterThan(5);
  });

  it('局の途中で花牌を引いたら表にして補充を引く。補充の牌はカンの嶺上牌の扱いにならない（杠上开花にしない）', () => {
    let seen = 0;
    for (const seed of seeds) {
      let { s, log } = begin(seed);
      for (let guard = 0; guard < 3000 && s.phase !== 'ended'; guard++) {
        if (s.phase === 'draw' || s.phase === 'deal') {
          const flowerDraw = s.flowerDue;
          s = step(s, log);
          if (flowerDraw && s.phase === 'discard') {
            seen++;
            expect(s.rinshanDraw).toBe(false);
          }
        } else if (s.phase === 'discard') {
          // ツモ切り
          for (const e of act(s, s.turn, { type: 'discard', tile: s.drawn[s.turn]! })) s = apply(s, e);
        } else if (s.phase === 'claim') {
          const seat = s.claim!.replies.findIndex((r) => r === null) as Seat;
          for (const e of act(s, seat, { type: 'pass' })) s = apply(s, e);
        } else break;
        expect(checkState(s, [])).toEqual([]);
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it('最後の 1 枚が花牌なら補充できず、そのまま流局（MIL 补充细则 15）', () => {
    let found = 0;
    for (let i = 0; i < 300 && found === 0; i++) {
      let { s, log } = begin(`mcr-last-${i}`);
      for (let guard = 0; guard < 3000 && s.phase !== 'ended'; guard++) {
        if (s.phase === 'draw' || s.phase === 'deal') {
          const due = s.flowerDue && liveWallLeft(s) === 0;
          s = step(s, log);
          if (due) {
            found++;
            expect(s.phase).toBe('ended');
          }
        } else if (s.phase === 'discard') {
          for (const e of act(s, s.turn, { type: 'discard', tile: s.drawn[s.turn]! })) s = apply(s, e);
        } else if (s.phase === 'claim') {
          const seat = s.claim!.replies.findIndex((r) => r === null) as Seat;
          for (const e of act(s, seat, { type: 'pass' })) s = apply(s, e);
        } else break;
      }
    }
    expect(found).toBe(1);
  });

  it('花牌を切る・鳴くことはできない（引いたらすぐ表になるので手に残らない）', () => {
    let { s, log } = begin('mcr-flower-1');
    while (s.phase === 'deal') s = step(s, log);
    const acts = legalActions(s, s.turn);
    expect(acts.some((a) => a.type === 'discard' && isFlower(kindOf(a.tile)))).toBe(false);
  });
});

// ---- 番の数え方（手順2）：正本は作業側 docs\国標_番の数え方_v0.01.md ----
import { MCR_FAN_IDS, mcrScore, type McrWinContext } from './mcr';
import { dictFor } from '../i18n/strings';

const B = { m: 0, p: 9, s: 18, z: 27 } as const;
function counts(code: string): number[] {
  const c = new Array<number>(34).fill(0);
  for (const [, nums, suit] of code.matchAll(/(\d+)([mpsz])/g)) for (const d of nums) c[B[suit as 'm'] + Number(d) - 1]++;
  return c;
}
const kk = (code: string) => counts(code).findIndex((n) => n > 0);
const chi = (code: string) => ({ kind: kk(code), type: 'chi' as const, concealed: false });
const pon = (code: string) => ({ kind: kk(code), type: 'pon' as const, concealed: false });
const kan = (code: string, concealed = false) => ({ kind: kk(code), type: 'kan' as const, concealed });
/** 南家（自風＝南）・場風＝東 */
function sc(hand: string, win: string, o: Partial<McrWinContext> = {}) {
  return mcrScore({ concealed: counts(hand), melds: [], winTile: kk(win), tsumo: false, seatWind: 28, roundWind: 27, flowers: 0, lastDraw: false, lastClaim: false, gangkai: false, qianggang: false, juezhang: false, qidui: true, ...o });
}
const F = (r: ReturnType<typeof sc>) => (r ? Object.fromEntries(r.fans.map((f) => [f.id, f.fan])) : null);

describe('国標の番（基本）', () => {
  it('无番和：ほかに番が無ければ 8 点', () => {
    const r = sc('1z1z7s8s9s', '9s', { melds: [chi('2m'), chi('5p'), pon('6s')] });
    expect(F(r)).toEqual({ wufanhe: 8 });
    expect(r!.fan).toBe(8);
  });
  it('清龙＋清一色＋平和＋一般高＋门前清（清一色のとき无字・缺一门は付かない）', () => {
    const r = F(sc('123m456m789m123m55m', '5m'));
    expect(r).toMatchObject({ qinglong: 16, qingyiseG: 24, pinghe: 2, yibangao: 1, menqianqing: 2 });
    expect(r).not.toHaveProperty('wuzi');
    expect(r).not.toHaveProperty('queyimen');
  });
  it('一色三同顺は一般高を数えない・4 つ目の順子と般逢老连を 1 つだけ（MIL 11）', () => {
    // 門前の 123m×3 は刻子にも読めて一色三节高＋三暗刻のほうが高い（就高不就低）＝順子 2 つを鳴いた手で見る
    const r = F(sc('123m456m99p', '9p', { melds: [chi('1m'), chi('1m')] }));
    expect(r).toMatchObject({ yisesantongshun: 24, lianliu: 1 });
    expect(r).not.toHaveProperty('yibangao');
  });
  it('一色四同顺は一般高・四归一を数えない（般逢老连も無し）', () => {
    const r = F(sc('234s234s234s234s88p', '8p'));
    expect(r).toMatchObject({ yisesitongshun: 48 });
    for (const x of ['yibangao', 'siguiyi', 'yisesantongshun', 'lianliu']) expect(r).not.toHaveProperty(x);
  });
  it('順子 4 つで 3 順子の番が無いとき、般逢老连は最多 3 つ・同じ番を同じ順子で 2 回作らない', () => {
    const r = F(sc('123m123p456m456p11z', '1z', { melds: [] }));
    expect(r).toMatchObject({ xixiangfeng: 2, lianliu: 1 });
  });
  it('大三元は双箭刻・箭刻を数えない。小三元は箭刻を数えない', () => {
    const big = F(sc('555z666z777z123m44m', '4m'));
    expect(big).toMatchObject({ dasanyuanG: 88 });
    expect(big).not.toHaveProperty('jianke');
    const small = F(sc('555z666z77z123m456m', '6m'));
    expect(small).toMatchObject({ xiaosanyuanG: 64 });
    expect(small).not.toHaveProperty('jianke');
  });
  it('圈风刻・门风刻になった風牌の刻子は幺九刻に数えない。ほかの風牌・一九の刻子は幺九刻', () => {
    const r = F(sc('111z444z999m123p55s', '5s', { melds: [] }));
    expect(r).toMatchObject({ quanfengke: 2, yaojiuke: 2 });
  });
});

describe('国標の番（MIL 补充细则）', () => {
  it('MIL 1：四暗刻のツモは自摸だけ（不求人・门前清は付かない）', () => {
    const r = F(sc('222m555p777s999s11z', '1z', { tsumo: true }));
    expect(r).toMatchObject({ sianke: 64, zimoG: 1 });
    for (const x of ['buqiuren', 'menqianqing', 'pengpenghe']) expect(r).not.toHaveProperty(x);
  });
  it('MIL 2：七对に断幺・缺一门・四归一を重ねる（门前清・单钓将は付かない）。ツモなら自摸', () => {
    const r = F(sc('22m33m44m44m66p77p88p', '8p', { tsumo: true }));
    expect(r).toMatchObject({ qiduiG: 24, duanyao: 2, queyimen: 1, siguiyi: 2, zimoG: 1 });
    // 断幺は无字を数えない
    for (const x of ['menqianqing', 'dandiao', 'buqiuren', 'wuzi']) expect(r).not.toHaveProperty(x);
  });
  it('MIL 4・5：明槓と暗槓は明暗杠 5 点（暗杠・明杠は数えない）。双暗杠は双暗刻を数えない', () => {
    const r = F(sc('123m456p77s', '7s', { melds: [kan('9s'), kan('1z', true)] }));
    expect(r).toMatchObject({ mingangang: 5 });
    expect(r).not.toHaveProperty('angang');
    const two = F(sc('123m456p77s', '7s', { melds: [kan('9s', true), kan('2m', true)] }));
    expect(two).toMatchObject({ shuangangang: 8 });
    expect(two).not.toHaveProperty('shuanganke');
  });
  it('MIL 10：待ちが 2 種類以上なら边张・坎张・单钓将は付かない。1 種類なら付く', () => {
    expect(F(sc('123m456m789p123s99s', '3s'))).toMatchObject({ bianzhang: 1 });
    expect(F(sc('123m456m789p123s99s', '2s'))).toMatchObject({ kanzhang: 1 });
    expect(F(sc('123m456m789p234s99s', '4s'))).not.toHaveProperty('bianzhang');
    expect(F(sc('123m456m789p234s99s', '9s'))).toMatchObject({ dandiao: 1 });
    // 原典の例：12345 で 3 を待つ形は边张にならない（3 と 6 の 2 種類待ち）
    expect(F(sc('123m456m99p123345s', '3s'))).not.toHaveProperty('bianzhang');
  });
  it('MIL 12：九莲宝灯は 258 でアガれば幺九刻 1 つ、ほかは無し（清一色・门前清は数えない）', () => {
    const five = F(sc('11123455678999m', '5m'));
    expect(five).toMatchObject({ jiulianG: 88, yaojiuke: 1 });
    expect(five).not.toHaveProperty('qingyiseG');
    expect(five).not.toHaveProperty('menqianqing');
    const one = F(sc('11112345678999m', '1m'));
    expect(one).toMatchObject({ jiulianG: 88 });
    expect(one).not.toHaveProperty('yaojiuke');
  });
});

describe('国標の番（特別な形・場面）', () => {
  it('十三幺（五门齐・门前清・单钓将は数えない）', () => {
    const r = F(sc('19m19p19s12345677z', '7z'));
    expect(r).toEqual({ shisanyaoG: 88 });
  });
  it('全不靠に组合龙・七星不靠', () => {
    expect(F(sc('147m258p369s12345z', '5z'))).toMatchObject({ quanbukao: 12, zuhelong: 12 });
    expect(F(sc('147m25p36s1234567z', '7z'))).toMatchObject({ qixingbukao: 24 });
  });
  it('组合龙＋1 面子＋雀頭（平和も付く＝MIL 9）', () => {
    expect(F(sc('147m258p369s234m55p', '5p'))).toMatchObject({ zuhelong: 12, pinghe: 2 });
  });
  it('妙手回春・杠上开花は自摸を数えない。抢杠和は和绝张を数えない。花牌は起和に数えない', () => {
    expect(F(sc('123m456m789p234s55s', '5s', { tsumo: true, lastDraw: true }))).not.toHaveProperty('zimoG');
    expect(F(sc('123m456p55s', '5s', { tsumo: true, gangkai: true, melds: [kan('9s'), chi('7m')] }))).not.toHaveProperty('zimoG');
    const rob = F(sc('123m456m789p234s55s', '5s', { qianggang: true, juezhang: true }));
    expect(rob).toMatchObject({ qiangganghe: 8 });
    expect(rob).not.toHaveProperty('hejuezhang');
    const fl = sc('1z1z7s8s9s', '9s', { melds: [chi('2m'), chi('5p'), pon('6s')], flowers: 3 });
    expect(fl!.fan).toBe(8);
    expect(fl!.points).toBe(11);
  });
  it('全求人（4 組とも鳴いてロンの単騎）は单钓将を数えない', () => {
    const r = F(sc('5z5z', '5z', { melds: [chi('1m'), chi('4p'), pon('9s'), pon('2s')] }));
    expect(r).toMatchObject({ quanqiuren: 6 });
    expect(r).not.toHaveProperty('dandiao');
  });
});

describe('国標の番の名前', () => {
  it('どの番も日英中の名前がある', () => {
    for (const lang of ['ja', 'en', 'zh'] as const) {
      const d = dictFor(lang) as Record<string, string>;
      for (const id of MCR_FAN_IDS) expect(d[`cnFan_${id}`], `${lang} cnFan_${id}`).toBeTruthy();
    }
  });
});
