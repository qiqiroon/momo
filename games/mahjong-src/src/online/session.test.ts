import { cpuOf } from '../cpu/strength';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ruleChoiceOf, rulesOfSet } from '../engine/ruleSets';
import type { JpRuleKey } from '../engine/rules';
import { joinRoleOf, OnlineSession, playersOf, ROLLCALL_MS, spectatorsOf, type RoomInfo, type Transport, type TransportHandlers } from './session';

// 本物のサーバーの多人数の部屋をまねた偽物。
// ★番号の付け方も本物と同じ（'p' + いまの人数）＝抜けた人のあとに入った人の番号が重なる癖ごとまねる
interface Peer {
  h: TransportHandlers;
  pid: string;
  host: boolean;
  room: string | null;
  /** サーバーに名乗った役割（入ったときのまま変わらない＝本物と同じ） */
  role?: 'player' | 'spectator';
}
interface FakeRoom {
  id: string;
  name: string;
  hostName: string;
  password: string;
  isPublic: boolean;
  gameState: string;
  peers: Peer[];
}

class FakeServer {
  rooms = new Map<string, FakeRoom>();
  lobby: Peer[] = [];
  private seq = 0;

  transport(): Transport {
    const me: Peer = { h: null as unknown as TransportHandlers, pid: '', host: false, room: null };
    return {
      connect: (h) => {
        me.h = h;
        this.lobby.push(me);
        h.onOpen();
        h.onRooms(this.list());
      },
      createRoom: (o) => {
        const id = `R${++this.seq}`;
        this.rooms.set(id, { id, name: o.name, hostName: o.hostName, password: o.password, isPublic: o.isPublic, gameState: 'lobby', peers: [] });
        Object.assign(me, { pid: 'p0', host: true, room: id });
        this.rooms.get(id)!.peers.push(me);
        me.h.onCreated(id, o.name);
        this.broadcastList();
      },
      joinRoom: (id, pw, _name, role = 'player') => {
        const r = this.rooms.get(id);
        if (!r) return me.h.onError('部屋が見つかりません');
        if (r.password && r.password !== pw) return me.h.onError('パスワードが違います');
        const players = r.peers.filter((p) => p.role !== 'spectator').length;
        if (role === 'player' && players >= 4) return me.h.onError('プレイヤーが満員です');
        if (role === 'spectator' && r.peers.length - players >= 8) return me.h.onError('観戦が満員です');
        Object.assign(me, { pid: role === 'spectator' ? `v${r.peers.length - players + 1}` : `p${players}`, host: false, room: id, role });
        r.peers.push(me);
        me.h.onJoined(id, r.name);
        this.broadcastList();
      },
      send: (data, to) => {
        const r = me.room ? this.rooms.get(me.room) : undefined;
        if (!r) return;
        const msg = { ...data, from: me.pid, to };
        const targets = to === 'host' ? r.peers.filter((p) => p.host) : r.peers.filter((p) => p !== me);
        // 届くのは送った順（同期で配る）
        targets.forEach((p) => p.h.onMessage(structuredClone(msg)));
      },
      leave: () => this.drop(me),
      refresh: () => me.h.onRooms(this.list()),
      setGameState: (s) => {
        const r = me.room ? this.rooms.get(me.room) : undefined;
        if (r) r.gameState = s;
        this.broadcastList();
      },
    };
  }

  /** 接続が切れた（本人には onLost、ほかの人には誰かが抜けた） */
  cut(t: OnlineSession) {
    const p = this.peerOf(t);
    this.drop(p);
    p.h.onLost();
  }

  private peerOf(t: OnlineSession): Peer {
    for (const r of this.rooms.values()) for (const p of r.peers) if ((p.h as unknown as { owner?: OnlineSession }).owner === t) return p;
    throw new Error('部屋にいない');
  }

  private drop(me: Peer) {
    const r = me.room ? this.rooms.get(me.room) : undefined;
    me.room = null;
    if (!r) return;
    r.peers = r.peers.filter((p) => p !== me);
    if (me.host) {
      this.rooms.delete(r.id);
      r.peers.forEach((p) => {
        p.room = null;
        p.h.onRoomClosed();
      });
    } else {
      r.peers.forEach((p) => p.h.onPeerLeft(r.peers.length));
    }
    this.broadcastList();
  }

  list(): RoomInfo[] {
    return [...this.rooms.values()].map((r) => ({
      id: r.id,
      name: r.name,
      hostName: r.hostName,
      hasPassword: r.password !== '',
      isPublic: r.isPublic,
      playerCount: r.peers.filter((p) => p.role !== 'spectator').length,
      maxPlayers: 4,
      spectatorCount: r.peers.filter((p) => p.role === 'spectator').length,
      maxSpectators: 8,
      gameState: r.gameState,
    }));
  }

  private broadcastList() {
    const l = this.list();
    this.lobby.forEach((p) => p.h.onRooms(l));
  }
}

let server: FakeServer;

/** 1 人ぶん（つないだ状態） */
function person(): OnlineSession {
  const tr = server.transport();
  const s = new OnlineSession({
    ...tr,
    connect: (h) => tr.connect(Object.assign(h, { owner: s })),
  });
  s.open();
  return s;
}

const names = (s: OnlineSession) => s.state.members.map((m) => `${m.name}${m.online ? '' : '(切)'}`);
const roomOf = (s: OnlineSession) => s.state.rooms[0];

beforeEach(() => {
  server = new FakeServer();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

function hostWith(...guests: string[]) {
  const host = person();
  host.create({ hostName: 'ホスト', roomName: '卓', password: '', isPrivate: false });
  const gs = guests.map((n) => {
    const g = person();
    g.join(roomOf(g), n, '');
    return g;
  });
  return { host, gs };
}

describe('部屋を作る・入る', () => {
  it('部屋を作ると待合に入り、席 1 がホスト。入った順に席に着き、全員の名簿がそろう', () => {
    const { host, gs } = hostWith('A', 'B', 'C');
    expect(host.state.where).toBe('room');
    expect(names(host)).toEqual(['ホスト', 'A', 'B', 'C']);
    gs.forEach((g) => expect(names(g)).toEqual(['ホスト', 'A', 'B', 'C']));
    expect(gs[1].myId).toBe(gs[1].state.members[2].id);
  });

  it('名前や部屋の名前が空なら作らない・入らない', () => {
    const h = person();
    h.create({ hostName: ' ', roomName: '卓', password: '', isPrivate: false });
    expect(h.state.note).toBe('noName');
    h.create({ hostName: 'ホスト', roomName: '', password: '', isPrivate: false });
    expect(h.state.note).toBe('noRoomName');
    expect(server.rooms.size).toBe(0);
  });

  it('パスワード：違えば入れない。合えば入れる。パスワードの無い部屋に入れて入ろうとしても止める', () => {
    const host = person();
    host.create({ hostName: 'ホスト', roomName: '鍵の卓', password: 'momo', isPrivate: false });
    const g = person();
    expect(roomOf(g).hasPassword).toBe(true);
    g.join(roomOf(g), 'A', 'xxx');
    expect(g.state.note).toBe('wrongPw');
    expect(g.state.where).toBe('lobby');
    g.join(roomOf(g), 'A', 'momo');
    expect(g.state.where).toBe('room');
    expect(g.state.room?.hasPassword).toBe(true);

    const host2 = person();
    host2.create({ hostName: 'ホスト2', roomName: '鍵なし', password: '', isPrivate: false });
    const g2 = person();
    g2.join(g2.state.rooms.find((r) => r.name === '鍵なし')!, 'B', 'momo');
    expect(g2.state.note).toBe('wrongPw');
    expect(g2.state.where).toBe('lobby');
  });

  it('非公開の部屋は一覧の情報に印が付く（画面はふだん出さない）', () => {
    const host = person();
    host.create({ hostName: 'ホスト', roomName: '内緒', password: '', isPrivate: true });
    expect(roomOf(person()).isPublic).toBe(false);
  });

  it('5 人目は席に着けない（観戦者になる・段階10の3）。観戦を断っている部屋なら入れない', () => {
    const { host } = hostWith('A', 'B', 'C');
    host.setAllowSpectators(false);
    const e = person();
    e.join(roomOf(e), 'E', '');
    expect(e.state.note).toBe('noSpectators');
    expect(names(host)).toHaveLength(4);
    host.setAllowSpectators(true);
    e.clearNote();
    e.join(roomOf(e), 'E', '');
    expect(e.myRole()).toBe('spectator');
    expect(playersOf(host.state.members)).toHaveLength(4);
  });
});

describe('抜ける・番号が重なる', () => {
  it('始める前に抜けた人は名簿から消え、あとの人が詰める', () => {
    const { host, gs } = hostWith('A', 'B', 'C');
    gs[0].leave();
    expect(names(host)).toEqual(['ホスト', 'B', 'C']);
    expect(names(gs[2])).toEqual(['ホスト', 'B', 'C']);
  });

  it('★抜けた人のあとに入った人とサーバーの番号が重なっても、麻雀の ID で見分けて名簿は正しい', () => {
    const { host, gs } = hostWith('A', 'B', 'C');
    gs[0].leave(); // A（p1）が抜ける → 次に入る人は p3＝C と重なる
    const d = person();
    d.join(roomOf(d), 'D', '');
    const pids = server.rooms.get(host.state.room!.id)!.peers.map((p) => p.pid);
    expect(pids.filter((p) => p === 'p3')).toHaveLength(2); // 偽物のサーバーでも本当に重なっている
    expect(names(host)).toEqual(['ホスト', 'B', 'C', 'D']);
    expect(names(d)).toEqual(['ホスト', 'B', 'C', 'D']);
    // 番号の重なった C が接続を切っても、点呼で C だけが抜ける（D は残る）
    server.cut(gs[2]);
    vi.advanceTimersByTime(ROLLCALL_MS);
    expect(names(host)).toEqual(['ホスト', 'B', 'D']);
    expect(gs[2].state.note).toBe('connectionLost');
  });

  it('接続が切れた人は、点呼に答えないので抜けたことになる（残った人の返事がそろえば待たずに決まる）', () => {
    const { host, gs } = hostWith('A', 'B');
    server.cut(gs[0]);
    expect(names(host)).toEqual(['ホスト', 'B']);
  });

  it('点呼に答えない人がいれば、時間切れまで待ってから外す', () => {
    const { host, gs } = hostWith('A', 'B');
    // B の返事が届かないことにする（B は部屋にいるが、点呼を受け取れない）
    const silent = vi.spyOn(gs[1] as unknown as { receive: (d: unknown) => void }, 'receive').mockImplementation(() => {});
    server.cut(gs[0]);
    expect(names(host)).toEqual(['ホスト', 'A', 'B']);
    vi.advanceTimersByTime(ROLLCALL_MS);
    expect(names(host)).toEqual(['ホスト']);
    silent.mockRestore();
  });

  it('ホストが部屋を閉じると、始める前は「部屋を閉じました」、始めたあとは「対局を終了しました」', () => {
    const a = hostWith('A');
    a.host.leave();
    expect(a.gs[0].state.where).toBe('lobby');
    expect(a.gs[0].state.note).toBe('hostLeft');
    const b = hostWith('B');
    b.host.start();
    b.host.leave();
    expect(b.gs[0].state.note).toBe('hostLeftGame');
  });
});

describe('始める', () => {
  it('ホストが始めると全員に始めた印が届き、一覧では対局中になる。ゲストは始められない', () => {
    const { host, gs } = hostWith('A');
    gs[0].start();
    expect(host.state.started).toBe(false);
    host.start();
    expect(gs[0].state.started).toBe(true);
    expect(roomOf(person()).gameState).toBe('playing');
  });

  it('始めたあとに新しい人が入ってきたら観戦者として入る（段階10の3・Q13=B）。観戦を断っている部屋では断る', () => {
    const { host } = hostWith('A');
    host.start();
    const x = person();
    expect(joinRoleOf(roomOf(x))).toBe('spectator');
    x.join(roomOf(x), 'X', '');
    expect(x.state.where).toBe('room');
    expect(x.myRole()).toBe('spectator');
    expect(names(host)).toEqual(['ホスト', 'A', 'X']);
    expect(playersOf(host.state.members).map((m) => m.name)).toEqual(['ホスト', 'A']);
    // 途中から入った観戦者にも卓ができる（席は無い＝誰の手牌も開けられない）
    expect(x.table?.started).toBe(true);
    expect(x.table?.mySeat).toBeNull();
    host.setAllowSpectators(false);
    const y = person();
    y.join(roomOf(y), 'Y', '');
    expect(y.state.where).toBe('lobby');
    expect(y.state.note).toBe('noSpectators');
  });

  it('始めたあとに抜けた人は席を残して「接続が切れています」の印', () => {
    const { host, gs } = hostWith('A', 'B');
    host.start();
    gs[0].leave();
    expect(names(host)).toEqual(['ホスト', 'A(切)', 'B']);
    expect(names(gs[1])).toEqual(['ホスト', 'A(切)', 'B']);
  });

  it('返事の待ち：ホストが選んだ値（始める前だけ）がゲストにも届き、始めると卓の待ちになる', () => {
    const { host, gs } = hostWith('A');
    expect(gs[0].state.replyWait).toBe('normal');
    gs[0].setReplyWait('fast'); // ゲストは選べない
    expect(host.state.replyWait).toBe('normal');
    host.setReplyWait('slow');
    expect(gs[0].state.replyWait).toBe('slow');
    host.start();
    expect(gs[0].table?.replyWait).toBe(10000);
    host.setReplyWait('fast'); // 始めたあとは変えられない
    expect(host.state.replyWait).toBe('slow');
  });

  it('CPU の強さ：ホストが選んだもの（始める前だけ）がゲストにも届き、空き席の CPU がその強さで打つ（段階7・Q4=A）', () => {
    const { host, gs } = hostWith('A');
    expect(gs[0].state.strength).toBe('hard');
    gs[0].setStrength('easy'); // ゲストは選べない
    expect(host.state.strength).toBe('hard');
    host.setStrength('apocalypse');
    expect(gs[0].state.strength).toBe('apocalypse');
    host.start();
    expect((host.table as unknown as { o: { cpu: unknown } }).o.cpu).toBe(cpuOf('apocalypse'));
    host.setStrength('easy'); // 始めたあとは変えられない
    expect(host.state.strength).toBe('apocalypse');
  });
  it('ルール：ホストが選んだもの（始める前だけ）がゲストにも届き、始めると対局の始まりで全員のルールになる', () => {
    const { host, gs } = hostWith('A');
    expect(gs[0].state.rules.base).toBe('general');
    const tenhou = { base: 'tenhou' as const, values: { ...(rulesOfSet('tenhou').values as Record<JpRuleKey, string>) } };
    gs[0].setRules(tenhou); // ゲストは選べない
    expect(host.state.rules.base).toBe('general');
    const custom = { ...tenhou, values: { ...tenhou.values, kuitan: 'on' } };
    host.setRules(custom);
    expect(gs[0].state.rules).toEqual(custom);
    host.start();
    expect(host.table?.view.rules).toEqual({ family: 'jp', values: custom.values });
    expect(gs[0].table?.view.rules).toEqual({ family: 'jp', values: custom.values });
    host.setRules(tenhou); // 始めたあとは変えられない
    expect(host.state.rules).toEqual(custom);
  });

  it('ルール：読めないもの（知らない値・項目の欠け）が届いたら使わない', () => {
    const g = ruleChoiceOf(rulesOfSet('general'));
    expect(g).toBeNull(); // base が無い
    const ok = { base: 'general', values: { ...(rulesOfSet('general').values as Record<string, string>) } };
    expect(ruleChoiceOf(ok)).toEqual(ok);
    expect(ruleChoiceOf({ ...ok, values: { ...ok.values, kuitan: 'maybe' } })).toBeNull();
    const { kuitan: _, ...missing } = ok.values;
    expect(ruleChoiceOf({ ...ok, values: missing })).toBeNull();
    expect(ruleChoiceOf({ ...ok, base: 'nope' })).toBeNull();
  });

  it('チャット：部屋の全員に名前つきで届く。空・長すぎ・1 秒に 2 回目は送らない', () => {
    const { host, gs } = hostWith('A', 'B');
    expect(gs[0].sendChat('よろしく', 10_000)).toBe(true);
    expect(host.state.chat).toEqual([{ id: gs[0].myId, name: 'A', text: 'よろしく' }]);
    expect(gs[1].state.chat.map((l) => l.text)).toEqual(['よろしく']);
    expect(gs[0].sendChat('連打', 10_500)).toBe(false);
    expect(gs[0].sendChat('   ', 12_000)).toBe(false);
    expect(gs[0].sendChat('x'.repeat(201), 12_000)).toBe(false);
    expect(gs[0].sendChat('二言目', 11_200)).toBe(true);
    expect(gs[1].state.chat.map((l) => l.text)).toEqual(['よろしく', '二言目']);
  });

  it('チャット：あとから入った人にも、それまでのチャットが届く', () => {
    const { host } = hostWith('A');
    expect(host.sendChat('始める前の話', 50_000)).toBe(true);
    const b = person();
    b.join(roomOf(b), 'B', '');
    expect(b.state.chat.map((l) => l.text)).toEqual(['始める前の話']);
  });
});

describe('観戦（段階10の3・利用者決定 10-16）', () => {
  const roles = (s: OnlineSession) => s.state.members.map((m) => `${m.name}:${m.role ?? 'player'}`);

  it('席が 4 つ埋まっていると、5 人目からは観戦者として入る（一覧のボタンは「観戦」）', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    expect(roles(host)).toEqual(['ホスト:player', 'A:player', 'B:player', 'C:player', 'D:spectator']);
    expect(gs[3].myRole()).toBe('spectator');
    expect(roles(gs[0])).toEqual(roles(host));
  });

  it('ホストは待合でプレイヤーを観戦者に・観戦者をプレイヤーにできる（席は 4 つまで）', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    host.setRole(gs[3].myId, 'player'); // 席が埋まっているので動かない
    expect(gs[3].myRole()).toBe('spectator');
    host.setRole(gs[0].myId, 'spectator');
    host.setRole(gs[3].myId, 'player');
    expect(roles(host)).toEqual(['ホスト:player', 'A:spectator', 'B:player', 'C:player', 'D:player']);
    expect(gs[0].myRole()).toBe('spectator');
    gs[0].setRole(gs[1].myId, 'spectator'); // ゲストは動かせない
    expect(gs[1].myRole()).toBe('player');
  });

  it('プレイヤーは自分から観戦に回れる。観戦者は自分ではプレイヤーに戻れない（入り直せば席が空いていればプレイヤー）', () => {
    const { host, gs } = hostWith('A');
    gs[0].becomeSpectator();
    expect(gs[0].myRole()).toBe('spectator');
    expect(roles(host)).toEqual(['ホスト:player', 'A:spectator']);
    gs[0].leave();
    gs[0].join(roomOf(gs[0]), 'A', '');
    expect(gs[0].myRole()).toBe('player');
  });

  it('始まったあとは役割を動かせない（ホストも本人も）', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    host.start();
    host.setRole(gs[0].myId, 'spectator');
    gs[1].becomeSpectator();
    host.setRole(gs[3].myId, 'player');
    expect(roles(host)).toEqual(['ホスト:player', 'A:player', 'B:player', 'C:player', 'D:spectator']);
  });

  it('キック：待合では誰でも、対局中は観戦者だけ。キックされた人はまた入れる', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    host.kick(gs[0].myId);
    expect(gs[0].state.where).toBe('lobby');
    expect(gs[0].state.note).toBe('kicked');
    expect(names(host)).toEqual(['ホスト', 'B', 'C', 'D']);
    gs[0].clearNote();
    gs[0].join(roomOf(gs[0]), 'A', '');
    expect(gs[0].state.where).toBe('room');
    host.start();
    host.kick(gs[1].myId); // プレイヤーは対局中にキックできない
    expect(gs[1].state.where).toBe('room');
    const watcher = [gs[0], gs[3]].find((g) => g.myRole() === 'spectator')!;
    host.kick(watcher.myId);
    expect(watcher.state.where).toBe('lobby');
    expect(watcher.state.note).toBe('kicked');
  });

  it('対局中に「観戦を断る」へ切り替えると、見ている人も全員出る（Q11=B）', () => {
    const { host, gs } = hostWith('A');
    host.start();
    const x = person();
    x.join(roomOf(x), 'X', '');
    const y = person();
    y.join(roomOf(y), 'Y', '');
    expect(spectatorsOf(host.state.members).length).toBe(2);
    host.setAllowSpectators(false);
    for (const v of [x, y]) {
      expect(v.state.where).toBe('lobby');
      expect(v.state.note).toBe('noSpectators');
    }
    expect(names(host)).toEqual(['ホスト', 'A']);
    expect(gs[0].state.allowSpectators).toBe(false);
  });

  it('チャット：待合では観戦者も書ける。対局が始まったら観戦者は書けないが、読める', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    const w = gs[3];
    expect(w.sendChat('待合です', 10_000)).toBe(true);
    expect(host.state.chat.map((l) => l.text)).toContain('待合です');
    host.start();
    expect(w.canChat()).toBe(false);
    expect(w.sendChat('対局中です', 20_000)).toBe(false);
    expect(host.state.chat.map((l) => l.text)).not.toContain('対局中です');
    expect(gs[0].sendChat('プレイヤーです', 30_000)).toBe(true);
    expect(w.state.chat.map((l) => l.text)).toContain('プレイヤーです');
  });

  it('対局中に観戦者が抜けても、席の人は「切れた」にならない（観戦者は名簿から外れる）', () => {
    const { host, gs } = hostWith('A', 'B', 'C', 'D');
    host.start();
    gs[3].leave();
    vi.advanceTimersByTime(ROLLCALL_MS + 10);
    expect(names(host)).toEqual(['ホスト', 'A', 'B', 'C']);
  });
});
