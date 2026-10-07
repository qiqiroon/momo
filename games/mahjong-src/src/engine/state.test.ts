import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HIDDEN, mask, type Envelope } from './events';
import { act, advance, legalActions, roundSeed, startRound } from './round';
import { GENERAL_RULES } from './rules';
import { apply, initialState, liveWallLeft, replay, viewFor } from './state';
import { playOne } from '../selfplay/run';

/** 対局を始めて、1 局目を配るまでの出来事の列 */
function dealtLog(gameSeed: string): Envelope[] {
  const log: Envelope[] = [{ seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } }];
  log.push(...startRound(replay(log), gameSeed, 0, 0));
  return log;
}

describe('出来事の列から局面を作る', () => {
  it('配牌：4 人とも 13 枚・重なりなし・山は 136−52 枚', () => {
    const s = replay(dealtLog('g1'));
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(s.hands.flat()).size).toBe(52);
    expect(s.wallLeft).toBe(136 - 52);
  });

  it('配牌は山の先頭 52 枚（全部を知る端末で検算）', () => {
    const s = replay(dealtLog('g1'));
    expect(s.wall).not.toBeNull();
    expect(new Set(s.hands.flat())).toEqual(new Set(s.wall!.slice(0, 52)));
  });

  it('同じ種なら同じ配牌・違う種なら違う配牌', () => {
    expect(replay(dealtLog('same')).hands).toEqual(replay(dealtLog('same')).hands);
    expect(replay(dealtLog('one')).hands).not.toEqual(replay(dealtLog('two')).hands);
  });

  it('局ごとの山の種は対局の種から決まる', () => {
    expect(roundSeed('g', 0)).not.toBe(roundSeed('g', 1));
    expect(roundSeed('g', 3)).toBe(roundSeed('g', 3));
  });

  it('通し番号が飛んだら受け付けない', () => {
    const log = dealtLog('g1');
    const s0 = apply(initialState(), log[0]);
    expect(() => apply(s0, log[2])).toThrow();
  });

  it('列を何度当てはめ直しても同じ局面', () => {
    const log = dealtLog('g2');
    expect(replay(log)).toEqual(replay(log.slice()));
  });
});

describe('席から見える局面', () => {
  const log = dealtLog('view');
  const full = replay(log);

  for (const viewer of [0, 1, 2, 3] as const) {
    it(`席 ${viewer}：自分の手牌だけ見え、他の 3 人は伏せた 13 枚・山の並びは見えない`, () => {
      const v = viewFor(log, viewer);
      expect(v.hands[viewer]).toEqual(full.hands[viewer]);
      for (const other of [0, 1, 2, 3].filter((x) => x !== viewer)) {
        expect(v.hands[other]).toEqual(new Array(13).fill(HIDDEN));
      }
      expect(v.wall).toBeNull();
      expect(v.wallLeft).toBe(full.wallLeft);
    });
  }

  it('席 1 に渡す列そのものに、他の人の牌の番号や山の種が残っていない（画面で隠すのでなく、渡さない）', () => {
    const sent = log.map((e) => mask(e, 1));
    expect(sent.map((e) => e.seq)).toEqual(log.map((e) => e.seq)); // 伏せても列から抜かない
    let checked = 0;
    for (const e of sent) {
      if (e.ev.type === 'wallSeed') {
        expect(e.ev.seed).toBeNull();
        checked++;
      }
      if (e.ev.type === 'deal' && e.ev.seat !== 1) {
        expect(e.ev.tiles.every((t) => t === HIDDEN)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBe(13); // 山の種 1 ＋ 他の 3 人の配牌（4 回ずつ）
  });
});

describe('ルール部分は画面に触らない', () => {
  it('engine の中で react・DOM を読み込んでいない', () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from ['"]react/);
      expect(src, f).not.toMatch(/\bdocument\.|\bwindow\./);
    }
  });
});

describe('ツモって切る（段階1）', () => {
  it('同じ種で2回打つと、出来事の列がまるごと同じ（同じ配牌・同じツモ）', () => {
    const a = playOne('same-seed');
    const b = playOne('same-seed');
    expect(a.log.length).toBeGreaterThan(100);
    expect(a.log).toEqual(b.log);
    expect(playOne('other-seed').log).not.toEqual(a.log);
  });

  it('ツモは本人だけに見え、他の人には伏せて渡る・切った牌は全員に見える', () => {
    const { log } = playOne('peek');
    const firstDraw = log.find((e) => e.ev.type === 'draw')!;
    expect(firstDraw.to).toEqual([0]);
    const seen = mask(firstDraw, 1);
    expect(seen.ev.type === 'draw' && seen.ev.tile).toBe(HIDDEN);
    const firstDiscard = log.find((e) => e.ev.type === 'discard')!;
    expect(firstDiscard.to).toBe('all');
  });

  it('他の人の打牌を、伏せた手牌から 1 枚減らして当てはめられる（河は全員同じ）', () => {
    const { log } = playOne('rivers');
    const full = replay(log);
    for (const viewer of [0, 1, 2, 3] as const) {
      const v = viewFor(log, viewer);
      expect(v.discards).toEqual(full.discards);
      expect(v.hands.map((h) => h.length)).toEqual(full.hands.map((h) => h.length));
    }
  });

  it('ツモ切りの印：ツモ切りの CPU の打牌はすべてツモ切り', () => {
    const { log } = playOne('giri');
    const discards = log.filter((e) => e.ev.type === 'discard');
    expect(discards.length).toBe(70);
    expect(discards.every((e) => e.ev.type === 'discard' && e.ev.tsumogiri)).toBe(true);
  });

  it('流局は王牌 14 枚を残したところ', () => {
    const s = replay(playOne('dead').log);
    // ツモ切りだけの卓は全員ノーテンになりやすい。ここでは流局で終わったことだけを見る（支払いは流局の検査で）
    expect(s.result?.type).toBe('exhaust');
    expect(s.wallLeft).toBe(14);
    expect(liveWallLeft(s)).toBe(0);
  });

  it('進行役は、番でない人・持っていない牌・アガリでない形のツモアガリを受け付けない', () => {
    const log = dealtLog('guard');
    let s = replay(log);
    for (const e of advance(s)) s = apply(s, e);
    expect(() => act(s, 1, { type: 'discard', tile: s.hands[1][0] })).toThrow(/番ではない/);
    expect(() => act(s, 0, { type: 'discard', tile: s.hands[1][0] })).toThrow(/持っていない/);
    expect(() => act(s, 0, { type: 'tsumo' })).toThrow(/アガリの形/);
    expect(legalActions(s, 1)).toEqual([]);
    expect(legalActions(s, 0).filter((a) => a.type === 'discard')).toHaveLength(14);
  });
});
