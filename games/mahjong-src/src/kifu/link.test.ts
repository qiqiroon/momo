// 牌譜のリンク（6d・Q41＝A）：詰めて読み直すと、元の出来事の列とそっくり同じになる
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { rulesOfCnSet, rulesOfSet } from '../engine/ruleSets';
import { GENERAL_RULES } from '../engine/rules';
import { decodeKifuLink, encodeKifuLink, packKifu, unpackKifu } from './link';
import type { KifuSource } from './kifu';
import { act, advance, nextHand, rollForDealer, startRound } from '../engine/round';
import { nextStep } from '../engine/game';
import { apply, initialState } from '../engine/state';
import type { Envelope, Seat } from '../engine/events';
import type { Rules } from '../engine/rules';

/** 一人用と同じ始め方（親決めの種は対局の種）で、半荘を CPU どうしで打つ。返事の順は毎回変える */
function solo(seed: string, rules: Rules, upto = Infinity): Envelope[] {
  const log: Envelope[] = [];
  let s = initialState();
  const take = (es: Envelope[]) => es.forEach((e) => { s = apply(s, e); log.push(e); });
  take([{ seq: 0, to: 'all', ev: { type: 'gameStart', rules } }, { seq: 1, to: 'all', ev: rollForDealer(seed, 0) }]);
  take(startRound(s, seed, 0, s.chicha));
  let k = 0;
  while (s.phase !== 'gameover' && log.length < upto) {
    const p = (seat: Seat) => (seat % 2 ? benchCpu : tsumogiriCpu)(s, seat);
    if (s.phase === 'ended') {
      const n = nextStep(s);
      take(n.type === 'yame' ? act(s, n.seat, p(n.seat)) : nextHand(s, seed));
    } else if (s.phase === 'claim') {
      const waiting = ([1, 2, 3].map((d) => (s.claim!.from + d) % 4) as Seat[]).filter((x) => s.claim!.replies[x] === null);
      const seat = waiting[k++ % waiting.length];
      take(act(s, seat, p(seat)));
    } else if (s.phase === 'que' || s.phase === 'huan3') {
      // 缺一門・換三張：まだ選んでいない人が選ぶ（順番は毎回変える）
      const waiting = ([0, 1, 2, 3] as Seat[]).filter((x) => (s.phase === 'que' ? s.queHeld[x] === null : s.huan3Out[x] === null));
      const seat = waiting[k++ % waiting.length];
      take(act(s, seat, p(seat)));
    } else if (s.phase === 'discard' || s.phase === 'declare') take(act(s, s.turn, p(s.turn)));
    else take(advance(s));
  }
  return log;
}

const src = (events: Envelope[], seed: string, set = 'general'): KifuSource => ({ seed, startedAt: '2026-10-11T12:00:00+09:00', players: [], set, events });

describe('牌譜のリンク', () => {
  it('★詰めて読み直すと、出来事の列がそっくり同じ（半荘 6 回・セットもいろいろ）', () => {
    const sets = ['general', 'tenhou', 'wrc', 'kenko', 'ml', 'ema'] as const;
    for (const [i, set] of sets.entries()) {
      const seed = `link-${i}`;
      const events = solo(seed, rulesOfSet(set));
      expect(events.at(-1)?.ev.type).toBe('gameEnd');
      const back = unpackKifu(packKifu(src(events, seed, set)));
      expect(back.events).toEqual(events);
      expect(back.set).toBe(set);
    }
  }, 120_000);

  it('★中国式（2026-10-14 第16）：3 つのセットと、換三張・血流成河・途中流局を入れたカスタムで、詰めて読み直すと出来事の列がそっくり同じ', () => {
    const cases: [string, Rules][] = [
      ['sichuan', rulesOfCnSet('sichuan')],
      ['hk', rulesOfCnSet('hk')],
      ['mcr', rulesOfCnSet('mcr')],
    ];
    const sc = rulesOfCnSet('sichuan');
    const mcr = rulesOfCnSet('mcr');
    if (sc.family === 'cn' && mcr.family === 'cn') {
      cases.push(['custom', { family: 'cn', values: { ...sc.values, huan3: 'on', afterWin: 'again', length: '1' } }]);
      cases.push(['custom', { family: 'cn', values: { ...mcr.values, huan3: 'on', tochu: 'on', length: '1' } }]);
    }
    for (const [i, [set, rules]] of cases.entries()) {
      const seed = `cnlink-${i}`;
      const events = solo(seed, rules);
      expect(events.at(-1)?.ev.type, set).toBe('gameEnd');
      const back = unpackKifu(packKifu(src(events, seed, set)));
      expect(back.events, set).toEqual(events);
      expect(back.events[0].ev.type === 'gameStart' && back.events[0].ev.rules).toEqual(rules);
    }
  }, 180_000);

  it('途中で保存した対局（選ぶ番の途中で終わっている）も、そこまで同じに作り直す', () => {
    const events = solo('mid', GENERAL_RULES, 700);
    const back = unpackKifu(packKifu(src(events, 'mid')));
    expect(back.events).toEqual(events);
  });

  it('リンクの文字にして読み直しても同じ。半荘の長さを測る', async () => {
    const lens: number[] = [];
    for (let i = 0; i < 4; i++) {
      const events = solo(`len-${i}`, GENERAL_RULES);
      const code = await encodeKifuLink(src(events, `len-${i}`));
      expect(/^[A-Za-z0-9_-]+$/.test(code)).toBe(true);
      lens.push(code.length);
      expect((await decodeKifuLink(code)).events).toEqual(events);
    }
    console.log(`牌譜のリンクの長さ（半荘）：${lens.join('・')} 文字`);
  }, 60_000);

  it('壊れたリンクは読まない', async () => {
    await expect(decodeKifuLink('abc')).rejects.toThrow();
  });
});
