// オンライン対局の部屋（段階5の2）：部屋の一覧・部屋を作る・入る・待合・始める。
// 通信の土台（games/matchmaking）は Transport の形でだけ使う＝検査では偽物の Transport に差し替える。
//
// 人の見分けは麻雀が自分で配る ID（利用者 Q3=B・2026-10-09）。
// 土台の番号（pid）は、抜けた人のあとに入った人と重なることがあるので使わない。
// 送るのは「全員あて」か「ホストあて」だけ。送るものには必ず自分の ID を入れる。
// ★送るものに to・from という項目を入れない（土台が宛先・送り主で上書きする）。誰あては target に入れる。
//
// 待合の名簿はホストが持ち、変わるたびに全員へ配る（ホストが正本）。
// 誰が抜けたかは土台からは確かに分からない（番号が重なりうる）ので、ホストが点呼を取って決める。

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
};

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

  constructor(private readonly tr: Transport) {}

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
      onOpen: () => this.set({ wsOpen: true }),
      onClose: () => this.set({ wsOpen: false }),
      onRooms: (rooms) => this.set({ rooms }),
      onCreated: (id, name) => this.created(id, name),
      onJoined: (id, name) => this.joined(id, name),
      onMessage: (d) => this.receive(d),
      onPeerLeft: (players) => this.peerLeft(players),
      onRoomClosed: () => this.toLobby(this.s.started ? 'hostLeftGame' : 'hostLeft'),
      onLost: () => this.toLobby('connectionLost'),
      onError: (m) => this.set({ busy: false, note: noteOfServer(m) }),
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
    this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
    this.set({ busy: true, note: null });
    this.tr.joinRoom(room.id, room.hasPassword ? typedPw : '', me);
  }

  /** 部屋を出る（ホストなら部屋が閉じる） */
  leave() {
    if (this.s.where !== 'room') return;
    if (!this.s.room?.isHost) this.tr.send({ type: 'mj-bye', id: this.myId }, 'host');
    this.tr.leave();
    this.toLobby(null);
  }

  /** ホスト：対局を始める（空いた席は CPU） */
  start() {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ started: true });
    this.tr.setGameState('playing');
    this.broadcastMembers();
  }

  private toLobby(note: OnlineNote | null) {
    this.stopRollcall();
    this.pending = null;
    this.set({ where: 'lobby', busy: false, room: null, members: [], started: false, note });
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
    this.set({ where: 'room', busy: false, room: { id, name, hasPassword: this.pending?.hasPassword ?? false, isHost: false }, members: [], started: false });
    this.pending = null;
    this.tr.send({ type: 'mj-hello', id: this.myId, name: this.myName }, 'host');
  }

  private broadcastMembers() {
    this.tr.send({ type: 'mj-members', members: this.s.members, started: this.s.started }, 'all');
  }

  private receive(d: Record<string, unknown>) {
    if (this.s.where !== 'room' || !this.s.room) return;
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
      this.set({ members: d.members as Member[], started: d.started === true });
      return;
    }
    if (d.type === 'mj-reject' && d.target === this.myId) {
      this.tr.leave();
      this.toLobby(d.reason === 'full' ? 'roomFull' : 'rejectedStarted');
      return;
    }
    if (d.type === 'mj-rollcall') this.tr.send({ type: 'mj-here', id: this.myId, nonce: d.nonce }, 'host');
  }

  /** ホスト：入ってきた人を席に着ける。対局が始まったあとは、抜けた本人（同じ ID）だけ戻れる */
  private hello(id: string, name: string) {
    const known = this.s.members.find((m) => m.id === id);
    if (known) {
      this.set({ members: this.s.members.map((m) => (m.id === id ? { ...m, online: true } : m)) });
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
