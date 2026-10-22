// オンラインの卓（段階5の3b）：錠前の山で配り、出来事の列を全員でそろえて打つ。
// 通信の土台とは切り離してある（send に渡した関数で送り、receive で受け取る）＝検査は偽の通信で 4 人分を動かす。
//
// 決まり（工程表 v0.03 段階5・利用者決定）：
//  - ホストが出来事に通し番号を付けて全員へ配る（全員が同じ順で当てはめる）。空いた席の CPU はホストの端末が打つ
//  - 山は全員の錠前を掛けて混ぜる（lock.ts）。誰も並びを知らない＝ツモ・配牌は「山の何番目」で指し、
//    引く人以外が自分の鍵をその人へ渡す（全員あてに送るが、引く人の鍵は渡らないので他の人は開けられない）
//  - ドラ・裏ドラは全員が鍵を出して全員で開ける。開けてよいのは王牌の表示牌の位置だけ（ほかを開けさせない）
//  - 打つ・鳴く・アガるなどは、その席の持ち主が自分の局面で出来事を作り、ホストが番号を付け直して配る
//  - 局の終わりに全員が鍵と混ぜ方を明かし、山を作り直して確かめる（verifyDeal）
//
// ★送るものに to・from という項目を入れない（土台が宛先・送り主で上書きする）。

import { HIDDEN, SEATS, mask, type Envelope, type GameEvent, type Seat } from '../engine/events';
import { doraIndicatorPos, uraIndicatorPos, MAX_INDICATORS } from '../engine/dora';
import { nextStep } from '../engine/game';
import { act, advance, dealChunkPositions, drawPosition, legalActions, positionsNeeded, rollForDealer, type Action } from '../engine/round';
import { GENERAL_RULES, type Rules } from '../engine/rules';
import { apply, claimKeyOf, huan3DirOf, huan3From, initialState, replay, type GameState } from '../engine/state';
import { tileSetFor, type TileId } from '../engine/tiles';
import { callables, presetReply, prunePresets, type Presets } from './presets';
import {
  LOCK_BITS,
  decoder,
  encode,
  groupOf,
  modPow,
  newKey,
  newLocker,
  relockPass,
  shufflePass,
  unlock,
  verifyDeal,
  type Group,
  type Key,
  type Locker,
  type VerifyProblem,
} from './lock';
import { newWrapKeyPair, unwrap, validWrapKey, wrapFor, type WrapKeyPair } from './keywrap';
import { timeoutAction } from './timeout';

/** 制限時間への同意を待つ長さ（段階10の2・利用者 Q6＝60 秒）。過ぎても押さない人の席は CPU が打つ */
export const CONSENT_MS = 60_000;
/** ホスト：同意の返事が届かない人を待つ予備（本人の端末が自分で「同意しない」を送るはずの時刻より少し後） */
export const CONSENT_GRACE_MS = 5_000;

/**
 * 席。人の席でも proxy なら、ホストの端末の CPU が打つ（段階10・利用者決定 10-15：本人が降りた・ホストが権限を移した・
 * 切れて戻らず鍵がサーバーから届いた）。そのときは本人の錠前をホストが持つ
 */
export type SeatKind = { kind: 'human'; id: string; name: string; proxy?: boolean } | { kind: 'cpu' };

/**
 * 席を移すときに渡すもの（ホストにしか開けられない形に包んで送る・サーバーに預けるのも同じ形）：
 * その局の錠前と、本人にだけ見える出来事の本物（缺一門の伏せる牌・換三張の 3 枚）
 */
export interface SeatPackage {
  no: number;
  seat: Seat;
  locker: WireLocker;
  priv: Envelope[];
}

/** 包む鍵を送れる形（36 進）から数へ */
const fromB36 = (v: string): bigint => [...v].reduce((a, c) => a * 36n + BigInt(parseInt(c, 36)), 0n);

export type Send = (msg: Record<string, unknown>, to: 'all' | 'host') => void;

export interface TableOptions {
  send: Send;
  isHost: boolean;
  myId: string;
  /** CPU の打ち手（その席から見える局面だけを渡す） */
  cpu: (view: GameState, seat: Seat) => Action;
  /** 検査用：人の席も自動で打つ */
  autoplay?: (view: GameState, seat: Seat) => Action;
  /** 検査用：局が終わったらホストが自動で次へ進む */
  autoNext?: boolean;
  /** CPU が打つまでの間（ミリ秒。人が目で追えるように。検査では 0） */
  cpuDelay?: number;
  /**
   * 配り終えてから最初のツモまで待つ長さ（ミリ秒）。画面の「洗牌→配る」の演出と音の長さ。
   * 待たないと、ツモの音が洗牌の音より先に鳴る（利用者指摘 10-10）。first は対局の最初の局（親決めのサイコロの分を足す）
   */
  dealHold?: (first: boolean) => number;
  onChange?: () => void;
  /** 検算で食い違いが見つかったとき */
  onProblem?: (p: VerifyProblem[]) => void;
  /** 局の検算が済んだ（山が分かった）。牌譜を控え直す合図 */
  onVerified?: () => void;
  /** 自分の錠前の控え（接続が切れて戻ったとき・開き直したときに、自分の牌を開け直すのに要る） */
  store?: LockerStore;
  /**
   * 自分の席を移すときの包み（ホストにしか開けられない）ができた・変わった（局の初め・本人にだけ見える出来事のあと）。
   * 部屋の側がサーバーに預ける（切れて戻らなかったときだけ、サーバーがホストへ渡す）
   */
  onPackage?: (no: number, blob: string) => void;
  /** 検査用：制限時間への同意を待つ長さ（ミリ秒。既定 CONSENT_MS） */
  consentMs?: number;
}

export interface LockerStore {
  save(no: number, seat: Seat, w: WireLocker): void;
  load(no: number, seat: Seat): WireLocker | null;
  /**
   * その局の、席ごとの本人にだけ見える出来事の本物（四川の伏せ牌・換三張）。開き直したときに取り戻す（大方針 2026-10-20）。
   * ★前は控えていなかった＝伏せたあと最初に切る前に開き直すと、伏せた牌を切れずに卓が止まった
   */
  savePriv?(no: number, seat: Seat, envs: Envelope[]): void;
  loadPriv?(no: number, seat: Seat): Envelope[];
}

/** 戻ってきた人へホストが渡すもの（それまでの出来事の列＝全員に見える形・局の山の途中） */
export interface SyncData {
  seats: SeatKind[];
  /** 返事の待ち・1 手の制限時間（ミリ秒。戻ってきた人も同じ長さで打つ） */
  replyWait?: number;
  timeLimit?: number;
  /** アシストモードの対局か（戻ってきた人・観戦で入った人もヒントを出す） */
  assist?: boolean;
  /** ホストの包む鍵 */
  wk?: string;
  wire: { env: Envelope; pos?: number[] }[];
  /** dealt＝この局の配牌を当てはめた回数（0＝まだ配っていない＝開き直したホストが配る局を決め直す） */
  hand: { no: number; shuffled: (string[] | null)[]; relocked: (string[] | null)[]; dealt?: number } | null;
  /** 最後の局の番号（局を持たない写し＝ホストが移ったとき。新しいホストが番号を使い回さないため・段階10の5） */
  lastNo?: number;
}

// 鍵と山の数は base64 で送る（16進より約3割短い＝利用者 Q14=B・本番の実測で通信の約4割が山だった）
const hex = (b: bigint): string => {
  let h = b.toString(16);
  if (h.length % 2) h = '0' + h;
  let bin = '';
  for (let i = 0; i < h.length; i += 2) bin += String.fromCharCode(parseInt(h.slice(i, i + 2), 16));
  return btoa(bin);
};
const big = (s: string): bigint => {
  const bin = atob(s);
  let h = '';
  for (let i = 0; i < bin.length; i++) h += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return BigInt('0x' + (h || '0'));
};

export interface WireLocker {
  g: [string, string];
  c: [string, string][];
  perm: number[];
}
const lockerToWire = (l: Locker): WireLocker => ({ g: [hex(l.global.e), hex(l.global.d)], c: l.perCard.map((k) => [hex(k.e), hex(k.d)]), perm: l.perm });
const lockerFromWire = (w: WireLocker): Locker => ({
  global: { e: big(w.g[0]), d: big(w.g[1]) },
  perCard: w.c.map(([e, d]) => ({ e: big(e), d: big(d) })),
  perm: w.perm,
});

/** 席の持ち主が作り、本人にだけ見える出来事（ホストへは伏せた形で送る） */
const PRIVATE_OWN = new Set<GameEvent['type']>(['queHold', 'huan3Pass', 'huan3Take']);
/** 伏せた形か（中身の牌が全部 HIDDEN） */
const isMasked = (e: Envelope): boolean => {
  const ev = e.ev;
  if (ev.type === 'queHold') return ev.tile === HIDDEN && ev.suit === HIDDEN;
  if (ev.type === 'huan3Pass' || ev.type === 'huan3Take') return ev.tiles.every((t) => t === HIDDEN);
  return false;
};

/** 全員から見えないものを伏せた形（ホストが番号を付けるときの局面に使う） */
const maskAll = (env: Envelope): Envelope => (env.to === 'all' ? env : mask(env, -1 as Seat));

interface Hand {
  no: number;
  /** この局の山の牌の顔ぶれ（ルールで決まる：日本式 136・四川 108・香港 136・国標 144） */
  ids: number[];
  /** 自分が持つ席の錠前 */
  mine: Map<Seat, Locker>;
  start: bigint[];
  shuffled: (bigint[] | null)[];
  relocked: (bigint[] | null)[];
  final: bigint[] | null;
  /** 位置ごとに届いた鍵（席→外す鍵） */
  keys: Map<number, Map<Seat, bigint>>;
  /** 開けた牌（位置→背番号） */
  tiles: Map<number, TileId>;
  /** 配った・引いた位置（位置→持ち主の席）。ここは表に開けさせない */
  privatePos: Map<number, Seat>;
  dealt: number;
  revealed: Map<Seat, Locker>;
  verified: VerifyProblem[] | null;
  /** 局の始まりの情報（ホストだけが使う） */
  round: Round | null;
  /** ホスト：局の始まりを配ったか */
  roundSent: boolean;
  /** 自分の錠前を明かしたか */
  revealedMine: boolean;
}

type Round = { roundIndex: number; dealer: Seat; honba: number };

interface Waiter {
  need: number[];
  run: () => void;
}

export class OnlineTable {
  /** 全員に見えることだけで作った局面（ホストが番号を付けるのに使う） */
  pub: GameState = initialState();
  /** 自分が持つ席ごとの局面（その席から見える形） */
  views = new Map<Seat, GameState>();
  /** 自分の席から見えた出来事の列（自分の牌を開けた形） */
  myLog: Envelope[] = [];
  seats: SeatKind[] = [];
  mySeat: Seat | null = null;
  started = false;
  /** 局の終わりに検算した結果（空＝問題なし・null＝まだ） */
  lastVerify: VerifyProblem[] | null = null;
  /** 検算で分かった局ごとの山（位置→牌の背番号）。検算した順＝局の順。牌譜を全員の牌が見える形にするのに使う（6d・Q42＝A） */
  walls: number[][] = [];
  /** 通信の量（送った文字数・通数） */
  sent = { bytes: 0, count: 0 };
  /**
   * 切られた牌への返事の待ち（ミリ秒・ホストが部屋で選ぶ）。全員がこの長さだけ待ってから返事を出す＝
   * その時間内に決めれば、誰が迷ったか（鳴けたか）が外に出ない（工程表 段階5）。過ぎて考えている人は、決めたときに出す
   */
  replyWait = 0;
  /** 「鳴かない」（自分の席だけ・利用者 Q16=B）：チー・ポン・カンは自動で見送り、ロンのときは止まる */
  noCalls = false;
  /** 鳴ける牌の予告で先に選んだこと（自分の席だけ・段階5の4c） */
  presets: Presets = new Map();
  /** 返事の番が始まった時刻（その返事の番ごと。自分の端末で捨て牌を当てはめた時刻） */
  private claimSince = new Map<string, number>();

  // ---- 1 手ごとの制限時間（段階10の2・利用者決定 2026-10-16） ----
  //  - ホストが部屋で選ぶ（15 秒・30 秒・なし）。時計は本人の端末が数え、時間切れの手も本人の端末が出す
  //    （引いた牌の中身は本人しか知らない＝ホストが代わりに切ることはできない）
  //  - 時間のある対局は、始める前に全員へ同意を求める（60 秒・押さない／やめる人の席は CPU）

  /** 1 手ごとの制限時間（ミリ秒・0＝なし） */
  timeLimit = 0;
  /** 自分の席の、いまの手の締め切り（Date.now() の時刻。null＝時計は動いていない） */
  deadline: number | null = null;
  /** 時間切れで自動の手を出した回数（画面が「ブー」を鳴らす合図） */
  timeouts = 0;
  private clockKey: string | null = null;
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  /** 自分：同意の窓の締め切り（null＝出していない） */
  consentDeadline: number | null = null;
  private consentTimer: ReturnType<typeof setTimeout> | null = null;
  /** ホスト：同意の返事（席→同意したか・null＝まだ）。対局の最初の局はそろってから配る */
  private consents: Map<Seat, boolean | null> | null = null;
  private consentHostTimer: ReturnType<typeof setTimeout> | null = null;
  /** ホスト：同意がそろったら出す、対局の始まり */
  private pendingOpen: (() => void) | null = null;

  // ---- アシストモード（訂正26101113 の 2・設計 アシストモード v0.01 §2） ----
  //  - ホストが「アシストモードで始める」で選ぶ。全員の画面に打ち方のヒントを出す
  //  - 始める前に全員へ案内を出し、全員が OK を押すまで配らない（制限時間の同意と同じ窓・同じ待ち。やめるは置かない）
  //  - 観戦者には案内を見せるだけで待たない

  /** アシストモードの対局か */
  assist = false;
  /** 自分：始める前の案内（アシスト・制限時間）を出しているか */
  consentAsk = false;
  /** 観戦者：アシストの案内を出しているか（自分で閉じる） */
  assistNotice = false;

  /** 当てはめた出来事（全員に見える形＋配牌・ツモの位置）。ホストは戻ってきた人へこれを渡す */
  wire: { env: Envelope; pos?: number[] }[] = [];

  private readonly g: Group;
  private readonly decode: (m: bigint) => number;
  private hand: Hand | null = null;
  private queue = new Map<number, { env: Envelope; pos?: number[] }>();
  private waiters: Waiter[] = [];
  /** まだ開いていない、表に開ける頼み */
  private opens: number[][] = [];
  private busy = false;
  /** 席ごとに、どの局面（通し番号）で打ったか（同じ局面で 2 度打たない） */
  private acted = new Map<Seat, number>();
  /**
   * 鳴ける牌の予告で返事を決めた返事の番（席ごとの claimKey）。返事は replyWait たってから出すので、
   * そのあいだもボタンを出したままだと、押した鳴きが捨てられて予告の返事が出た（利用者報告 10-20・Q1=A＝予告が優先・ボタンを出さない）。
   * 通し番号でなく返事の番で覚える（ほかの人の返事が届いて通し番号が進んでも、また出さない）
   */
  private presetReplied = new Map<Seat, string>();
  /** 返事を決めた返事の番（席ごとの claimKey・予告でも押したのでも） */
  private replied = new Map<Seat, string>();
  /** ホストが手を付けた局面の番号（同じ局面で 2 度進めない） */
  private hostStep = -1;
  private nextRequested = false;
  /** 人の席の返事待ち（画面が choose を呼ぶ） */
  private ids = new Map<string, Seat>();
  /**
   * 本人にだけ見える出来事（缺一門の伏せる牌・換三張で出す 3 枚）の本物。ホストへは伏せた形で送り、
   * 配られてきたら自分の席の局面にはこちらを当てはめる（キー＝出来事の種類:席）
   */
  private privateReal = new Map<string, Envelope>();
  /**
   * 換三張の 2 人の間だけの受け渡し（Q12=A）：渡す人 A が錠前 a を掛けて送る（x）→ 受け取る人 B が錠前 b を重ねて返す（y）→
   * A が a を外して送る（z）→ B が b を外すと中身が分かる。ほかの人に見えるのは錠前の掛かった形だけ。鍵は局の終わりに明かして確かめる
   */
  private h3 = {
    give: new Map<Seat, Key>(),
    take: new Map<Seat, { from: Seat; key: Key }>(),
    done: new Set<Seat>(),
    inbox: [] as { stage: 'x' | 'y' | 'z'; from: Seat; vals: bigint[] }[],
    /** 渡す人ごとの錠前 a を掛けた 3 枚（局の終わりに a の鍵が明かされたら中身が分かる） */
    xs: new Map<Seat, bigint[]>(),
    /** 局の終わりに明かされた錠前 a の外す鍵 */
    revealed: new Map<Seat, bigint>(),
  };
  /** 局ごとの換三張で出した 3 枚（局の終わりに分かった分。walls と同じ順） */
  h3Tiles: Map<Seat, TileId[]>[] = [];

  // ---- 席を移す（段階10） ----
  /** ホスト：包みを開ける鍵（ホストの端末から出さない） */
  private wrapKeys: WrapKeyPair | null = null;
  /** ホストの包む鍵（全員へ配られる） */
  private hostWk: bigint | null = null;
  /** 自分の包みを開ける鍵（席を返してもらうとき） */
  private myWrap: WrapKeyPair | null = null;
  /** 自分の席を降りた（ホストへ渡した）。席の知らせ（mt-seat）が来る前から打たない */
  private yielded = false;
  /** 席ごとの、この局の本人にだけ見える出来事の本物（自分が見ている席だけ） */
  private ownLogs = new Map<Seat, Envelope[]>();
  /** ホスト：席を返してほしいという頼み（席→頼んだ人の包む鍵） */
  reclaims = new Map<Seat, bigint>();
  /** 自分：席を返してほしいと頼んでいる */
  reclaimPending = false;
  /** 自分：席を返す頼みを断られた（画面に出す） */
  reclaimRefused = false;

  constructor(private readonly o: TableOptions) {
    this.g = groupOf(LOCK_BITS);
    // 背番号は最大の 144 枚ぶん（どのルールの山もこの中）
    this.decode = decoder(this.g, Array.from({ length: 144 }, (_, i) => i));
  }

  // ---- 外から呼ぶ ----

  /** ホスト：席を決めて対局を始める（人の席は入った順・空きは CPU）。rules＝ホストが選んだルール（対局の始まりの出来事で全員へ）。assist＝アシストモード */
  begin(humans: { id: string; name: string }[], replyWait = 0, rules: Rules = GENERAL_RULES, timeLimit = 0, assist = false) {
    if (!this.o.isHost) return;
    const seats: SeatKind[] = SEATS.map((i) => (humans[i] ? { kind: 'human', id: humans[i].id, name: humans[i].name } : { kind: 'cpu' }));
    this.wrapKeys = newWrapKeyPair(this.g);
    const open = () => {
      const seedBytes = new Uint32Array(2);
      crypto.getRandomValues(seedBytes);
      const seed = Array.from(seedBytes, (n) => n.toString(36)).join('');
      this.emitAll([{ env: { seq: 0, to: 'all', ev: { type: 'gameStart', rules } } }, { env: { seq: 1, to: 'all', ev: rollForDealer(seed, 0) } }]);
      this.beginHand({ roundIndex: 0, dealer: this.pub.chicha, honba: 0 });
    };
    // 時間のある対局・アシストモード：全員の同意がそろう（時間のある対局は、待つ長さが過ぎる）まで、対局の始まりを出さない。
    // アシストだけなら待つ長さは無い（全員が OK を押すまで始めない＝利用者 Q13=A）
    if (timeLimit > 0 || assist) {
      this.consents = new Map(SEATS.filter((s) => seats[s].kind === 'human').map((s) => [s, null]));
      this.pendingOpen = open;
      if (timeLimit > 0) this.consentHostTimer = setTimeout(() => this.finishConsent(), (this.o.consentMs ?? CONSENT_MS) + CONSENT_GRACE_MS);
    }
    this.broadcast({ type: 'mt-begin', seats, replyWait, timeLimit, assist, wk: this.wrapKeys.y.toString(36) });
    if (!this.consents) open();
  }

  /** 画面から：始める前の案内に同意する（ok）／やめる（時間のある対局だけ）。同意の窓の時間切れも「やめる」 */
  answerConsent(ok: boolean) {
    if (!this.consentAsk || this.mySeat === null) return;
    this.consentAsk = false;
    this.consentDeadline = null;
    if (this.consentTimer) clearTimeout(this.consentTimer);
    this.consentTimer = null;
    this.toHost({ type: 'mt-consent', seat: this.mySeat, id: this.o.myId, ok });
    this.changed();
  }

  /** ホスト：同意の返事が届いた */
  private onConsent(seat: Seat, id: string, ok: boolean) {
    const k = this.seats[seat];
    if (!this.o.isHost || !this.consents || k?.kind !== 'human' || k.id !== id || this.consents.get(seat) !== null) return;
    this.consents.set(seat, ok);
    this.checkConsents();
  }

  /** ホスト：全員の返事がそろったら締め切る（返事の前に CPU に任された席＝ホストが引き取った席は待たない） */
  private checkConsents() {
    if (this.consents && [...this.consents].every(([s, x]) => x !== null || this.isProxy(s))) this.finishConsent();
  }

  /** ホスト：同意の返事をまだ出していない人の名前（ホストの画面の「○○さんの確認待ち」） */
  get consentPending(): string[] {
    if (!this.consents) return [];
    return [...this.consents].flatMap(([s, x]) => {
      const k = this.seats[s];
      return x === null && k?.kind === 'human' && !k.proxy ? [k.name] : [];
    });
  }

  /** 観戦者：アシストの案内を閉じる */
  closeAssistNotice() {
    this.assistNotice = false;
    this.changed();
  }

  /** ホスト：同意を締め切る。同意しなかった・返事の無い人の席は CPU にしてから、対局を始める（最初の局の錠前はホストが作る） */
  private finishConsent() {
    const consents = this.consents;
    if (!consents) return;
    if (this.consentHostTimer) clearTimeout(this.consentHostTimer);
    this.consentHostTimer = null;
    // 先に締め切りの印を消す（CPU にする知らせを自分で受け取ったとき、もう一度締め切らない）
    this.consents = null;
    for (const [seat, ok] of consents) if (ok !== true) this.setProxy(seat, true);
    const open = this.pendingOpen;
    this.pendingOpen = null;
    open?.();
  }

  /** ホスト：局の錠前の段取りを始める（終わったら局の始まりを配る） */
  private beginHand(r: Round) {
    this.pendingRound = r;
    this.broadcast({ type: 'mt-hand', no: (this.hand?.no ?? this.baseNo) + 1 });
  }

  /**
   * 局を持たないときの、最後の局の番号（ホストが移って作り直した卓・段階10の5）。
   * 番号を使い回すと、端末に控えた前の局の錠前を読み出してしまう（その局の鍵はもう全員に明かしてある）
   */
  private baseNo = 0;
  /**
   * 写しで作り直した卓：写しに入っていた出来事の数（通し番号がここより前の出来事は、作り直す前にもう起きていた）。
   * 局の始めの演出（親決めのサイコロ・洗牌・配る様子）は、これより後に配られた局だけで出す（利用者 10-20 Q1=A）。
   * ★前は作り直しの途中で局面が一瞬「配り終えた直後」に見え、続きから再開するのにサイコロが回った
   */
  restoredUpTo = 0;

  /** 画面から：自分の席の選んだこと */
  choose(a: Action) {
    if (this.mySeat === null) return;
    const v = this.views.get(this.mySeat);
    if (!v || !legalActions(v, this.mySeat).length) return;
    this.perform(this.mySeat, a);
    // 押したらその場で時計を止める（ホストから出来事が戻ってくるのを待たない）
    this.updateClock();
  }

  /** ホストの画面から：次の局へ */
  next() {
    this.nextRequested = true;
    this.drive();
  }

  get view(): GameState {
    return (this.mySeat !== null && this.views.get(this.mySeat)) || this.pub;
  }

  /** この局の検算の結果（null＝まだ） */
  get handVerified(): VerifyProblem[] | null {
    return this.hand?.verified ?? null;
  }

  /** 錠前を掛けて混ぜている途中か（画面に「配っています…」を出す） */
  get dealing(): boolean {
    return this.hand !== null && this.hand.final === null;
  }

  receive(d: Record<string, unknown>) {
    switch (d.type) {
      case 'mt-begin':
        this.replyWait = Math.max(0, Number(d.replyWait) || 0);
        this.timeLimit = Math.max(0, Number(d.timeLimit) || 0);
        this.assist = d.assist === true;
        this.setHostWk(d.wk);
        this.onBegin(d.seats as SeatKind[]);
        return this.askConsent();
      case 'mt-consent':
        return this.onConsent(Number(d.seat) as Seat, String(d.id), d.ok === true);
      case 'mt-seat':
        return this.onSeat(Number(d.seat) as Seat, !!d.proxy);
      case 'mt-take':
        if (Number(d.seat) === this.mySeat) void this.yieldSeat();
        return undefined;
      case 'mt-yield':
        return void this.onYield(Number(d.seat) as Seat, String(d.id), String(d.blob ?? ''));
      case 'mt-reclaim':
        return this.onReclaim(Number(d.seat) as Seat, String(d.id), d.wk);
      case 'mt-reclaim-no':
        if (Number(d.seat) === this.mySeat) {
          this.reclaimPending = false;
          this.reclaimRefused = true;
          this.changed();
        }
        return undefined;
      case 'mt-give':
        return void this.onGive(Number(d.seat) as Seat, String(d.blob ?? ''));
      case 'mt-hand':
        return this.onHand(Number(d.no));
      case 'mt-lock':
        return this.onLock(Number(d.no), d.stage as 's' | 'r', Number(d.k), (d.deck as string[]).map(big));
      case 'mt-ev':
        return this.onEv(d.env as Envelope, d.pos as number[] | undefined);
      case 'mt-open':
        return this.onOpen(Number(d.no), d.positions as number[]);
      case 'mt-keys':
        return this.onKeys(Number(d.no), d.seat as Seat, d.keys as [number, string][]);
      case 'mt-act':
        return this.onAct(String(d.id), d.seat as Seat, d.envs as Envelope[], typeof d.at === 'number' ? d.at : undefined);
      case 'mt-reveal':
        if (typeof d.h3 === 'string' && Number(d.no) === this.hand?.no) this.h3.revealed.set(d.seat as Seat, big(d.h3));
        return this.onReveal(Number(d.no), d.seat as Seat, d.locker as WireLocker);
      case 'mt-rekey':
        return this.onRekey(Number(d.no), d.seat as Seat, d.positions as number[]);
      case 'mt-h3':
        if (Number(d.no) !== this.hand?.no) return undefined;
        this.h3.inbox.push({ stage: d.stage as 'x' | 'y' | 'z', from: d.from as Seat, vals: (d.vals as string[]).map(big) });
        return this.drive();
      default:
        return undefined;
    }
  }

  // ---- 送る ----

  private send(msg: Record<string, unknown>, to: 'all' | 'host') {
    const s = JSON.stringify(msg);
    this.sent.bytes += s.length;
    this.sent.count++;
    this.o.send(msg, to);
  }

  /** 全員へ送り、自分でも受け取る（土台は送った本人には返さない） */
  private broadcast(msg: Record<string, unknown>) {
    this.send(msg, 'all');
    this.receive(msg);
  }

  /** ホストへ送る（自分がホストなら自分で受け取る） */
  private toHost(msg: Record<string, unknown>) {
    if (this.o.isHost) this.receive(msg);
    else this.send(msg, 'host');
  }

  /** ホスト：出来事を配る */
  private emit(env: Envelope, pos?: number[]) {
    this.broadcast({ type: 'mt-ev', env, ...(pos ? { pos } : {}) });
  }

  /** ホスト：続けて配る出来事は、配り終えるまで自動で進めない（途中の局面で次の手を作ると番号がぶつかる） */
  private emitAll(items: { env: Envelope; pos?: number[] }[]) {
    this.holding++;
    try {
      for (const it of items) this.emit(it.env, it.pos);
    } finally {
      this.holding--;
    }
    this.drive();
  }

  private holding = 0;

  /** 自分が打つ席（ホストは自分の席と CPU の席と、CPU に任された人の席） */
  private controlled(): Seat[] {
    return SEATS.filter((s) => (this.cpuSeat(s) ? this.o.isHost : s === this.mySeat && !this.yielded));
  }

  /** CPU が打つ席か（空き席・CPU に任された人の席） */
  cpuSeat(s: Seat): boolean {
    const k = this.seats[s];
    return k?.kind === 'cpu' || (k?.kind === 'human' && !!k.proxy);
  }

  /** CPU に任された人の席か */
  isProxy(s: Seat): boolean {
    const k = this.seats[s];
    return k?.kind === 'human' && !!k.proxy;
  }

  /** 局面を持つ席（打つ席と、自分の席＝CPU に任せていても見ていられる） */
  private viewSeats(): Seat[] {
    const out = this.controlled();
    if (this.mySeat !== null && !out.includes(this.mySeat)) out.push(this.mySeat);
    return out;
  }

  // ---- 受け取る ----

  private onBegin(seats: SeatKind[]) {
    this.seats = seats;
    this.ids = new Map(seats.flatMap((s, i) => (s.kind === 'human' ? [[s.id, i as Seat] as const] : [])));
    this.mySeat = this.ids.get(this.o.myId) ?? null;
    this.yielded = this.mySeat !== null && this.isProxy(this.mySeat);
    this.views = new Map(this.viewSeats().map((s) => [s, initialState()]));
    this.started = true;
    this.changed();
  }

  /**
   * 時間のある対局・アシストモードの始まり：自分の席があれば同意の窓を出す（時間のある対局は 60 秒で押さなければ「やめる」を送る）。
   * 観戦者はアシストの案内を見せるだけ（返事は送らない）
   */
  private askConsent() {
    if (this.timeLimit <= 0 && !this.assist) return;
    if (this.mySeat === null) {
      if (this.assist) {
        this.assistNotice = true;
        this.changed();
      }
      return;
    }
    this.consentAsk = true;
    if (this.timeLimit > 0) {
      const ms = this.o.consentMs ?? CONSENT_MS;
      this.consentDeadline = Date.now() + ms;
      this.consentTimer = setTimeout(() => this.answerConsent(false), ms);
    }
    this.changed();
  }

  /** 局の錠前の段取りを始める（全員がこの局の自分の錠前を作る） */
  private onHand(no: number) {
    const ids = this.wallIds();
    const mine = new Map(this.controlled().map((s) => [s, this.lockerFor(no, s, ids.length)] as const));
    this.hand = {
      no,
      ids,
      mine,
      start: ids.map((i) => encode(this.g, i)),
      shuffled: [null, null, null, null],
      relocked: [null, null, null, null],
      final: null,
      keys: new Map(),
      tiles: new Map(),
      privatePos: new Map(),
      dealt: 0,
      revealed: new Map(),
      verified: null,
      round: this.pendingRound,
      roundSent: false,
      revealedMine: false,
    };
    this.pendingRound = null;
    this.waiters = [];
    this.opens = [];
    this.lateActs = [];
    this.h3 = { give: new Map(), take: new Map(), done: new Set(), inbox: [], xs: new Map(), revealed: new Map() };
    this.changed();
    this.ownLogs = new Map();
    this.depositMine();
    // 席 0 から順に混ぜる（席 0 の持ち主が最初）
    this.lockStep('s', 0, this.hand.start);
  }

  private pendingRound: Round | null = null;

  /** 山の牌の顔ぶれ（対局の始まりの出来事のルールから） */
  private wallIds(rules: Rules | null = this.pub.rules): number[] {
    return tileSetFor(rules ?? GENERAL_RULES).slice();
  }

  /** この局の自分の錠前（控えがあればそれ。無ければ作って控える） */
  private lockerFor(no: number, seat: Seat, size: number): Locker {
    const kept = this.o.store?.load(no, seat);
    if (kept && kept.c.length === size) return lockerFromWire(kept);
    const lk = newLocker(this.g, size);
    this.o.store?.save(no, seat, lockerToWire(lk));
    return lk;
  }

  /** k 番目の段（混ぜる s／掛け直す r）を自分の席なら計算して配る */
  private lockStep(stage: 's' | 'r', k: number, input: bigint[]) {
    const h = this.hand;
    if (!h) return;
    const lk = h.mine.get(k as Seat);
    if (!lk) return;
    const out = stage === 's' ? shufflePass(this.g, input, lk) : relockPass(this.g, input, lk);
    this.broadcast({ type: 'mt-lock', no: h.no, stage, k, deck: out.map(hex) });
  }

  private onLock(no: number, stage: 's' | 'r', k: number, deck: bigint[]) {
    const h = this.hand;
    if (!h || h.no !== no || deck.length !== h.start.length) return;
    (stage === 's' ? h.shuffled : h.relocked)[k] = deck;
    if (stage === 's' && k < 3) this.lockStep('s', k + 1, deck);
    else if (stage === 's' && k === 3) this.lockStep('r', 0, deck);
    else if (stage === 'r' && k < 3) this.lockStep('r', k + 1, deck);
    else {
      h.final = deck;
      this.changed();
      this.drive();
    }
  }

  /** 表に開けてよい位置か（王牌のドラ・裏ドラの表示牌だけ。中国式はドラが無い＝無し） */
  private publicAllowed(pos: number): boolean {
    if (this.pub.rules?.family === 'cn') return false;
    const size = this.hand?.ids.length ?? 136;
    for (let n = 0; n < MAX_INDICATORS; n++) if (pos === doraIndicatorPos(size, n) || pos === uraIndicatorPos(size, n)) return true;
    return false;
  }

  /** 表に開ける：全員が全員へ自分の鍵を出す */
  private onOpen(no: number, positions: number[]) {
    const h = this.hand;
    if (!h || h.no !== no || !h.final) return;
    const ok = positions.filter((p) => this.publicAllowed(p) && !h.privatePos.has(p));
    this.sendKeys(ok, null);
  }

  /** 自分が持つ席の鍵を出す（except の席の分は出さない＝その席の持ち主だけが知る牌） */
  private sendKeys(positions: number[], except: Seat | null) {
    const h = this.hand;
    if (!h || positions.length === 0) return;
    for (const [seat, lk] of h.mine) {
      if (seat === except) continue;
      this.broadcast({ type: 'mt-keys', no: h.no, seat, keys: positions.map((p) => [p, hex(lk.perCard[p].d)]) });
    }
  }

  private onKeys(no: number, seat: Seat, keys: [number, string][]) {
    const h = this.hand;
    if (!h || h.no !== no || !h.final) return;
    for (const [p, d] of keys) {
      let m = h.keys.get(p);
      if (!m) h.keys.set(p, (m = new Map()));
      m.set(seat, big(d));
      this.tryDecode(p);
    }
    this.wake();
  }

  /** 4 席ぶんの鍵がそろった位置を開ける（自分の席の鍵は手元にある） */
  private tryDecode(p: number) {
    const h = this.hand;
    if (!h || !h.final || h.tiles.has(p)) return;
    const m = new Map(h.keys.get(p) ?? []);
    for (const [seat, lk] of h.mine) m.set(seat, lk.perCard[p].d);
    if (m.size < 4) return;
    const id = this.decode(unlock(this.g, h.final[p], [...m.values()]));
    if (id >= 0) h.tiles.set(p, id);
  }

  private wake() {
    const ready = this.waiters.filter((w) => w.need.every((p) => this.hand?.tiles.has(p)));
    this.waiters = this.waiters.filter((w) => !ready.includes(w));
    ready.forEach((w) => w.run());
    if (ready.length) this.pump();
  }

  /** 位置の牌が開いたら run（すでに開いていればすぐ） */
  private whenOpen(need: number[], run: () => void) {
    for (const p of need) this.tryDecode(p);
    if (need.every((p) => this.hand?.tiles.has(p))) run();
    else this.waiters.push({ need, run });
  }

  /** 表に開けて、開いたら run */
  private openPublic(positions: number[], run: () => void) {
    if (positions.length === 0) return run();
    const h = this.hand;
    if (!h) return;
    this.broadcast({ type: 'mt-open', no: h.no, positions });
    this.opens.push(positions);
    this.whenOpen(positions, () => {
      this.opens = this.opens.filter((x) => x !== positions);
      run();
    });
  }

  // ---- 出来事を当てはめる ----

  private onEv(env: Envelope, pos?: number[]) {
    this.queue.set(env.seq, { env, pos });
    this.pump();
  }

  /** 届いた出来事を通し番号の順に当てはめる（自分の牌を開けるのを待つあいだは止まる） */
  private pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const item = this.queue.get(this.pub.nextSeq);
        if (!item) break;
        if (!this.applyOne(item.env, item.pos)) break;
        this.queue.delete(item.env.seq);
      }
    } finally {
      this.busy = false;
    }
    this.changed();
    this.drive();
  }

  /** 1 つ当てはめる。自分の牌を開ける鍵がまだなら false（待つ） */
  private applyOne(env: Envelope, pos?: number[]): boolean {
    const h = this.hand;
    const priv = env.to !== 'all' && (env.ev.type === 'deal' || env.ev.type === 'draw');
    if (priv) {
      if (!h || !h.final || !pos) throw new Error('山が配られていないのに牌が来た');
      const target = (env.ev as { seat: Seat }).seat;
      if (!h.privatePos.has(pos[0])) {
        // はじめて見たとき：決まった位置かを確かめて、自分の鍵を出す（引く人の分は出さない）
        if (!this.expectedPrivate(env.ev, pos)) throw new Error(`決まった位置でない牌を開けようとした（${pos.join(',')}）`);
        pos.forEach((p) => h.privatePos.set(p, target));
        this.sendKeys(pos, target);
      }
      if (h.mine.has(target)) {
        for (const p of pos) this.tryDecode(p);
        if (!pos.every((p) => h.tiles.has(p))) {
          if (!this.waiters.some((w) => w.need === pos)) this.waiters.push({ need: pos, run: () => {} });
          return false;
        }
      }
    }
    // 表に開けた牌（ドラ・裏ドラ）は、自分で開けた牌と同じか確かめる（ホストや打った人が別の牌を言っても見つかる）
    if (h) this.checkPublicTiles(env.ev);
    for (const [seat, v] of this.views) {
      let e = env;
      // 本人にだけ見える出来事：自分の席の分は、控えておいた本物を当てはめる
      const realKey = `${env.ev.type}:${seat}`;
      if (PRIVATE_OWN.has(env.ev.type) && (env.ev as { seat: Seat }).seat === seat && this.privateReal.has(realKey)) {
        e = { ...this.privateReal.get(realKey)!, seq: env.seq };
        this.privateReal.delete(realKey);
      } else if (priv && (env.ev as { seat: Seat }).seat === seat && h && pos && pos.every((p) => h.tiles.has(p))) {
        const tiles = pos.map((p) => h.tiles.get(p)!);
        e = { ...env, ev: env.ev.type === 'deal' ? { ...env.ev, tiles } : { ...(env.ev as Extract<GameEvent, { type: 'draw' }>), tile: tiles[0] } };
      } else if (priv && (env.ev as { seat: Seat }).seat === seat) {
        // 自分の席でも錠前を持っていない（CPU に任せたあとの局）：伏せたまま
        e = mask(env, -1 as Seat);
      }
      if (PRIVATE_OWN.has(e.ev.type) && (e.ev as { seat: Seat }).seat === seat && !isMasked(e)) {
        const l = this.ownLogs.get(seat) ?? [];
        l.push(e);
        this.ownLogs.set(seat, l);
        if (h) this.o.store?.savePriv?.(h.no, seat, l);
        if (seat === this.mySeat) this.depositMine();
      }
      this.views.set(seat, apply(v, mask(e, seat)));
      if (seat === this.mySeat) this.myLog.push(mask(e, seat));
    }
    if (env.ev.type === 'roundStart' || env.ev.type === 'roundVoid') this.ownLogs = new Map();
    this.pub = apply(this.pub, maskAll(env));
    this.wire.push({ env: maskAll(env), ...(pos ? { pos } : {}) });
    const ck = this.claimKey(this.pub);
    if (ck !== null && !this.claimSince.has(ck)) this.claimSince.set(ck, Date.now());
    // 自分の手が変わったら、もう鳴けない牌の予告を消す（まだ鳴ける牌の選択は残す）
    if (this.presets.size && this.mySeat !== null && this.views.has(this.mySeat)) prunePresets(this.presets, this.callables());
    if (env.ev.type === 'deal' && h) h.dealt++;
    return true;
  }

  private checkPublicTiles(ev: GameEvent) {
    const h = this.hand;
    if (!h) return;
    const said: [number, TileId][] = [];
    const size = h.ids.length;
    if (ev.type === 'doraReveal') said.push([doraIndicatorPos(size, this.pub.doraIndicators.length), ev.tile]);
    if ((ev.type === 'ron' || ev.type === 'tsumo') && ev.ura.length) ev.ura.forEach((t, i) => said.push([uraIndicatorPos(size, i), t]));
    const bad = said.filter(([p, t]) => {
      this.tryDecode(p);
      const mine = h.tiles.get(p);
      return mine !== undefined && mine !== t;
    });
    if (bad.length) {
      const problems: VerifyProblem[] = bad.map(([pos]) => ({ kind: 'claimed', pos }));
      this.lastVerify = problems;
      this.o.onProblem?.(problems);
    }
  }

  /** 配牌・ツモの位置が決まった位置か（ホストにも、引く順でない牌を開けさせない） */
  private expectedPrivate(ev: GameEvent, pos: number[]): boolean {
    const h = this.hand;
    if (!h) return false;
    if (ev.type === 'deal') {
      if (this.pub.phase !== 'deal') return false;
      const chunk = dealChunkPositions(this.pub.dealer)[h.dealt];
      return !!chunk && chunk.seat === ev.seat && chunk.positions.join(',') === pos.join(',');
    }
    if (ev.type === 'draw') {
      if (this.pub.phase !== 'draw' && this.pub.phase !== 'deal') return false;
      const d = drawPosition(this.pub);
      return d !== null && ev.seat === this.pub.turn && pos.length === 1 && pos[0] === d.pos && !!ev.rinshan === d.rinshan;
    }
    return false;
  }

  /** 返事の番の見分け（誰の・何枚目の捨て牌か・何への返事か） */
  private claimKey(v: GameState): string | null {
    return claimKeyOf(v);
  }

  /**
   * この返事の番に、もう返事を決めたか（押した・予告・時間切れ）。返事は replyWait たってから出すので、
   * そのあいだにほかの人の返事が届いて通し番号が進んでも、同じ番では 2 度返事をしない・時計も動かし直さない（10-20 に発見）
   */
  private repliedHere(v: GameState, seat: Seat): boolean {
    const key = this.claimKey(v);
    return key !== null && this.replied.get(seat) === key;
  }

  /** 返事を出すまでに、あと何ミリ秒待つか（返事の番が始まってから replyWait まで） */
  private replyDelay(v: GameState): number {
    const key = this.claimKey(v);
    if (key === null || this.replyWait <= 0) return 0;
    let since = this.claimSince.get(key);
    if (since === undefined) {
      since = Date.now();
      this.claimSince.set(key, since);
    }
    return Math.max(0, since + this.replyWait - Date.now());
  }

  // ---- 打つ ----

  /** 席の持ち主として、選んだことを出来事にしてホストへ（ドラ・裏ドラが要れば先に表に開ける） */
  private perform(seat: Seat, a: Action, delay = 0) {
    const v = this.views.get(seat);
    if (!v) return;
    if (this.acted.get(seat) === v.nextSeq) return;
    if (v.phase === 'claim') {
      if (this.repliedHere(v, seat)) return;
      const key = this.claimKey(v);
      if (key !== null) this.replied.set(seat, key);
    }
    // 缺一門・換三張は 4 人が同時に選ぶ：自分の分を送って、まだ配られてこないうちは送り直さない
    if ((v.phase === 'que' && this.privateReal.has(`queHold:${seat}`)) || (v.phase === 'huan3' && this.privateReal.has(`huan3Pass:${seat}`))) return;
    this.acted.set(seat, v.nextSeq);
    // 返事（見送る・鳴く・ロン）は、決めた時刻によらず返事の番の始まりから replyWait たってから出す。
    // ロンの裏ドラを開ける頼みも、そのあと（先に出すと誰かがロンすると分かる）
    if (v.phase === 'claim') delay = Math.max(delay, this.replyDelay(v));
    const go = () => {
      const need = positionsNeeded((src) => act(v, seat, a, src));
      this.openPublic(need, () => {
        const h = this.hand;
        const envs = act(v, seat, a, (p) => h?.tiles.get(p) ?? HIDDEN).map((e) => {
          if (e.to === 'all' || !PRIVATE_OWN.has(e.ev.type)) return e;
          // 本人にだけ見える出来事：本物は手元に控え、ホストへは伏せた形で送る（中身はホストにも届かない）
          this.privateReal.set(`${e.ev.type}:${seat}`, e);
          return mask(e, -1 as Seat);
        });
        // at＝この選択を決めた局面の通し番号（ホストの局面が遅れていたら、追いつくまで預かってもらう）
        this.toHost({ type: 'mt-act', id: this.o.myId, seat, envs, at: v.nextSeq });
      });
    };
    if (delay > 0) setTimeout(go, delay);
    else go();
  }

  /**
   * ホスト：自分の局面より先の局面で決めた知らせ（at が自分の通し番号より先）。
   * ホストは自分の牌の鍵が届くまで局面を進めずに待つので、先に進んだ人の知らせが早く届くことがある。
   * 捨てると、送った人は送り直さないので卓が止まる（10-15 に見つけた前からの不具合）→ 追いつくまで預かる
   */
  private lateActs: { id: string; seat: Seat; envs: Envelope[]; at: number }[] = [];

  /** ホスト：預かっていた知らせのうち、局面が追いついたものを確かめる */
  private flushLateActs() {
    for (;;) {
      const i = this.lateActs.findIndex((x) => x.at <= this.pub.nextSeq);
      if (i < 0) return;
      const [x] = this.lateActs.splice(i, 1);
      this.onAct(x.id, x.seat, x.envs, x.at);
    }
  }

  /** ホスト：席の持ち主から届いた出来事に番号を付け直して配る（古い局面から作ったものは捨てる） */
  private onAct(id: string, seat: Seat, envs: Envelope[], at?: number) {
    if (!this.o.isHost || envs.length === 0) return;
    if (at !== undefined && at > this.pub.nextSeq) {
      this.lateActs.push({ id, seat, envs, at });
      return;
    }
    const owner = this.seats[seat];
    const fromOk = this.cpuSeat(seat) ? id === this.o.myId : owner?.kind === 'human' && owner.id === id;
    if (!fromOk) return;
    let trial = this.pub;
    const out: Envelope[] = [];
    try {
      for (const e of envs) {
        // 配るのは全員に見える出来事と、本人にだけ見える出来事の伏せた形（宛先はその席だけ）。席のある出来事はその席のもの
        const evSeat = (e.ev as { seat?: Seat }).seat;
        if (e.to !== 'all' && !(PRIVATE_OWN.has(e.ev.type) && e.to.length === 1 && e.to[0] === seat && isMasked(e))) return;
        if (evSeat !== undefined && evSeat !== seat) return;
        const n = { ...e, seq: trial.nextSeq };
        trial = apply(trial, n);
        out.push(n);
      }
    } catch {
      return;
    }
    this.emitAll(out.map((env) => ({ env })));
  }

  private onReveal(no: number, seat: Seat, w: WireLocker) {
    const h = this.hand;
    if (!h || h.no !== no || !h.final) return;
    h.revealed.set(seat, lockerFromWire(w));
    if (h.revealed.size < 4 || h.verified) return;
    const lockers = SEATS.map((s) => h.revealed.get(s)!);
    const log = { start: h.start, shuffled: h.shuffled as bigint[][], relocked: h.relocked as bigint[][] };
    const { problems, wall } = verifyDeal(this.g, h.ids, log, lockers, h.tiles);
    if (!problems.some((x) => x.kind === 'tiles')) {
      this.walls.push(wall);
      // 換三張で出した 3 枚：錠前 a を外して中身を出す
      const passed = new Map<Seat, TileId[]>();
      for (const [seat, xs] of this.h3.xs) {
        const d = this.h3.revealed.get(seat);
        if (d !== undefined) passed.set(seat, xs.map((x) => this.decode(modPow(x, d, this.g.p))));
      }
      this.h3Tiles.push(passed);
      // 全員の牌を本物で埋めた列を最初から当てはめ直す（持っていない牌を切った・表にした・換三張で出した なら止まる）
      try {
        const full = this.fullLog();
        if (full) replay(full);
      } catch (e) {
        problems.push({ kind: 'events', why: (e as Error).message });
      }
    }
    h.verified = problems;
    this.o.onVerified?.();
    this.lastVerify = problems;
    if (problems.length) this.o.onProblem?.(problems);
    this.changed();
    this.drive();
  }

  /**
   * 全員の牌が見える牌譜（自分の席から見えた列の、伏せた配牌・ツモを検算で分かった山で埋めたもの）。
   * 山が分からない局がある（途中で入り直して前の局の鍵を受け取れなかった等）なら null
   */
  fullLog(): Envelope[] | null {
    const out: Envelope[] = [];
    let s = initialState();
    let hand = -1;
    let chunk = 0;
    // 缺一門で伏せた牌（ほかの人の分は伏せてある）：その人の最初の打牌（捨てる色の印つき）で表に出るので、そこから埋める
    const queOf = new Map<number, { tile: TileId; suit: number }>();
    this.myLog.forEach((e, k) => {
      if (e.ev.type !== 'queHold' || e.ev.tile !== HIDDEN) return;
      const seat = e.ev.seat;
      for (let j = k + 1; j < this.myLog.length; j++) {
        const x = this.myLog[j].ev;
        if (x.type === 'roundStart') break;
        if (x.type === 'discard' && x.seat === seat && x.que !== undefined) {
          queOf.set(k, { tile: x.tile, suit: x.que });
          break;
        }
      }
    });
    // なかったことにした局（roundVoid・段階10）は牌譜に入れない：局の始まりから roundVoid までを飛ばし、通し番号を付け直す
    const skip = new Set<number>();
    let lastStart = -1;
    this.myLog.forEach((e, k) => {
      if (e.ev.type === 'roundStart') lastStart = k;
      if (e.ev.type === 'roundVoid' && lastStart >= 0) for (let j = lastStart; j <= k; j++) skip.add(j);
    });
    for (const [k, e0] of this.myLog.entries()) {
      if (skip.has(k)) continue;
      let e: Envelope = { ...e0, seq: s.nextSeq };
      const ev = e.ev;
      if (ev.type === 'roundStart') {
        hand++;
        chunk = 0;
      }
      // 検算できなかった局（錠前が届かず検算なしで進めた局）は空の山＝埋められない
      const w = this.walls[hand]?.length ? this.walls[hand] : undefined;
      if (ev.type === 'deal') {
        const c = dealChunkPositions(s.dealer)[chunk++];
        if (ev.tiles.includes(HIDDEN)) {
          if (!w || !c) return null;
          e = { ...e, ev: { ...ev, tiles: c.positions.map((pos) => w[pos]) } };
        }
      } else if (ev.type === 'draw' && ev.tile === HIDDEN) {
        const d = drawPosition(s);
        if (!w || !d) return null;
        e = { ...e, ev: { ...ev, tile: w[d.pos] } };
      } else if (ev.type === 'queHold' && ev.tile === HIDDEN) {
        const q = queOf.get(k);
        if (q) e = { ...e, ev: { ...ev, tile: q.tile, suit: q.suit } };
      } else if ((ev.type === 'huan3Pass' || ev.type === 'huan3Take') && ev.tiles.includes(HIDDEN)) {
        // 換三張：局の終わりに分かった 3 枚（受け取った人の分は、渡した人の 3 枚）
        const from = ev.type === 'huan3Pass' ? ev.seat : s.huan3Dir !== null ? huan3From(ev.seat, s.huan3Dir) : null;
        const tiles = from !== null ? this.h3Tiles[hand]?.get(from) : undefined;
        if (!tiles) return null;
        e = { ...e, ev: { ...ev, tiles } };
      }
      s = apply(s, e);
      out.push(e);
    }
    return out;
  }

  // ---- 戻ってきた人 ----

  /** 席の持ち主を ID で（いなければ null） */
  seatOfId(id: string): Seat | null {
    return this.ids.get(id) ?? null;
  }

  /** ホスト：戻ってきた人へ渡すもの */
  syncData(): SyncData {
    const h = this.hand;
    const w = (d: (bigint[] | null)[]) => d.map((x) => (x ? x.map(hex) : null));
    // 配ったがまだ当てはめていない出来事（戻ってきた人の鍵を待っているもの）も渡す
    const waiting = [...this.queue.values()].sort((a, b) => a.env.seq - b.env.seq).map((x) => ({ env: maskAll(x.env), ...(x.pos ? { pos: x.pos } : {}) }));
    return {
      seats: this.seats,
      replyWait: this.replyWait,
      timeLimit: this.timeLimit,
      assist: this.assist,
      wk: this.hostWk?.toString(36),
      wire: [...this.wire, ...waiting],
      // dealt は当てはめ待ち（鍵待ち）の配牌も数える。★作り直した直後の卓は配牌が当てはめ待ちで 0 になり、受け取った人が「まだ配っていない局」と取り違えた
      hand: h ? { no: h.no, shuffled: w(h.shuffled), relocked: w(h.relocked), dealt: h.dealt + waiting.filter((x) => x.env.ev.type === 'deal').length } : null,
      lastNo: h?.no ?? this.baseNo,
    };
  }

  /** 戻ってきた人：ホストから受け取った列で局面を作り直す。自分の牌は鍵を頼み直して開け直す */
  loadSync(d: SyncData) {
    // ★前は返事の待ちを受け取っていなかった（戻った人だけ待ちが 0 になり、迷ったかが外に出た）。制限時間と一緒に受け取る
    this.replyWait = Math.max(0, Number(d.replyWait) || 0);
    this.timeLimit = Math.max(0, Number(d.timeLimit) || 0);
    this.assist = d.assist === true;
    this.setHostWk(d.wk);
    this.onBegin(d.seats);
    this.baseNo = d.hand?.no ?? Math.max(0, Number(d.lastNo) || 0);
    this.restoredUpTo = d.wire.length;
    // 局の山はあるが、まだ配牌を配っていない（次の局の錠前の段取りの途中）：それまでの出来事は全部、前の局まで＝済んだ出来事。
    // ★前は「最後の局の始まりから後ろは、いまの局の出来事」と決めつけ、前の局の配牌を新しい局に当てはめて止まった
    // （開き直したホストで見つけた。ゲストが段取りの途中で入り直したときも同じ＝前からの不具合）
    const undealt = !!d.hand && (d.hand.dealt ?? 0) === 0;
    if (d.hand) {
      const no = d.hand.no;
      const deck = (x: (string[] | null)[]) => x.map((a) => (a ? a.map(big) : null));
      const shuffled = deck(d.hand.shuffled);
      const relocked = deck(d.hand.relocked);
      // 山の顔ぶれは、受け取った列の対局の始まりのルールから
      const ge = d.wire.find((x) => x.env.ev.type === 'gameStart')?.env.ev;
      const ids = this.wallIds(ge && ge.type === 'gameStart' ? ge.rules : null);
      this.hand = {
        no,
        ids,
        mine: new Map(this.controlled().map((s) => [s, this.lockerFor(no, s, ids.length)] as const)),
        start: ids.map((i) => encode(this.g, i)),
        shuffled,
        relocked,
        final: relocked[3],
        keys: new Map(),
        tiles: new Map(),
        privatePos: new Map(),
        dealt: 0,
        revealed: new Map(),
        verified: null,
        round: null,
        roundSent: true,
        revealedMine: false,
      };
      // 開き直す前に当てはめた、本人にだけ見える出来事の本物（四川の伏せ牌・換三張）を端末の控えから取り戻す。
      // 列の中では伏せた形なので、当てはめるときにこの本物に差し替わる（送ったばかりの選びと同じ扱い）
      for (const s of this.controlled()) for (const e of this.o.store?.loadPriv?.(no, s) ?? []) this.privateReal.set(`${e.ev.type}:${s}`, e);
      // この局の出来事だけで、自分あての配牌・ツモの位置を集めて鍵を頼み直す
      const startAt = undealt ? d.wire.length : d.wire.map((x) => x.env.ev.type).lastIndexOf('roundStart');
      const mine = d.wire.slice(Math.max(0, startAt)).filter((x) => x.pos && this.mySeat !== null && (x.env.ev as { seat?: Seat }).seat === this.mySeat);
      const positions = mine.flatMap((x) => x.pos ?? []);
      if (this.mySeat !== null) this.broadcast({ type: 'mt-rekey', no, seat: this.mySeat, positions });
      // 錠前の段取りの途中なら、自分の番から続ける
      if (!this.hand.final) this.resumeLock();
      this.depositMine();
    }
    // 局の始まりより前（前の局）の出来事は、全部を順番どおり、自分の牌を開けずに伏せたまま当てはめる。
    // ★以前は位置付き（配牌・ツモ）だけを先に当てはめ、ほかを後回しにしていたため、2 局目以降（配り直しのあとも）に
    // 戻ると通し番号が合わずに止まり、画面が暗いまま入れなかった（10-15 利用者指摘で発見）
    // 局の山が無い写し（ホストが移ったとき＝その局はなかったことにする）は、全部を済んだ出来事として当てはめる
    // （配牌・ツモを開ける鍵はもう誰も出さない＝待つと止まる）
    const startAt = d.hand && !undealt ? d.wire.map((x) => x.env.ev.type).lastIndexOf('roundStart') : d.wire.length;
    d.wire.forEach((x, i) => {
      if (i < startAt) this.applyOld(x.env);
      else this.queue.set(x.env.seq, x);
    });
    // 前の局の山は知らない（その局の錠前は明かされたあと）。牌譜の山の並びを局の順にそろえるため、空の山を置いておく
    // （fullLog は空の山の局を埋められない＝全員の牌の牌譜は作らない。なかったことにした局は数えない）
    const kinds = d.wire.slice(0, Math.max(0, startAt)).map((x) => x.env.ev.type);
    let past = 0;
    kinds.forEach((k, i) => {
      if (k !== 'roundStart') return;
      const nextStart = kinds.indexOf('roundStart', i + 1);
      const voided = kinds.slice(i + 1, nextStart < 0 ? undefined : nextStart).includes('roundVoid');
      if (!voided) past++;
    });
    while (this.walls.length < past) {
      this.walls.push([]);
      this.h3Tiles.push(new Map());
    }
    this.pump();
  }

  /** 前の局の出来事：鍵はもう明かされていて要らない（自分の牌も伏せたまま当てはめる） */
  private applyOld(env: Envelope) {
    for (const [seat, v] of this.views) {
      this.views.set(seat, apply(v, mask(env, seat)));
      if (seat === this.mySeat) this.myLog.push(mask(env, seat));
    }
    this.pub = apply(this.pub, maskAll(env));
    this.wire.push({ env: maskAll(env) });
  }

  private resumeLock() {
    const h = this.hand;
    if (!h) return;
    const s = h.shuffled.findIndex((x) => x === null);
    if (s >= 0) return this.lockStep('s', s, s === 0 ? h.start : h.shuffled[s - 1]!);
    const r = h.relocked.findIndex((x) => x === null);
    if (r >= 0) this.lockStep('r', r, r === 0 ? h.shuffled[3]! : h.relocked[r - 1]!);
  }

  /** 誰かが戻ってきて、自分の牌の鍵を頼み直した：その人に配った位置だけ鍵を出し直す。待っている表の頼みも出し直す */
  private onRekey(no: number, seat: Seat, positions: number[]) {
    const h = this.hand;
    if (!h || h.no !== no || !h.final) return;
    this.sendKeys(
      positions.filter((p) => h.privatePos.get(p) === seat),
      seat,
    );
    for (const o of this.opens) this.send({ type: 'mt-open', no: h.no, positions: o }, 'all');
  }

  // ---- 自動で進むところ ----

  private drive() {
    // 作り直している途中（写しを配る前・段階10の5）は CPU の席も含めて動かない＝配り直しは afterTakeover が始める
    if (!this.started || this.holding > 0 || this.takingOver) return;
    const h = this.hand;
    // 局が終わったら、自分の錠前を明かす（1 局に 1 回）
    if (h && h.final && h.dealt > 0 && (this.pub.phase === 'ended' || this.pub.phase === 'gameover') && !h.revealedMine) {
      h.revealedMine = true;
      // 換三張で掛けた錠前 a の外す鍵も明かす（出した 3 枚を全員が確かめられる）
      for (const [seat, lk] of h.mine) {
        const a = this.h3.give.get(seat);
        this.broadcast({ type: 'mt-reveal', no: h.no, seat, locker: lockerToWire(lk), ...(a ? { h3: hex(a.d) } : {}) });
      }
    }
    if (this.o.isHost) {
      this.flushLateActs();
      this.driveHost();
    }
    this.driveHuan3();
    for (const seat of this.controlled()) this.driveSeat(seat);
    this.updateClock();
  }

  /**
   * 自分の席の時計：自分が選ぶ番（画面のボタン・牌を待っている）になったら締め切りを決め、選んだら止める。
   * 同じ手のあいだ（ほかの人の返事が届いて通し番号が進んでも）は数え直さない
   */
  private updateClock() {
    const seat = this.mySeat;
    const v = seat !== null ? this.views.get(seat) : undefined;
    const waiting =
      this.timeLimit > 0 && !this.paused && seat !== null && !!v && !this.yielded && this.queue.size === 0 && this.acted.get(seat) !== v.nextSeq && !this.repliedHere(v, seat) && this.choices(v, seat).length > 0;
    if (!waiting) return this.stopClock();
    const key = this.clockKeyOf(v, seat);
    if (key === this.clockKey) return;
    this.stopClock();
    this.clockKey = key;
    this.deadline = Date.now() + this.timeLimit;
    this.clockTimer = setTimeout(() => this.onTimeUp(key), this.timeLimit);
    this.changed();
  }

  private stopClock() {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
    if (this.clockKey === null && this.deadline === null) return;
    this.clockKey = null;
    this.deadline = null;
    this.changed();
  }

  /** 1 つの「選ぶ番」の見分け（返事は返事の番ごと・ほかは局と段階と自分の手の形） */
  private clockKeyOf(v: GameState, seat: Seat): string {
    const no = this.hand?.no ?? 0;
    if (v.phase === 'claim') return `c:${no}:${this.claimKey(v)}`;
    if (v.phase === 'ended') return `e:${no}:${v.roundIndex}:${v.honba}`;
    return `${v.phase}:${no}:${v.turn}:${v.discards.map((d) => d.length).join('.')}:${v.kans}:${v.melds[seat].length}:${v.drawn[seat]}`;
  }

  /** 時間切れ：本人の端末が、決まった選び方で手を出す（timeout.ts） */
  private onTimeUp(key: string) {
    this.clockTimer = null;
    const seat = this.mySeat;
    const v = seat !== null ? this.views.get(seat) : undefined;
    if (seat === null || !v || key !== this.clockKey || this.yielded) return;
    const a = timeoutAction(v, seat, legalActions(v, seat));
    this.clockKey = null;
    this.deadline = null;
    if (a) {
      this.timeouts++;
      this.perform(seat, a);
    }
    this.changed();
    this.drive();
  }

  /** 換三張の受け渡し（向きが決まったあと）。届いた知らせは向きが分かってから処理する */
  private driveHuan3() {
    const h = this.hand;
    const dir = this.pub.huan3Dir;
    if (!h || this.pub.phase !== 'huan3' || dir === null) return;
    const p = this.g.p;
    // 渡す人：自分の 3 枚に錠前 a を掛けて送る
    for (const seat of this.controlled()) {
      const out = this.views.get(seat)?.huan3Out[seat];
      if (this.h3.give.has(seat) || !out || out.includes(HIDDEN)) continue;
      const a = newKey(this.g);
      this.h3.give.set(seat, a);
      this.broadcast({ type: 'mt-h3', no: h.no, stage: 'x', from: seat, vals: out.map((t) => hex(modPow(encode(this.g, t), a.e, p))) });
    }
    const inbox = this.h3.inbox;
    this.h3.inbox = [];
    for (const m of inbox) {
      const to = SEATS.find((x) => huan3From(x, dir) === m.from)!;
      if (m.stage === 'x') this.h3.xs.set(m.from, m.vals);
      if (m.stage === 'x' && this.views.has(to) && !this.h3.take.has(to)) {
        // 受け取る人：錠前 b を重ねて返す
        const b = newKey(this.g);
        this.h3.take.set(to, { from: m.from, key: b });
        this.broadcast({ type: 'mt-h3', no: h.no, stage: 'y', from: m.from, vals: m.vals.map((v) => hex(modPow(v, b.e, p))) });
      } else if (m.stage === 'y' && this.h3.give.has(m.from)) {
        // 渡す人：自分の錠前 a を外して送る（残るのは b だけ）
        const a = this.h3.give.get(m.from)!;
        this.broadcast({ type: 'mt-h3', no: h.no, stage: 'z', from: m.from, vals: m.vals.map((v) => hex(modPow(v, a.d, p))) });
      } else if (m.stage === 'z' && this.h3.take.get(to)?.from === m.from && !this.h3.done.has(to)) {
        // 受け取る人：錠前 b を外すと中身が分かる。受け取った出来事は本人にだけ見える形で出す
        const b = this.h3.take.get(to)!.key;
        const tiles = m.vals.map((v) => this.decode(modPow(v, b.d, p)));
        if (tiles.some((t) => t < 0)) continue;
        this.h3.done.add(to);
        const real: Envelope = { seq: this.pub.nextSeq, to: [to], ev: { type: 'huan3Take', seat: to, tiles } };
        this.privateReal.set(`huan3Take:${to}`, real);
        this.toHost({ type: 'mt-act', id: this.o.myId, seat: to, envs: [mask(real, -1 as Seat)], at: this.pub.nextSeq });
      }
    }
  }

  /** ホスト：局を始める・山から引かせる・次の局へ */
  private driveHost() {
    const p = this.pub;
    const h = this.hand;
    // 局を持たない（ホストが移って作り直した卓で、局の間だった）：次の局へ進むところだけ（検算する局が無い）
    if (!h) {
      if (this.queue.size === 0 && p.phase === 'ended' && (this.nextRequested || this.o.autoNext)) this.nextHand();
      return;
    }
    if (!h.final || this.queue.size > 0) return;
    // 錠前が掛け終わったら、ドラ表示牌を表に開けて、局の始まりと配牌を配る
    if (h.round && !h.roundSent) {
      h.roundSent = true;
      const r = h.round;
      // 中国式はドラが無い＝表に開けずに配る
      if (p.rules?.family === 'cn') {
        this.startRound(r, null);
        return;
      }
      const dora = doraIndicatorPos(h.ids.length, 0);
      this.openPublic([dora], () => this.startRound(r, h.tiles.get(dora)!));
      return;
    }
    if (this.hostStep === p.nextSeq) return;
    // 換三張：4 人とも出したら、サイコロを振って渡す向きを決める（オンラインはホストの端末の乱数）
    if (p.phase === 'huan3' && p.huan3Dir === null && p.huan3Out.every((x) => x !== null)) {
      this.hostStep = p.nextSeq;
      const n = new Uint32Array(2);
      crypto.getRandomValues(n);
      const dice: [number, number] = [1 + (n[0] % 6), 1 + (n[1] % 6)];
      this.emit({ seq: p.nextSeq, to: 'all', ev: { type: 'huan3Swap', dice, dir: huan3DirOf(dice) } });
      return;
    }
    if ((p.phase === 'deal' && h.dealt >= 16) || p.phase === 'draw') {
      this.hostStep = p.nextSeq;
      const d = drawPosition(p);
      const need = positionsNeeded((src) => advance(p, src)).filter((x) => x !== d?.pos);
      const go = () =>
        this.openPublic(need, () => {
          const envs = advance(p, (x) => (x === d?.pos ? HIDDEN : h.tiles.get(x) ?? HIDDEN));
          this.emitAll(envs.map((e) => ({ env: e, pos: e.ev.type === 'draw' && d ? [d.pos] : undefined })));
        });
      // 局の最初のツモは、全員の画面で洗牌と配る演出が終わってから
      // 対局の最初の局（親決めのサイコロを見せる局）か＝useTable の showsDice と同じ決め方
      const first = p.dealerDice !== null && p.roundIndex === 0 && p.honba === 0 && p.discards.every((x) => x.length === 0);
      // 作り直す前に配っていた局（演出はもう済んでいる・作り直した画面では出さない）は待たない
      const hold = p.phase === 'deal' && p.nextSeq > this.restoredUpTo ? (this.o.dealHold?.(first) ?? 0) : 0;
      if (hold > 0) setTimeout(go, hold);
      else go();
      return;
    }
    // 次の局へは、この局の検算が済んでから（新しい局の錠前で、この局の鍵が届かなくなるため）
    if (p.phase === 'ended' && h.verified !== null && (this.nextRequested || this.o.autoNext)) this.nextHand();
  }

  /** ホスト：局が終わった局面から、次の局（または対局の終わり）へ */
  private nextHand() {
    const p = this.pub;
    const n = nextStep(p);
    if (n.type === 'yame' || this.hostStep === p.nextSeq) return;
    this.hostStep = p.nextSeq;
    this.nextRequested = false;
    if (n.type === 'end') {
      this.emit({ seq: p.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: n.reason } });
      return;
    }
    this.beginHand({ roundIndex: n.roundIndex, dealer: n.dealer, honba: n.honba });
  }

  // ---- ホストが移る（段階10の5・利用者 2026-10-20） ----
  //  - 元のホストが 3 分たっても戻らないと、元ホストの下家から順に、つながっているプレイヤーがホストを受け持つ（Q2=A）
  //  - 新しいホストは、自分が見ていた全員に見える出来事の列から卓を作り直す。元ホストの席と CPU の席の鍵は元ホストの端末にしか無い
  //    ＝その局の続きは打てないので、その局はなかったことにして同じ局を配り直す（局の間だったら次の局へ）
  //  - 元ホストの席は CPU に任せた席にする（戻ってきたら、ほかの人と同じく席を返してもらう＝新しいホストの許可）

  /**
   * 新しいホスト：それまでの卓（ゲストとして見ていたもの）から、この卓（ホスト）を作る。
   * 返すのはほかの人へ配る写し（全員がこれで卓を作り直す）。配り直しは配ったあとに afterTakeover で始める
   */
  takeoverFrom(prev: OnlineTable, awaySeat: Seat | null): SyncData {
    this.takingOver = true;
    this.wrapKeys = newWrapKeyPair(this.g);
    const seats = prev.seats.map((k, i) => (i === awaySeat && k.kind === 'human' ? { ...k, proxy: true } : k));
    this.loadSync({ seats, replyWait: prev.replyWait, timeLimit: prev.timeLimit, wk: this.wrapKeys.y.toString(36), wire: prev.wire.slice(), hand: null, lastNo: prev.hand?.no ?? prev.baseNo });
    const p = this.pub;
    // 局の途中なら、その局をなかったことにする（配るのは写しを配ったあと）
    if (p.roundIndex >= 0 && p.phase !== 'ended' && p.phase !== 'gameover') this.receive({ type: 'mt-ev', env: { seq: p.nextSeq, to: 'all', ev: { type: 'roundVoid' } } });
    return this.syncData();
  }

  /** 新しいホスト：写しを配ったあと。なかったことにした局を配り直す・局の間なら次の局へ進められるようにする */
  afterTakeover() {
    this.takingOver = false;
    const p = this.pub;
    if (p.phase === 'gameover') return this.changed();
    const voided = this.wire.length > 0 && this.wire[this.wire.length - 1].env.ev.type === 'roundVoid';
    if (voided) {
      const start = [...this.wire].reverse().find((x) => x.env.ev.type === 'roundStart')?.env.ev;
      if (start && start.type === 'roundStart') return this.beginHand({ roundIndex: start.roundIndex, dealer: start.dealer, honba: start.honba ?? 0 });
    }
    // 最初の局の前（親決めのあと）に移った
    if (p.roundIndex < 0 && p.rules) return this.beginHand({ roundIndex: 0, dealer: p.chicha, honba: 0 });
    this.changed();
    this.drive();
  }

  /**
   * 画面を開き直したホスト（3 分のうち・大方針 2026-10-20）：ゲストの端末から受け取った写し（鍵のかかった山・出来事の記録）で、
   * ホストとして卓を作り直す。自分の席・CPU の席・引き取った席の鍵と本人にだけ見える選びは、端末の控えから読む（loadSync が読む）。
   * 包み用の鍵は作り直す（写しを配り直すときに全員へ）。局の錠前の段取りの途中で落ちていたら、配る局を決め直す。
   * 呼んだあと、部屋の側が写しを全員へ配り（mt-resync）、rekeyMine で鍵を頼み直す
   */
  resumeAsHost(d: SyncData) {
    this.wrapKeys = newWrapKeyPair(this.g);
    this.loadSync({ ...d, wk: this.wrapKeys.y.toString(36) });
    const h = this.hand;
    // 局の始まりを配る前に落ちた（次の局の錠前の段取りの途中）：どの局を配るかを、写しの列から決める。
    // ★「終わった局」（配牌済み）と「これから配る局」（段取りの途中）を取り違えると、終わった局の山で配り直してしまう＝写しの dealt で見分ける。
    // ★作り直した直後の局面は、鍵待ちで当てはめの途中（「配牌の途中」に見える）＝それでは決められない。列を全員に見える形で当てはめ切って決める
    if (h && (d.hand?.dealt ?? 0) === 0) {
      let p = initialState();
      for (const { env } of d.wire) p = apply(p, maskAll(env));
      if (p.phase !== 'gameover') {
        if (p.roundIndex < 0 && p.rules) h.round = { roundIndex: 0, dealer: p.chicha, honba: 0 };
        else if (p.phase === 'ended' && p.result) {
          const n = nextStep(p);
          if (n.type === 'round') h.round = { roundIndex: n.roundIndex, dealer: n.dealer, honba: n.honba };
        }
        if (h.round) h.roundSent = false;
      }
    }
    this.changed();
    this.drive();
  }

  /** ホスト：戻ってきたとき（3 分のうち）。ゲストは写しで作り直す＝自分の席と CPU の席の牌の鍵を頼み直す */
  rekeyMine() {
    const h = this.hand;
    if (!h || !h.final) return;
    const startAt = this.wire.map((x) => x.env.ev.type).lastIndexOf('roundStart');
    for (const seat of h.mine.keys()) {
      const positions = this.wire
        .slice(Math.max(0, startAt))
        .filter((x) => x.pos && (x.env.ev as { seat?: Seat }).seat === seat)
        .flatMap((x) => x.pos ?? []);
      if (positions.length) this.broadcast({ type: 'mt-rekey', no: h.no, seat, positions });
    }
    // 待っている表の頼み・錠前の段取りも出し直す
    for (const o of this.opens) this.send({ type: 'mt-open', no: h.no, positions: o }, 'all');
  }

  /** ホストを待っているあいだ（段階10の5・Q3=A）：時計を止める。待ちが終わったら動かす */
  setPaused(on: boolean) {
    if (this.paused === on) return;
    this.paused = on;
    if (on) this.stopClock();
    this.updateClock();
    this.changed();
  }
  paused = false;
  private takingOver = false;

  /** ホスト：局の始まり・配牌（伏せた形＋位置）・ドラ表示牌 */
  private startRound(r: Round, dora: TileId | null) {
    let seq = this.pub.nextSeq;
    const items: { env: Envelope; pos?: number[] }[] = [{ env: { seq: seq++, to: 'all', ev: { type: 'roundStart', roundIndex: r.roundIndex, dealer: r.dealer, honba: r.honba } } }];
    for (const c of dealChunkPositions(r.dealer)) {
      items.push({ env: { seq: seq++, to: [c.seat], ev: { type: 'deal', seat: c.seat, tiles: c.positions.map(() => HIDDEN) } }, pos: c.positions });
    }
    if (dora !== null) items.push({ env: { seq: seq++, to: 'all', ev: { type: 'doraReveal', tile: dora } } });
    this.emitAll(items);
  }

  /** 席の持ち主として、打つ番なら打つ（CPU・自動の席はすぐ、人の席は見送るしかないときだけ自動） */
  private driveSeat(seat: Seat) {
    const v = this.views.get(seat);
    if (!v || this.queue.size > 0) return;
    // 局の終わり（やめるか選ぶ）以外は、山が配られてから
    if (v.phase !== 'ended' && !this.hand?.final) return;
    // 自分の手牌がまだ伏せたまま（席を返してもらう途中：包みを開ける前・開けても手牌の鍵がまだ届いていない）は打たない。
    // ★前は席の知らせ（mt-seat）を包み（mt-give）より先に受けて伏せた手牌で打とうとし、例外で止まった（鍵が届けば次の機会に打つ）
    if (v.hands[seat].includes(HIDDEN)) return;
    const legal = legalActions(v, seat);
    if (legal.length === 0) return;
    // この返事の番にもう返事を決めた（出すのを待っている）
    if (v.phase === 'claim' && this.repliedHere(v, seat)) return;
    const isCpu = this.cpuSeat(seat);
    const auto = isCpu ? this.o.cpu : this.o.autoplay;
    // CPU は少し間を置く（見送るだけの返事は待たせない）
    if (auto) {
      const a = auto(v, seat);
      return this.perform(seat, a, isCpu && v.phase !== 'claim' ? (this.o.cpuDelay ?? 0) : 0);
    }
    // 人の席：見送るしかない返事・言えることが 1 つだけの宣言は自動（画面のボタンを待たない）
    const shown = this.choices(v, seat);
    // 花牌を表にする・補花を終える：選ぶ余地が無いので自動（オンラインは本人が出すが、ボタンは出さない）
    if (shown.length === 1 && (shown[0].type === 'flower' || shown[0].type === 'buhuaDone')) return this.perform(seat, shown[0]);
    if ((v.phase === 'claim' || v.phase === 'declare') && shown.length === 1) return this.perform(seat, shown[0]);
    // 返事の番：鳴ける牌の予告で先に選んであれば、そのとおりに返す（「その場で聞く」ならボタンを待つ）。
    // 「鳴かない」のあいだは予告を使わない＝ロンできるときは必ず止まる（ロンの予告は残し、「自動で鳴く」に戻すとまた効く）
    if (v.phase === 'claim' && !this.noCalls) {
      const r = presetReply(v, shown, this.presets);
      if (r !== 'ask') {
        const key = this.claimKey(v);
        if (key !== null) this.presetReplied.set(seat, key);
        this.perform(seat, r);
        this.changed();
      }
    }
  }

  /** 画面に出す選べること（「鳴かない」なら返事のチー・ポン・カンを除く） */
  choices(v: GameState = this.view, seat: Seat | null = this.mySeat): Action[] {
    // CPU に任せている間は自分では選べない（手牌も伏せたままのことがある＝計算すると止まる）
    if (seat === null || this.dealing || (seat === this.mySeat && this.yielded)) return [];
    // 予告で返事を決めた返事の番は、もう選べない（ボタンを出さない）
    if (v.phase === 'claim' && this.presetReplied.get(seat) === this.claimKey(v)) return [];
    const legal = legalActions(v, seat);
    if (!this.noCalls || v.phase !== 'claim') return legal;
    return legal.filter((a) => a.type !== 'chi' && a.type !== 'pon' && a.type !== 'kan');
  }

  /** 画面から：鳴ける牌の予告を選ぶ */
  setPreset(kind: number, p: Presets extends Map<number, infer P> ? P : never) {
    if (p.ron || p.pon || p.chi) this.presets.set(kind, p);
    else this.presets.delete(kind);
    this.changed();
    this.drive();
  }

  /** いま鳴ける牌（自分の席・画面の予告の帯に並べる） */
  callables() {
    if (this.mySeat === null) return [];
    const v = this.view;
    const me = this.mySeat;
    // 自分の番（ツモったあと）は、ツモった牌を除いた手牌で並べる（切ったあと手が変われば作り直す）
    const drawn = v.drawn[me];
    const hand = drawn !== null && v.turn === me ? v.hands[me].filter((t) => t !== drawn) : v.hands[me];
    return callables(v, me, this.noCalls, hand);
  }

  /** 画面から：「鳴かない」を切り替える（いま返事の番なら、見送るしかなくなったときにすぐ見送る） */
  setNoCalls(on: boolean) {
    this.noCalls = on;
    this.changed();
    this.drive();
  }

  // ---- 席を移す（段階10・利用者決定 10-15） ----
  //  - 本人が降りる／ホストが権限を移す：本人の端末が錠前をホストへ渡す（ホストにしか開けられない包み）→ ホストの CPU が続きを打つ
  //  - 切れて戻らない：局の初めにサーバーへ預けた包みを、3 分後にサーバーがホストへ渡す（部屋の側が adoptReleased を呼ぶ）
  //  - 包みが無い・使えない（錠前の段取りの途中に落ちた・換三張の受け渡しの途中など）：その局をなかったことにして配り直す（Q5=A）
  //  - 席を返す：本人が頼み、ホストが許可すると、ホストが錠前と本物の出来事を本人にしか開けられない包みで返す（Q4=A）

  private setHostWk(v: unknown) {
    if (typeof v !== 'string') return;
    const y = fromB36(v);
    if (validWrapKey(this.g, y)) this.hostWk = y;
  }

  private packageOf(seat: Seat): SeatPackage | null {
    const h = this.hand;
    const lk = h?.mine.get(seat);
    if (!h || !lk) return null;
    return { no: h.no, seat, locker: lockerToWire(lk), priv: (this.ownLogs.get(seat) ?? []).slice() };
  }

  /** 自分の席の包みを作り直して部屋の側へ（サーバーに預ける）。ホストは預けない */
  private depositMine() {
    if (this.o.isHost || !this.o.onPackage || this.mySeat === null || this.yielded || this.hostWk === null) return;
    const pkg = this.packageOf(this.mySeat);
    if (!pkg) return;
    void wrapFor(this.g, this.hostWk, JSON.stringify(pkg)).then((blob) => this.o.onPackage?.(pkg.no, blob));
  }

  /** 自分の席を CPU に任せる（本人が降りる・ホストに言われた）。ホストは自分の席をそのまま CPU に回す */
  async yieldSeat(): Promise<void> {
    const seat = this.mySeat;
    if (seat === null || this.yielded || !this.started) return;
    if (this.o.isHost) {
      this.setProxy(seat, true);
      return;
    }
    if (this.hostWk === null) return;
    const pkg = this.packageOf(seat);
    this.yielded = true;
    this.reclaimRefused = false;
    this.changed();
    // 局の間（錠前がまだ無い）なら錠前は渡さない＝ホストが次の局から作る
    const blob = pkg ? await wrapFor(this.g, this.hostWk, JSON.stringify(pkg)) : '';
    this.toHost({ type: 'mt-yield', seat, id: this.o.myId, blob });
  }

  /** ホスト：つながっている人の席を CPU に移す（その人の端末が錠前を渡してくる） */
  takeSeat(seat: Seat) {
    if (!this.o.isHost || this.isProxy(seat) || this.seats[seat]?.kind !== 'human') return;
    if (seat === this.mySeat) return void this.yieldSeat();
    this.send({ type: 'mt-take', seat }, 'all');
  }

  /** ホスト：席の持ち主が錠前を渡してきた */
  private async onYield(seat: Seat, id: string, blob: string) {
    const k = this.seats[seat];
    if (!this.o.isHost || !this.wrapKeys || k?.kind !== 'human' || k.id !== id || k.proxy) return;
    this.adopt(seat, await this.openPackage(seat, blob));
  }

  private async openPackage(seat: Seat, blob: string | null): Promise<SeatPackage | null> {
    if (!blob || !this.wrapKeys) return null;
    const plain = await unwrap(this.g, this.wrapKeys.x, blob);
    if (!plain) return null;
    try {
      const pkg = JSON.parse(plain) as SeatPackage;
      return pkg.seat === seat ? pkg : null;
    } catch {
      return null;
    }
  }

  /**
   * ホスト：切れて戻らなかった人の包みがサーバーから届いた（blob が null＝預かりが無かった・サーバーが対応していない）。
   * 包みを開けて、その局の続きをホストの CPU が打つ。使えなければ局を配り直す
   */
  async adoptReleased(id: string, blob: string | null): Promise<'continued' | 'redealt' | 'none'> {
    const seat = this.ids.get(id);
    if (!this.o.isHost || seat === undefined || this.isProxy(seat)) return 'none';
    return this.adopt(seat, await this.openPackage(seat, blob));
  }

  /** ホスト：席を CPU に移し、包みで局面を作り直す（作れなければ配り直す） */
  private adopt(seat: Seat, pkg: SeatPackage | null): 'continued' | 'redealt' {
    const h = this.hand;
    this.setProxy(seat, true);
    // 錠前の段取りの途中：その席の錠前があれば続ける。無ければ段取りからやり直す
    if (h && !h.final) {
      this.views.set(seat, this.viewFromWire(seat));
      if (pkg && pkg.no === h.no) {
        h.mine.set(seat, lockerFromWire(pkg.locker));
        this.o.store?.save(h.no, seat, pkg.locker);
        this.resumeLock();
        this.drive();
        return 'continued';
      }
      this.redeal();
      return 'redealt';
    }
    const r = pkg ? this.rebuildSeat(seat, pkg) : false;
    if (pkg && r !== false) {
      // 錠前は持った：その人が出すはずだった鍵を出し直す（作り直しが鍵待ちでも先に出す＝ほかの人の局面が進む）
      h!.mine.set(seat, lockerFromWire(pkg.locker));
      this.sendSeatKeys(seat);
      if (r !== true) {
        // ほかの人の鍵が届いたら作り直す。それまでその席は打たない（局面を持たない）
        this.views.delete(seat);
        this.waiters.push({ need: r, run: () => this.adoptRetry(seat, pkg) });
        return 'continued';
      }
      // 局が終わって錠前を明かしたあとなら、この席の分も明かす（検算がそろう）
      if (h && h.revealedMine) this.broadcast({ type: 'mt-reveal', no: h.no, seat, locker: pkg.locker });
      this.changed();
      this.drive();
      return 'continued';
    }
    this.views.set(seat, this.viewFromWire(seat));
    this.redeal();
    return 'redealt';
  }

  /** 鍵待ちだった作り直しをやり直す（その間に局が変わっていれば配り直す） */
  private adoptRetry(seat: Seat, pkg: SeatPackage) {
    const r = this.rebuildSeat(seat, pkg);
    if (r === true) {
      const h = this.hand;
      if (h && h.revealedMine) this.broadcast({ type: 'mt-reveal', no: h.no, seat, locker: pkg.locker });
      this.changed();
      this.drive();
    } else if (r === false) {
      this.views.set(seat, this.viewFromWire(seat));
      this.redeal();
    } else this.waiters.push({ need: r, run: () => this.adoptRetry(seat, pkg) });
  }

  /** ホスト：席を CPU に任せる／戻すを全員へ */
  private setProxy(seat: Seat, proxy: boolean) {
    this.broadcast({ type: 'mt-seat', seat, proxy });
  }

  private onSeat(seat: Seat, proxy: boolean) {
    const k = this.seats[seat];
    if (k?.kind !== 'human' || !!k.proxy === proxy) return;
    this.seats = this.seats.map((x, i) => (i === seat && x.kind === 'human' ? { ...x, proxy } : x));
    if (seat === this.mySeat) {
      this.yielded = proxy;
      if (!proxy) {
        this.reclaimPending = false;
        this.reclaimRefused = false;
        // 席が返ってきた：自分の錠前をすぐサーバーに預け直す（包みを開け終わる前ならまだ錠前が無い＝開け終わったときに預ける）。
        // ★前は包みを開け終わったときにまだ「任せている」の印が立っていて預けず、切れたときの 3 分の時計が止まらなかった（10-21 見回りで発見）
        this.depositMine();
      }
    }
    if (this.o.isHost) this.reclaims.delete(seat);
    // 打たなくなった席の局面は捨てる（自分の席は見ていられるように残す）
    if (!this.viewSeats().includes(seat)) this.views.delete(seat);
    // 最初の局の前に CPU に替わった席（制限時間に同意しなかった）：局面はまだ空なので、ここで持つ。
    // 局の途中で替わった席は、包みで作り直す側（adopt）が持つ（伏せた局面のまま打たせない）
    else if (this.hand === null && !this.views.has(seat)) this.views.set(seat, this.viewFromWire(seat));
    // 始める前の同意を待っているあいだにホストが引き取った席（切れて戻らなかった人など）は、もう待たない。
    // 引き取りの処理（adopt）を終えてから締め切る（途中で対局を始めると、引き取りの続きが配り直しを重ねる）
    if (this.o.isHost && this.consents) setTimeout(() => this.checkConsents(), 0);
    this.changed();
    this.drive();
  }

  /** 全員に見える列だけで、その席から見える局面（その席の牌は伏せたまま） */
  private viewFromWire(seat: Seat): GameState {
    let v = initialState();
    for (const { env } of this.wire) v = apply(v, mask(env, seat));
    return v;
  }

  /**
   * 包みの錠前と本物の出来事で、その席の局面を作り直す（この局の配牌・ツモは錠前で開け直す。
   * ほかの人の鍵は全員あてに出ているので手元にある）。作れなければ false（何も変えない）
   */
  private rebuildSeat(seat: Seat, pkg: SeatPackage): boolean | number[] {
    const h = this.hand;
    if (!h || !h.final || pkg.no !== h.no || pkg.seat !== seat) return false;
    // 換三張の受け渡しの途中は、錠前だけでは続けられない（受け渡しの鍵は本人の端末の中）
    if (this.pub.phase === 'huan3') return false;
    const had = h.mine.get(seat);
    h.mine.set(seat, lockerFromWire(pkg.locker));
    const fail = () => {
      if (had) h.mine.set(seat, had);
      else h.mine.delete(seat);
      return false;
    };
    const real = new Map(pkg.priv.map((e) => [e.seq, e]));
    const startAt = this.wire.map((x) => x.env.ev.type).lastIndexOf('roundStart');
    const own: Envelope[] = [];
    const missing: number[] = [];
    let v = initialState();
    try {
      for (const [i, { env, pos }] of this.wire.entries()) {
        if (missing.length) break;
        let e = env;
        const ev = env.ev;
        const evSeat = (ev as { seat?: Seat }).seat;
        if (i > startAt && evSeat === seat && pos && (ev.type === 'deal' || ev.type === 'draw')) {
          for (const p of pos) this.tryDecode(p);
          // ほかの人の鍵がまだ届いていない（落ちる直前に引いた牌など）：届くのを待ってやり直す
          if (!pos.every((p) => h.tiles.has(p))) {
            missing.push(...pos.filter((p) => !h.tiles.has(p)));
            continue;
          }
          const tiles = pos.map((p) => h.tiles.get(p)!);
          e = { ...env, ev: ev.type === 'deal' ? { ...ev, tiles } : { ...ev, tile: tiles[0] } };
        } else if (i > startAt && evSeat === seat && PRIVATE_OWN.has(ev.type)) {
          const r = real.get(env.seq);
          if (!r || r.ev.type !== ev.type) return fail();
          e = r;
          own.push(r);
        }
        v = apply(v, mask(e, seat));
      }
    } catch {
      return fail();
    }
    // 鍵待ち：錠前は持ったまま（届いた鍵と合わせて開けるため）
    if (missing.length) return missing;
    this.views.set(seat, v);
    this.ownLogs.set(seat, own);
    // 引き取った・返してもらった席の錠前と本物の出来事も、端末に控える（開き直したときに取り戻す）
    this.o.store?.save(h.no, seat, pkg.locker);
    this.o.store?.savePriv?.(h.no, seat, own);
    return true;
  }

  /**
   * 引き取った席の鍵を、その人が出すはずだった所へ出し直す（ほかの人に配った牌・表に開ける頼み）。
   * 落ちる前に出していた分と重なっても、同じ鍵なので困らない
   */
  private sendSeatKeys(seat: Seat) {
    const h = this.hand;
    const lk = h?.mine.get(seat);
    if (!h || !lk || !h.final) return;
    const positions = [...h.privatePos].filter(([, owner]) => owner !== seat).map(([p]) => p);
    for (const o of this.opens) for (const p of o) if (this.publicAllowed(p) && !h.privatePos.has(p)) positions.push(p);
    if (positions.length) this.broadcast({ type: 'mt-keys', no: h.no, seat, keys: positions.map((p) => [p, hex(lk.perCard[p].d)]) });
  }

  /** ホスト：この局をなかったことにして、同じ局を配り直す（錠前の段取りの途中なら段取りからやり直す） */
  private redeal() {
    const h = this.hand;
    const p = this.pub;
    if (h && h.round && !h.roundSent) {
      this.beginHand(h.round);
      return;
    }
    if (p.phase === 'gameover' || p.roundIndex < 0) return;
    if (p.phase === 'ended') {
      // 局はもう終わっている：その人の錠前が無いので検算だけがそろわない。検算なしで次へ進めるようにする
      if (h && h.verified === null) {
        h.verified = [];
        this.lastVerify = [];
        // 牌譜の山の並びを局の順にそろえておく（この局は空＝全員の牌は出せない）
        this.walls.push([]);
        this.h3Tiles.push(new Map());
      }
      this.changed();
      this.drive();
      return;
    }
    const r: Round = { roundIndex: p.roundIndex, dealer: p.dealer, honba: p.honba };
    this.emit({ seq: p.nextSeq, to: 'all', ev: { type: 'roundVoid' } });
    this.beginHand(r);
  }

  /** 自分：席を返してほしいとホストへ頼む（ホストの許可が要る） */
  requestReclaim() {
    const seat = this.mySeat;
    if (seat === null || !this.isProxy(seat) || this.reclaimPending) return;
    if (this.o.isHost) {
      // ホストは自分の席をそのまま戻す（錠前は手元にある）
      this.setProxy(seat, false);
      return;
    }
    this.myWrap ??= newWrapKeyPair(this.g);
    this.reclaimPending = true;
    this.reclaimRefused = false;
    this.toHost({ type: 'mt-reclaim', seat, id: this.o.myId, wk: this.myWrap.y.toString(36) });
    this.changed();
  }

  private onReclaim(seat: Seat, id: string, wk: unknown) {
    const k = this.seats[seat];
    if (!this.o.isHost || k?.kind !== 'human' || k.id !== id || !k.proxy || typeof wk !== 'string') return;
    const y = fromB36(wk);
    if (!validWrapKey(this.g, y)) return;
    this.reclaims.set(seat, y);
    this.changed();
  }

  /** ホスト：席を返す頼みに答える */
  async answerReclaim(seat: Seat, ok: boolean) {
    const y = this.reclaims.get(seat);
    if (!this.o.isHost || y === undefined) return;
    this.reclaims.delete(seat);
    if (!ok) {
      this.send({ type: 'mt-reclaim-no', seat }, 'all');
      this.changed();
      return;
    }
    // その局の錠前と本物の出来事を、本人にしか開けられない形で返す（局の間なら錠前は無い＝次の局から本人が作る）
    const pkg = this.packageOf(seat);
    const blob = pkg ? await wrapFor(this.g, y, JSON.stringify(pkg)) : '';
    this.send({ type: 'mt-give', seat, blob }, 'all');
    this.setProxy(seat, false);
  }

  /** 自分：ホストから席が返ってきた */
  private async onGive(seat: Seat, blob: string) {
    if (seat !== this.mySeat || !this.myWrap || !blob) return;
    const plain = await unwrap(this.g, this.myWrap.x, blob);
    if (!plain) return;
    const pkg = JSON.parse(plain) as SeatPackage;
    const h = this.hand;
    if (h && !h.final && pkg.no === h.no) {
      h.mine.set(seat, lockerFromWire(pkg.locker));
      this.o.store?.save(h.no, seat, pkg.locker);
    }
    else return this.giveRetry(seat, pkg);
    this.depositMine();
    this.changed();
    this.drive();
  }

  /**
   * 返ってきた席の局面を包みで作り直す。ほかの人の鍵がまだ届いていなければ、届いてからやり直す（引き取る側の adoptRetry と同じ）。
   * ★前は鍵待ちの返事を捨てていた＝入り直したばかりの人（頼み直した鍵が届く前）は手牌が伏せたままになり、その席が打てずに卓が止まった
   */
  private giveRetry(seat: Seat, pkg: SeatPackage) {
    const r = this.rebuildSeat(seat, pkg);
    if (Array.isArray(r)) {
      this.waiters.push({ need: r, run: () => this.giveRetry(seat, pkg) });
      return;
    }
    this.depositMine();
    this.changed();
    this.drive();
  }

  /** 卓を捨てるとき（部屋を出た・接続が切れて作り直す）：時計を止める（捨てた卓が時間切れの手を送らない） */
  dispose() {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    if (this.consentTimer) clearTimeout(this.consentTimer);
    if (this.consentHostTimer) clearTimeout(this.consentHostTimer);
    this.clockTimer = this.consentTimer = this.consentHostTimer = null;
    this.clockKey = null;
    this.deadline = null;
    this.consentDeadline = null;
    this.consentAsk = false;
  }

  private changed() {
    this.o.onChange?.();
  }
}

