// 1 手ごとの制限時間（段階10の2・利用者決定 2026-10-16）：始める前の同意（押さない・やめる人の席は CPU）と、
// 本人の端末の時計（時間切れで決まった選び方の手を出す）。偽の通信で 3 人＋CPU 1 席を動かす。
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import type { Envelope } from '../engine/events';
import { OnlineTable } from './table';

/**
 * 待ちの上限の倍率。ほかの検査と同時に回ってパソコンが混むと、CPU の手も錠前の計算も遅くなり、
 * 正しく動いていても上限に届いて「時間切れ」で落ちた（第26・席を移す検査で再現した直しを、同じ待ち方の検査にもそろえた）。正しく動くときの所要時間は変わらない
 */
const WAIT_SCALE = 3;

class Net {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  problems: unknown[] = [];
  types: { from: string; type: string; ev?: string; msg: Record<string, unknown> }[] = [];
  private q: { from: string; to: 'all' | 'host'; msg: Record<string, unknown> }[] = [];
  private running = false;

  /** manual＝人の席を自動で打たない（時計に任せる） */
  add(id: string, host: boolean, o: { manual?: boolean; consentMs?: number } = {}) {
    const t: OnlineTable = new OnlineTable({
      send: (msg, to) => this.push(id, to, msg),
      isHost: host,
      myId: id,
      cpu: benchCpu,
      ...(o.manual ? {} : { autoplay: benchCpu }),
      autoNext: true,
      consentMs: o.consentMs,
      onProblem: (p) => this.problems.push(...p),
    });
    this.tables.push({ id, t, host });
    return t;
  }

  cut(id: string) {
    this.tables = this.tables.filter((x) => x.id !== id);
  }

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
    if (!this.tables.some((x) => x.id === from)) return;
    this.types.push({ from, type: String(msg.type), ev: (msg.env as Envelope | undefined)?.ev?.type, msg });
    this.q.push({ from, to, msg: JSON.parse(JSON.stringify(msg)) });
    if (!this.running) {
      this.running = true;
      setTimeout(() => this.flush(), 0);
    }
  }

  private flush() {
    const batch = this.q.splice(0, 50);
    for (const m of batch) {
      for (const x of this.tables) {
        if (x.id === m.from) continue;
        if (m.to === 'host' && !x.host) continue;
        x.t.receive(structuredClone(m.msg));
      }
    }
    if (this.q.length) setTimeout(() => this.flush(), 0);
    else this.running = false;
  }

  async until(done: () => boolean, ms: number) {
    const t0 = Date.now();
    while (!done()) {
      if (Date.now() - t0 > ms * WAIT_SCALE) throw new Error('時間切れ');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const HUMANS = [
  { id: 'H', name: 'H' },
  { id: 'G', name: 'G' },
  { id: 'K', name: 'K' },
];

/** consentMsG＝G の端末だけ同意の待ちを替える（ホストの予備の時計を確かめるとき、G の時計が先に鳴らないように） */
function start(timeLimit: number, o: { manualG?: boolean; consentMs?: number; consentMsG?: number } = {}) {
  const net = new Net();
  const H = net.add('H', true, { consentMs: o.consentMs });
  const G = net.add('G', false, { manual: o.manualG, consentMs: o.consentMsG ?? o.consentMs });
  const K = net.add('K', false, { consentMs: o.consentMs });
  H.begin(HUMANS, 0, undefined, timeLimit);
  return { net, H, G, K };
}

/** 最初の局が終わって検算も済み、次の局に入った（ホストは自動で次へ進むので「局の終わり」は一瞬しか見えない）。全員の局面がそろっている */
const nextHandBegun = (ts: OnlineTable[]) => ts.every((t) => t.pub.handCount >= 2 && t.pub.nextSeq === ts[0].pub.nextSeq);

describe('制限時間への同意', () => {
  it('時間の無い対局は窓を出さずにすぐ配る', async () => {
    const { net, H, G } = start(0);
    expect(H.consentDeadline).toBeNull();
    await net.until(() => G.pub.phase === 'discard' || G.pub.phase === 'claim', 20_000);
    expect(G.consentDeadline).toBeNull();
  }, 90_000);

  it('全員が同意するまで配らない。そろったら配り、だれも CPU にならない', async () => {
    const { net, H, G, K } = start(60_000);
    await net.until(() => G.consentDeadline !== null && K.consentDeadline !== null, 5_000);
    expect(H.consentDeadline).not.toBeNull();
    H.answerConsent(true);
    G.answerConsent(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(H.pub.phase).toBe('idle');
    K.answerConsent(true);
    await net.until(() => H.pub.phase === 'discard' || H.pub.phase === 'claim', 20_000);
    expect([0, 1, 2].map((s) => H.isProxy(s as 0))).toEqual([false, false, false]);
    expect(net.problems).toEqual([]);
  }, 90_000);

  it('［やめる］を押した人の席は、最初の局から CPU（本人の端末は打たない）。局も最後まで進む', async () => {
    const { net, H, G, K } = start(60_000);
    await net.until(() => G.consentDeadline !== null && K.consentDeadline !== null, 5_000);
    H.answerConsent(true);
    K.answerConsent(true);
    G.answerConsent(false);
    await net.until(() => G.isProxy(1) && H.isProxy(1), 5_000);
    await net.until(() => nextHandBegun([H, G, K]), 60_000);
    expect(net.types.filter((x) => x.from === 'G' && x.type === 'mt-act')).toEqual([]);
    expect(net.problems).toEqual([]);
  }, 270_000);

  it('押さないまま待つ長さが過ぎた人は、本人の端末が「やめる」を送って CPU になる', async () => {
    const { net, H, G, K } = start(60_000, { consentMs: 300 });
    // ★窓が出ている（0.3 秒で閉じる）を見張ると、重いときに見逃して待ち続ける＝卓ができたことを待つ
    await net.until(() => G.started && K.started, 5_000);
    H.answerConsent(true);
    K.answerConsent(true);
    await net.until(() => H.isProxy(1), 5_000);
    expect(G.consentDeadline).toBeNull();
    expect(net.types.some((x) => x.from === 'G' && x.type === 'mt-consent' && x.msg.ok === false)).toBe(true);
    await net.until(() => H.pub.phase === 'discard' || H.pub.phase === 'claim', 20_000);
    expect(net.problems).toEqual([]);
  }, 90_000);

  it('返事が届かない人（端末が止まった）は、ホストの予備の時計で CPU にして始める', async () => {
    // G の端末の時計は長く（自分で「やめる」を送らない）＝ホストの予備の時計（0.2 秒＋予備）だけで CPU になることを確かめる
    const { net, H, G, K } = start(60_000, { consentMs: 200, consentMsG: 60_000 });
    await net.until(() => G.started && K.started, 5_000);
    net.cut('G');
    H.answerConsent(true);
    K.answerConsent(true);
    await net.until(() => H.isProxy(1), 10_000);
    // G は何も返していない（ホストの予備の時計で決まった）
    expect(net.types.some((x) => x.from === 'G' && x.type === 'mt-consent')).toBe(false);
    await net.until(() => H.pub.phase === 'discard' || H.pub.phase === 'claim', 20_000);
  }, 90_000);
});

describe('1 手ごとの時計', () => {
  it('何も押さない人は、時間切れの手（ツモ切り・見送りなど）で局が最後まで進む', async () => {
    const { net, H, G, K } = start(150, { manualG: true });
    await net.until(() => G.consentDeadline !== null && K.consentDeadline !== null, 5_000);
    for (const t of [H, G, K]) t.answerConsent(true);
    await net.until(() => nextHandBegun([H, G, K]), 90_000);
    expect(G.isProxy(1)).toBe(false);
    expect(G.timeouts).toBeGreaterThan(0);
    expect(net.problems).toEqual([]);
    expect(JSON.stringify(G.pub)).toBe(JSON.stringify(H.pub));
    // G の打牌は、引いた牌をそのまま切ったもの（鳴いていないので、ツモ切りできないことは無い）
    const firstHand = G.myLog.slice(0, G.myLog.map((e) => e.ev.type).lastIndexOf('roundStart'));
    const mine = firstHand.filter((e) => e.ev.type === 'discard' && e.ev.seat === 1);
    expect(mine.length).toBeGreaterThan(0);
    for (const e of mine) expect(e.ev.type === 'discard' && e.ev.tsumogiri).toBe(true);
  }, 360_000);

  it('選んだら時計は止まり、時間切れの手は出ない', async () => {
    const { net, H, G, K } = start(5_000, { manualG: true });
    await net.until(() => G.consentDeadline !== null && K.consentDeadline !== null, 5_000);
    for (const t of [H, G, K]) t.answerConsent(true);
    // G の番（選ぶ手がある）まで進めて、時計が動いたらすぐ選ぶ
    await net.until(() => G.deadline !== null, 30_000);
    const left = G.deadline! - Date.now();
    expect(left).toBeGreaterThan(4_000);
    expect(left).toBeLessThanOrEqual(5_000);
    const legal = G.choices();
    const pick = legal.find((a) => a.type === 'pass' || a.type === 'discard') ?? legal[0];
    G.choose(pick);
    await net.until(() => G.deadline === null || G.timeouts > 0, 1_000);
    expect(G.timeouts).toBe(0);
  }, 180_000);
});
