import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { SEATS, type Seat } from '../engine/events';
import { legalActions } from '../engine/round';
import { GENERAL_RULES } from '../engine/rules';
import { viewFor } from '../engine/state';
import { kindOf } from '../engine/tiles';
import { playOne } from '../selfplay/run';
import { OnlineTable } from './table';

// 自動対局の中から「ポンだけできる返事の番」（チー・カン・ロンは無い）を探す
function findPonOnly() {
  for (let i = 1; i < 400; i += 2) {
    const log = playOne(`presetwait-${i}`, GENERAL_RULES, benchCpu).log;
    for (let n = 1; n <= log.length; n++) {
      for (const seat of SEATS) {
        const v = viewFor(log.slice(0, n), seat);
        if (v.phase !== 'claim') continue;
        const legal = legalActions(v, seat);
        if (legal.some((a) => a.type === 'pon') && !legal.some((a) => a.type === 'chi' || a.type === 'ron' || a.type === 'kan')) return { v, seat: seat as Seat, legal };
      }
    }
  }
  throw new Error('ポンだけできる場面が見つからない');
}

type Inside = { mySeat: Seat; views: Map<Seat, unknown>; replyWait: number; hand: unknown; driveSeat: (s: Seat) => void };

describe('鳴ける牌の予告で見送ると決めた返事の番（利用者報告 2026-10-20・Q1=A）', () => {
  it('★返事の待ちのあいだもボタンを出さない＝押した鳴きが捨てられて見送りが出る、が起きない', async () => {
    const { v, seat, legal } = findPonOnly();
    const sent: { type: string; envs?: { ev: { type: string } }[] }[] = [];
    const t = new OnlineTable({ send: (m) => sent.push(m as never), isHost: false, myId: 'x', cpu: benchCpu });
    const inside = t as unknown as Inside;
    inside.mySeat = seat;
    inside.views.set(seat, v);
    inside.replyWait = 300;
    inside.hand = { final: true };
    // 予告なし：ボタン（ポン・見送る）が出る
    expect(t.choices(v, seat).map((a) => a.type)).toContain('pon');
    t.presets.set(kindOf(v.claim!.tile), { pon: 'no' });
    inside.driveSeat(seat);
    // 予告どおり見送ると決まったら、待ちのあいだも画面に選べることを渡さない
    expect(t.choices(v, seat)).toEqual([]);
    // それでも押されたら（古い画面など）、出るのは予告の見送りだけ
    t.choose(legal.find((a) => a.type === 'pon')!);
    await new Promise((r) => setTimeout(r, 450));
    const acts = sent.filter((m) => m.type === 'mt-act');
    expect(acts.map((m) => m.envs!.map((e) => e.ev.type))).toEqual([['pass']]);
  });
});
