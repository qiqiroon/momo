// オンライン対局の部屋（段階5の2）：部屋の一覧・部屋を作る・入る・待合・始める。
// 通信の土台（games/matchmaking）は Transport の形でだけ使う＝検査では偽物の Transport に差し替える。
//
// 人の見分けは麻雀が自分で配る ID（利用者 Q3=B・2026-10-09）。
// 土台の番号（pid）は、抜けた人のあとに入った人と重なることがあるので使わない。
// 送るのは「全員あて」か「ホストあて」だけ。送るものには必ず自分の ID を入れる。
// ★送るものに to・from という項目を入れない（土台が宛先・送り主で上書きする）。誰あては target に入れる。
//
// 待合の名簿はホストが持ち、変わるたびに全員へ配る（ホストが正本）。
// 対局が始まったら卓（table.ts の OnlineTable）を作り、mt- で始まる知らせは卓へ回す（段階5の3c）。
// ホスト以外の人は、接続が切れても同じ ID で入り直せば同じ席に戻れる（利用者 Q4=A）：
// アプリを開いたままなら自動で入り直す。開き直したときは、部屋の一覧に「対局中の部屋に戻る」を出す。
// 誰が抜けたかは土台からは確かに分からない（番号が重なりうる）ので、ホストが点呼を取って決める。

import { tsumogiriCpu } from '../cpu/tsumogiri';
import { OnlineTable, type LockerStore, type SyncData, type TableOptions, type WireLocker } from './table';

/** 「鳴かない」の端末の控え（画面の Online.tsx と同じ名前） */
const readNoCalls = (): boolean => {
  try {
    return localStorage.getItem('momo-mahjong.online.noCalls') === '1';
  } catch {
    return false;
  }
};

/** 部屋の一覧の 1 行（土台の room_list の多人数の部屋） */
export interface RoomInfo {
  id: string;
  name: string;
  hostName: string;
  hasPassword: boolean;
  isPublic: boolean;
  playerCount: number;
  maxPlayers: number;
  gameState: string;
}

export interface Member {
  id: string;
  name: string;
  /** 対局が始まったあとで抜けた人は、席を残したまま false にする（戻れるのは同じ ID の人だけ） */
  online: boolean;
}

/** 画面に出す一言（言葉は画面の側で選ぶ） */
export type OnlineNote =
  | 'noName'
  | 'noRoomName'
  | 'wrongPw'
  | 'roomFull'
  | 'roomGone'
  | 'rejectedStarted'
  | 'hostLeft'
  | 'hostLeftGame'
  | 'connectionLost'
  | 'serverBusy'
  | { raw: string };

/** 開き直したときに戻るための控え（ホスト以外。端末に 1 つ） */
export interface SavedSeat {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  myId: string;
  name: string;
  password: string;
}

export interface OnlineState {
  /** サーバーにつながっているか */
  wsOpen: boolean;
  rooms: RoomInfo[];
  where: 'lobby' | 'room';
  /** 入る・作るを頼んで返事を待っている */
  busy: boolean;
  room: { id: string; name: string; hasPassword: boolean; isHost: boolean } | null;
  /** 席順（0 番がホスト）。4 人に満たない席は CPU */
  members: Member[];
  started: boolean;
  note: OnlineNote | null;
  /** 卓が変わった回数（画面を描き直す合図） */
  tableRev: number;
  /** 接続が切れて入り直しているところ */
  reconnecting: boolean;
  /** 開き直したときに戻れる対局（部屋の一覧に「戻る」を出す） */
  saved: SavedSeat | null;
  /** 返事の待ち（ホストが選び、名簿と一緒に配る） */
  replyWait: ReplyWait;
}

export interface TransportHandlers {
  onOpen(): void;
  onClose(): void;
  onRooms(rooms: RoomInfo[]): void;
  onCreated(roomId: string, roomName: string): void;
  onJoined(roomId: string, roomName: string): void;
  onMessage(data: Record<string, unknown>): void;
  /** 誰かが抜けた（誰かは確かでない）。players＝ホストを含むいまの人数 */
  onPeerLeft(players: number): void;
  /** ホストが抜けて部屋が閉じた */
  onRoomClosed(): void;
  /** 部屋にいるあいだに自分の接続が切れた */
  onLost(): void;
  onError(message: string): void;
}

export interface Transport {
  connect(h: TransportHandlers): void;
  createRoom(o: { hostName: string; name: string; password: string; isPublic: boolean; maxPlayers: number }): void;
  joinRoom(roomId: string, password: string, name: string): void;
  send(data: Record<string, unknown>, to: 'all' | 'host'): void;
  leave(): void;
  refresh(): void;
  setGameState(s: 'lobby' | 'playing'): void;
}

export const MAX_SEATS = 4;

/** 切られた牌への返事の待ち（ホストが部屋で選ぶ）。秒数は仮（利用者に押してもらってから決める＝工程表 段階5） */
export type ReplyWait = 'fast' | 'normal' | 'slow';
export const REPLY_WAIT_MS: Record<ReplyWait, number> = { fast: 1000, normal: 2000, slow: 3000 };
/** 点呼の返事を待つ長さ */
export const ROLLCALL_MS = 3000;

/** 土台のエラー文（日本語の決まった文）を一言の種類へ */
function noteOfServer(message: string): OnlineNote {
  if (message.includes('パスワード')) return 'wrongPw';
  if (message.includes('満員')) return 'roomFull';
  if (message.includes('見つかりません')) return 'roomGone';
  if (message.includes('混雑')) return 'serverBusy';
  return { raw: message };
}

function newId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const INITIAL: OnlineState = {
  wsOpen: false,
  rooms: [],
  where: 'lobby',
  busy: false,
  room: null,
  members: [],
  started: false,
  note: null,
  tableRev: 0,
  reconnecting: false,
  saved: null,
  replyWait: 'normal',
};

const SAVED_KEY = 'momo-mahjong.online.seat';
const LOCK_KEY = 'momo-mahjong.online.lock';

function readJson<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 控えられない端末では、開き直したときに戻れない（開いたままの入り直しはできる） */
  }
}

/** 自分の錠前の控え（その部屋・その ID の、いまの局だけ） */
function lockerStore(roomId: string, myId: string): LockerStore {
  return {
    save(no, seat, w) {
      const all = readJson<{ room: string; id: string; no: number; lockers: Record<string, WireLocker> }>(LOCK_KEY);
      const same = all && all.room === roomId && all.id === myId && all.no === no ? all.lockers : {};
      writeJson(LOCK_KEY, { room: roomId, id: myId, no, lockers: { ...same, [seat]: w } });
    },
    load(no, seat) {
      const all = readJson<{ room: string; id: string; no: number; lockers: Record<string, WireLocker> }>(LOCK_KEY);
      return all && all.room === roomId && all.id === myId && all.no === no ? (all.lockers[seat] ?? null) : null;
    },
  };
}

export class OnlineSession {
  private s: OnlineState = INITIAL;
  private listeners = new Set<() => void>();
  private connected = false;
  /** 自分の ID（部屋に入るたび・作るたびに作り直す） */
  myId = '';
  private myName = '';
  /** 入ろうとしている部屋（返事が来たら room にする） */
  private pending: { id: string; name: string; hasPassword: boolean } | null = null;
  /** ホスト：点呼 */
  private rollcall: { nonce: string; heard: Set<string>; expect: number; timer: ReturnType<typeof setTimeout> } | null = null;

  /** 対局の卓（始まっていなければ null） */
  table: OnlineTable | null = null;
  /** 入り直すときのパスワード */
  private password = '';

  constructor(
    private readonly tr: Transport,
    /** 卓の作り方（検査では CPU や速さを替える） */
    private readonly makeTable: (o: TableOptions) => OnlineTable = (o) => new OnlineTable(o),
  ) {
    this.s = { ...INITIAL, saved: readJson<SavedSeat>(SAVED_KEY) };
  }

  get state(): OnlineState {
    return this.s;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<OnlineState>) {
    this.s = { ...this.s, ...patch };
    this.listeners.forEach((f) => f());
  }

  /** オンライン対局の画面に入ったときに 1 回だけつなぐ */
  open() {
    if (this.connected) {
      this.tr.refresh();
      return;
    }
    this.connected = true;
    this.tr.connect({
      onOpen: () => {
        this.set({ wsOpen: true });
        this.retryJoin();
      },
      onClose: () => this.set({ wsOpen: false }),
      onRooms: (rooms) => this.set({ rooms }),
      onCreated: (id, name) => this.created(id, name),
      onJoined: (id, name) => this.joined(id, name),
      onMessage: (d) => this.receive(d),
      onPeerLeft: (players) => this.peerLeft(players),
      onRoomClosed: () => this.toLobby(this.s.started ? 'hostLeftGame' : 'hostLeft'),
      onLost: () => this.lost(),
      onError: (m) => {
        // 入り直そうとして断られた（部屋が無い＝ホストが抜けて対局が終わった）
        if (this.s.reconnecting) return this.toLobby(noteOfServer(m) === 'roomGone' ? 'hostLeftGame' : noteOfServer(m));
        this.set({ busy: false, note: noteOfServer(m) });
      },
    });
  }

  clearNote() {
    if (this.s.note) this.set({ note: null });
  }

  refresh() {
    this.tr.refresh();
  }

  create(o: { hostName: string; roomName: string; password: string; isPrivate: boolean }) {
    const hostName = o.hostName.trim();
    const roomName = o.roomName.trim();
    if (!hostName) return this.set({ note: 'noName' });
    if (!roomName) return this.set({ note: 'noRoomName' });
    this.myId = newId();
    this.myName = hostName;
    this.pending = { id: '', name: roomName, hasPassword: o.password !== '' };
    this.set({ busy: true, note: null });
    this.tr.createRoom({ hostName, name: roomName, password: o.password, isPublic: !o.isPrivate, maxPlayers: MAX_SEATS });
  }

  join(room: RoomInfo, name: string, typedPw: string) {
    const me = name.trim();
    if (!me) return this.set({ note: 'noName' });
    // パスワードの無い部屋にパスワードを入れて入ろうとしたら、違うとして止める（MOMO Hanafuda v2.73 と同じ）
    if (!room.hasPassword && typedPw !== '') return this.set({ note: 'wrongPw' });
    this.myId = newId();
    this.myName = me;
    this.password = room.hasPassword ? typedPw : '';
    this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
    this.set({ busy: true, note: null });
    this.tr.joinRoom(room.id, this.password, me);
  }

  /** 開き直したあと：控えた ID で対局中の部屋に戻る */
  rejoin() {
    const sv = this.s.saved;
    if (!sv) return;
    this.myId = sv.myId;
    this.myName = sv.name;
    this.password = sv.password;
    this.pending = { id: sv.roomId, name: sv.roomName, hasPassword: sv.hasPassword };
    this.set({ busy: true, note: null });
    this.tr.joinRoom(sv.roomId, sv.password, sv.name);
  }

  /** 戻るのをやめる（控えを消す） */
  forgetSaved() {
    writeJson(SAVED_KEY, null);
    this.set({ saved: null });
  }

  /** 自分の接続が切れた：対局中のゲストは同じ部屋へ入り直す。それ以外は部屋の一覧へ */
  private lost() {
    const room = this.s.room;
    if (this.s.started && room && !room.isHost) {
      this.table = null;
      this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
      this.set({ reconnecting: true, tableRev: this.s.tableRev + 1 });
      this.retryJoin();
      return;
    }
    this.toLobby('connectionLost');
  }

  private retryJoin() {
    if (!this.s.reconnecting || !this.s.wsOpen || !this.pending) return;
    this.tr.joinRoom(this.pending.id, this.password, this.myName);
  }

  /** 部屋を出る（ホストなら部屋が閉じる） */
  leave() {
    if (this.s.where !== 'room') return;
    if (!this.s.room?.isHost) this.tr.send({ type: 'mj-bye', id: this.myId }, 'host');
    this.tr.leave();
    this.forgetSaved();
    this.toLobby(null);
  }

  /** ホスト：返事の待ちを選ぶ（始める前だけ） */
  setReplyWait(w: ReplyWait) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ replyWait: w });
    this.broadcastMembers();
  }

  /** ホスト：対局を始める（空いた席は CPU） */
  start() {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ started: true });
    this.tr.setGameState('playing');
    this.broadcastMembers();
    this.table = this.newTable(true);
    this.table.begin(
      this.s.members.filter((m) => m.online).map((m) => ({ id: m.id, name: m.name })),
      REPLY_WAIT_MS[this.s.replyWait],
    );
  }

  private newTable(isHost: boolean): OnlineTable {
    const roomId = this.s.room?.id ?? '';
    const t = this.makeTable({
      send: (m, to) => this.tr.send(m, to),
      isHost,
      myId: this.myId,
      cpu: tsumogiriCpu,
      cpuDelay: 420,
      store: lockerStore(roomId, this.myId),
      onChange: () => this.set({ tableRev: this.s.tableRev + 1 }),
    });
    t.noCalls = readNoCalls();
    return t;
  }

  private toLobby(note: OnlineNote | null) {
    this.stopRollcall();
    this.pending = null;
    this.table = null;
    // 対局が終わった・部屋が閉じた＝戻る先は無い
    if (note === 'hostLeft' || note === 'hostLeftGame' || note === 'roomGone' || note === 'rejectedStarted') this.forgetSaved();
    this.set({ where: 'lobby', busy: false, room: null, members: [], started: false, reconnecting: false, note, tableRev: this.s.tableRev + 1 });
    this.tr.refresh();
  }

  private created(id: string, name: string) {
    this.set({
      where: 'room',
      busy: false,
      room: { id, name, hasPassword: this.pending?.hasPassword ?? false, isHost: true },
      members: [{ id: this.myId, name: this.myName, online: true }],
      started: false,
    });
    this.pending = null;
  }

  private joined(id: string, name: string) {
    const back = this.s.reconnecting || this.s.saved?.roomId === id;
    this.set({
      where: 'room',
      busy: false,
      reconnecting: false,
      room: { id, name, hasPassword: this.pending?.hasPassword ?? false, isHost: false },
      members: back ? this.s.members : [],
      started: back ? this.s.started : false,
    });
    this.pending = null;
    this.tr.send({ type: 'mj-hello', id: this.myId, name: this.myName }, 'host');
  }

  private broadcastMembers() {
    this.tr.send({ type: 'mj-members', members: this.s.members, started: this.s.started, replyWait: this.s.replyWait }, 'all');
  }

  private receive(d: Record<string, unknown>) {
    if (this.s.where !== 'room' || !this.s.room) return;
    if (typeof d.type === 'string' && d.type.startsWith('mt-')) return this.receiveTable(d);
    const id = typeof d.id === 'string' ? d.id : '';
    if (this.s.room.isHost) {
      if (d.type === 'mj-hello' && id) return this.hello(id, String(d.name ?? ''));
      if (d.type === 'mj-bye' && id) return this.dropMembers(new Set([id]));
      if (d.type === 'mj-here' && id && this.rollcall && d.nonce === this.rollcall.nonce) {
        this.rollcall.heard.add(id);
        if (this.rollcall.heard.size >= this.rollcall.expect) this.finishRollcall();
      }
      return;
    }
    if (d.type === 'mj-members' && Array.isArray(d.members)) {
      const started = d.started === true;
      const rw = d.replyWait === 'fast' || d.replyWait === 'slow' ? d.replyWait : 'normal';
      this.set({ members: d.members as Member[], started, replyWait: rw });
      // 対局中のゲストは、開き直したときに戻れるよう控える
      if (started && this.s.room && !this.s.room.isHost) {
        const sv: SavedSeat = { roomId: this.s.room.id, roomName: this.s.room.name, hasPassword: this.s.room.hasPassword, myId: this.myId, name: this.myName, password: this.password };
        writeJson(SAVED_KEY, sv);
        this.set({ saved: sv });
      }
      return;
    }
    if (d.type === 'mj-reject' && d.target === this.myId) {
      this.tr.leave();
      this.toLobby(d.reason === 'full' ? 'roomFull' : 'rejectedStarted');
      return;
    }
    if (d.type === 'mj-rollcall') this.tr.send({ type: 'mj-here', id: this.myId, nonce: d.nonce }, 'host');
  }

  /** 卓あての知らせ。ゲストは対局の始まり（mt-begin）か、戻ったときの写し（mt-sync）で卓を作る */
  private receiveTable(d: Record<string, unknown>) {
    if (d.type === 'mt-sync') {
      if (d.target !== this.myId || this.s.room?.isHost) return;
      this.table = this.newTable(false);
      this.table.loadSync(d.data as SyncData);
      this.set({ tableRev: this.s.tableRev + 1 });
      return;
    }
    if (!this.table && d.type === 'mt-begin' && !this.s.room?.isHost) this.table = this.newTable(false);
    this.table?.receive(d);
  }

  /** ホスト：入ってきた人を席に着ける。対局が始まったあとは、抜けた本人（同じ ID）だけ戻れる */
  private hello(id: string, name: string) {
    const known = this.s.members.find((m) => m.id === id);
    if (known) {
      this.set({ members: this.s.members.map((m) => (m.id === id ? { ...m, online: true } : m)) });
      // 対局中に戻ってきた人へ、それまでの出来事の列と局の山を渡す（その人は自分の牌の鍵を頼み直して開け直す）
      if (this.s.started && this.table?.started) {
        this.broadcastMembers();
        this.tr.send({ type: 'mt-sync', target: id, data: this.table.syncData() }, 'all');
        return;
      }
    } else if (this.s.started) {
      return this.tr.send({ type: 'mj-reject', target: id, reason: 'started' }, 'all');
    } else if (this.s.members.length >= MAX_SEATS) {
      return this.tr.send({ type: 'mj-reject', target: id, reason: 'full' }, 'all');
    } else {
      this.set({ members: [...this.s.members, { id, name: name || '?', online: true }] });
    }
    this.broadcastMembers();
  }

  /** ホスト：抜けた人を外す（始まったあとは席を残して抜けた印だけ付ける） */
  private dropMembers(gone: ReadonlySet<string>) {
    const members = this.s.started
      ? this.s.members.map((m) => (gone.has(m.id) ? { ...m, online: false } : m))
      : this.s.members.filter((m) => !gone.has(m.id));
    this.set({ members });
    this.broadcastMembers();
  }

  /** ホスト：誰かが抜けた＝点呼を取り、返事の無かった人を抜けたことにする */
  private peerLeft(players: number) {
    if (!this.s.room?.isHost) return;
    this.stopRollcall();
    const nonce = newId();
    const timer = setTimeout(() => this.finishRollcall(), ROLLCALL_MS);
    this.rollcall = { nonce, heard: new Set(), expect: Math.max(0, players - 1), timer };
    this.tr.send({ type: 'mj-rollcall', nonce }, 'all');
  }

  private finishRollcall() {
    const rc = this.rollcall;
    if (!rc) return;
    this.stopRollcall();
    const gone = new Set(this.s.members.filter((m, i) => i > 0 && m.online && !rc.heard.has(m.id)).map((m) => m.id));
    if (gone.size > 0) this.dropMembers(gone);
  }

  private stopRollcall() {
    if (this.rollcall) clearTimeout(this.rollcall.timer);
    this.rollcall = null;
  }
}
