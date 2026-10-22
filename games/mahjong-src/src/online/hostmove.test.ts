// ホストが移る（段階10の5・利用者 2026-10-20）：元のホストが戻らないと、ほかのプレイヤーがホストを受け持つ。
// 新しいホストは自分が見ていた全員に見える出来事の列から卓を作り直し、局の途中ならその局をなかったことにして配り直す。
// 部屋の側（session.ts）がすることを、ここでは手で行う（写しを全員へ配る＝ゲストは作り直す・そのあと配り直す）。

import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import type { Envelope, Seat } from '../engine/events';
import { OnlineTable } from './table';

/**
 * 待ちの上限の倍率。ほかの検査と同時に回ってパソコンが混むと、CPU の手も錠前の計算も遅くなり、
 * 正しく動いていても上限に届いて「時間切れ」で落ちた（第26・席を移す検査で再現した直しを、同じ待ち方の検査にもそろえた）。正しく動くときの所要時間は変わらない
 */
const WAIT_SCALE = 3;

class Net {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  problems: unknown[] = [];
  private q: { from: string; to: 'all' | 'host'; msg: Record<string, unknown> }[] = [];
  private running = false;

  add(id: string, host: boolean, autoNext = true) {
    const t: OnlineTable = new OnlineTable({
      send: (msg, to) => this.push(id, to, msg),
      isHost: host,
      myId: id,
      cpu: benchCpu,
      autoplay: benchCpu,
      autoNext,
      onProblem: (p) => this.problems.push(...p),
    });
    this.tables = this.tables.filter((x) => x.id !== id);
    this.tables.push({ id, t, host });
    return t;
  }

  cut(id: string) {
    this.tables = this.tables.filter((x) => x.id !== id);
  }

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
    if (!this.tables.some((x) => x.id === from)) return;
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

const midHand = (t: OnlineTable) => t.pub.phase !== 'ended' && t.pub.phase !== 'deal' && t.pub.wallLeft > 50 && t.pub.discards.reduce((a, d) => a + d.length, 0) >= 6;

/** 3 人（H＝ホスト・G・K）＋CPU 1 席 */
function start(hostAutoNext = true) {
  const net = new Net();
  const H = net.add('H', true, hostAutoNext);
  const G = net.add('G', false);
  const K = net.add('K', false);
  H.begin([
    { id: 'H', name: 'H' },
    { id: 'G', name: 'G' },
    { id: 'K', name: 'K' },
  ]);
  return { net, H, G, K };
}

/** H が消え、G が新しいホストになる（部屋の側の段取り：作り直す→写しを配る→ほかの人が作り直す→配り直す） */
function takeover(net: Net, oldG: OnlineTable) {
  net.cut('H');
  const NG = net.add('G', true);
  const sync = NG.takeoverFrom(oldG, 0 as Seat);
  const NK = net.add('K', false);
  NK.loadSync(structuredClone(sync));
  NG.afterTakeover();
  return { NG, NK, sync };
}

const lastStart = (wire: { env: Envelope }[]) => [...wire].reverse().find((x) => x.env.ev.type === 'roundStart')?.env.ev;

describe('ホストが移る（段階10の5）', () => {
  it('★局の途中で移る：その局をなかったことにして、新しいホストのもとで同じ局を配り直す。元ホストの席は CPU・点数は局の始まり・検算も通る', async () => {
    const { net, H, G } = start();
    await net.until(() => midHand(H) && G.pub.nextSeq === H.pub.nextSeq, 60_000);
    const voidedStart = lastStart(G.wire);
    const scoresAtStart = G.pub.beforeRound ? G.pub.beforeRound.scores.slice() : null;
    const lastNo = G.syncData().lastNo ?? 0;
    const { NG, NK, sync } = takeover(net, G);
    // 写しの最後は「なかったことにした」
    expect(sync.wire[sync.wire.length - 1].env.ev.type).toBe('roundVoid');
    expect(sync.hand).toBeNull();
    expect(sync.seats[0]).toMatchObject({ kind: 'human', id: 'H', proxy: true });
    expect(NG.isProxy(0 as Seat)).toBe(true);
    expect(NG.mySeat).toBe(1);
    expect(NK.mySeat).toBe(2);
    // なかったことにしたあとの点数は、その局の始まりと同じ（リーチ棒なども戻る）
    expect(scoresAtStart).not.toBeNull();
    expect(NG.pub.scores).toEqual(scoresAtStart);
    expect(NK.pub.scores).toEqual(scoresAtStart);
    // 配り直した局のあと、次の局が始まって途中まで進む（配り直した局の検算が済まないと次の局へ進まない）
    const voidAt = NG.wire.findIndex((x) => x.env.ev.type === 'roundVoid');
    const n = NG.pub.handCount;
    let same = '';
    await net.until(() => {
      // 局の数は、なかったことにすると元に戻り、配り直すと 1 つ増える＝次の局は 2 つ先
      const ok = NG.pub.handCount > n + 1 && midHand(NG) && NK.pub.nextSeq === NG.pub.nextSeq;
      if (ok) same = JSON.stringify(NK.pub) === JSON.stringify(NG.pub) ? 'same' : 'diff';
      return ok;
    }, 360_000);
    expect(same).toBe('same');
    const redealt = NG.wire.slice(voidAt).find((x) => x.env.ev.type === 'roundStart')?.env.ev;
    expect(redealt).toMatchObject({ type: 'roundStart', roundIndex: voidedStart?.type === 'roundStart' ? voidedStart.roundIndex : -1 });
    expect(redealt && redealt.type === 'roundStart' ? (redealt.honba ?? 0) : -1).toBe(voidedStart?.type === 'roundStart' ? (voidedStart.honba ?? 0) : -2);
    // 局の番号は前の続き（番号を使い回すと、前の局の錠前を控えから読み出してしまう）
    expect(NG.syncData().lastNo).toBeGreaterThan(lastNo + 1);
    expect(net.problems).toEqual([]);
  }, 600_000);

  it('★局の間（局が終わって次へ進む前）に移る：なかったことにする局は無く、新しいホストが次の局へ進める', async () => {
    const { net, H, G } = start(false);
    await net.until(() => H.pub.phase === 'ended' && H.handVerified !== null && G.handVerified !== null && G.pub.nextSeq === H.pub.nextSeq, 90_000);
    const before = G.pub.handCount;
    const { NG, NK, sync } = takeover(net, G);
    expect(sync.wire.some((x) => x.env.ev.type === 'roundVoid')).toBe(false);
    let same = '';
    await net.until(() => {
      const ok = NG.pub.handCount > before && midHand(NG) && NK.pub.nextSeq === NG.pub.nextSeq;
      if (ok) same = JSON.stringify(NK.pub) === JSON.stringify(NG.pub) ? 'same' : 'diff';
      return ok;
    }, 270_000);
    expect(same).toBe('same');
    expect(net.problems).toEqual([]);
  }, 600_000);
});
