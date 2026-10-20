// 開き直して戻る（大方針・利用者 2026-10-20「３分以内ならホストもゲストも復活を待つ、３分を超えたら一旦CPUに変わる」）。
// 開き直すと画面の中の局面は消える。戻るのに使うのは：鍵のかかった山と出来事の記録（ほかの人の端末にある）＋端末の控え（自分の鍵・本人にだけ見える選び）。
// ★前は「本人にだけ見える選び」（四川の伏せ牌・換三張）を端末に控えていなかった＝開き直すと消えた。

import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { HIDDEN, type Envelope } from '../engine/events';
import { rulesOfCnSet } from '../engine/ruleSets';
import type { Rules } from '../engine/rules';
import { OnlineTable, type LockerStore, type WireLocker } from './table';

class Net {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  problems: unknown[] = [];
  private q: { from: string; to: 'all' | 'host'; msg: Record<string, unknown> }[] = [];
  private running = false;

  add(id: string, host: boolean, store?: LockerStore) {
    const t: OnlineTable = new OnlineTable({
      store,
      send: (msg, to) => this.push(id, to, msg),
      isHost: host,
      myId: id,
      cpu: benchCpu,
      autoplay: benchCpu,
      autoNext: true,
      onProblem: (p) => this.problems.push(...p),
    });
    this.tables = this.tables.filter((x) => x.id !== id);
    this.tables.push({ id, t, host });
    return t;
  }

  cut(id: string) {
    this.tables = this.tables.filter((x) => x.id !== id);
  }

  /** 送るたびに呼ぶ（決まった瞬間に手を入れる） */
  onPush: ((from: string, msg: Record<string, unknown>) => void) | null = null;

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
    if (!this.tables.some((x) => x.id === from)) return;
    this.onPush?.(from, msg);
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

  async until(done: () => boolean, ms: number, label = '') {
    const t0 = Date.now();
    while (!done()) {
      if (Date.now() - t0 > ms) throw new Error('時間切れ：' + label);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

/** 端末の控え（localStorage の代わり。開き直しても残る）。鍵も本人にだけ見える選びも */
function memStore(): LockerStore {
  const m = new Map<string, WireLocker>();
  const p = new Map<string, Envelope[]>();
  return {
    save: (no, seat, w) => void m.set(`${no}:${seat}`, w),
    load: (no, seat) => m.get(`${no}:${seat}`) ?? null,
    savePriv: (no, seat, envs) => void p.set(`${no}:${seat}`, JSON.parse(JSON.stringify(envs))),
    loadPriv: (no, seat) => p.get(`${no}:${seat}`) ?? [],
  };
}

function start(rules?: Rules) {
  const net = new Net();
  const H = net.add('H', true);
  const store = memStore();
  const G = net.add('G', false, store);
  H.begin(
    [
      { id: 'H', name: 'H' },
      { id: 'G', name: 'G' },
    ],
    0,
    rules,
  );
  return { net, H, G, store };
}

/** ホストも端末の控えを持つ形で始める（H・G の 2 人＋CPU 2 席） */
function startWithHostStore(hostAutoNext = true) {
  const net = new Net();
  const hs = memStore();
  const gs = memStore();
  const H = net.add('H', true, hs);
  if (!hostAutoNext) (H as unknown as { o: { autoNext: boolean } }).o.autoNext = false;
  const G = net.add('G', false, gs);
  H.begin([
    { id: 'H', name: 'H' },
    { id: 'G', name: 'G' },
  ]);
  return { net, H, G, hs, gs };
}

/** ホストが開き直して戻る（部屋の側の段取り：ゲストの写しで作り直す→全員へ写しを配る→ゲストは作り直す→鍵を頼み直す） */
function hostReopens(net: Net, G: OnlineTable, hs: LockerStore, gs: LockerStore) {
  net.cut('H');
  const NH = net.add('H', true, hs);
  NH.resumeAsHost(JSON.parse(JSON.stringify(G.syncData())));
  const G2 = net.add('G', false, gs);
  G2.loadSync(JSON.parse(JSON.stringify(NH.syncData())));
  NH.rekeyMine();
  return { NH, G2 };
}

const midHand = (t: OnlineTable) => t.pub.phase !== 'ended' && t.pub.phase !== 'deal' && t.pub.wallLeft > 50 && t.pub.discards.reduce((a, d) => a + d.length, 0) >= 6;

describe('開き直して戻る（3 分以内は復活を待つ）', () => {
  it('★ホストが次の局の錠前の段取りを始めた瞬間に開き直す：段取りの続きから配る（止まらない・終わった局を配り直さない）', async () => {
    const { net, H, G, hs, gs } = startWithHostStore(false);
    await net.until(() => H.pub.phase === 'ended' && G.pub.nextSeq === H.pub.nextSeq && G.handVerified !== null && H.handVerified !== null, 90_000, '局が終わる');
    const hc = H.pub.handCount;
    const no = H.syncData().lastNo ?? 0;
    // ホストが次の局の段取り（mt-hand）を送った瞬間に落ちる（段取りの最初の 1 段＝ホストの席もまだ）
    let cutNow = false;
    net.onPush = (from, msg) => {
      if (from === 'H' && msg.type === 'mt-hand') cutNow = true;
    };
    H.next();
    await net.until(() => cutNow, 5000, '段取りを始める');
    net.onPush = null;
    await net.until(() => G.syncData().lastNo === no + 1, 5000, 'ゲストに段取りが届く');
    expect(G.syncData().hand?.dealt ?? 0).toBe(0);
    const { NH, G2 } = hostReopens(net, G, hs, gs);
    await net.until(() => NH.pub.handCount > hc && midHand(NH) && G2.pub.nextSeq === NH.pub.nextSeq, 120_000, '次の局');
    expect(NH.wire.filter((x) => x.env.ev.type === 'roundStart').length).toBe(hc + 1);
    expect(net.problems).toEqual([]);
  }, 200_000);

  it('★ホストが局の途中で開き直す：ゲストの写しと端末の控えで、ホストのまま同じ局の続きを打つ（なかったことにしない）', async () => {
    const { net, H, G, hs, gs } = startWithHostStore();
    await net.until(() => midHand(H) && G.pub.nextSeq === H.pub.nextSeq, 60_000, '局の途中');
    const seq = H.pub.nextSeq;
    const hc = H.pub.handCount;
    const { NH, G2 } = hostReopens(net, G, hs, gs);
    expect(NH.mySeat).toBe(0);
    // 続きを打ち、局が終わって検算が済み、次の局へ進む
    await net.until(() => NH.pub.handCount > hc && midHand(NH) && G2.pub.nextSeq === NH.pub.nextSeq, 120_000, '次の局');
    expect(NH.wire.some((x) => x.env.ev.type === 'roundVoid')).toBe(false);
    expect(NH.wire.length).toBeGreaterThan(seq);
    expect(net.problems).toEqual([]);
  }, 200_000);

  it('★ホストが局の間（終わって次へ進む前）に開き直す：終わった局の検算を済ませ、次の局を配る（終わった局を配り直さない）', async () => {
    const { net, H, G, hs, gs } = startWithHostStore(false);
    await net.until(() => H.pub.phase === 'ended' && G.pub.nextSeq === H.pub.nextSeq && G.handVerified !== null, 90_000, '局が終わる');
    const hc = H.pub.handCount;
    const no = H.syncData().lastNo ?? 0;
    const { NH, G2 } = hostReopens(net, G, hs, gs);
    NH.next();
    await net.until(() => NH.pub.handCount > hc && midHand(NH) && G2.pub.nextSeq === NH.pub.nextSeq, 120_000, '次の局');
    expect(NH.wire.filter((x) => x.env.ev.type === 'roundStart').length).toBe(hc + 1);
    // 次の局は新しい錠前の段取りで配った（局の番号が 1 つ進む）。★局の始まりの数だけだと、終わった局の山で配り直しても見分けられなかった
    expect(NH.syncData().lastNo).toBe(no + 1);
    expect(net.problems).toEqual([]);
  }, 200_000);

  it('★四川：伏せる牌を決めたあとにゲストが開き直しても、伏せた牌を取り戻して続きを打てる（前は控えていなかった）', async () => {
    const { net, H, G, store } = start(rulesOfCnSet('sichuan'));
    // G が伏せる牌を決めたあと、まだ自分の最初の 1 枚（伏せた牌）を切っていないとき＝伏せた牌はまだ本人にしか見えない。
    // ★全員が切り終えたあとに開き直すと、伏せた牌はもう表に出ていて穴を通らなかった
    const held = (t: OnlineTable) => t.pub.queHeld[1] !== null && t.pub.discards[1].length === 0 && t.pub.phase !== 'deal';
    await net.until(() => held(H) && held(G) && G.pub.nextSeq === H.pub.nextSeq && G.view.queHeld[1] !== HIDDEN, 60_000, '伏せたところ');
    net.cut('G');
    const G2 = net.add('G', false, store);
    G2.loadSync(JSON.parse(JSON.stringify(H.syncData())));
    expect(G2.mySeat).toBe(1);
    // 自分の手牌がすべて開いている（伏せた牌の中身も取り戻している）
    await net.until(() => G2.pub.nextSeq >= H.pub.nextSeq && G2.view.hands[1].length > 0 && !G2.view.hands[1].includes(HIDDEN), 20_000, '開き直して手牌が開く');
    // 伏せた牌の中身も取り戻している（取り戻せないと、自分の最初の 1 枚＝伏せた牌を切れずに卓が止まった）
    await net.until(() => G2.view.queHeld[1] !== null && G2.view.queHeld[1] !== HIDDEN, 10_000, '伏せた牌を取り戻す');
    // 局が終わって検算が済み、次の局に進む
    const n = H.pub.handCount;
    await net.until(() => H.pub.handCount > n && G2.pub.nextSeq === H.pub.nextSeq, 90_000, '次の局');
    expect(net.problems).toEqual([]);
  }, 150_000);
});
