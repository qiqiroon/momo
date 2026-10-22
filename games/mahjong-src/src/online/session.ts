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

import { cpuOf, DEFAULT_STRENGTH, loadStrength, strengthOf, type Strength } from '../cpu/strength';
import { generalChoice, labelOf, ruleChoiceOf, rulesOfChoice, type RuleChoice } from '../engine/ruleSets';
import { isoLocal, type KifuSource } from '../kifu/kifu';
import { saveLastGame } from '../kifu/store';
import { DEAL_SHOW_MS, DICE_SHOW_MS, dealShowOn } from '../game/useTable';
import type { Envelope, Seat } from '../engine/events';
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
  /** 観戦の人数と枠（サーバーの役割で数えたもの。麻雀の中での役割はホストが決めるので、ずれることがある） */
  spectatorCount?: number;
  maxSpectators?: number;
  gameState: string;
}

/** 部屋の中での役割（段階10の3）。サーバーの役割（入ったときのまま）とは別に、ホストが決めて名簿で配る */
export type Role = 'player' | 'spectator';

export interface Member {
  id: string;
  name: string;
  /** 対局が始まったあとで抜けた人は、席を残したまま false にする（戻れるのは同じ ID の人だけ） */
  online: boolean;
  /** 無ければプレイヤー（前の版の名簿） */
  role?: Role;
}

/** 席に着く人（ホストを含む・入った順＝席順）と観戦者 */
export const playersOf = (ms: readonly Member[]) => ms.filter((m) => (m.role ?? 'player') === 'player');
export const spectatorsOf = (ms: readonly Member[]) => ms.filter((m) => m.role === 'spectator');

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
  /** ホストに部屋から出された（段階10の3） */
  | 'kicked'
  /** 観戦を断っている部屋（入ろうとした・途中で断るに切り替わった） */
  | 'noSpectators'
  | { raw: string };

/** 開き直したときに戻るための控え（ホスト以外。端末に 1 つ） */
export interface SavedSeat {
  roomId: string;
  roomName: string;
  hasPassword: boolean;
  myId: string;
  name: string;
  password: string;
  /** サーバーに預けた鍵の包みの合言葉（開き直して戻ったときに預け直す・段階10） */
  keySecret?: string;
  /**
   * ホストだった人の、部屋の合言葉（段階10の5）。開き直したときは鍵が端末から消えているのでホストには戻らない＝
   * サーバーにすぐ「ほかの人へ移してよい」と伝えてから、プレイヤーとして入り直す
   */
  hostToken?: string;
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
  /** ルール（ホストが選び、名簿と一緒に配る。始めるときに対局の始まりの出来事で全員へ） */
  rules: RuleChoice;
  /** 空き席の CPU の強さ（ホストが選び、名簿と一緒に配る。CPU を打つのはホストの端末） */
  strength: Strength;
  /** 1 手ごとの制限時間（ホストが選び、名簿と一緒に配る・段階10の2） */
  timeLimit: TimeLimit;
  /** 観戦を許すか（ホストが部屋を作るときに選び、途中でも切り替えられる・段階10の3） */
  allowSpectators: boolean;
  /** チャット（待合と卓で同じ記録を続けて使う） */
  chat: ChatLine[];
  /**
   * ホストを待っている（段階10の5・Q3=A）。away＝切れて戻るのを待っている（until まで）／gone＝3 分を過ぎ、ほかの人へ移している。
   * 卓はそのまま見せ、上に一言を出し続ける・1 手の時計は止める
   */
  hostWait: { kind: 'checking' } | { kind: 'away'; until: number } | { kind: 'gone' } | null;
  /**
   * ほかのプレイヤーの接続を待っている（生存チェック・利用者 2026-10-20）。人の ID ごと。
   * checking＝合図が届かず、サーバーに確かめてもらっている／away＝切れた（until まで待つ＝サーバーの時計と同じ時点から 3 分）。
   * 観戦者は入れない（待たない・追わない・一言も出さない＝利用者指示）
   */
  peerWait: Record<string, { kind: 'checking' } | { kind: 'away'; until: number }>;
  /** ホストが移った（新しいホストの名前・一言を 1 回出す） */
  hostNew: string | null;
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
  /** role＝サーバーに名乗る役割（席が埋まっていれば観戦。麻雀の中の役割はホストが決め直す） */
  joinRoom(roomId: string, password: string, name: string, role?: Role): void;
  send(data: Record<string, unknown>, to: 'all' | 'host'): void;
  leave(): void;
  refresh(): void;
  setGameState(s: 'lobby' | 'playing'): void;
  /** いまの部屋の合言葉（切れたあとにホストの席へ戻るため・共通ライブラリ v1.03 の getToken）。無ければ null */
  token?(): string | null;
  /** サーバーが付けた自分の番号（ホストを受け持つ人の知らせ mj_host_new が自分かを見分ける） */
  myPid?(): string | null;
}

export const MAX_SEATS = 4;
/** 観戦者の上限（サーバーの最大と同じ・Q10=A） */
export const MAX_SPECTATORS = 8;

/** チャットの 1 行（自由に打った文。訳さない） */
export interface ChatLine {
  id: string;
  name: string;
  text: string;
}
/** チャット：1 回に送れる文字数・残す行数・送る間隔（連打で流れないように） */
export const CHAT_MAX_LEN = 200;
export const CHAT_KEEP = 50;
export const CHAT_GAP_MS = 1000;

/** 切られた牌への返事の待ち（ホストが部屋で選ぶ）。秒数は仮（利用者に押してもらってから決める＝工程表 段階5） */
export type ReplyWait = 'fast' | 'normal' | 'slow';
/** 返事の待ち（利用者 10-11：はやい 1 秒・ふつう 3 秒・ゆっくり 10 秒） */
export const REPLY_WAIT_MS: Record<ReplyWait, number> = { fast: 1000, normal: 3000, slow: 10000 };
/** 1 手ごとの制限時間（段階10の2・利用者 2026-10-19：5 秒・10 秒・なし。30 秒は長かった） */
export type TimeLimit = 'none' | '5' | '10';
export const TIME_LIMITS: readonly TimeLimit[] = ['5', '10', 'none'];
export const TIME_LIMIT_MS: Record<TimeLimit, number> = { none: 0, '5': 5_000, '10': 10_000 };
const timeLimitOf = (v: unknown): TimeLimit => (v === '5' || v === '10' ? v : 'none');
/** ホストが前に選んだ制限時間の控え（この端末だけ） */
const TIME_LIMIT_KEY = 'momo-mahjong.online.timeLimit';
/** 点呼の返事を待つ長さ */
export const ROLLCALL_MS = 3000;
/**
 * ホスト：切れた人を待つ長さの予備（段階10・利用者 Q2=A）。サーバーは 3 分で預かった包みを渡してくる。
 * 包みが来なかった（古いサーバー・預ける前に切れた）ときは、この長さで「包み無し」として引き継ぐ（＝その局は配り直し）
 */
export const KEY_FALLBACK_MS = 3 * 60 * 1000 + 10_000;
/** 戻るときの古い接続の追い出し：サーバーの返事を待つ長さ（古いサーバーは返事をしない） */
export const RECLAIM_WAIT_MS = 2000;
/** ホストが、つながっている人の席を移すとき：本人の端末が錠前を渡してくるのを待つ長さ。来なければサーバーに包みを頼む */
export const TAKE_WAIT_MS = 6000;

/** 土台のエラー文（日本語の決まった文）を一言の種類へ */
function noteOfServer(message: string): OnlineNote {
  if (message.includes('パスワード')) return 'wrongPw';
  if (message.includes('満員')) return 'roomFull';
  if (message.includes('見つかりません')) return 'roomGone';
  if (message.includes('混雑')) return 'serverBusy';
  return { raw: message };
}

/** 一覧から入るときにサーバーへ名乗る役割（Q13=B：席が空いていればプレイヤー、埋まっている・対局中なら観戦） */
export const joinRoleOf = (r: RoomInfo): Role => (r.gameState === 'playing' || r.playerCount >= r.maxPlayers ? 'spectator' : 'player');

/** 包みの合言葉（サーバーは sha256 だけを持つ） */
function newSecret(): string {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function newId(): string {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 選んだルールの控え（ui/RuleSettings.tsx の saveRuleChoice と同じ場所） */
const RULES_KEY = 'momo-mahjong.rules';

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
  rules: generalChoice(),
  strength: DEFAULT_STRENGTH,
  timeLimit: 'none',
  allowSpectators: true,
  chat: [],
  hostWait: null,
  hostNew: null,
  peerWait: {},
};

// ---- 生存チェック（利用者 2026-10-20・Q1=A＝クライアントどうし） ----
/** 「ここにいます」を送る間 */
export const ALIVE_EVERY_MS = 10_000;
/** これだけ何も届かなければ、サーバーに確かめてもらう */
export const SILENT_MS = 25_000;
/** 同じ人を確かめ直すまでの間（生きていたのに、また頼み続けない） */
export const RECHECK_MS = 30_000;
/** 確かめを頼んでから「確かめています」を出すまで（画面を裏にしているだけの人はブラウザがすぐ答える＝ちらつかせない） */
export const CHECK_SHOW_MS = 1500;
/** 開き直した元ホストが、ゲストからの局の写しを待つ長さ（届いたものからいちばん先まで進んだものを使う） */
export const RESUME_WAIT_MS = 1500;

/** ホストが 3 分戻らなかったとき：名乗り出る順の 1 人ぶんの間（下家が先・その人が名乗り出なければ次の人＝Q2=A） */
export const CLAIM_STEP_MS = 5000;

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
  type Kept = { room: string; id: string; no: number; lockers: Record<string, WireLocker>; priv?: Record<string, Envelope[]> };
  /** いまの部屋・ID・局の控え（違えば空＝局が替わったら前の局の分は捨てる） */
  const current = (no: number): Kept => {
    const all = readJson<Kept>(LOCK_KEY);
    return all && all.room === roomId && all.id === myId && all.no === no ? all : { room: roomId, id: myId, no, lockers: {}, priv: {} };
  };
  return {
    save(no, seat, w) {
      const k = current(no);
      writeJson(LOCK_KEY, { ...k, lockers: { ...k.lockers, [seat]: w } });
    },
    load(no, seat) {
      return current(no).lockers[seat] ?? null;
    },
    // 本人にだけ見える出来事の本物（四川の伏せ牌・換三張）も同じ控えに（開き直したときに取り戻す・大方針 2026-10-20）
    savePriv(no, seat, envs) {
      const k = current(no);
      writeJson(LOCK_KEY, { ...k, priv: { ...(k.priv ?? {}), [seat]: envs } });
    },
    loadPriv(no, seat) {
      return current(no).priv?.[seat] ?? [];
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
  // ---- 落ちた人の鍵の預かり（段階10） ----
  /** いまの接続のサーバーが鍵を預かれる（mj_key_probe に mj_key_ready が返った） */
  private keyReady = false;
  /** 預ける包みの合言葉（自分の ID と組。開き直しても控えから同じものを使う） */
  private keySecret = '';
  /** 最後に作った自分の包み（サーバーに預ける） */
  private lastPkg: { no: number; blob: string } | null = null;
  /** ホスト：切れた人ごとの予備の時計 */
  private keyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** ホスト：席を引き継いだ（画面に一言を出す）。id→引き継ぎ方 */
  takeovers: { id: string; how: 'continued' | 'redealt' }[] = [];
  /** ホスト：点呼 */
  private rollcall: { nonce: string; heard: Set<string>; expect: number; timer: ReturnType<typeof setTimeout> } | null = null;

  /** 対局の卓（始まっていなければ null） */
  table: OnlineTable | null = null;
  /** 入り直すときのパスワード */
  private password = '';
  // ---- ホストの復帰と交代（段階10の5） ----
  /** いまのホストの ID（作った人。ホストが移ったら新しい人）。名簿と一緒に配る */
  private hostId = '';
  /** ホスト：部屋の合言葉（切れて戻るときに使う） */
  private hostToken: string | null = null;
  /** ホスト：接続が切れて、合言葉でホストの席へ戻ろうとしている（卓は捨てずに持っている） */
  private returningHost = false;
  /** ホストが 3 分戻らなかった：自分が名乗り出る時計 */
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  // ---- 生存チェック（利用者 2026-10-20） ----
  /** 「ここにいます」を送り、黙っている人を見る時計 */
  private aliveTimer: ReturnType<typeof setInterval> | null = null;
  /** サーバーの番号（pid）ごとの、最後に何か届いた時刻 */
  private lastSeen = new Map<string, number>();
  /** 人の ID → いまのサーバーの番号（入り直すと変わる） */
  private pidOf = new Map<string, string>();
  /** 番号ごとの、最後に確かめを頼んだ時刻 */
  private checkedAt = new Map<string, number>();
  /** 番号ごとの、「確かめています」を出すまでの時計 */
  private checkShow = new Map<string, ReturnType<typeof setTimeout>>();

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

  create(o: { hostName: string; roomName: string; password: string; isPrivate: boolean; allowSpectators?: boolean }) {
    const hostName = o.hostName.trim();
    const roomName = o.roomName.trim();
    if (!hostName) return this.set({ note: 'noName' });
    if (!roomName) return this.set({ note: 'noRoomName' });
    this.myId = newId();
    this.keySecret = newSecret();
    this.myName = hostName;
    this.pending = { id: '', name: roomName, hasPassword: o.password !== '' };
    this.set({ busy: true, note: null, allowSpectators: o.allowSpectators ?? true });
    this.tr.createRoom({ hostName, name: roomName, password: o.password, isPublic: !o.isPrivate, maxPlayers: MAX_SEATS });
  }

  join(room: RoomInfo, name: string, typedPw: string) {
    const me = name.trim();
    if (!me) return this.set({ note: 'noName' });
    // パスワードの無い部屋にパスワードを入れて入ろうとしたら、違うとして止める（MOMO Hanafuda v2.73 と同じ）
    if (!room.hasPassword && typedPw !== '') return this.set({ note: 'wrongPw' });
    this.myId = newId();
    this.keySecret = newSecret();
    this.myName = me;
    this.password = room.hasPassword ? typedPw : '';
    this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
    this.set({ busy: true, note: null });
    // 席が埋まっている・対局中なら、サーバーには観戦として名乗る（満員で断られない）。席に着くかはホストが決める（花札と同じ）
    this.tr.joinRoom(room.id, this.password, me, joinRoleOf(room));
  }

  /** 開き直したあと：控えた ID で対局中の部屋に戻る */
  rejoin() {
    const sv = this.s.saved;
    if (!sv) return;
    this.myId = sv.myId;
    this.keySecret = sv.keySecret ?? newSecret();
    this.myName = sv.name;
    this.password = sv.password;
    this.pending = { id: sv.roomId, name: sv.roomName, hasPassword: sv.hasPassword };
    this.set({ busy: true, note: null });
    // ホストだった人（大方針 2026-10-20「３分以内ならホストもゲストも復活を待つ」）：まず合言葉でホストの席へ戻る。
    // 戻れたら、ゲストの端末から局の写しをもらい、端末の控え（鍵・本人にだけ見える選び）と合わせてホストのまま続きを打つ（resumeHost）。
    // 3 分を過ぎて断られたら（ほかの人へ移った）、プレイヤーとして入り直す（joinSaved）
    if (sv.hostToken) {
      this.resumingHost = true;
      this.tr.send({ type: 'mj_host_return', roomId: sv.roomId, token: sv.hostToken }, 'host');
      return;
    }
    this.joinSaved(sv);
  }

  /** 開き直した元ホスト：ホストの席へ戻ろうとしているところ（返事は room_created か mj_host_return_no） */
  private resumingHost = false;
  /** 開き直した元ホスト：ゲストから届いた局の写し（いちばん先まで進んだものを使う） */
  private resumeState: { data: SyncData; extra: Record<string, unknown> }[] = [];
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  /** 控えた席へ、プレイヤーとして入り直す（元ホストは観戦として名乗る＝席の数え方の都合。自分の席は残っている） */
  private joinSaved(sv: SavedSeat) {
    const role = sv.hostToken ? 'spectator' : undefined;
    // アプリが落ちた携帯の古い接続がサーバーに残っていると、席が埋まって入れない（10-15 利用者指摘）。
    // 合言葉で本人と確かめてもらい、古い接続を追い出してから入る（常時の見張りはしない＝Q14=B）
    if (!sv.keySecret) return this.tr.joinRoom(sv.roomId, sv.password, sv.name, role);
    const go = () => {
      if (!this.reclaimTimer) return;
      clearTimeout(this.reclaimTimer);
      this.reclaimTimer = null;
      this.tr.joinRoom(sv.roomId, sv.password, sv.name, role);
    };
    this.reclaimGo = go;
    // 古いサーバーは返事をしないので、少し待ってから入る
    this.reclaimTimer = setTimeout(go, RECLAIM_WAIT_MS);
    this.tr.send({ type: 'mj_seat_reclaim', roomId: sv.roomId, id: sv.myId, secret: sv.keySecret }, 'host');
  }

  /** 戻るときの古い接続の追い出しの返事を待つ時計（返事が来たら・時間が来たら入る） */
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  private reclaimGo: (() => void) | null = null;

  /** 戻るのをやめる（控えを消す） */
  forgetSaved() {
    writeJson(SAVED_KEY, null);
    this.set({ saved: null });
  }

  /** 自分の接続が切れた：対局中のゲストは同じ部屋へ入り直す。それ以外は部屋の一覧へ */
  private lost() {
    const room = this.s.room;
    // ホスト（段階10の5）：卓は捨てずに持ったまま、つなぎ直したら合言葉でホストの席へ戻る（サーバーは 3 分待つ）。
    // 3 分を過ぎてほかの人へ移っていたら、断られるのでプレイヤーとして入り直す
    if (room?.isHost && this.hostToken) {
      this.returningHost = true;
      this.stopRollcall();
      this.table?.setPaused(true);
      this.set({ reconnecting: true, tableRev: this.s.tableRev + 1 });
      this.retryJoin();
      return;
    }
    if (this.s.started && room && !room.isHost) {
      this.table?.dispose();
      this.table = null;
      this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
      this.set({ reconnecting: true, tableRev: this.s.tableRev + 1 });
      this.retryJoin();
      return;
    }
    this.toLobby('connectionLost');
  }

  private retryJoin() {
    if (this.returningHost && this.s.wsOpen && this.s.room && this.hostToken) {
      // 部屋の外からの頼み（共通ライブラリは部屋を出たと思っているので、そのままサーバーへ届く）。返事は room_created と同じ形
      this.tr.send({ type: 'mj_host_return', roomId: this.s.room.id, token: this.hostToken }, 'host');
      return;
    }
    if (!this.s.reconnecting || !this.s.wsOpen || !this.pending) return;
    this.tr.joinRoom(this.pending.id, this.password, this.myName, this.myRole() === 'spectator' ? 'spectator' : 'player');
  }

  /** 部屋を出る（ホストなら部屋が閉じる） */
  leave() {
    if (this.s.where !== 'room') return;
    if (!this.s.room?.isHost) this.tr.send({ type: 'mj-bye', id: this.myId }, 'host');
    this.tr.leave();
    this.forgetSaved();
    this.toLobby(null);
  }

  private lastChatAt = 0;

  /** チャットを送る（部屋の全員へ）。送れたら true（空・長すぎ・1 秒に 2 回目は送らない） */
  sendChat(text: string, now = Date.now()): boolean {
    const s = text.trim();
    if (this.s.where !== 'room' || !s || s.length > CHAT_MAX_LEN || now - this.lastChatAt < CHAT_GAP_MS) return false;
    if (!this.canChat()) return false;
    this.lastChatAt = now;
    const line: ChatLine = { id: this.myId, name: this.myName, text: s };
    this.tr.send({ type: 'mj-chat', ...line }, 'all');
    this.addChat(line);
    return true;
  }

  /** 自分の部屋の中での役割（名簿に無ければ null） */
  myRole(): Role | null {
    const m = this.s.members.find((x) => x.id === this.myId);
    return m ? (m.role ?? 'player') : null;
  }

  /** チャットに書けるか（利用者指示：待合は全員、対局が始まったら観戦者は書けない＝読むことはできる） */
  canChat(): boolean {
    return !(this.s.started && this.myRole() === 'spectator');
  }

  /** その人が観戦者か（対局中の観戦者のチャットは受け取らない） */
  private isSpectator(id: string): boolean {
    return this.s.members.find((x) => x.id === id)?.role === 'spectator';
  }

  // ---- 観戦（段階10の3・利用者決定 10-16） ----
  //  - ホストは待合でプレイヤー⇄観戦者を入れ替え、誰でもキックできる。対局中にキックできるのは観戦者だけ（プレイヤーは CPU に切り替えるだけ）
  //  - プレイヤーは自分で観戦者になれる（待合）。観戦者をプレイヤーにできるのはホストだけ
  //  - キックは締め出さない（また入れる）。観戦を断るに切り替えたら、見ている人も全員出てもらう（Q11=B）
  //  - 観戦者には手牌を送らない（卓はもともと伏せて配る）。途中から入った観戦者には、戻った人と同じ写し（mt-sync）を送る

  /** ホスト：待合で、その人をプレイヤー／観戦者にする（ホスト自身は動かさない・席は 4 つまで） */
  setRole(id: string, role: Role) {
    if (!this.s.room?.isHost || this.s.started || id === this.myId) return;
    const m = this.s.members.find((x) => x.id === id);
    if (!m || (m.role ?? 'player') === role) return;
    if (role === 'player' && playersOf(this.s.members).length >= MAX_SEATS) return;
    this.set({ members: this.s.members.map((x) => (x.id === id ? { ...x, role } : x)) });
    this.broadcastMembers();
  }

  /** プレイヤー：待合で、自分から観戦者になる（ホストへ頼む。ホストは自分では動かない） */
  becomeSpectator() {
    if (this.s.started || this.s.room?.isHost || this.myRole() !== 'player') return;
    this.tr.send({ type: 'mj-spectate', id: this.myId }, 'host');
  }

  /** ホスト：その人に部屋から出てもらう。対局中は観戦者だけ（プレイヤーは CPU に切り替える） */
  kick(id: string, reason: 'kicked' | 'noSpectators' = 'kicked') {
    if (!this.s.room?.isHost || id === this.myId) return;
    const m = this.s.members.find((x) => x.id === id);
    if (!m || (this.s.started && m.role !== 'spectator')) return;
    this.tr.send({ type: 'mj-kick', target: id, reason }, 'all');
    this.set({ members: this.s.members.filter((x) => x.id !== id) });
    this.broadcastMembers();
  }

  /** ホスト：観戦を許す・断る（いつでも。断るに切り替えたら、見ている人にも出てもらう＝Q11=B） */
  setAllowSpectators(v: boolean) {
    if (!this.s.room?.isHost || this.s.allowSpectators === v) return;
    this.set({ allowSpectators: v });
    if (!v) for (const m of spectatorsOf(this.s.members)) this.kick(m.id, 'noSpectators');
    this.broadcastMembers();
  }

  private addChat(line: ChatLine) {
    this.set({ chat: [...this.s.chat, line].slice(-CHAT_KEEP) });
  }

  /** ホスト：返事の待ちを選ぶ（始める前だけ） */
  setReplyWait(w: ReplyWait) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ replyWait: w });
    this.broadcastMembers();
  }

  /** ホスト：ルールを選ぶ（始める前だけ） */
  setRules(c: RuleChoice) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ rules: c });
    this.broadcastMembers();
  }

  /** ホスト：空き席の CPU の強さを選ぶ（始める前だけ） */
  setStrength(s: Strength) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ strength: s });
    this.broadcastMembers();
  }

  /** ホスト：1 手ごとの制限時間を選ぶ（始める前だけ） */
  setTimeLimit(v: TimeLimit) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ timeLimit: v });
    writeJson(TIME_LIMIT_KEY, v);
    this.broadcastMembers();
  }

  /** ホスト：対局を始める（空いた席は CPU）。assist＝アシストモードで始める（訂正26101113 の 2） */
  start(assist = false) {
    if (!this.s.room?.isHost || this.s.started) return;
    this.set({ started: true });
    this.tr.setGameState('playing');
    this.broadcastMembers();
    this.table = this.newTable(true);
    this.table.begin(
      playersOf(this.s.members).filter((m) => m.online).map((m) => ({ id: m.id, name: m.name })),
      REPLY_WAIT_MS[this.s.replyWait],
      rulesOfChoice(this.s.rules),
      TIME_LIMIT_MS[this.s.timeLimit],
      assist,
    );
    // ホストも開き直したときに戻れるよう控える（段階10の5。ホストには戻らず、プレイヤーとして入り直す）
    this.saveSeat();
  }

  private newTable(isHost: boolean): OnlineTable {
    const roomId = this.s.room?.id ?? '';
    const t = this.makeTable({
      send: (m, to) => this.tr.send(m, to),
      isHost,
      myId: this.myId,
      cpu: cpuOf(this.s.strength),
      cpuDelay: 420,
      // 一人用と同じ長さ（useTable の DEAL_SHOW_MS・DICE_SHOW_MS）
      dealHold: (first) => (dealShowOn() ? DEAL_SHOW_MS + (first ? DICE_SHOW_MS : 0) : 0),
      store: lockerStore(roomId, this.myId),
      onPackage: (no, blob) => {
        this.lastPkg = { no, blob };
        this.depositKey();
      },
      onChange: () => {
        this.set({ tableRev: this.s.tableRev + 1 });
        // 終局したら一度控え直す（最後の局の検算のあとに来る「対局の終わり」まで牌譜に入れる）
        if (this.table?.view.phase === 'gameover' && !this.savedOver) {
          this.savedOver = true;
          this.saveKifu();
        }
      },
      onVerified: () => this.saveKifu(),
    });
    t.noCalls = readNoCalls();
    this.startedAt = isoLocal(new Date());
    this.savedOver = false;
    return t;
  }

  /** 対局を始めた時刻（牌譜に残す） */
  private startedAt = '';
  /** 終局のあと牌譜を控え直したか */
  private savedOver = false;

  /**
   * 局の検算が済むたびに、全員の牌が見える牌譜を「最後に打った・開いた対局」に控え直す（6d・Q42＝A）。
   * 山が分からない局がある（途中で入り直した等）なら控えない
   */
  private saveKifu() {
    const src = this.kifuSource();
    if (src) saveLastGame(src);
  }

  /**
   * いまの対局の牌譜（全員の牌が見える形）。山が分からない局がある（検算が済んでいない・途中で入り直した等）なら null。
   * 終局の画面の保存とリンク（10-12・Q6=A）は、押したときにここから作る
   */
  kifuSource(): KifuSource | null {
    const t = this.table;
    const events = t?.fullLog();
    if (!t || !events || events.length === 0) return null;
    const rules = this.s.rules;
    return {
      seed: 'online',
      startedAt: this.startedAt,
      players: t.seats.map((x) => (x.kind === 'human' ? { name: x.name, kind: 'human' as const } : { name: 'CPU', kind: 'cpu' as const })),
      set: labelOf(rules.values, rules.base),
      cpu: this.s.strength,
      events,
      mode: 'online',
      walls: t.walls.map((w) => w.slice()),
      me: t.mySeat ?? 0,
    };
  }

  /** 自分の包みをサーバーに預ける（預かれるサーバーのときだけ。古いサーバーだと全員へ中継されてしまうため） */
  private depositKey() {
    if (!this.keyReady || !this.lastPkg || this.s.room?.isHost) return;
    this.tr.send({ type: 'mj_key_deposit', id: this.myId, secret: this.keySecret, no: this.lastPkg.no, blob: this.lastPkg.blob }, 'host');
  }

  /** ホスト：すぐ受け取りたいと頼んだ人 */
  private askedNow = new Set<string>();

  /**
   * ホスト：その席を CPU に切り替える（メニュー・10-15 利用者指示＝切れている人も 3 分待たずに）。
   * つながっている人：本人の端末が錠前を渡してくる。来なければ（アプリが落ちて古い接続だけ残っている等）サーバーに包みを頼む。
   * 切れている人：サーバーに包みをすぐ頼む（古いサーバーなら包み無し＝その局は配り直し）
   */
  takeSeat(seat: number) {
    const t = this.table;
    if (!this.s.room?.isHost || !t) return;
    const x = t.seats[seat];
    if (x?.kind !== 'human' || x.proxy) return;
    const m = this.s.members.find((y) => y.id === x.id);
    const askServer = () => {
      if (t.isProxy(seat as Seat)) return;
      if (!this.keyReady) return void this.takeOver(x.id, null);
      this.askedNow.add(x.id);
      this.tr.send({ type: 'mj_key_release_now', id: x.id }, 'host');
    };
    if (m?.online) {
      t.takeSeat(seat as Seat);
      setTimeout(askServer, TAKE_WAIT_MS);
    } else {
      // 切れている人：古いサーバーでは包みが来ないので、切れたことにしてすぐ引き継ぐ（配り直し）
      if (!this.keyReady) return void this.takeOver(x.id, null);
      askServer();
    }
  }

  /** ホスト：切れた人の予備の時計を止める */
  private stopKeyTimer(id: string) {
    const t = this.keyTimers.get(id);
    if (t) clearTimeout(t);
    this.keyTimers.delete(id);
  }

  /** ホスト：切れた人の席を引き継ぐ（包みが無ければ配り直し）。戻っていたら・もう CPU なら何もしない */
  private async takeOver(id: string, blob: string | null) {
    this.stopKeyTimer(id);
    this.askedNow.delete(id);
    const t = this.table;
    const m = this.s.members.find((x) => x.id === id);
    if (!t || !m) return;
    // つながって見える人（アプリが落ちて古い接続が残っていた）：サーバーが確かめたので、切れたことにする
    if (m.online) {
      if (!this.keyReady) return;
      this.set({ members: this.s.members.map((x) => (x.id === id ? { ...x, online: false } : x)) });
      this.broadcastMembers();
    }
    const how = await t.adoptReleased(id, blob);
    if (how !== 'none') {
      this.takeovers = [...this.takeovers, { id, how }];
      this.set({ tableRev: this.s.tableRev + 1 });
    }
  }

  // ---- ホストの復帰と交代（段階10の5・利用者 2026-10-20） ----
  //  - ホストが切れたら、サーバーは 3 分部屋を残す（Q1=C）。そのあいだに戻れば、ホストのまま局の続きを打つ
  //  - 3 分を過ぎたら、元ホストの下家から順に、つながっているプレイヤーが名乗り出てホストを受け持つ（Q2=A）
  //    新しいホストは卓を作り直し、その局はなかったことにして配り直す（鍵は元ホストの端末にしか無い）
  //  - 元ホストが戻ってきたら、プレイヤーとして入り直し、自分の席を返してもらう（利用者指示「プレイヤーとして…引き継いで再戦」）
  //  - 待っているあいだは卓をそのまま見せ、上に一言を出し続ける・1 手の時計は止める（Q3=A）

  /** ホスト：3 分のうちに戻れた。ゲストはこちらの写しで卓を作り直す（切れていたあいだの手や鍵が届いていないため） */
  private hostBack() {
    this.returningHost = false;
    this.hostToken = this.tr.token?.() ?? this.hostToken;
    this.keyReady = false;
    this.set({ where: 'room', busy: false, reconnecting: false, tableRev: this.s.tableRev + 1 });
    this.tr.send({ type: 'mj_key_probe' }, 'host');
    this.startAlive();
    const t = this.table;
    if (t?.started) {
      t.setPaused(false);
      this.tr.send({ type: 'mt-resync', data: t.syncData() }, 'all');
      t.rekeyMine();
    }
    this.broadcastMembers();
  }

  /**
   * 開き直した元ホストが、3 分のうちにホストの席へ戻れた（大方針 2026-10-20）。画面の中の局面は消えているので、
   * ゲストに「いまの局の写し・名簿・設定」を頼み、いちばん先まで進んだ写しで卓を作り直す（鍵と本人にだけ見える選びは端末の控えから）。
   * 作り直したら、全員へ写しを配り直す（ゲストも作り直す＝ホストが戻ったときと同じ）
   */
  private resumeHost(id: string, name: string) {
    this.resumingHost = false;
    this.hostId = this.myId;
    this.hostToken = this.tr.token?.() ?? this.s.saved?.hostToken ?? null;
    this.keyReady = false;
    this.set({
      where: 'room',
      busy: false,
      reconnecting: false,
      room: { id, name, hasPassword: this.pending?.hasPassword ?? false, isHost: true },
      started: true,
      tableRev: this.s.tableRev + 1,
    });
    this.pending = null;
    this.tr.send({ type: 'mj_key_probe' }, 'host');
    this.startAlive();
    this.resumeState = [];
    this.askState(0);
  }

  /** 開き直した元ホスト：ゲストに局の写しを頼む。届かなければ頼み直す（3 回まで。だめなら一覧へ） */
  private askState(tries: number) {
    if (this.resumeTimer) clearTimeout(this.resumeTimer);
    this.tr.send({ type: 'mt-askstate', id: this.myId }, 'all');
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.resumeState.length) return this.finishResume();
      if (tries < 2) return this.askState(tries + 1);
      this.tr.leave();
      this.toLobby('hostLeftGame');
    }, RESUME_WAIT_MS);
  }

  /** 届いた写しのうち、いちばん先まで進んだもので卓を作り直し、全員へ写しを配り直す */
  private finishResume() {
    const best = this.resumeState.reduce((a, b) => (b.data.wire.length > a.data.wire.length ? b : a));
    this.resumeState = [];
    const x = best.extra;
    const rw = x.replyWait === 'fast' || x.replyWait === 'slow' ? x.replyWait : 'normal';
    this.set({
      members: Array.isArray(x.members) ? (x.members as Member[]).map((m) => (m.id === this.myId ? { ...m, online: true } : m)) : this.s.members,
      replyWait: rw,
      rules: ruleChoiceOf(x.rules) ?? this.s.rules,
      strength: strengthOf(x.strength),
      timeLimit: timeLimitOf(x.timeLimit),
      allowSpectators: x.allowSpectators !== false,
      chat: Array.isArray(x.chat) ? (x.chat as ChatLine[]).slice(-CHAT_KEEP) : this.s.chat,
    });
    this.table?.dispose();
    const t = this.newTable(true);
    this.table = t;
    t.resumeAsHost(best.data);
    this.tr.send({ type: 'mt-resync', data: t.syncData() }, 'all');
    t.rekeyMine();
    this.broadcastMembers();
    this.saveSeat();
    this.set({ tableRev: this.s.tableRev + 1 });
  }

  /** 元ホスト：3 分を過ぎてほかの人へ移っていた（戻るのを断られた）。プレイヤーとして入り直す */
  private hostRefused() {
    this.returningHost = false;
    const room = this.s.room;
    this.table?.dispose();
    this.table = null;
    if (!room) return this.toLobby('hostLeftGame');
    this.pending = { id: room.id, name: room.name, hasPassword: room.hasPassword };
    this.set({ room: { ...room, isHost: false }, reconnecting: true, tableRev: this.s.tableRev + 1 });
    // 席の数え方の都合で、サーバーには観戦として名乗る（席に着くかは新しいホストが決める＝自分の席は残っている）
    this.tr.joinRoom(room.id, this.password, this.myName, 'spectator');
  }

  /** ホストが 3 分戻らなかった：自分が名乗り出る順番なら、その順番の分だけ待ってから名乗り出る（下家が先） */
  private scheduleClaim() {
    this.stopClaim();
    const rank = this.claimRank();
    if (rank < 0) return;
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      this.tr.send({ type: 'mj_host_take' }, 'host');
    }, rank * CLAIM_STEP_MS);
  }

  private stopClaim() {
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.claimTimer = null;
  }

  /**
   * 名乗り出る順番（0＝最初。-1＝名乗り出ない）。元ホストの下家から順に、つながっているプレイヤー（Q2=A）。
   * 席の順は全員の端末で同じ＝全員が同じ順番を出す。観戦者・席の無い人は名乗り出ない。待合では入った順
   */
  claimRank(): number {
    const online = (id: string) => this.s.members.find((m) => m.id === id)?.online !== false;
    const t = this.table;
    if (this.s.started && t?.started) {
      const me = t.mySeat;
      if (me === null || this.myRole() === 'spectator') return -1;
      const old = t.seats.findIndex((k) => k.kind === 'human' && k.id === this.hostId);
      const from = old < 0 ? 0 : old;
      const order = [1, 2, 3].map((k) => (from + k) % 4).filter((s) => {
        const k = t.seats[s];
        return k?.kind === 'human' && k.id !== this.hostId && online(k.id);
      });
      return order.indexOf(me);
    }
    const order = playersOf(this.s.members).filter((m) => m.id !== this.hostId && m.online);
    return order.findIndex((m) => m.id === this.myId);
  }

  /** 新しいホストになった：卓を作り直して写しを全員へ配り、その局を配り直す（局の間なら次の局へ） */
  private becomeHost() {
    const room = this.s.room;
    if (!room) return;
    const oldHost = this.hostId;
    this.stopClaim();
    this.hostId = this.myId;
    this.hostToken = this.tr.token?.() ?? null;
    const members = this.s.started
      ? this.s.members.map((m) => (m.id === oldHost ? { ...m, online: false } : m))
      : this.s.members.filter((m) => m.id !== oldHost);
    this.set({ room: { ...room, isHost: true }, members, hostWait: null, hostNew: this.myName, tableRev: this.s.tableRev + 1 });
    const old = this.table;
    if (this.s.started && old?.started) {
      const away = old.seats.findIndex((k) => k.kind === 'human' && k.id === oldHost);
      const startedAt = this.startedAt;
      const nt = this.newTable(true);
      this.startedAt = startedAt;
      const sync = nt.takeoverFrom(old, away < 0 ? null : (away as Seat));
      old.dispose();
      this.table = nt;
      this.tr.send({ type: 'mt-resync', data: sync }, 'all');
      nt.afterTakeover();
      this.saveSeat();
    }
    this.broadcastMembers();
  }

  /** 開き直したときに戻れるよう、席の控えを残す（ホストも＝段階10の5。ホストは合言葉も残す） */
  private saveSeat() {
    const room = this.s.room;
    if (!room || !this.s.started || this.myRole() !== 'player') return;
    const sv: SavedSeat = {
      roomId: room.id,
      roomName: room.name,
      hasPassword: room.hasPassword,
      myId: this.myId,
      name: this.myName,
      password: this.password,
      keySecret: this.keySecret,
      ...(room.isHost && this.hostToken ? { hostToken: this.hostToken } : {}),
    };
    writeJson(SAVED_KEY, sv);
    this.set({ saved: sv });
  }

  // ---- 生存チェック（利用者 2026-10-20・Q1=A） ----
  //  - 部屋にいる全員が 10 秒ごとに「ここにいます」を送る。何か届くたびに、送った人（サーバーの番号）の時刻を覚える
  //  - 25 秒何も届かない人がいたら、気づいた端末がサーバーに確かめを頼む。サーバーは 1 回だけ尋ね、答えなければ閉じる
  //    （閉じたあとは、切れたときと同じ流れ＝ホストなら 3 分待って交代・ゲストなら 3 分で CPU へ）
  //  - 画面：「○○さんの接続を確かめています」→ サーバーが閉じたら「○○さんの接続が切れました。戻るのを待っています（残り m:ss）」
  //    （3:00 はサーバーの時計と同じ時点から）。生きていたら消す
  //  - 観戦者は見張るのはホストだけ。待たない・追わない・一言も出さない（閉じたら一覧から消えるだけ＝利用者指示）

  private startAlive() {
    if (this.aliveTimer) return;
    this.aliveTimer = setInterval(() => this.aliveTick(), ALIVE_EVERY_MS);
    this.aliveTick();
  }

  private stopAlive() {
    if (this.aliveTimer) clearInterval(this.aliveTimer);
    this.aliveTimer = null;
    for (const t of this.checkShow.values()) clearTimeout(t);
    this.checkShow.clear();
    this.lastSeen.clear();
    this.pidOf.clear();
    this.checkedAt.clear();
  }

  /** 10 秒ごと：「ここにいます」を送り、黙っている人を確かめてもらう */
  aliveTick(now = Date.now()) {
    if (this.s.where !== 'room' || !this.s.room || !this.s.wsOpen || this.returningHost || this.s.reconnecting) return;
    this.tr.send({ type: 'mj-alive', id: this.myId }, 'all');
    for (const m of this.s.members) {
      if (m.id === this.myId || !m.online) continue;
      const pid = this.pidOf.get(m.id);
      // 合図をまだ一度も受け取っていない人（入ったばかり・前の版のアプリ）は見ない
      if (!pid) continue;
      if (now - (this.lastSeen.get(pid) ?? now) < SILENT_MS) continue;
      if (now - (this.checkedAt.get(pid) ?? 0) < RECHECK_MS) continue;
      const watcher = m.role === 'spectator';
      // 観戦者を見張るのはホストだけ（一言は出さない）
      if (watcher && !this.s.room.isHost) continue;
      this.checkedAt.set(pid, now);
      this.tr.send({ type: 'mj_peer_check', pid }, 'host');
      if (watcher) continue;
      const old = this.checkShow.get(pid);
      if (old) clearTimeout(old);
      this.checkShow.set(
        pid,
        setTimeout(() => {
          this.checkShow.delete(pid);
          if (m.id === this.hostId) {
            if (this.s.hostWait === null) this.set({ hostWait: { kind: 'checking' } });
          } else if (!this.s.peerWait[m.id]) this.set({ peerWait: { ...this.s.peerWait, [m.id]: { kind: 'checking' } } });
        }, CHECK_SHOW_MS),
      );
    }
  }

  /** 何か届いた：送った人の時刻を覚える（ID の入った知らせなら、ID と番号を結ぶ）。戻ってきた人の待ちの一言は消す */
  private heard(d: Record<string, unknown>, now = Date.now()) {
    const pid = typeof d.from === 'string' ? d.from : null;
    if (!pid) return;
    this.lastSeen.set(pid, now);
    const id = typeof d.id === 'string' ? d.id : null;
    if (id && this.pidOf.get(id) !== pid) this.pidOf.set(id, pid);
    // 待っている人から届いた＝戻ってきた。★前は番号が変わったときだけ消していたが、サーバーは空いた番号の小さい順に配るので、
    // 読み込み直して戻った人は前と同じ番号になることがあり、「戻るのを待っています」が消えなかった（10-21 見回りで発見）
    if (id && this.s.peerWait[id]) this.clearPeerWait(id);
  }

  /** いまもその人の合図が届いているか（最後に届いてから SILENT_MS のうち） */
  private hearsFrom(id: string, now = Date.now()): boolean {
    const pid = this.pidOf.get(id);
    const seen = pid ? this.lastSeen.get(pid) : undefined;
    return seen !== undefined && now - seen < SILENT_MS;
  }

  private clearPeerWait(id: string) {
    const { [id]: _gone, ...rest } = this.s.peerWait;
    void _gone;
    this.set({ peerWait: rest });
  }

  private idOfPid(pid: string): string | null {
    for (const [id, p] of this.pidOf) if (p === pid) return id;
    return null;
  }

  /** 生存チェックのサーバーからの返事。扱ったら true */
  private receiveAlive(d: Record<string, unknown>): boolean {
    const pid = typeof d.pid === 'string' ? d.pid : '';
    if (d.type === 'mj_peer_alive') {
      // 生きていた：時刻を今にし、「確かめています」を出さない・消す
      this.lastSeen.set(pid, Date.now());
      const t = this.checkShow.get(pid);
      if (t) clearTimeout(t);
      this.checkShow.delete(pid);
      const id = this.idOfPid(pid);
      if (id && id === this.hostId && this.s.hostWait?.kind === 'checking') this.set({ hostWait: null });
      else if (id && this.s.peerWait[id]?.kind === 'checking') this.clearPeerWait(id);
      return true;
    }
    if (d.type === 'mj_peer_away') {
      // ゲストが切れた：サーバーの時計と同じ時点から 3 分を数える（観戦者は何も出さない）
      const t = this.checkShow.get(pid);
      if (t) clearTimeout(t);
      this.checkShow.delete(pid);
      const id = this.idOfPid(pid);
      const m = id ? this.s.members.find((x) => x.id === id) : undefined;
      if (id && m && m.role !== 'spectator' && id !== this.myId) {
        const wait = Math.max(0, Number(d.waitMs) || 0);
        this.set({ peerWait: { ...this.s.peerWait, [id]: { kind: 'away', until: Date.now() + wait } } });
      }
      return true;
    }
    return false;
  }

  /** 画面から：ホストが移った一言を出した */
  clearHostNew() {
    if (this.s.hostNew !== null) this.set({ hostNew: null });
  }

  private toLobby(note: OnlineNote | null) {
    this.stopRollcall();
    this.stopAlive();
    this.stopClaim();
    this.returningHost = false;
    for (const id of [...this.keyTimers.keys()]) this.stopKeyTimer(id);
    this.takeovers = [];
    this.lastPkg = null;
    this.keyReady = false;
    this.pending = null;
    this.table?.dispose();
    this.table = null;
    // 対局が終わった・部屋が閉じた＝戻る先は無い
    if (note === 'hostLeft' || note === 'hostLeftGame' || note === 'roomGone' || note === 'rejectedStarted') this.forgetSaved();
    this.set({ where: 'lobby', busy: false, room: null, members: [], started: false, reconnecting: false, note, tableRev: this.s.tableRev + 1, chat: [], hostWait: null, hostNew: null, peerWait: {} });
    this.tr.refresh();
  }

  private created(id: string, name: string) {
    if (this.returningHost && this.s.room?.id === id) return this.hostBack();
    if (this.resumingHost && this.pending?.id === id) return this.resumeHost(id, name);
    this.hostId = this.myId;
    this.hostToken = this.tr.token?.() ?? null;
    this.set({
      where: 'room',
      busy: false,
      room: { id, name, hasPassword: this.pending?.hasPassword ?? false, isHost: true },
      members: [{ id: this.myId, name: this.myName, online: true, role: 'player' }],
      started: false,
      // ホストのルールは、この端末で前に選んだもの（CPU と対局と同じ控え）
      rules: ruleChoiceOf(readJson<unknown>(RULES_KEY)) ?? generalChoice(),
      // 強さも、この端末で CPU と対局のときに選んだもの
      strength: loadStrength(),
      // 制限時間も、この端末で前に部屋を作ったときに選んだもの
      timeLimit: timeLimitOf(readJson<unknown>(TIME_LIMIT_KEY)),
    });
    this.pending = null;
    this.keyReady = false;
    this.tr.send({ type: 'mj_key_probe' }, 'host');
    this.startAlive();
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
      rules: back ? this.s.rules : generalChoice(),
      strength: back ? this.s.strength : DEFAULT_STRENGTH,
      timeLimit: back ? this.s.timeLimit : 'none',
    });
    this.pending = null;
    this.keyReady = false;
    this.tr.send({ type: 'mj_key_probe' }, 'host');
    this.startAlive();
    this.tr.send({ type: 'mj-hello', id: this.myId, name: this.myName }, 'host');
  }

  private broadcastMembers() {
    this.tr.send({ type: 'mj-members', members: this.s.members, hostId: this.hostId, started: this.s.started, replyWait: this.s.replyWait, rules: this.s.rules, strength: this.s.strength, timeLimit: this.s.timeLimit, allowSpectators: this.s.allowSpectators }, 'all');
  }

  private receive(d: Record<string, unknown>) {
    // 生存チェック：誰から届いたかを覚える（どの知らせでも）
    this.heard(d);
    // 部屋の外（一覧）で届く返事：戻るときの古い接続の追い出し
    if (d.type === 'mj_seat_reclaim_ok' || d.type === 'mj_seat_reclaim_no') {
      this.reclaimGo?.();
      this.reclaimGo = null;
      return;
    }
    // 元ホスト：ホストの席へ戻るのを断られた（3 分を過ぎてほかの人へ移った・部屋が無い）
    if (d.type === 'mj_host_return_no') {
      if (this.returningHost) this.hostRefused();
      // 開き直した元ホスト：プレイヤーとして入り直す（部屋が無ければ一覧に「部屋が見つかりません」）
      else if (this.resumingHost && this.s.saved) {
        this.resumingHost = false;
        this.joinSaved(this.s.saved);
      }
      return;
    }
    if (this.s.where !== 'room' || !this.s.room) return;
    if (this.receiveHostMove(d)) return;
    if (this.receiveAlive(d)) return;
    if (typeof d.type === 'string' && d.type.startsWith('mt-')) return this.receiveTable(d);
    // サーバーからの返事（鍵の預かり）。古いサーバーでは誰かの問い合わせが中継されてくるだけ＝返事は来ない
    if (d.type === 'mj_key_ready') {
      this.keyReady = true;
      return this.depositKey();
    }
    // ホスト：切れて戻らなかった人の包み。預かれるサーバーのときだけ受け取る（古いサーバーでは誰でも同じ形を送れてしまう）。
    // 新しいサーバーはクライアントからの mj_key_ を中継しないので、届いたものはサーバーが切れたと確かめて渡したもの
    if (d.type === 'mj_key_release') {
      if (!this.s.room.isHost || !this.keyReady || typeof d.id !== 'string') return;
      // 切れたあと戻ってきて、いまも合図が届いている人：切れたときにサーバーが始めた 3 分の時計で届いた古い包み＝受け取らない（席を引き取らない）。
      // ★前は CPU に任せたまま戻って席を返してもらった人の席が、切れてから 3 分でホストの画面だけ CPU に戻った（10-21 見回りで発見・利用者 Q1=A）。
      // こちらから「すぐ渡して」と頼んだとき（askedNow）は、サーバーが確かめて閉じた人なので受け取る
      if (!this.askedNow.has(d.id) && this.hearsFrom(d.id)) return;
      void this.takeOver(d.id, typeof d.blob === 'string' ? d.blob : null);
      return;
    }
    // ホスト：すぐ受け取りたいと頼んだが、預かりが無かった＝その局は配り直して CPU へ
    if (d.type === 'mj_key_none') {
      if (this.s.room.isHost && this.keyReady && typeof d.id === 'string' && this.askedNow.has(d.id)) void this.takeOver(d.id, null);
      return;
    }
    // ホスト：すぐ受け取りたいと頼んだが、その人の端末はまだ答えた（生きている）
    if (d.type === 'mj_key_alive') {
      if (typeof d.id === 'string') this.askedNow.delete(d.id);
      return;
    }
    if (typeof d.type === 'string' && d.type.startsWith('mj_key_')) return;
    const id = typeof d.id === 'string' ? d.id : '';
    // チャット：だれから来ても受け取る（文字数を超えたものは捨てる）
    // 対局中の観戦者の発言は受け取らない（書けないようにしてあるが、古い版・いじった端末から来ても出さない）
    if (d.type === 'mj-chat' && id && typeof d.text === 'string' && d.text.length <= CHAT_MAX_LEN && !(this.s.started && this.isSpectator(id))) {
      return this.addChat({ id, name: String(d.name ?? '?'), text: d.text });
    }
    // 入ってきた人へ、それまでのチャットを渡す（ホストから）
    if (d.type === 'mj-chatlog' && d.target === this.myId && Array.isArray(d.lines)) {
      return this.set({ chat: (d.lines as ChatLine[]).slice(-CHAT_KEEP) });
    }
    if (this.s.room.isHost) {
      if (d.type === 'mj-hello' && id) return this.hello(id, String(d.name ?? ''));
      if (d.type === 'mj-bye' && id) return this.dropMembers(new Set([id]));
      if (d.type === 'mj-spectate' && id && !this.s.started) {
        const m = this.s.members.find((x) => x.id === id);
        if (m && (m.role ?? 'player') === 'player') {
          this.set({ members: this.s.members.map((x) => (x.id === id ? { ...x, role: 'spectator' as const } : x)) });
          this.broadcastMembers();
        }
        return;
      }
      if (d.type === 'mj-here' && id && this.rollcall && d.nonce === this.rollcall.nonce) {
        this.rollcall.heard.add(id);
        if (this.rollcall.heard.size >= this.rollcall.expect) this.finishRollcall();
      }
      return;
    }
    if (d.type === 'mj-members' && Array.isArray(d.members)) {
      const started = d.started === true;
      const rw = d.replyWait === 'fast' || d.replyWait === 'slow' ? d.replyWait : 'normal';
      // ルールは確かめてから使う（読めなければ一般ルールのまま）
      const members = d.members as Member[];
      // いまのホスト（段階10の5で移ることがある）。前の版の名簿には無い＝先頭がホスト
      this.hostId = typeof d.hostId === 'string' && d.hostId ? d.hostId : (members[0]?.id ?? this.hostId);
      this.set({ members, started, replyWait: rw, rules: ruleChoiceOf(d.rules) ?? this.s.rules, strength: strengthOf(d.strength), timeLimit: timeLimitOf(d.timeLimit), allowSpectators: d.allowSpectators !== false });
      // 対局中のゲスト（席に着いている人）は、開き直したときに戻れるよう控える。観戦者は控えない（一覧から入り直せばよい）
      this.saveSeat();
      return;
    }
    if (d.type === 'mj-reject' && d.target === this.myId) {
      this.tr.leave();
      this.toLobby(d.reason === 'full' ? 'roomFull' : d.reason === 'noSpectators' ? 'noSpectators' : 'rejectedStarted');
      return;
    }
    // ホストに出された（キック・観戦を断るに切り替わった）。締め出しではない＝また入れる
    if (d.type === 'mj-kick' && d.target === this.myId) {
      this.tr.leave();
      this.forgetSaved();
      this.toLobby(d.reason === 'noSpectators' ? 'noSpectators' : 'kicked');
      return;
    }
    if (d.type === 'mj-rollcall') this.tr.send({ type: 'mj-here', id: this.myId, nonce: d.nonce }, 'host');
  }

  /** ホストの復帰と交代のサーバーからの知らせ（段階10の5）。扱ったら true */
  private receiveHostMove(d: Record<string, unknown>): boolean {
    const room = this.s.room;
    if (!room) return false;
    switch (d.type) {
      case 'mj_host_away': {
        if (room.isHost) return true;
        const wait = Math.max(0, Number(d.waitMs) || 0);
        this.table?.setPaused(true);
        this.set({ hostWait: { kind: 'away', until: Date.now() + wait } });
        return true;
      }
      case 'mj_host_gone':
        if (room.isHost) return true;
        this.set({ hostWait: { kind: 'gone' } });
        this.scheduleClaim();
        return true;
      case 'mj_host_take_no':
        return true;
      case 'mj_host_new': {
        this.stopClaim();
        if (typeof d.pid === 'string' && d.pid === this.tr.myPid?.()) {
          this.becomeHost();
          return true;
        }
        this.set({ hostNew: String(d.name ?? '?') });
        // 卓を持っていない（ホストの席へ戻るのを断られて入り直した元ホスト）：新しいホストへ名乗り、写しをもらう
        if (!this.table) this.tr.send({ type: 'mj-hello', id: this.myId, name: this.myName }, 'host');
        return true;
      }
      default:
        return false;
    }
  }

  /** 卓あての知らせ。ゲストは対局の始まり（mt-begin）か、戻ったときの写し（mt-sync）で卓を作る */
  private receiveTable(d: Record<string, unknown>) {
    // 開き直した元ホストが「いまの局の写しを送って」（大方針 2026-10-20）：ゲストは写し・名簿・設定を返す
    if (d.type === 'mt-askstate') {
      const t = this.table;
      if (this.s.room?.isHost || !t?.started) return;
      this.tr.send(
        {
          type: 'mt-state',
          id: this.myId,
          data: t.syncData(),
          members: this.s.members,
          replyWait: this.s.replyWait,
          rules: this.s.rules,
          strength: this.s.strength,
          timeLimit: this.s.timeLimit,
          allowSpectators: this.s.allowSpectators,
          chat: this.s.chat,
        },
        'host',
      );
      return;
    }
    if (d.type === 'mt-state') {
      if (!this.s.room?.isHost || !d.data || this.table?.started) return;
      const { data, ...extra } = d;
      this.resumeState.push({ data: data as SyncData, extra });
      return;
    }
    // ホストが戻った・新しいホストになった：全員がホストの写しで卓を作り直す（段階10の5）
    if (d.type === 'mt-resync') {
      if (this.s.room?.isHost || !d.data) return;
      const startedAt = this.startedAt;
      this.table?.dispose();
      this.table = this.newTable(false);
      this.startedAt = startedAt || this.startedAt;
      this.table.loadSync(d.data as SyncData);
      this.set({ hostWait: null, tableRev: this.s.tableRev + 1 });
      return;
    }
    if (d.type === 'mt-sync') {
      if (d.target !== this.myId || this.s.room?.isHost) return;
      this.table?.dispose();
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
    // 席に着けるか・観戦で入れるか（対局中は観戦だけ＝Q13=B。観戦を断っている部屋は観戦で入れない）
    const seatFree = !this.s.started && playersOf(this.s.members).length < MAX_SEATS;
    const watchOk = this.s.allowSpectators && spectatorsOf(this.s.members).length < MAX_SPECTATORS;
    if (!known && !seatFree && !watchOk) {
      return this.tr.send({ type: 'mj-reject', target: id, reason: this.s.allowSpectators ? 'full' : 'noSpectators' }, 'all');
    }
    // 入ってきた人（戻ってきた人も・観戦者も）へ、それまでのチャットを渡す（観戦者もプレイヤーのチャットは読める）
    if (this.s.chat.length) this.tr.send({ type: 'mj-chatlog', target: id, lines: this.s.chat }, 'all');
    if (known) {
      this.stopKeyTimer(id);
      this.set({ members: this.s.members.map((m) => (m.id === id ? { ...m, online: true } : m)) });
    } else {
      const role: Role = seatFree ? 'player' : 'spectator';
      this.set({ members: [...this.s.members, { id, name: name || '?', online: true, role }] });
    }
    this.broadcastMembers();
    // 対局中に入ってきた人へ、それまでの出来事の列と局の山を渡す。
    // 戻ってきたプレイヤーは自分の牌の鍵を頼み直して開け直す。観戦者は席が無いので伏せたまま（手牌は見えない）
    if (this.s.started && this.table?.started) this.tr.send({ type: 'mt-sync', target: id, data: this.table.syncData() }, 'all');
  }

  /** ホスト：抜けた人を外す（始まったあとは席を残して抜けた印だけ付ける） */
  private dropMembers(gone: ReadonlySet<string>) {
    // 観戦者は席が無いので、いつでも名簿から外す（戻ってきたら観戦者として入り直す）
    const members = this.s.started
      ? this.s.members.filter((m) => !(gone.has(m.id) && m.role === 'spectator')).map((m) => (gone.has(m.id) ? { ...m, online: false } : m))
      : this.s.members.filter((m) => !gone.has(m.id));
    const seated = new Set(playersOf(this.s.members).map((m) => m.id));
    this.set({ members });
    this.broadcastMembers();
    // 対局中に切れた人（席のある人だけ）：サーバーから包みが来なければ、予備の時計で引き継ぐ（その局は配り直し）
    if (this.s.started) {
      for (const id of gone) {
        if (!seated.has(id)) continue;
        if (this.keyTimers.has(id)) continue;
        this.keyTimers.set(
          id,
          setTimeout(() => void this.takeOver(id, null), KEY_FALLBACK_MS),
        );
      }
    }
  }

  /** ホスト：誰かが抜けた＝点呼を取り、返事の無かった人を抜けたことにする。people＝ホストを含む部屋の人数（観戦者も点呼に答える） */
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
    // 自分（ホスト）は点呼に答えない＝数えない。★前は「名簿の先頭がホスト」として先頭を外していたが、ホストが移ると先頭は元ホスト（段階10の5）
    const gone = new Set(this.s.members.filter((m) => m.id !== this.myId && m.online && !rc.heard.has(m.id)).map((m) => m.id));
    if (gone.size > 0) this.dropMembers(gone);
  }

  private stopRollcall() {
    if (this.rollcall) clearTimeout(this.rollcall.timer);
    this.rollcall = null;
  }
}
