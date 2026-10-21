// 生存チェック（利用者 2026-10-20・Q1=A＝クライアントどうし）：部屋の側。卓は使わない（待合で確かめる）。
// 全員が 10 秒ごとに「ここにいます」。25 秒何も届かない人は、気づいた端末がサーバーに確かめを頼む。
// 「確かめています」は 1.5 秒たっても答えが無いときだけ出す。切れたらサーバーの時計と同じ時点から 3:00 を数える。
// 観戦者は見張るのはホストだけ・一言は出さない（利用者指示）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALIVE_EVERY_MS, CHECK_SHOW_MS, OnlineSession, RECHECK_MS, SILENT_MS, type Member, type Transport, type TransportHandlers } from './session';

interface Sent {
  data: Record<string, unknown>;
  to: 'all' | 'host';
}

function fakeTransport() {
  const sent: Sent[] = [];
  let h: TransportHandlers | null = null;
  const tr: Transport = {
    connect: (x) => {
      h = x;
      x.onOpen();
    },
    createRoom: (o) => h!.onCreated('R1', o.name),
    joinRoom: (id) => h!.onJoined(id, '卓'),
    send: (data, to) => sent.push({ data: structuredClone(data), to }),
    leave: () => {},
    refresh: () => {},
    setGameState: () => {},
    myPid: () => 'p1',
  };
  return { tr, sent, recv: (d: Record<string, unknown>) => h!.onMessage(d) };
}

const ROOM = { id: 'R1', name: '卓', hostName: 'H', hasPassword: false, isPublic: true, playerCount: 1, maxPlayers: 4, gameState: 'lobby' };

/** ゲスト G（p1）として入る。名簿＝H（ホスト・p0）・G・K（p2）・V（観戦・v1） */
function guest() {
  const net = fakeTransport();
  const g = new OnlineSession(net.tr);
  g.open();
  g.join(ROOM, 'G', '');
  const members: Member[] = [
    { id: 'H', name: 'H', online: true, role: 'player' },
    { id: g.myId, name: 'G', online: true, role: 'player' },
    { id: 'K', name: 'K', online: true, role: 'player' },
    { id: 'V', name: 'V', online: true, role: 'spectator' },
  ];
  net.recv({ type: 'mj-members', members, hostId: 'H', started: false, from: 'p0' });
  // 3 人とも一度合図を送ってきた（ID と番号が結ばれる）
  net.recv({ type: 'mj-alive', id: 'H', from: 'p0' });
  net.recv({ type: 'mj-alive', id: 'K', from: 'p2' });
  net.recv({ type: 'mj-alive', id: 'V', from: 'v1' });
  return { net, g };
}

const checks = (sent: Sent[]) => sent.filter((x) => x.data.type === 'mj_peer_check').map((x) => x.data.pid);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('生存チェック（部屋の側）', () => {
  it('部屋にいるあいだ、10 秒ごとに「ここにいます」を全員へ送る', () => {
    const { net } = guest();
    const n = net.sent.filter((x) => x.data.type === 'mj-alive').length;
    vi.advanceTimersByTime(ALIVE_EVERY_MS * 3);
    const alive = net.sent.filter((x) => x.data.type === 'mj-alive');
    expect(alive.length - n).toBe(3);
    expect(alive.every((x) => x.to === 'all')).toBe(true);
  });

  it('★25 秒何も届かないプレイヤーは確かめを頼む。1.5 秒答えが無ければ「確かめています」・生きていたら消す', () => {
    const { net, g } = guest();
    // H と V はしゃべり続け、K だけ黙る
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(ALIVE_EVERY_MS);
      net.recv({ type: 'mj-alive', id: 'H', from: 'p0' });
      net.recv({ type: 'mj-alive', id: 'V', from: 'v1' });
    }
    expect(checks(net.sent)).toEqual(['p2']);
    expect(g.state.peerWait.K).toBeUndefined();
    vi.advanceTimersByTime(CHECK_SHOW_MS);
    expect(g.state.peerWait.K).toEqual({ kind: 'checking' });
    net.recv({ type: 'mj_peer_alive', pid: 'p2' });
    expect(g.state.peerWait.K).toBeUndefined();
    // 生きていた人は、すぐには確かめ直さない
    vi.advanceTimersByTime(ALIVE_EVERY_MS);
    expect(checks(net.sent)).toEqual(['p2']);
  });

  it('答えが 1.5 秒のうちに来れば「確かめています」は出さない（画面を裏にしているだけの人でちらつかない）', () => {
    const { net, g } = guest();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(ALIVE_EVERY_MS);
      net.recv({ type: 'mj-alive', id: 'H', from: 'p0' });
    }
    expect(checks(net.sent)).toContain('p2');
    // 答えが 1.5 秒より前（1 秒後）に来た。★すぐ来る場面だけだと、待ちを外しても同じ結果になって検査にならなかった
    vi.advanceTimersByTime(CHECK_SHOW_MS - 500);
    expect(g.state.peerWait.K).toBeUndefined();
    net.recv({ type: 'mj_peer_alive', pid: 'p2' });
    vi.advanceTimersByTime(CHECK_SHOW_MS * 2);
    expect(g.state.peerWait.K).toBeUndefined();
  });

  it('★切れたら（サーバーの mj_peer_away）、サーバーの時計と同じ時点から 3:00 を数える。入り直して合図が来たら消す', () => {
    const { net, g } = guest();
    const now = Date.now();
    net.recv({ type: 'mj_peer_away', pid: 'p2', name: 'K', waitMs: 180_000 });
    expect(g.state.peerWait.K).toEqual({ kind: 'away', until: now + 180_000 });
    // K が入り直した（番号が変わる）
    net.recv({ type: 'mj-alive', id: 'K', from: 'p3' });
    expect(g.state.peerWait.K).toBeUndefined();
  });

  it('★入り直して前と同じ番号になった人も、合図が来たら「戻るのを待っています」を消す（サーバーは空いた番号の小さい順に配る）', () => {
    const { net, g } = guest();
    net.recv({ type: 'mj_peer_away', pid: 'p2', name: 'K', waitMs: 180_000 });
    expect(g.state.peerWait.K?.kind).toBe('away');
    // K が入り直した（空いた p2 がまた配られた）。★前は番号が変わったときだけ消していて、残り時間が出たままだった
    net.recv({ type: 'mj-alive', id: 'K', from: 'p2' });
    expect(g.state.peerWait.K).toBeUndefined();
  });

  it('★ホストが黙ったら確かめを頼み、「ホストの接続を確かめています」→ サーバーの「ホストが切れた」で残り時間', () => {
    const { net, g } = guest();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(ALIVE_EVERY_MS);
      net.recv({ type: 'mj-alive', id: 'K', from: 'p2' });
      net.recv({ type: 'mj-alive', id: 'V', from: 'v1' });
    }
    expect(checks(net.sent)).toEqual(['p0']);
    vi.advanceTimersByTime(CHECK_SHOW_MS);
    expect(g.state.hostWait).toEqual({ kind: 'checking' });
    net.recv({ type: 'mj_host_away', waitMs: 180_000 });
    expect(g.state.hostWait?.kind).toBe('away');
  });

  it('★観戦者：ゲストは見張らない（確かめも一言も無い）。切れた知らせが来ても何も出さない', () => {
    const { net, g } = guest();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(ALIVE_EVERY_MS);
      net.recv({ type: 'mj-alive', id: 'H', from: 'p0' });
      net.recv({ type: 'mj-alive', id: 'K', from: 'p2' });
    }
    expect(checks(net.sent)).toEqual([]);
    net.recv({ type: 'mj_peer_away', pid: 'v1', name: 'V', waitMs: 180_000 });
    expect(g.state.peerWait).toEqual({});
  });

  it('★観戦者：ホストは見張って確かめを頼む。一言は出さない', () => {
    const net = fakeTransport();
    const h = new OnlineSession(net.tr);
    h.open();
    h.create({ hostName: 'H', roomName: '卓', password: '', isPrivate: false });
    net.recv({ type: 'mj-hello', id: 'V', name: 'V', from: 'v1' });
    h.setRole('V', 'spectator');
    net.recv({ type: 'mj-alive', id: 'V', from: 'v1' });
    vi.advanceTimersByTime(SILENT_MS + ALIVE_EVERY_MS);
    expect(checks(net.sent)).toEqual(['v1']);
    vi.advanceTimersByTime(CHECK_SHOW_MS + RECHECK_MS);
    expect(h.state.peerWait).toEqual({});
    expect(h.state.hostWait).toBeNull();
  });
});
