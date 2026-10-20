// ホストの復帰と交代（段階10の5）：部屋の側（session.ts）を、新しいサーバーと同じ動きの偽サーバーで確かめる。
//  - ホストが切れると、ほかの人に「ホストが切れた」（mj_host_away）。卓はそのまま・時計は止める
//  - 3 分のうちに戻れば、ホストのまま続ける（返事は room_created と同じ形＝共通ライブラリが部屋に戻ったと分かる）
//  - 3 分を過ぎると mj_host_gone。元ホストの下家から順に名乗り出て（mj_host_take）、最初の人がホスト（mj_host_new）
//  - 新しいホストは卓を作り直して写しを配り、その局を配り直す
//  - 元ホストが戻ると断られ（mj_host_return_no）、プレイヤーとして入り直して自分の席を返してもらう
// 卓は本物（人の席も自動で打つ）。サーバーの 3 分は、検査が「切れたまま 3 分たった」を手で起こす。

import { describe, expect, it } from 'vitest';
import { benchCpu } from '../cpu/bench';
import type { Envelope, Seat } from '../engine/events';
import { OnlineSession, type RoomInfo, type Transport, type TransportHandlers } from './session';
import { OnlineTable, type LockerStore, type TableOptions, type WireLocker } from './table';

interface Peer {
  h: TransportHandlers;
  pid: string;
  role: 'host' | 'player' | 'spectator';
  room: string | null;
  token: string;
  name: string;
  online: boolean;
  /** 切れたまま（送るものは届かない） */
  offline?: boolean;
}
interface Room {
  id: string;
  name: string;
  peers: Peer[];
  gameState: string;
  /** ホストが切れている（gone＝3 分を過ぎて移す段） */
  away: { token: string; name: string; gone: boolean } | null;
}

class Server {
  rooms = new Map<string, Room>();
  private n = 0;
  private tok = 0;
  peers = new Map<OnlineSession, Peer>();
  /** 名乗り出（mj_host_take）を受け付けるまでの遅れ（検査用） */
  takeDelayMs = 0;

  transport(owner: () => OnlineSession): Transport {
    const me: Peer = { h: null as unknown as TransportHandlers, pid: '', role: 'player', room: null, token: '', name: '', online: true };
    const deliver = (p: Peer, d: Record<string, unknown>) => {
      if (!p.online) return;
      const c = structuredClone(d);
      setTimeout(() => p.online && p.h.onMessage(c), 0);
    };
    const roomOf = () => (me.room ? this.rooms.get(me.room) : undefined);
    const freePid = (r: Room) => {
      for (let i = 1; ; i++) if (!r.peers.some((p) => p.pid === `p${i}`)) return `p${i}`;
    };
    return {
      connect: (h) => {
        me.h = h;
        this.peers.set(owner(), me);
        h.onOpen();
      },
      createRoom: (o) => {
        const id = `R${++this.n}`;
        Object.assign(me, { pid: 'p0', role: 'host', room: id, token: `T${++this.tok}`, name: o.hostName });
        this.rooms.set(id, { id, name: o.name, peers: [me], gameState: 'lobby', away: null });
        setTimeout(() => me.h.onCreated(id, o.name), 0);
      },
      joinRoom: (id, _pw, name, role = 'player') => {
        const r = this.rooms.get(id);
        if (!r) return void setTimeout(() => me.h.onError('部屋が見つかりません'), 0);
        Object.assign(me, { pid: freePid(r), role, room: id, token: `T${++this.tok}`, name, online: true });
        r.peers.push(me);
        setTimeout(() => me.h.onJoined(id, r.name), 0);
      },
      send: (data, to) => {
        if (me.offline) return;
        // 部屋の外からの頼み（ホストの席へ戻る・開き直したので移してよい）
        if (data.type === 'mj_host_return') {
          const r = this.rooms.get(String(data.roomId));
          if (!r?.away || r.away.gone || r.away.token !== data.token) return deliver(me, { type: 'mj_host_return_no' });
          const away = r.away;
          r.away = null;
          Object.assign(me, { pid: 'p0', role: 'host', room: r.id, token: away.token, name: away.name, online: true });
          r.peers.unshift(me);
          setTimeout(() => me.h.onCreated(r.id, r.name), 0);
          return;
        }
        if (data.type === 'mj_host_giveup') {
          const r = this.rooms.get(String(data.roomId));
          if (r?.away && !r.away.gone && r.away.token === data.token) this.gone(r);
          return;
        }
        const r = roomOf();
        if (!r) return;
        if (data.type === 'mj_key_probe') return deliver(me, { type: 'mj_key_ready' });
        if (typeof data.type === 'string' && data.type.startsWith('mj_key_')) return;
        if (data.type === 'mj_host_take') {
          const take = () => {
            if (!r.away?.gone || r.peers.some((p) => p.role === 'host')) return deliver(me, { type: 'mj_host_take_no' });
            r.away = null;
            me.role = 'host';
            r.peers.forEach((p) => deliver(p, { type: 'mj_host_new', pid: me.pid, name: me.name }));
          };
          // 名乗り出が遅れる場面（下家がすぐ名乗り出られず次の人に回る等）を作るためのつまみ
          if (this.takeDelayMs > 0) setTimeout(take, this.takeDelayMs);
          else take();
          return;
        }
        const msg = { ...data, from: me.pid };
        const targets = to === 'host' ? r.peers.filter((p) => p.role === 'host') : r.peers.filter((p) => p !== me);
        targets.forEach((p) => deliver(p, msg));
      },
      leave: () => {
        const r = roomOf();
        if (r) r.peers = r.peers.filter((p) => p !== me);
        me.room = null;
      },
      refresh: () => {},
      setGameState: (s) => {
        const r = roomOf();
        if (r) r.gameState = s;
      },
      token: () => (me.room ? me.token : null),
      myPid: () => me.pid,
    };
  }

  /** その人の接続が切れた（ホストなら 3 分待つ段へ）。本人には onLost（本物は共通ライブラリが部屋を出てつなぎ直す）。
   *  later＝本人はまだつなぎ直さない（そのあいだ本人の送るものは届かない）。reconnect で onLost を起こす */
  cut(s: OnlineSession, later = false) {
    const me = this.peers.get(s)!;
    const r = me.room ? this.rooms.get(me.room) : undefined;
    me.online = false;
    if (r) {
      r.peers = r.peers.filter((p) => p !== me);
      if (me.role === 'host') {
        r.away = { token: me.token, name: me.name, gone: false };
        r.peers.forEach((p) => {
          const c = { type: 'mj_host_away', waitMs: 180_000 };
          setTimeout(() => p.online && p.h.onMessage(c), 0);
        });
      } else r.peers.forEach((p) => p.h.onPeerLeft(r.peers.length));
    }
    me.room = null;
    if (later) {
      me.offline = true;
      return;
    }
    me.online = true;
    me.h.onLost();
  }

  reconnect(s: OnlineSession) {
    const me = this.peers.get(s)!;
    me.offline = false;
    me.online = true;
    me.h.onLost();
  }

  /** 切れたホストの 3 分が過ぎた */
  gone(r: Room) {
    if (!r.away) return;
    r.away.gone = true;
    const name = r.away.name;
    r.peers.forEach((p) => {
      const c = { type: 'mj_host_gone', name };
      setTimeout(() => p.online && p.h.onMessage(c), 0);
    });
  }

  room(): Room {
    return [...this.rooms.values()][0];
  }
}

/** 錠前の控え（端末ごと）。★検査の中では全員が同じ localStorage を使ってしまい、上書きし合って作り直した卓が自分の錠前を読めなかった */
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

/** 人（端末）ごとの控え。開き直した端末は同じ控えを使う */
const stores = new WeakMap<OnlineSession, LockerStore>();
const storeOf = (s: OnlineSession) => stores.get(s)!;

/** 本物の卓（人の席も自動で打つ・待たない・控えは端末ごと） */

function newSession(srv: Server, store: LockerStore = memStore()) {
  let s: OnlineSession;
  s = new OnlineSession(
    srv.transport(() => s),
    (o: TableOptions) => {
      const t = new OnlineTable({ ...o, store, autoplay: benchCpu, autoNext: true, cpuDelay: 0, dealHold: () => 0 });
      // 返事の待ち（ふつう 3 秒）を 0 に＝検査の時間を縮める（待ちの長さは table.test が見ている）
      Object.defineProperty(t, 'replyWait', { get: () => 0, set: () => {} });
      return t;
    },
  );
  stores.set(s, store);
  return s;
}

const until = async (done: () => boolean, ms: number) => {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > ms) throw new Error('時間切れ：' + done.toString().replace(/s+/g, ' ').slice(0, 160));
    await new Promise((r) => setTimeout(r, 5));
  }
};

const midHand = (t: OnlineTable | null) => !!t && t.pub.phase !== 'ended' && t.pub.phase !== 'deal' && t.pub.wallLeft > 50 && t.pub.discards.reduce((a, d) => a + d.length, 0) >= 6;

const ROOM: RoomInfo = { id: 'R1', name: '卓', hostName: 'H', hasPassword: false, isPublic: true, playerCount: 1, maxPlayers: 4, gameState: 'lobby' };

/** H がホスト、A・B が入って 3 人＋CPU で始め、局の途中まで進める */
async function play() {
  const srv = new Server();
  const H = newSession(srv);
  const A = newSession(srv);
  const B = newSession(srv);
  H.open();
  H.create({ hostName: 'H', roomName: '卓', password: '', isPrivate: false });
  await until(() => H.state.where === 'room', 2000);
  for (const [s, name] of [
    [A, 'A'],
    [B, 'B'],
  ] as const) {
    s.open();
    s.join(ROOM, name, '');
    await until(() => H.state.members.some((m) => m.name === name), 2000);
  }
  H.start();
  await until(() => [H, A, B].every((s) => midHand(s.table)), 60_000);
  return { srv, H, A, B };
}

describe('ホストの復帰と交代（部屋の側・段階10の5）', () => {
  it('★3 分のうちに戻る：ほかの人は「待っています」・時計を止める → ホストのまま続き、全員の局面がそろう', async () => {
    const { srv, H, A, B } = await play();
    srv.cut(H, true);
    await until(() => A.state.hostWait?.kind === 'away' && B.state.hostWait?.kind === 'away', 2000);
    expect(A.table?.paused).toBe(true);
    srv.reconnect(H);
    // ホストは卓を捨てずに持っていて、合言葉で戻る（返事は room_created と同じ形）
    await until(() => H.state.room?.isHost === true && !H.state.reconnecting, 3000);
    await until(() => A.state.hostWait === null && B.state.hostWait === null, 3000);
    expect(A.table?.paused).toBe(false);
    // 戻ったあとも局が進み、次の局まで行く
    const n = H.table!.pub.handCount;
    await until(() => H.table!.pub.handCount > n && midHand(H.table) && [A, B].every((s) => s.table?.pub.nextSeq === H.table!.pub.nextSeq), 90_000);
    expect(H.state.room?.isHost).toBe(true);
  }, 200_000);

  it('★3 分を過ぎる：元ホストの下家（A）がホストになり、局を配り直して続く。元ホストはプレイヤーとして戻り、席を返してもらえる', async () => {
    const { srv, H, A, B } = await play();
    srv.cut(H, true);
    await until(() => A.state.hostWait?.kind === 'away', 2000);
    // H が戻らないまま 3 分が過ぎた（本物は 3 分待つ）
    srv.gone(srv.room());
    await until(() => A.state.room?.isHost === true, 5000);
    expect(B.state.room?.isHost).toBe(false);
    expect(A.state.hostNew).toBe('A');
    // B は新しいホストの写しで作り直し、待ちが終わる
    await until(() => B.state.hostWait === null && B.table?.wire.some((x) => x.env.ev.type === 'roundVoid') === true, 5000);
    expect(A.table?.isProxy(0 as Seat)).toBe(true);
    // 新しいホストのもとで次の局まで進む
    const n = A.table!.pub.handCount;
    await until(() => A.table!.pub.handCount > n + 1 && midHand(A.table) && B.table?.pub.nextSeq === A.table!.pub.nextSeq, 120_000);
    // 元ホストがつなぎ直す：断られ、プレイヤーとして入り直して写しをもらう（自分の席は CPU のまま）
    srv.reconnect(H);
    await until(() => H.state.room?.isHost === false && H.table !== null && H.table.mySeat === 0, 10_000);
    expect(H.table?.isProxy(0 as Seat)).toBe(true);
    // 席を返してもらう（新しいホストが許可する）
    H.table!.requestReclaim();
    await until(() => A.table!.reclaims.has(0), 5000);
    await A.table!.answerReclaim(0 as Seat, true);
    await until(() => H.table?.isProxy(0 as Seat) === false && A.table?.isProxy(0 as Seat) === false, 30_000);
    // そのあとも続く
    const m = A.table!.pub.nextSeq;
    await until(() => A.table!.pub.nextSeq > m + 20 && H.table?.pub.nextSeq === A.table!.pub.nextSeq, 60_000);
  }, 300_000);

  it('★画面を閉じた元ホストが 3 分のうちに開き直す：ホストのまま同じ局の続きを打つ（下家に移らない・なかったことにしない）', async () => {
    const { srv, H, A, B } = await play();
    // ホストの端末の「戻るための控え」（合言葉つき）と鍵の控え。★検査の中では全員が同じ localStorage を使う＝取っておいて、開き直した端末に戻す
    const saved = H.state.saved;
    expect(saved?.hostToken).toBeTruthy();
    const seq = H.table!.pub.nextSeq;
    srv.cut(H, true);
    await until(() => A.state.hostWait?.kind === 'away' && B.state.hostWait?.kind === 'away', 2000);
    localStorage.setItem('momo-mahjong.online.seat', JSON.stringify(saved));
    const H2 = newSession(srv, storeOf(H));
    H2.open();
    H2.rejoin();
    // ホストの席へ戻り、ゲストの写しで卓を作り直す
    await until(() => H2.state.room?.isHost === true && H2.table !== null && H2.table.mySeat === 0, 10_000);
    expect(A.state.room?.isHost).toBe(false);
    expect(H2.myId).toBe(H.myId);
    // ゲストの待ちが終わり、同じ局の続きを打って次の局へ
    await until(() => A.state.hostWait === null && B.state.hostWait === null, 10_000);
    const n = H2.table!.pub.handCount;
    await until(() => H2.table!.pub.handCount > n && midHand(H2.table) && [A, B].every((s) => s.table?.pub.nextSeq === H2.table!.pub.nextSeq), 120_000);
    expect(H2.table!.wire.length).toBeGreaterThan(seq);
    expect(H2.table!.wire.some((x) => x.env.ev.type === 'roundVoid')).toBe(false);
    expect(H2.table!.isProxy(0 as Seat)).toBe(false);
  }, 300_000);

  it('★画面を閉じた元ホストが 3 分を過ぎて開き直す：ホストは下家に移っている → プレイヤーとして戻り、席を返してもらえる', async () => {
    const { srv, H, A, B } = await play();
    const saved = H.state.saved;
    srv.cut(H, true);
    await until(() => A.state.hostWait?.kind === 'away', 2000);
    // 3 分が過ぎた → 下家（A）がホスト
    srv.gone(srv.room());
    await until(() => A.state.room?.isHost === true && B.state.hostWait === null, 10_000);
    localStorage.setItem('momo-mahjong.online.seat', JSON.stringify(saved));
    const H2 = newSession(srv, storeOf(H));
    H2.open();
    H2.rejoin();
    // ホストの席へは戻れない（断られる）→ プレイヤーとして入り直し、新しいホストから写しをもらう（自分の席は CPU のまま）
    await until(() => H2.state.room?.isHost === false && H2.table !== null && H2.table.mySeat === 0, 15_000);
    expect(H2.table?.isProxy(0 as Seat)).toBe(true);
    await until(() => A.state.members.find((m) => m.id === H.myId)?.online === true, 10_000);
    // 席を返してもらう（新しいホストが許可する）
    H2.table!.requestReclaim();
    await until(() => A.table!.reclaims.has(0), 5000);
    await A.table!.answerReclaim(0 as Seat, true);
    await until(() => H2.table?.isProxy(0 as Seat) === false && A.table?.isProxy(0 as Seat) === false, 30_000);
    const m = A.table!.pub.nextSeq;
    await until(() => A.table!.pub.nextSeq > m + 20 && H2.table?.pub.nextSeq === A.table!.pub.nextSeq && B.table?.pub.nextSeq === A.table!.pub.nextSeq, 60_000);
  }, 300_000);
});
