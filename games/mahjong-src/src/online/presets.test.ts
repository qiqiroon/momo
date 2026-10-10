import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { SEATS, type Seat } from '../engine/events';
import { legalActions, type Action } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { viewFor, type GameState } from '../engine/state';
import { kindOf } from '../engine/tiles';
import { playOne } from '../selfplay/run';
import { callables, nextPon, nextRon, presetReply, prunePresets, type Presets } from './presets';

/** 自動対局の中から、その席がある返事をできる場面を探す */
function find(want: (legal: Action[]) => boolean): { v: GameState; seat: Seat; legal: Action[] } {
  for (let i = 1; i < 400; i += 2) {
    const log = playOne(`presets-${i}`, GENERAL_RULES, benchCpu).log;
    for (let n = 1; n <= log.length; n++) {
      if (log[n - 1].ev.type !== 'discard') continue;
      for (const seat of SEATS) {
        const v = viewFor(log.slice(0, n), seat);
        if (v.phase !== 'claim') continue;
        const legal = legalActions(v, seat);
        if (want(legal)) return { v, seat: seat as Seat, legal };
      }
    }
  }
  throw new Error('場面が見つからない');
}

const tileKind = (v: GameState) => kindOf(v.claim!.tile);

describe('鳴ける牌の予告（段階5の4c）', () => {
  it('押すたびの切り替え：ロンは 聞く→ロン→見送る→聞く／ポンは 聞く→ポン→(カン)→見送る→聞く', () => {
    expect([undefined, 'yes', 'no'].map((p) => nextRon(p as never))).toEqual(['yes', 'no', 'ask']);
    expect(nextPon(undefined, true)).toBe('pon');
    expect(nextPon('pon', true)).toBe('kan');
    expect(nextPon('pon', false)).toBe('no');
    expect(nextPon('kan', true)).toBe('no');
    expect(nextPon('no', true)).toBe('ask');
  });

  it('ポンできる牌：何も選んでいなければ聞く、ポンと選べばポン、見送ると選べば見送る（ほかに鳴けるものが無いとき）', () => {
    const { v, legal } = find((l) => l.some((a) => a.type === 'pon') && !l.some((a) => a.type === 'chi' || a.type === 'ron'));
    const k = tileKind(v);
    const p: Presets = new Map();
    expect(presetReply(v, legal, p)).toBe('ask');
    p.set(k, { pon: 'pon' });
    expect(presetReply(v, legal, p)).toMatchObject({ type: 'pon' });
    p.set(k, { pon: 'no' });
    expect(presetReply(v, legal, p)).toEqual({ type: 'pass' });
  });

  it('チー：組み合わせを選んであればその組み合わせで鳴く。選んだ組み合わせが無ければ聞く', () => {
    const { v, legal } = find((l) => l.some((a) => a.type === 'chi') && !l.some((a) => a.type === 'pon' || a.type === 'kan' || a.type === 'ron'));
    const k = tileKind(v);
    const chi = legal.find((a) => a.type === 'chi') as { type: 'chi'; tiles: number[] };
    const ks = chi.tiles.map(kindOf).sort((a, b) => a - b) as [number, number];
    const p: Presets = new Map([[k, { chi: { with: ks } }]]);
    const r = presetReply(v, legal, p);
    expect(r).toMatchObject({ type: 'chi' });
    expect((r as { tiles: number[] }).tiles.map(kindOf).sort((a, b) => a - b)).toEqual(ks);
    p.set(k, { chi: { with: [ks[0], ks[0]] } });
    expect(presetReply(v, legal, p)).toBe('ask');
    p.set(k, { chi: 'no' });
    expect(presetReply(v, legal, p)).toEqual({ type: 'pass' });
  });

  it('ロン：ロンと選べばロン（ロンはポン・チーより先）。ロンを見送るでも、ほかが「聞く」なら聞く', () => {
    const { v, legal } = find((l) => l.some((a) => a.type === 'ron'));
    const k = tileKind(v);
    const p: Presets = new Map([[k, { ron: 'yes', pon: 'pon' }]]);
    expect(presetReply(v, legal, p)).toEqual({ type: 'ron' });
    p.set(k, { ron: 'no' });
    const others = legal.some((a) => a.type === 'pon' || a.type === 'chi' || a.type === 'kan');
    expect(presetReply(v, legal, p)).toEqual(others ? 'ask' : { type: 'pass' });
  });

  it('予告の帯に並ぶ牌：手牌で決まる。リーチのあと・「鳴かない」ならロンだけ。手が変わったら鳴けなくなった牌の選択を消す', () => {
    const { v, seat } = find((l) => l.some((a) => a.type === 'pon'));
    const list = callables(v, seat, false);
    const k = tileKind(v);
    expect(list.find((c) => c.kind === k)?.pon).toBe(true);
    expect(callables(v, seat, true).every((c) => !c.pon && !c.kan && c.chi.length === 0)).toBe(true);
    const p: Presets = new Map([
      [k, { pon: 'pon' }],
      [999, { pon: 'pon' }],
    ]);
    prunePresets(p, list);
    expect(p.has(k)).toBe(true);
    expect(p.has(999)).toBe(false);
  });
});
