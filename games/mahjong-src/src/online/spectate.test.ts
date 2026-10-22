// 観戦（段階10の3）：途中から入った観戦者の卓。ホストの写し（syncData）から作り、そのあとは全員あての知らせだけで
// ほかの人と同じ局面についていく。席が無いので、誰の配牌・ツモも開けられない（手牌を見せない＝送らない作りのまま）。
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { HIDDEN } from '../engine/events';
import { OnlineTable } from './table';

/**
 * 待ちの上限の倍率。ほかの検査と同時に回ってパソコンが混むと、CPU の手も錠前の計算も遅くなり、
 * 正しく動いていても上限に届いて「時間切れ」で落ちた（第26・席を移す検査で再現した直しを、同じ待ち方の検査にもそろえた）。正しく動くときの所要時間は変わらない
 */
const WAIT_SCALE = 3;

class Net {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  problems: unknown[] = [];
  /** 観戦者が送った卓の知らせ（送らないはず） */
  fromWatcher: string[] = [];
  private q: { from: string; to: 'all' | 'host'; msg: Record<string, unknown> }[] = [];
  private running = false;

  add(id: string, host: boolean, watcher = false) {
    const t: OnlineTable = new OnlineTable({
      send: (msg, to) => {
        if (watcher) this.fromWatcher.push(String(msg.type));
        this.push(id, to, msg);
      },
      isHost: host,
      myId: id,
      cpu: benchCpu,
      autoplay: benchCpu,
      autoNext: true,
      onProblem: (p) => this.problems.push(...p),
    });
    this.tables.push({ id, t, host });
    return t;
  }

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
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

describe('観戦（段階10の3）', () => {
  it('局の途中から入った観戦者：写しで卓を作り、次の局までほかの人と同じ局面。誰の牌も開いていない・何も送らない', async () => {
    const net = new Net();
    const H = net.add('H', true);
    const G = net.add('G', false);
    H.begin(
      [
        { id: 'H', name: 'H' },
        { id: 'G', name: 'G' },
      ],
      0,
    );
    await net.until(() => H.pub.phase !== 'deal' && H.pub.discards.reduce((a, d) => a + d.length, 0) >= 6, 30_000);
    // 部屋の側と同じ：ホストが写しを渡し、観戦者はそれで卓を作る（席は無い）
    const W = net.add('W', false, true);
    W.loadSync(JSON.parse(JSON.stringify(H.syncData())));
    expect(W.mySeat).toBeNull();
    const n = H.pub.handCount;
    await net.until(() => [H, G, W].every((t) => t.pub.handCount > n && t.pub.nextSeq === H.pub.nextSeq) && H.pub.discards.reduce((a, d) => a + d.length, 0) >= 4, 60_000);
    expect(net.problems).toEqual([]);
    expect(JSON.stringify(W.pub)).toBe(JSON.stringify(H.pub));
    // 観戦者の局面には誰の手牌も無い（全部伏せた牌）
    for (const hand of W.view.hands) expect(hand.every((x) => x === HIDDEN)).toBe(true);
    // 観戦者は選べることが無く、卓の知らせを何も送らない
    expect(W.choices()).toEqual([]);
    expect(net.fromWatcher).toEqual([]);
  }, 270_000);
});
