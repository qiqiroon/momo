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
