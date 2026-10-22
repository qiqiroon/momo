// アシストモード（訂正26101113 の 2・設計 アシストモード v0.01 §2）：始める前の案内に全員が OK を押すまで配らない（待つ長さは無い・やめるは無い）。
// 観戦者は案内を見るだけで待たない。返事の前に CPU に替わった席（切れて戻らなかった人）は待たない。偽の通信で 3 人＋CPU 1 席を動かす。
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import type { Envelope } from '../engine/events';
import { CONSENT_GRACE_MS, OnlineTable } from './table';

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
      if (Date.now() - t0 > ms) throw new Error('時間切れ');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

const HUMANS = [
  { id: 'H', name: 'H' },
  { id: 'G', name: 'G' },
  { id: 'K', name: 'K' },
];

/** timeLimit＝制限時間（ミリ秒・0＝なし）。spectator＝観戦者 S も入れる */
function start(o: { timeLimit?: number; consentMs?: number; spectator?: boolean } = {}) {
  const net = new Net();
  const H = net.add('H', true, { consentMs: o.consentMs });
  const G = net.add('G', false, { consentMs: o.consentMs });
  const K = net.add('K', false, { consentMs: o.consentMs });
  const S = o.spectator ? net.add('S', false) : null;
  H.begin(HUMANS, 0, undefined, o.timeLimit ?? 0, true);
  return { net, H, G, K, S };
}

const dealt = (t: OnlineTable) => t.pub.phase === 'discard' || t.pub.phase === 'claim' || t.pub.phase === 'draw';

describe('アシストモードの始まり', () => {
  it('全員に案内が出て、全員が OK を押すまで配らない。ホストには返事のない人の名前。そろったら配り、全員がアシストの卓になる', async () => {
    const { net, H, G, K } = start();
    await net.until(() => G.consentAsk && K.consentAsk, 5_000);
    expect(H.consentAsk).toBe(true);
    // 時間のない対局は締め切りも「やめる」も無い
    expect([H, G, K].map((t) => t.consentDeadline)).toEqual([null, null, null]);
    expect([H, G, K].map((t) => t.assist)).toEqual([true, true, true]);
    expect(H.consentPending).toEqual(['H', 'G', 'K']);
    H.answerConsent(true);
    G.answerConsent(true);
    await net.until(() => H.consentPending.length === 1, 5_000);
    expect(H.consentPending).toEqual(['K']);
    await new Promise((r) => setTimeout(r, 100));
    expect(H.pub.phase).toBe('idle');
    K.answerConsent(true);
    await net.until(() => dealt(H) && dealt(G) && dealt(K), 20_000);
    expect([0, 1, 2].map((s) => H.isProxy(s as 0))).toEqual([false, false, false]);
    expect(net.problems).toEqual([]);
  }, 30_000);

  it('待つ長さは無い：同意の待ちの時間（consentMs）とホストの予備の待ち（CONSENT_GRACE_MS）が過ぎても、だれも CPU にならず配らない', async () => {
    const { net, H, G, K } = start({ consentMs: 100 });
    await net.until(() => G.consentAsk && K.consentAsk, 5_000);
    await new Promise((r) => setTimeout(r, 100 + CONSENT_GRACE_MS + 400));
    expect(H.pub.phase).toBe('idle');
    expect([G.consentAsk, K.consentAsk]).toEqual([true, true]);
    expect(net.types.some((x) => x.type === 'mt-consent')).toBe(false);
    expect([0, 1, 2].map((s) => H.isProxy(s as 0))).toEqual([false, false, false]);
  }, 15_000);

  it('観戦者は案内を見るだけ（返事は送らない・待たない）。閉じれば消える', async () => {
    const { net, H, G, K, S } = start({ spectator: true });
    await net.until(() => !!S && S.assistNotice, 5_000);
    expect(S!.consentAsk).toBe(false);
    [H, G, K].forEach((t) => t.answerConsent(true));
    await net.until(() => dealt(H), 20_000);
    expect(net.types.some((x) => x.from === 'S' && x.type === 'mt-consent')).toBe(false);
    S!.closeAssistNotice();
    expect(S!.assistNotice).toBe(false);
  }, 30_000);

  it('返事の前に切れて戻らなかった人（サーバーが包み無しで渡す）は CPU にして、残りの OK がそろえば配る。局も進む', async () => {
    const { net, H, G, K } = start();
    await net.until(() => G.consentAsk && K.consentAsk, 5_000);
    net.cut('K');
    H.answerConsent(true);
    G.answerConsent(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(H.pub.phase).toBe('idle');
    expect(await H.adoptReleased('K', null)).not.toBe('none');
    await net.until(() => dealt(H) && dealt(G), 20_000);
    expect(H.isProxy(2)).toBe(true);
    // 局の錠前の段取りは 1 回だけ（引き取りの続きが配り直しを重ねない）
    expect(net.types.filter((x) => x.type === 'mt-hand').length).toBe(1);
    await net.until(() => H.pub.handCount >= 2 || H.pub.phase === 'gameover', 60_000);
    expect(net.problems).toEqual([]);
  }, 90_000);

  it('制限時間とアシストの両方：1 つの窓（締め切りあり）で、［やめる］を押した人の席は CPU', async () => {
    const { net, H, G, K } = start({ timeLimit: 60_000 });
    await net.until(() => G.consentAsk && K.consentAsk, 5_000);
    expect(G.consentDeadline).not.toBeNull();
    H.answerConsent(true);
    K.answerConsent(true);
    G.answerConsent(false);
    await net.until(() => H.isProxy(1) && dealt(H), 20_000);
    expect(G.assist).toBe(true);
    expect(net.problems).toEqual([]);
  }, 30_000);
});
