import { decodeSameLink, encodeSameLink, sameWallOf } from '../kifu/same';
import { startRoundFromWall } from '../engine/round';
import { dealerByDice } from '../engine/state';
import { describe, expect, it } from 'vitest';
import { rulesOfSet } from '../engine/ruleSets';
import { packKifu, unpackKifu } from '../kifu/link';
import { GENERAL_RULES } from '../engine/rules';
import { benchCpu } from '../cpu/bench';
import { tsumogiriCpu } from '../cpu/tsumogiri';
import { HIDDEN, type Envelope } from '../engine/events';
import { replay } from '../engine/state';
import { OnlineTable, type LockerStore, type WireLocker } from './table';

// 偽の通信：送った順に、少し遅らせて 1 通ずつ届ける（本物の中継と同じく、送った本人には返さない）
class FakeNet {
  tables: { id: string; t: OnlineTable; host: boolean }[] = [];
  private q: { from: string; to: 'all' | 'host'; msg: Record<string, unknown> }[] = [];
  private running = false;
  bytes = 0;
  messages = 0;
  /** のぞき見の検査：届いたものを全部とっておく */
  seen = new Map<string, Record<string, unknown>[]>();
  /** 検算で見つかった食い違い（どの局でも） */
  problems: unknown[] = [];
  /** 検算した回数 */
  verified = 0;
  /** 返事の待ちの検査：最後に捨て牌が届いた時刻（人ごと）と、返事を出すまでの長さ */
  lastDiscardAt = new Map<string, number>();
  replyGaps: { id: string; gap: number; type: string }[] = [];

  add(id: string, host: boolean, o: { human: boolean; cpu?: typeof benchCpu; store?: LockerStore }) {
    const t: OnlineTable = new OnlineTable({
      store: o.store,
      send: (msg, to) => this.push(id, to, msg),
      isHost: host,
      myId: id,
      cpu: benchCpu,
      autoplay: o.human ? (o.cpu ?? benchCpu) : undefined,
      autoNext: true,
      onProblem: (p) => this.problems.push(...p),
      onChange: () => {
        const v = t.handVerified;
        if (v !== null && !counted.has(v)) {
          counted.add(v);
          this.verified++;
        }
      },
    });
    const counted = new WeakSet<object>();
    this.tables = this.tables.filter((x) => x.id !== id);
    this.tables.push({ id, t, host });
    if (!this.seen.has(id)) this.seen.set(id, []);
    return t;
  }

  /** 接続が切れた（その人あての知らせは届かない・その人の古い卓からの知らせも届かない） */
  cut(id: string) {
    this.tables = this.tables.filter((y) => y.id !== id);
  }

  /** 送った時刻の記録（送った人・種類・出来事の種類） */
  sent: { from: string; type: string; ev?: string; at: number }[] = [];

  private push(from: string, to: 'all' | 'host', msg: Record<string, unknown>) {
    if (!this.tables.some((x) => x.id === from)) return;
    this.sent.push({ from, type: String(msg.type), ev: (msg.env as Envelope | undefined)?.ev?.type, at: Date.now() });
    if (msg.type === 'mt-act') {
      const ev = (msg.envs as Envelope[])[0]?.ev;
      const at = this.lastDiscardAt.get(from);
      if (ev && (ev.type === 'pass' || ev.type === 'call' || ev.type === 'ron') && at !== undefined) this.replyGaps.push({ id: from, gap: Date.now() - at, type: ev.type });
    }
    const s = JSON.stringify(msg);
    this.bytes += s.length;
    this.messages++;
    this.q.push({ from, to, msg: JSON.parse(s) });
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
        this.seen.get(x.id)!.push(m.msg);
        if (m.msg.type === 'mt-ev' && (m.msg.env as Envelope).ev.type === 'discard') this.lastDiscardAt.set(x.id, Date.now());
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

describe('オンラインの卓（偽の通信）', () => {
  // 半荘は 1 分ほど計算し続けるので、いつもの検査と並べると他の検査が時間切れになる＝別に回す（npm run onlineplay）
  it.runIf(import.meta.env.MODE === 'full')('ホスト＋人 1 人＋CPU 2 席で半荘を最後まで打てる。全員の点数がそろい、毎局の検算で食い違いなし', async () => {
    const net = new FakeNet();
    const host = net.add('H', true, { human: true });
    const guest = net.add('G', false, { human: true, cpu: tsumogiriCpu });
    host.begin([
      { id: 'H', name: 'ホスト' },
      { id: 'G', name: 'ゲスト' },
    ]);
    await net.until(() => host.pub.phase === 'gameover' && guest.pub.phase === 'gameover' && host.handVerified !== null && guest.handVerified !== null, 170_000);
    expect(host.mySeat).toBe(0);
    expect(guest.mySeat).toBe(1);
    expect(guest.view.scores).toEqual(host.view.scores);
    expect(guest.pub.nextSeq).toBe(host.pub.nextSeq);
    expect(net.problems).toEqual([]);
    // 毎局、ホストとゲストの両方が検算した
    const hands = host.myLog.filter((e) => e.ev.type === 'roundStart').length;
    expect(hands).toBeGreaterThanOrEqual(1); // 飛びで早く終わる半荘もある（山は毎回違う）
    expect(net.verified).toBe(2 * hands);
    // 全員に見える局面は、ホストとゲストで同じ
    expect(JSON.stringify(guest.pub)).toBe(JSON.stringify(host.pub));
    // ゲストの局面に、ほかの人の配牌・ツモの中身は届いていない（自分の分だけ開いている）
    const others = guest.myLog.filter((e) => (e.ev.type === 'deal' || e.ev.type === 'draw') && e.ev.seat !== 1);
    expect(others.length).toBeGreaterThan(0);
    for (const e of others) expect(e.ev.type === 'deal' ? e.ev.tiles.every((x) => x === HIDDEN) : e.ev.type === 'draw' && e.ev.tile === HIDDEN).toBe(true);
    const mine = guest.myLog.filter((e) => e.ev.type === 'draw' && e.ev.seat === 1);
    expect(mine.length).toBeGreaterThan(0);
    for (const e of mine) expect(e.ev.type === 'draw' && e.ev.tile).not.toBe(HIDDEN);
    // 牌譜（6d）：ホストとゲストで同じ・全員の牌が見える列。リンクに詰めて読み直しても同じ
    const full = host.fullLog();
    expect(full).not.toBeNull();
    expect(guest.fullLog()).toEqual(full);
    const src = { seed: 'online', startedAt: '2026-10-11T12:00:00+09:00', players: [], set: 'general', events: full!, mode: 'online' as const, walls: host.walls };
    expect(unpackKifu(packKifu(src)).events).toEqual(full);
    expect(unpackKifu(packKifu({ ...src, walls: undefined })).events).toEqual(full);
    console.log(`半荘 ${hands} 局・通信 ${net.messages} 通・${(net.bytes / 1e6).toFixed(2)} MB`);
  }, 180_000);

  it('人 4 人で 1 局：誰の局面にも、ほかの人の牌の中身は届かない。局面は出来事の列だけで決まる', async () => {
    const net = new FakeNet();
    const ids = ['A', 'B', 'C', 'D'];
    const ts = ids.map((id, i) => net.add(id, i === 0, { human: true }));
    (ts[0] as unknown as { o: { autoNext: boolean } }).o.autoNext = false;
    ts[0].begin(ids.map((id) => ({ id, name: id })));
    await net.until(() => ts.every((t) => t.pub.phase === 'ended') && ts.every((t) => t.lastVerify !== null), 60_000);
    expect(net.problems).toEqual([]);
    for (const [i, t] of ts.entries()) {
      expect(t.lastVerify).toEqual([]);
      const leaked = t.myLog.filter((e) => (e.ev.type === 'deal' || e.ev.type === 'draw') && e.ev.seat !== i && (e.ev.type === 'deal' ? e.ev.tiles.some((x) => x !== HIDDEN) : e.ev.tile !== HIDDEN));
      expect(leaked).toEqual([]);
      // 自分の席から見た局面を出来事の列から作り直しても同じ（列だけで局面が決まる）
      expect(JSON.stringify(replay(t.myLog))).toBe(JSON.stringify(t.view));
    }
    // 牌譜（6d・Q42＝A）：検算で分かった山で埋めると、誰の端末でも同じ・全員の牌が見える列になる
    const full = ts.map((t) => t.fullLog());
    expect(full[0]).not.toBeNull();
    for (const f of full) expect(f).toEqual(full[0]);
    expect(full[0]!.some((e) => (e.ev.type === 'deal' && e.ev.tiles.includes(HIDDEN)) || (e.ev.type === 'draw' && e.ev.tile === HIDDEN))).toBe(false);
    // 牌譜のリンクに詰めて読み直しても同じ
    const src = { seed: 'online', startedAt: '2026-10-11T12:00:00+09:00', players: [], set: 'general', events: full[0]!, mode: 'online' as const, walls: ts[0].walls };
    expect(unpackKifu(packKifu(src)).events).toEqual(full[0]);
    // 山の並びの控えが無い（ファイルから読んだ）牌譜も、出来事から山を読み取って詰められる
    const fromFile = { ...src, walls: undefined };
    expect(unpackKifu(packKifu(fromFile)).events).toEqual(full[0]);
    // 同じ山で勝負（Q5=A）：錠前で配った本物の山。席 2 の人の牌譜から作ったリンクで、受け取った人（席 0）は席 2 の配牌から始まる
    const sw = decodeSameLink(encodeSameLink(sameWallOf({ ...src, me: 2 })))!;
    const o = sw.online!;
    const mine = startRoundFromWall(2, { roundIndex: 0, dealer: dealerByDice(o.by, o.dice), honba: 0 }, (pos) => o.walls[0][pos]).flatMap((e) => (e.ev.type === 'deal' && e.ev.seat === 0 ? e.ev.tiles : []));
    const theirs = full[0]!.flatMap((e) => (e.ev.type === 'deal' && e.ev.seat === 2 ? e.ev.tiles : []));
    expect(mine).toHaveLength(13);
    expect(mine).toEqual(theirs);
  }, 70_000);

  it('ホストが選んだルール（WRC）で 1 局：全員の局面のルールがそれになり、局が終わって検算も通る', async () => {
    const net = new FakeNet();
    const host = net.add('H', true, { human: true });
    const guest = net.add('G', false, { human: true, cpu: tsumogiriCpu });
    (host as unknown as { o: { autoNext: boolean } }).o.autoNext = false;
    const wrc = rulesOfSet('wrc');
    host.begin(
      [
        { id: 'H', name: 'ホスト' },
        { id: 'G', name: 'ゲスト' },
      ],
      0,
      wrc,
    );
    await net.until(() => [host, guest].every((t) => t.pub.phase === 'ended' && t.lastVerify !== null), 60_000);
    expect(net.problems).toEqual([]);
    for (const t of [host, guest]) {
      expect(t.view.rules).toEqual(wrc);
      expect(t.lastVerify).toEqual([]);
    }
    // 一般ルールとは違う値（赤ドラなし）で配られている
    expect(wrc).not.toEqual(GENERAL_RULES);
  }, 70_000);

  it('★表に開けてよいのはドラ・裏ドラの位置だけ：山のツモ牌の位置を開けるよう頼まれても、誰も鍵を出さない', async () => {
    const net = new FakeNet();
    const ids = ['A', 'B'];
    const ts = ids.map((id, i) => net.add(id, i === 0, { human: true }));
    ts[0].begin(ids.map((id) => ({ id, name: id })));
    await net.until(() => ts.every((t) => t.view.phase === 'discard' || t.view.phase === 'claim' || t.view.phase === 'draw') && ts[1].myLog.length > 20, 30_000);
    const before = net.messages;
    // 悪い B：まだ誰も引いていない山の位置（100 番目）を表に開けさせようとする
    const h = (ts[1] as unknown as { hand: { no: number } }).hand;
    net.tables[1].t.receive({ type: 'mt-open', no: h.no, positions: [100] });
    (ts[1] as unknown as { send: (m: unknown, to: string) => void }).send({ type: 'mt-open', no: h.no, positions: [100] }, 'all');
    await new Promise((r) => setTimeout(r, 50));
    const keysFor100 = [...net.seen.values()].flat().slice(0).filter((m) => m.type === 'mt-keys' && (m.keys as [number, string][]).some(([p]) => p === 100));
    expect(keysFor100).toEqual([]);
    expect(net.messages).toBeGreaterThanOrEqual(before);
  }, 40_000);

  it('★ゲストが局の途中で接続を切って戻っても、同じ席で続きを打てる（控えた錠前で自分の牌を開け直す）。検算も通る', async () => {
    const net = new FakeNet();
    const kept = new Map<string, WireLocker>();
    const store: LockerStore = { save: (no, seat, w) => void kept.set(`${no}:${seat}`, w), load: (no, seat) => kept.get(`${no}:${seat}`) ?? null };
    const host = net.add('H', true, { human: true });
    (host as unknown as { o: { autoNext: boolean } }).o.autoNext = false;
    let guest = net.add('G', false, { human: true, store });
    host.begin([
      { id: 'H', name: 'H' },
      { id: 'G', name: 'G' },
    ]);
    // ゲストが何回か引いたところで切る
    await net.until(() => guest.myLog.filter((e) => e.ev.type === 'draw' && e.ev.seat === 1).length >= 3, 30_000);
    const handBefore = guest.view.hands[1].slice().sort();
    net.cut('G');
    await new Promise((r) => setTimeout(r, 300));
    // 戻ったゲストは新しい卓で、ホストから写しを受け取って作り直す
    guest = net.add('G', false, { human: true, store });
    guest.loadSync(host.syncData());
    await net.until(() => guest.view.hands[1].length > 0 && !guest.view.hands[1].includes(HIDDEN), 20_000);
    expect(guest.mySeat).toBe(1);
    // 切れる前の手牌が、少なくとも一部はそのまま開け直されている（切れたあとに進んだ分は変わってよい）
    expect(handBefore.some((x) => guest.view.hands[1].includes(x))).toBe(true);
    await net.until(() => host.pub.phase === 'ended' && guest.pub.phase === 'ended' && host.handVerified !== null && guest.handVerified !== null, 60_000);
    expect(net.problems).toEqual([]);
    expect(JSON.stringify(guest.pub)).toBe(JSON.stringify(host.pub));
  }, 120_000);

  it('★返事の待ち：ゲストの返事は、捨て牌が届いてから決めた長さがたつまで返事を出さない（誰が迷ったか漏れない）', async () => {
    const net = new FakeNet();
    const ids = ['A', 'B', 'C'];
    const ts = ids.map((id, i) => net.add(id, i === 0, { human: true }));
    (ts[0] as unknown as { o: { autoNext: boolean } }).o.autoNext = false;
    ts[0].begin(
      ids.map((id) => ({ id, name: id })),
      250,
    );
    await net.until(() => ts.every((t) => t.pub.phase === 'ended') && ts.every((t) => t.handVerified !== null), 120_000);
    expect(ts[1].replyWait).toBe(250);
    // ホスト以外（捨て牌が通信で届く人）の返事をすべて見る
    const gaps = net.replyGaps.filter((g) => g.id !== 'A');
    expect(gaps.length).toBeGreaterThan(10);
    expect(Math.min(...gaps.map((g) => g.gap))).toBeGreaterThanOrEqual(240);
    expect(net.problems).toEqual([]);
  }, 130_000);

  it('★局の最初のツモは、配り終えてから演出の長さ（dealHold）を待ってから出す（洗牌→配る→ツモの順に鳴る）', async () => {
    const net = new FakeNet();
    const ids = ['A', 'B'];
    const ts = ids.map((id, i) => net.add(id, i === 0, { human: true }));
    const o = (ts[0] as unknown as { o: { autoNext: boolean; dealHold: (first: boolean) => number } }).o;
    o.autoNext = false;
    o.dealHold = (first) => (first ? 600 : 300);
    ts[0].begin(ids.map((id) => ({ id, name: id })));
    await net.until(() => ts[1].pub.drawn.some((d) => d !== null), 30_000);
    // ホストが「配り終えた（ドラ表示牌）」を送った時刻と、最初の「ツモ」を送った時刻を、送った瞬間の記録で比べる。
    // ★以前は 5 ミリ秒ごとの見回りで見つけた時刻で測っていたため、ほかの検査と並んで混むと見つけるのが遅れて短く出て、たまに赤になった（10-12）。
    //   待ちはタイマーなので、混んでも早まることはない＝送った時刻なら必ず 600 以上
    const dealt = net.sent.find((x) => x.from === 'A' && x.ev === 'doraReveal');
    const drew = net.sent.find((x) => x.from === 'A' && x.ev === 'draw');
    expect(dealt).toBeDefined();
    expect(drew).toBeDefined();
    expect(drew!.at - dealt!.at).toBeGreaterThanOrEqual(590);
    // ゲストにも、ツモは配牌のあとに届いている
    const seen = net.seen.get('B')!.map((m) => (m.env as Envelope | undefined)?.ev?.type);
    expect(seen.indexOf('doraReveal')).toBeLessThan(seen.indexOf('draw'));
  }, 40_000);
});
