// 落ちた人の鍵の預かり（段階10・Q8=A）：部屋の側の段取り。卓は偽物（呼ばれたことだけ見る）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_FALLBACK_MS, OnlineSession, RECLAIM_WAIT_MS, TAKE_WAIT_MS, type Transport, type TransportHandlers } from './session';
import type { OnlineTable, TableOptions } from './table';

interface Sent {
  data: Record<string, unknown>;
  to: 'all' | 'host';
}

/** 送ったものを控え、受け取るものは検査が手で渡す */
function fakeTransport() {
  const sent: Sent[] = [];
  let h: TransportHandlers | null = null;
  const tr: Transport = {
    connect: (x) => {
      h = x;
      x.onOpen();
    },
    createRoom: (o) => h!.onCreated('R1', o.name),
    joinRoom: (id) => {
      sent.push({ data: { type: '(join)', roomId: id }, to: 'host' });
      h!.onJoined(id, '卓');
    },
    send: (data, to) => sent.push({ data: structuredClone(data), to }),
    leave: () => {},
    refresh: () => {},
    setGameState: () => {},
  };
  return { tr, sent, recv: (d: Record<string, unknown>) => h!.onMessage(d), handlers: () => h! };
}

/** 偽の卓：作り方の options（onPackage）を控え、呼ばれたことを記録する */
function fakeTable() {
  const calls: { adopt: [string, string | null][]; take: number[] } = { adopt: [], take: [] };
  let opts: TableOptions | null = null;
  const proxies = new Set<number>();
  const make = (o: TableOptions) => {
    opts = o;
    return {
      started: true,
      seats: [
        { kind: 'human', id: 'H', name: 'H' },
        { kind: 'human', id: 'A', name: 'A' },
        { kind: 'human', id: 'B', name: 'B' },
        { kind: 'cpu' },
      ],
      takeSeat: (seat: number) => calls.take.push(seat),
      begin: () => {},
      receive: () => {},
      isProxy: (s: number) => proxies.has(s),
      adoptReleased: async (id: string, blob: string | null) => {
        calls.adopt.push([id, blob]);
        return blob ? 'continued' : 'redealt';
      },
      syncData: () => ({ seats: [], wire: [], hand: null }),
      loadSync: () => {},
      noCalls: false,
      view: { phase: 'draw' },
    } as unknown as OnlineTable;
  };
  return { make, calls, opts: () => opts!, proxies };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const deposits = (sent: Sent[]) => sent.filter((x) => x.data.type === 'mj_key_deposit').map((x) => x.data);

describe('鍵の預かり（部屋の側）', () => {
  it('ゲスト：入ると「預かれますか」を尋ねる。「預かれます」が返るまでは包みを預けない（古いサーバーだと全員へ中継されてしまう）', () => {
    const net = fakeTransport();
    const tb = fakeTable();
    const g = new OnlineSession(net.tr, tb.make);
    g.open();
    g.join({ id: 'R1', name: '卓', hostName: 'H', hasPassword: false, isPublic: true, playerCount: 1, maxPlayers: 4, gameState: 'lobby' }, 'G', '');
    expect(net.sent.some((x) => x.data.type === 'mj_key_probe')).toBe(true);
    // 対局が始まって卓ができ、包みができた
    net.recv({ type: 'mt-begin', seats: [], replyWait: 0 });
    tb.opts().onPackage!(1, 'BLOB1');
    expect(deposits(net.sent)).toEqual([]);
    // 預かれるサーバー：いま持っている包みをすぐ預ける。包みが変わればまた預ける（合言葉は同じ）
    net.recv({ type: 'mj_key_ready' });
    tb.opts().onPackage!(2, 'BLOB2');
    const d = deposits(net.sent);
    expect(d.map((x) => [x.no, x.blob])).toEqual([
      [1, 'BLOB1'],
      [2, 'BLOB2'],
    ]);
    expect(d[0].id).toBe(g.myId);
    expect(typeof d[0].secret).toBe('string');
    expect((d[0].secret as string).length).toBeGreaterThanOrEqual(16);
    expect(d[1].secret).toBe(d[0].secret);
  });

  function hostStarted() {
    const net = fakeTransport();
    const tb = fakeTable();
    const h = new OnlineSession(net.tr, tb.make);
    h.open();
    h.create({ hostName: 'H', roomName: '卓', password: '', isPrivate: false });
    net.recv({ type: 'mj-hello', id: 'A', name: 'A' });
    net.recv({ type: 'mj-hello', id: 'B', name: 'B' });
    h.start();
    return { net, tb, h };
  }

  it('ホスト：切れた人の包みがサーバーから届いたら、その人の席を引き継ぐ（預かれるサーバーのときだけ）', async () => {
    const { net, tb, h } = hostStarted();
    net.recv({ type: 'mj_key_ready' });
    net.recv({ type: 'mj-bye', id: 'A' });
    net.recv({ type: 'mj_key_release', id: 'A', no: 1, blob: 'PKG' });
    await vi.runOnlyPendingTimersAsync();
    expect(tb.calls.adopt).toEqual([['A', 'PKG']]);
    expect(h.takeovers).toEqual([{ id: 'A', how: 'continued' }]);
    // 予備の時計は止まっている（2 度引き継がない）
    await vi.advanceTimersByTimeAsync(KEY_FALLBACK_MS + 1000);
    expect(tb.calls.adopt.length).toBe(1);
  });

  it('ホスト：古いサーバー（「預かれます」が返らない）では、届いた包みの形のものを信じない', async () => {
    const { net, tb } = hostStarted();
    net.recv({ type: 'mj-bye', id: 'A' });
    net.recv({ type: 'mj_key_release', id: 'A', no: 1, blob: 'FAKE' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tb.calls.adopt).toEqual([]);
  });

  it('ホスト：つながって見える人の包みも、預かれるサーバーから届いたら受け取り、その人は切れたことにする（アプリが落ちて古い接続が残っていた）', async () => {
    const { net, tb, h } = hostStarted();
    net.recv({ type: 'mj_key_ready' });
    net.recv({ type: 'mj_key_release', id: 'B', no: 1, blob: 'PKG' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tb.calls.adopt).toEqual([['B', 'PKG']]);
    expect(h.state.members.find((m) => m.id === 'B')?.online).toBe(false);
  });

  it('ホスト：つながっている人の席を CPU に切り替える＝まず本人の端末に頼み、渡してこなければ（落ちていれば）サーバーに包みを頼む', async () => {
    const { net, tb, h } = hostStarted();
    net.recv({ type: 'mj_key_ready' });
    h.takeSeat(1);
    expect(tb.calls.take).toEqual([1]);
    expect(net.sent.some((x) => x.data.type === 'mj_key_release_now')).toBe(false);
    await vi.advanceTimersByTimeAsync(TAKE_WAIT_MS + 10);
    expect(net.sent.filter((x) => x.data.type === 'mj_key_release_now').map((x) => x.data.id)).toEqual(['A']);
    // 生きていた：何もしない／預かりが無かった：配り直しで引き継ぐ
    net.recv({ type: 'mj_key_alive', id: 'A' });
    net.recv({ type: 'mj_key_none', id: 'A' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tb.calls.adopt).toEqual([]);
  });

  it('ホスト：切れている人の席は 3 分待たずに切り替えられる（すぐサーバーに包みを頼む。預かりが無ければ配り直し）', async () => {
    const { net, tb, h } = hostStarted();
    net.recv({ type: 'mj_key_ready' });
    net.recv({ type: 'mj-bye', id: 'A' });
    h.takeSeat(1);
    expect(tb.calls.take).toEqual([]);
    expect(net.sent.filter((x) => x.data.type === 'mj_key_release_now').map((x) => x.data.id)).toEqual(['A']);
    net.recv({ type: 'mj_key_none', id: 'A' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tb.calls.adopt).toEqual([['A', null]]);
  });

  it('ホスト：頼んでいない「預かりが無い」は無視する', async () => {
    const { net, tb } = hostStarted();
    net.recv({ type: 'mj_key_ready' });
    net.recv({ type: 'mj-bye', id: 'A' });
    net.recv({ type: 'mj_key_none', id: 'A' });
    await vi.advanceTimersByTimeAsync(10);
    expect(tb.calls.adopt).toEqual([]);
  });

  it('ホスト：包みが来ないまま 3 分（予備で 3 分 10 秒）たったら、包み無しで引き継ぐ（＝その局は配り直し）', async () => {
    const { net, tb, h } = hostStarted();
    net.recv({ type: 'mj-bye', id: 'A' });
    await vi.advanceTimersByTimeAsync(KEY_FALLBACK_MS - 1000);
    expect(tb.calls.adopt).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(tb.calls.adopt).toEqual([['A', null]]);
    expect(h.takeovers).toEqual([{ id: 'A', how: 'redealt' }]);
  });

  it('ホスト：3 分のうちに戻ってきたら引き継がない', async () => {
    const { net, tb } = hostStarted();
    net.recv({ type: 'mj-bye', id: 'A' });
    await vi.advanceTimersByTimeAsync(60_000);
    net.recv({ type: 'mj-hello', id: 'A', name: 'A' });
    await vi.advanceTimersByTimeAsync(KEY_FALLBACK_MS);
    expect(tb.calls.adopt).toEqual([]);
  });
});

describe('開き直して戻る（10-15 利用者指摘＝アプリが落ちると満員で入れない）', () => {
  const saved = { roomId: 'R1', roomName: '卓', hasPassword: false, myId: 'me1', name: 'G', password: '', keySecret: 'secret-secret-1234' };
  beforeEach(() => localStorage.setItem('momo-mahjong.online.seat', JSON.stringify(saved)));
  afterEach(() => localStorage.removeItem('momo-mahjong.online.seat'));

  it('戻るを押すと、先に合言葉で古い接続の追い出しを頼み、返事が来たら入る', () => {
    const net = fakeTransport();
    const g = new OnlineSession(net.tr, fakeTable().make);
    g.open();
    g.rejoin();
    const types = () => net.sent.map((x) => x.data.type);
    expect(types()).toEqual(['mj_seat_reclaim']);
    expect(net.sent[0].data).toMatchObject({ roomId: 'R1', id: 'me1', secret: 'secret-secret-1234' });
    net.handlers().onMessage({ type: 'mj_seat_reclaim_ok' });
    expect(types().slice(0, 2)).toEqual(['mj_seat_reclaim', '(join)']);
    // 返事が 2 度来ても 1 回だけ入る
    net.handlers().onMessage({ type: 'mj_seat_reclaim_no' });
    expect(types().filter((x) => x === '(join)').length).toBe(1);
  });

  it('古いサーバー（返事が無い）でも、少し待ってから入る', async () => {
    const net = fakeTransport();
    const g = new OnlineSession(net.tr, fakeTable().make);
    g.open();
    g.rejoin();
    await vi.advanceTimersByTimeAsync(RECLAIM_WAIT_MS - 100);
    expect(net.sent.some((x) => x.data.type === '(join)')).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(net.sent.filter((x) => x.data.type === '(join)').length).toBe(1);
  });
});
