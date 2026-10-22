// 席を移す（段階10・利用者決定 10-15）：本人が降りる・ホストが権限を移す・切れて戻らない人の鍵をサーバーから受け取る・
// 鍵が無ければ局を配り直す・本人が戻ってホストの許可で席を返してもらう。偽の通信で 4 人分を動かす。
import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import { HIDDEN, type Envelope, type Seat } from '../engine/events';
import { replay } from '../engine/state';
import { OnlineTable, type LockerStore, type WireLocker } from './table';
import { rulesOfCnSet } from '../engine/ruleSets';
import type { Rules } from '../engine/rules';

class Net {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  problems: unknown[] = [];
  /** 席ごとの最新の包み（部屋の側がサーバーに預けるもの） */
  packages = new Map<string, { no: number; blob: string }>();
  /** 送った知らせの種類（のぞき見の検査） */
  types: { from: string; type: string; ev?: string }[] = [];
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
      onPackage: (no, blob) => this.packages.set(id, { no, blob }),
    });
    this.tables = this.tables.filter((x) => x.id !== id);
    this.tables.push({ id, t, host });
    return t;
  }

  cut(id: string) {
    this.tables = this.tables.filter((x) => x.id !== id);
  }

  /** その人の送る知らせを止めておく（届くのが遅れた形を作る）。release で送り出す */
  /** 送るたびに呼ぶ（検査が決まった瞬間に手を入れる） */
  onPush: ((from: string, msg: Record<string, unknown>) => void) | null = null;
  private held = new Map<string, { to: 'all' | 'host'; msg: Record<string, unknown> }[]>();
  private heldType = new Map<string, string>();
  hold(id: string, type: string) {
    this.held.set(id, []);
    this.heldType.set(id, type);
  }
  release(id: string) {
    const l = this.held.get(id) ?? [];
    this.held.delete(id);
    this.heldType.delete(id);
    for (const m of l) this.push(id, m.to, m.msg);
  }

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
    if (!this.tables.some((x) => x.id === from)) return;
    this.onPush?.(from, msg);
    const h = this.held.get(from);
    if (h && msg.type === this.heldType.get(from)) {
      h.push({ to, msg });
      return;
    }
    this.types.push({ from, type: String(msg.type), ev: (msg.env as Envelope | undefined)?.ev?.type });
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

/**
 * 待ちの上限の倍率。ほかの検査と同時に回ってパソコンが混むと、CPU の手も錠前の計算も遅くなり、
 * 正しく動いていても上限に届いて「時間切れ」で落ちた（第26 で 3 つ同時に回して再現）。正しく動くときの所要時間は変わらない
 */
const WAIT_SCALE = 3;

/** 錠前の控え（端末の localStorage の代わり。開き直しても残る） */
function memStore(): LockerStore {
  const m = new Map<string, WireLocker>();
  return { save: (no, seat, w) => void m.set(`${no}:${seat}`, w), load: (no, seat) => m.get(`${no}:${seat}`) ?? null };
}

/** 局の途中（何人かが何枚か切ったあと） */
const midHand = (t: OnlineTable, discards = 6) =>
  t.pub.phase !== 'ended' && t.pub.phase !== 'deal' && t.pub.wallLeft > 50 && t.pub.discards.reduce((a, d) => a + d.length, 0) >= discards;

/** 3 人（H・G・K）＋CPU 1 席で始める */
function start(rules?: Rules) {
  const net = new Net();
  const H = net.add('H', true);
  const G = net.add('G', false);
  const K = net.add('K', false);
  H.begin(
    [
      { id: 'H', name: 'H' },
      { id: 'G', name: 'G' },
      { id: 'K', name: 'K' },
    ],
    0,
    rules,
  );
  return { net, H, G, K };
}

/** いまの局が終わって検算が済み、次の局の途中まで進んだ */
async function nextHandRuns(net: Net, H: OnlineTable, others: OnlineTable[]) {
  const n = H.pub.handCount;
  await net.until(() => H.pub.handCount > n && [H, ...others].every((t) => t.pub.nextSeq === H.pub.nextSeq) && midHand(H, 4), 60_000);
}

describe('席を移す（段階10）', () => {
  it('本人が局の途中で降りると、ホストの CPU が続きを打つ。局の検算も通り、次の局もホストが錠前を作って続く', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    await G.yieldSeat();
    await net.until(() => H.isProxy(1) && G.isProxy(1) && K.isProxy(1), 10_000);
    await nextHandRuns(net, H, [G, K]);
    expect(net.problems).toEqual([]);
    // 降りた人は、そのあと打っていない（ホストへの打つ知らせを出していない）。降りたあとの局の自分の牌は伏せたまま
    const iYield = net.types.findIndex((x) => x.type === 'mt-yield');
    expect(net.types.slice(iYield + 1).filter((x) => x.from === 'G' && x.type === 'mt-act')).toEqual([]);
    // 降りた人がその局で引くまで待つ（鳴きで順番が飛ぶと、局の途中でもまだ引いていないことがある）
    const drawsOfG = () => {
      const lastStart = G.myLog.map((e) => e.ev.type).lastIndexOf('roundStart');
      return G.myLog.slice(lastStart).filter((e) => e.ev.type === 'draw' && e.ev.seat === 1);
    };
    await net.until(() => drawsOfG().length > 0 || H.pub.phase === 'ended', 30_000);
    const myDraws = drawsOfG();
    expect(myDraws.length).toBeGreaterThan(0);
    for (const e of myDraws) expect(e.ev.type === 'draw' && e.ev.tile).toBe(HIDDEN);
    // 全員の局面がそろっている（卓は打ち続けているので、届く途中の出来事が無い瞬間に比べる＝前は混んでいると 1 つずれて赤になった・第26）
    await net.until(() => G.pub.nextSeq === H.pub.nextSeq, 10_000);
    expect(JSON.stringify(G.pub)).toBe(JSON.stringify(H.pub));
  }, 270_000);

  it('ホストがつながっている人の席を CPU に移せる（本人の端末が錠前を渡す）', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(K), 30_000);
    H.takeSeat(2);
    await net.until(() => H.isProxy(2) && K.isProxy(2), 10_000);
    await nextHandRuns(net, H, [G, K]);
    expect(net.problems).toEqual([]);
  }, 270_000);

  it('切れて戻らない人：サーバーに預けた包みをホストが受け取ると、その局の続きをホストの CPU が打つ（配り直さない）', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(G) && net.packages.get('G')?.no === H['hand']?.no, 30_000);
    const pkg = net.packages.get('G')!;
    net.cut('G');
    const round = H.pub.roundIndex;
    const r = await H.adoptReleased('G', pkg.blob);
    expect(r).toBe('continued');
    await nextHandRuns(net, H, [K]);
    expect(net.problems).toEqual([]);
    // 配り直していない
    expect(H.myLog.some((e) => e.ev.type === 'roundVoid')).toBe(false);
    expect(H.pub.handCount).toBeGreaterThan(0);
    expect(round).toBeGreaterThanOrEqual(0);
  }, 270_000);

  it('★落ちる直前に引いた牌の、ほかの人の鍵がまだ届いていない：届くのを待ってから続きを打つ（配り直さない）', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    // ホストが G のツモを配った瞬間から K の鍵の知らせを止める（K が G のツモに出す鍵は届かない）
    net.onPush = (from, msg) => {
      const env = msg.env as Envelope | undefined;
      if (from === 'H' && msg.type === 'mt-ev' && env?.ev.type === 'draw' && env.ev.seat === 1) {
        net.hold('K', 'mt-keys');
        net.onPush = null;
      }
    };
    const drawsOfG = () => H.wire.filter((x) => x.env.ev.type === 'draw' && x.env.ev.seat === 1).length;
    const n0 = drawsOfG();
    await net.until(() => drawsOfG() > n0 && net.packages.get('G')?.no === H['hand']?.no, 30_000);
    const pkg = net.packages.get('G')!;
    net.cut('G');
    expect(await H.adoptReleased('G', pkg.blob)).toBe('continued');
    // まだ打てない（局面を持たない）
    expect(H.views.has(1)).toBe(false);
    net.release('K');
    await net.until(() => H.views.has(1), 10_000);
    await nextHandRuns(net, H, [K]);
    expect(net.problems).toEqual([]);
    expect(H.myLog.some((e) => e.ev.type === 'roundVoid')).toBe(false);
  }, 270_000);

  it('★落ちた人が、ほかの人のツモに出すはずだった鍵をまだ出していない：ホストが代わりに出す（K のツモが開く）', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    // ホストが K のツモを配った瞬間から G の鍵の知らせを止め、そのまま G を切る（G が K に出す鍵は届かない）
    let cutDone = false;
    net.onPush = (from, msg) => {
      const env = msg.env as Envelope | undefined;
      if (from === 'H' && msg.type === 'mt-ev' && env?.ev.type === 'draw' && env.ev.seat === 2) {
        net.hold('G', 'mt-keys');
        net.onPush = null;
        cutDone = true;
      }
    };
    await net.until(() => cutDone, 30_000);
    const pkg = net.packages.get('G')!;
    net.cut('G');
    expect(await H.adoptReleased('G', pkg.blob)).toBe('continued');
    await nextHandRuns(net, H, [K]);
    expect(net.problems).toEqual([]);
  }, 270_000);

  it('★四川（缺一門で伏せた牌がある）：局の途中で降りても、本人だけに見える出来事の本物を渡すので、配り直さずに続く', async () => {
    const { net, H, G, K } = start(rulesOfCnSet('sichuan'));
    const mid = (t: OnlineTable) => t.pub.phase !== 'ended' && t.pub.phase !== 'deal' && t.pub.wallLeft > 30 && t.pub.que.every((q) => q !== null) && t.pub.discards.reduce((a, d) => a + d.length, 0) >= 6;
    await net.until(() => mid(H) && mid(G), 30_000);
    await G.yieldSeat();
    await net.until(() => H.isProxy(1) && K.isProxy(1), 10_000);
    const n = H.pub.handCount;
    await net.until(() => H.pub.handCount > n && K.pub.nextSeq === H.pub.nextSeq, 60_000);
    expect(net.problems).toEqual([]);
    expect(H.myLog.some((e) => e.ev.type === 'roundVoid')).toBe(false);
  }, 270_000);

  it('★ホストの局面が遅れている間に届いた、先の局面の知らせは捨てずに預かる（捨てると送った人は送り直さず卓が止まる＝前からの不具合）', async () => {
    // 親の最初のツモがホストの持つ席（ホストか CPU）の局を作る（親はサイコロで決まるので、そうなるまで作り直す）
    for (let tries = 0; tries < 8; tries++) {
      const net = new Net();
      const H = net.add('H', true);
      const G = net.add('G', false);
      let held = false;
      net.onPush = (from, msg) => {
        const env = msg.env as Envelope | undefined;
        // ホストが親の最初のツモ（ホストの持つ席）を配った瞬間から、G の鍵の知らせを止める＝ホストはそのツモを開けられず局面が止まる
        if (!held && from === 'H' && msg.type === 'mt-ev' && env?.ev.type === 'draw' && (env.ev.seat === 0 || env.ev.seat === 2 || env.ev.seat === 3)) {
          held = true;
          net.hold('G', 'mt-keys');
        }
      };
      H.begin(
        [
          { id: 'H', name: 'H' },
          { id: 'G', name: 'G' },
        ],
        0,
        rulesOfCnSet('sichuan'),
      );
      await net.until(() => H.pub.phase === 'que' || G.pub.phase === 'que' || G.pub.phase === 'discard', 20_000);
      if (!held) continue; // 親が G だった：作り直す
      // G は先に進んで伏せる牌を送った。ホストはまだ配る途中（G の鍵待ち）
      await net.until(() => net.types.some((x) => x.from === 'G' && x.type === 'mt-act'), 10_000);
      expect(H.pub.phase).toBe('deal');
      net.release('G');
      await net.until(() => H.pub.que.every((q) => q !== null), 10_000);
      expect(net.problems).toEqual([]);
      return;
    }
    throw new Error('親がホストの持つ席になる局が作れなかった');
  }, 270_000);

  it('★2 局目以降に開き直して戻る：ホストが渡す列で作り直せて、続きを打てる（前は前の局の出来事の順が狂って止まり、画面が暗いまま＝10-15 利用者指摘）', async () => {
    const net = new Net();
    const H = net.add('H', true);
    const store = memStore();
    net.add('G', false, store);
    H.begin([
      { id: 'H', name: 'H' },
      { id: 'G', name: 'G' },
    ]);
    await net.until(() => H.pub.handCount >= 2 && midHand(H, 4), 90_000);
    net.cut('G');
    // 開き直した：同じ ID と錠前の控えで新しい卓を作り、ホストが渡す列で作り直す（部屋の側の mt-sync と同じ）
    const G2 = net.add('G', false, store);
    G2.loadSync(JSON.parse(JSON.stringify(H.syncData())));
    expect(G2.mySeat).toBe(1);
    await nextHandRuns(net, H, [G2]);
    expect(net.problems).toEqual([]);
    expect(JSON.stringify(G2.pub)).toBe(JSON.stringify(H.pub));
  }, 450_000);

  it('★配り直したあとに開き直して戻る（なかったことにした局をはさんでも作り直せる）', async () => {
    const net = new Net();
    const H = net.add('H', true);
    const store = memStore();
    net.add('G', false, store);
    net.add('K', false);
    H.begin([
      { id: 'H', name: 'H' },
      { id: 'G', name: 'G' },
      { id: 'K', name: 'K' },
    ]);
    await net.until(() => midHand(H, 6), 30_000);
    net.cut('K');
    expect(await H.adoptReleased('K', null)).toBe('redealt');
    await net.until(() => H.myLog.some((e) => e.ev.type === 'roundVoid') && midHand(H, 4), 30_000);
    net.cut('G');
    const G2 = net.add('G', false, store);
    G2.loadSync(JSON.parse(JSON.stringify(H.syncData())));
    await nextHandRuns(net, H, [G2]);
    expect(net.problems).toEqual([]);
    expect(JSON.stringify(G2.pub)).toBe(JSON.stringify(H.pub));
  }, 450_000);

  it('預かりが無い：その局をなかったことにして、同じ局を CPU 入りで配り直す（Q5=A）', async () => {
    const { net, H, K } = start();
    await net.until(() => midHand(H, 8) && midHand(K, 8), 30_000);
    const before = { roundIndex: H.pub.roundIndex, honba: H.pub.honba, dealer: H.pub.dealer };
    const startScores = H.pub.beforeRound!.scores.slice();
    net.cut('G');
    expect(await H.adoptReleased('G', null)).toBe('redealt');
    await net.until(() => H.myLog.some((e) => e.ev.type === 'roundVoid') && midHand(H, 2) && K.pub.nextSeq === H.pub.nextSeq, 30_000);
    // 同じ局・同じ本場を配り直した。点は局の始まりに戻ってから動く
    const starts = H.myLog.filter((e) => e.ev.type === 'roundStart').map((e) => e.ev);
    const last = starts.at(-1)!;
    expect(last).toEqual({ type: 'roundStart', roundIndex: before.roundIndex, dealer: before.dealer, honba: before.honba });
    expect(H.pub.beforeRound!.scores).toEqual(startScores);
    // 配り直した局が終わって検算が済むまで待つ
    const n = K.pub.handCount;
    await net.until(() => K.pub.handCount === n && K.pub.phase === 'ended' && K.handVerified !== null, 60_000);
    expect(net.problems).toEqual([]);
    // 牌譜（全員の牌が見える形）は、なかったことにした局を除いて最初から当てはめ直せる
    const full = K.fullLog();
    expect(full).not.toBeNull();
    expect(full!.some((e) => e.ev.type === 'roundVoid')).toBe(false);
    expect(() => replay(full!)).not.toThrow();
  }, 270_000);

  it('席を返す：本人が頼み、ホストが許可すると、次の自分の番から本人が打つ（Q4=A）。断ることもできる', async () => {
    const { net, H, G, K } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    await G.yieldSeat();
    await net.until(() => H.isProxy(1) && G.isProxy(1), 10_000);
    // 断る
    G.requestReclaim();
    await net.until(() => H.reclaims.has(1), 10_000);
    await H.answerReclaim(1, false);
    await net.until(() => G.reclaimRefused && !G.reclaimPending, 10_000);
    expect(H.isProxy(1)).toBe(true);
    // もう一度頼んで、許可する
    G.requestReclaim();
    await net.until(() => H.reclaims.has(1), 10_000);
    await H.answerReclaim(1, true);
    await net.until(() => !H.isProxy(1) && !G.isProxy(1) && !K.isProxy(1), 10_000);
    const iGive = net.types.findIndex((x) => x.type === 'mt-give');
    await nextHandRuns(net, H, [G, K]);
    expect(net.problems).toEqual([]);
    // 返してもらったあと、本人が打っている
    expect(net.types.slice(iGive + 1).some((x) => x.from === 'G' && x.type === 'mt-act')).toBe(true);
    // 本人の端末で自分の牌が開いている（次の局も）
    const lastStart = G.myLog.map((e) => e.ev.type).lastIndexOf('roundStart');
    const myDraws = G.myLog.slice(lastStart).filter((e) => e.ev.type === 'draw' && e.ev.seat === (1 as Seat));
    for (const e of myDraws) expect(e.ev.type === 'draw' && e.ev.tile).not.toBe(HIDDEN);
  }, 270_000);

  it('★席を返してもらったら、その局のうちにすぐ自分の包みを預け直す（預け直さないと、切れたときの 3 分の時計で古い包みがホストへ渡り、席がまた CPU に戻る＝10-21 見回りで発見）', async () => {
    const { net, H, G } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    await G.yieldSeat();
    await net.until(() => H.isProxy(1) && G.isProxy(1), 10_000);
    net.packages.delete('G');
    // 預けた時点（それまでに送られた知らせの数）を控える
    const at: number[] = [];
    const set = net.packages.set.bind(net.packages);
    net.packages.set = (k, v) => {
      if (k === 'G') at.push(net.types.length);
      return set(k, v);
    };
    const hc = H.pub.handCount;
    G.requestReclaim();
    await net.until(() => H.reclaims.has(1), 10_000);
    // ★預け直しを「作り始めた瞬間」に、G の手の出来事（ツモ・打牌など）がもう起きていたかを控える
    // （自分の手の出来事のついでに預けるのでは、打つ番が来ないあいだに切れると間に合わない）。
    // 前は「預け終わったのが最初に打つより先か」を比べていて、混んでいると預ける暗号の計算が終わる前に 1 手打ち、赤になった（第26）。
    // 席を任せたあとの G で包みを作るのは預けるときだけ
    const g = G as unknown as { packageOf: (seat: Seat) => unknown; ownLogs: Map<Seat, unknown[]> };
    const own = () => g.ownLogs.get(1 as Seat)?.length ?? 0;
    const base = own();
    const made: boolean[] = [];
    const packageOf = g.packageOf.bind(G);
    g.packageOf = (seat) => {
      const pkg = packageOf(seat);
      if (pkg) made.push(own() > base);
      return pkg;
    };
    const no = H['hand']?.no;
    await H.answerReclaim(1, true);
    const iGive = net.types.length;
    await net.until(() => at.length > 0 || H.pub.handCount > hc, 10_000);
    expect(H.pub.handCount).toBe(hc);
    expect(at[0]).toBeGreaterThanOrEqual(iGive);
    // 席を返した局の包み（次の局が始まったときに預けたのでは遅い）
    expect(no).toBeDefined();
    expect(net.packages.get('G')?.no).toBe(no);
    expect(made[0]).toBe(false);
  }, 180_000);

  it('包みはホストにしか開けられない：ほかの人に届く知らせに錠前の中身は出ていない', async () => {
    const { net, H, G } = start();
    await net.until(() => midHand(H) && midHand(G), 30_000);
    const lk = (G as unknown as { hand: { mine: Map<Seat, { perCard: { d: bigint }[] }> } }).hand.mine.get(1)!;
    const secret = lk.perCard[0].d.toString(36);
    const seen: string[] = [];
    const K2 = net.tables.find((x) => x.id === 'K')!.t;
    const orig = K2.receive.bind(K2);
    K2.receive = (d) => {
      seen.push(JSON.stringify(d));
      orig(d);
    };
    await G.yieldSeat();
    await net.until(() => H.isProxy(1), 10_000);
    expect(seen.some((x) => x.includes('mt-yield'))).toBe(false);
    expect(seen.some((x) => x.includes(secret))).toBe(false);
    expect(net.packages.get('G')!.blob).not.toContain(secret);
  }, 180_000);
});
