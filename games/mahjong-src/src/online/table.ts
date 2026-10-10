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
import { GENERAL_RULES } from '../engine/rules';
import { apply, initialState, type GameState } from '../engine/state';
import type { TileId } from '../engine/tiles';
import {
  LOCK_BITS,
  decoder,
  encode,
  groupOf,
  newLocker,
  relockPass,
  shufflePass,
  unlock,
  verifyDeal,
  type Group,
  type Locker,
  type VerifyProblem,
} from './lock';

export type SeatKind = { kind: 'human'; id: string; name: string } | { kind: 'cpu' };

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
  onChange?: () => void;
  /** 検算で食い違いが見つかったとき */
  onProblem?: (p: VerifyProblem[]) => void;
}

const hex = (b: bigint) => b.toString(16);
const big = (s: string) => BigInt('0x' + s);

interface WireLocker {
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

/** 全員から見えないものを伏せた形（ホストが番号を付けるときの局面に使う） */
const maskAll = (env: Envelope): Envelope => (env.to === 'all' ? env : mask(env, -1 as Seat));

interface Hand {
  no: number;
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
  /** 通信の量（送った文字数・通数） */
  sent = { bytes: 0, count: 0 };

  private readonly g: Group;
  private readonly decode: (m: bigint) => number;
  private hand: Hand | null = null;
  private queue = new Map<number, { env: Envelope; pos?: number[] }>();
  private waiters: Waiter[] = [];
  private busy = false;
  /** 席ごとに、どの局面（通し番号）で打ったか（同じ局面で 2 度打たない） */
  private acted = new Map<Seat, number>();
  /** ホストが手を付けた局面の番号（同じ局面で 2 度進めない） */
  private hostStep = -1;
  private nextRequested = false;
  /** 人の席の返事待ち（画面が choose を呼ぶ） */
  private ids = new Map<string, Seat>();

  constructor(private readonly o: TableOptions) {
    this.g = groupOf(LOCK_BITS);
    this.decode = decoder(this.g, Array.from({ length: 136 }, (_, i) => i));
  }

  // ---- 外から呼ぶ ----

  /** ホスト：席を決めて対局を始める（人の席は入った順・空きは CPU） */
  begin(humans: { id: string; name: string }[]) {
    if (!this.o.isHost) return;
    const seats: SeatKind[] = SEATS.map((i) => (humans[i] ? { kind: 'human', id: humans[i].id, name: humans[i].name } : { kind: 'cpu' }));
    this.broadcast({ type: 'mt-begin', seats });
    const seedBytes = new Uint32Array(2);
    crypto.getRandomValues(seedBytes);
    const seed = Array.from(seedBytes, (n) => n.toString(36)).join('');
    this.emitAll([{ env: { seq: 0, to: 'all', ev: { type: 'gameStart', rules: GENERAL_RULES } } }, { env: { seq: 1, to: 'all', ev: rollForDealer(seed, 0) } }]);
    this.beginHand({ roundIndex: 0, dealer: this.pub.chicha, honba: 0 });
  }

  /** ホスト：局の錠前の段取りを始める（終わったら局の始まりを配る） */
  private beginHand(r: Round) {
    this.pendingRound = r;
    this.broadcast({ type: 'mt-hand', no: (this.hand?.no ?? 0) + 1 });
  }

  /** 画面から：自分の席の選んだこと */
  choose(a: Action) {
    if (this.mySeat === null) return;
    const v = this.views.get(this.mySeat);
    if (!v || !legalActions(v, this.mySeat).length) return;
    this.perform(this.mySeat, a);
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
        return this.onBegin(d.seats as SeatKind[]);
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
        return this.onAct(String(d.id), d.seat as Seat, d.envs as Envelope[]);
      case 'mt-reveal':
        return this.onReveal(Number(d.no), d.seat as Seat, d.locker as WireLocker);
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

  /** 自分が持つ席（ホストは自分の席と CPU の席） */
  private controlled(): Seat[] {
    return SEATS.filter((s) => (this.seats[s]?.kind === 'cpu' ? this.o.isHost : s === this.mySeat));
  }

  // ---- 受け取る ----

  private onBegin(seats: SeatKind[]) {
    this.seats = seats;
    this.ids = new Map(seats.flatMap((s, i) => (s.kind === 'human' ? [[s.id, i as Seat] as const] : [])));
    this.mySeat = this.ids.get(this.o.myId) ?? null;
    this.views = new Map(this.controlled().map((s) => [s, initialState()]));
    this.started = true;
    this.changed();
  }

  /** 局の錠前の段取りを始める（全員がこの局の自分の錠前を作る） */
  private onHand(no: number) {
    const size = 136;
    const mine = new Map(this.controlled().map((s) => [s, newLocker(this.g, size)] as const));
    this.hand = {
      no,
      mine,
      start: Array.from({ length: size }, (_, i) => encode(this.g, i)),
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
    this.changed();
    // 席 0 から順に混ぜる（席 0 の持ち主が最初）
    this.lockStep('s', 0, this.hand.start);
  }

  private pendingRound: Round | null = null;

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

  /** 表に開けてよい位置か（王牌のドラ・裏ドラの表示牌だけ） */
  private publicAllowed(pos: number): boolean {
    const size = 136;
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
    this.whenOpen(positions, run);
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
      if (this.views.has(target)) {
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
      if (priv && (env.ev as { seat: Seat }).seat === seat && h && pos) {
        const tiles = pos.map((p) => h.tiles.get(p)!);
        e = { ...env, ev: env.ev.type === 'deal' ? { ...env.ev, tiles } : { ...(env.ev as Extract<GameEvent, { type: 'draw' }>), tile: tiles[0] } };
      }
      this.views.set(seat, apply(v, mask(e, seat)));
      if (seat === this.mySeat) this.myLog.push(mask(e, seat));
    }
    this.pub = apply(this.pub, maskAll(env));
    if (env.ev.type === 'deal' && h) h.dealt++;
    return true;
  }

  private checkPublicTiles(ev: GameEvent) {
    const h = this.hand;
    if (!h) return;
    const said: [number, TileId][] = [];
    if (ev.type === 'doraReveal') said.push([doraIndicatorPos(136, this.pub.doraIndicators.length), ev.tile]);
    if ((ev.type === 'ron' || ev.type === 'tsumo') && ev.ura.length) ev.ura.forEach((t, i) => said.push([uraIndicatorPos(136, i), t]));
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

  // ---- 打つ ----

  /** 席の持ち主として、選んだことを出来事にしてホストへ（ドラ・裏ドラが要れば先に表に開ける） */
  private perform(seat: Seat, a: Action) {
    const v = this.views.get(seat);
    if (!v) return;
    if (this.acted.get(seat) === v.nextSeq) return;
    this.acted.set(seat, v.nextSeq);
    const need = positionsNeeded((src) => act(v, seat, a, src));
    this.openPublic(need, () => {
      const h = this.hand;
      const envs = act(v, seat, a, (p) => h?.tiles.get(p) ?? HIDDEN);
      this.toHost({ type: 'mt-act', id: this.o.myId, seat, envs });
    });
  }

  /** ホスト：席の持ち主から届いた出来事に番号を付け直して配る（古い局面から作ったものは捨てる） */
  private onAct(id: string, seat: Seat, envs: Envelope[]) {
    if (!this.o.isHost || envs.length === 0) return;
    const owner = this.seats[seat];
    const fromOk = owner?.kind === 'cpu' ? id === this.o.myId : owner?.kind === 'human' && owner.id === id;
    if (!fromOk) return;
    let trial = this.pub;
    const out: Envelope[] = [];
    try {
      for (const e of envs) {
        // 配るのは全員に見える出来事だけ。席のある出来事はその席のもの
        if (e.to !== 'all') return;
        const evSeat = (e.ev as { seat?: Seat }).seat;
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
    const { problems } = verifyDeal(this.g, Array.from({ length: 136 }, (_, i) => i), log, lockers, h.tiles);
    h.verified = problems;
    this.lastVerify = problems;
    if (problems.length) this.o.onProblem?.(problems);
    this.changed();
    this.drive();
  }

  // ---- 自動で進むところ ----

  private drive() {
    if (!this.started || this.holding > 0) return;
    const h = this.hand;
    // 局が終わったら、自分の錠前を明かす（1 局に 1 回）
    if (h && h.final && h.dealt > 0 && (this.pub.phase === 'ended' || this.pub.phase === 'gameover') && !h.revealedMine) {
      h.revealedMine = true;
      for (const [seat, lk] of h.mine) this.broadcast({ type: 'mt-reveal', no: h.no, seat, locker: lockerToWire(lk) });
    }
    if (this.o.isHost) this.driveHost();
    for (const seat of this.controlled()) this.driveSeat(seat);
  }

  /** ホスト：局を始める・山から引かせる・次の局へ */
  private driveHost() {
    const p = this.pub;
    const h = this.hand;
    if (!h?.final || this.queue.size > 0) return;
    // 錠前が掛け終わったら、ドラ表示牌を表に開けて、局の始まりと配牌を配る
    if (h.round && !h.roundSent) {
      h.roundSent = true;
      const r = h.round;
      const dora = doraIndicatorPos(136, 0);
      this.openPublic([dora], () => this.startRound(r, h.tiles.get(dora)!));
      return;
    }
    if (this.hostStep === p.nextSeq) return;
    if ((p.phase === 'deal' && h.dealt >= 16) || p.phase === 'draw') {
      this.hostStep = p.nextSeq;
      const d = drawPosition(p);
      const need = positionsNeeded((src) => advance(p, src)).filter((x) => x !== d?.pos);
      this.openPublic(need, () => {
        const envs = advance(p, (x) => (x === d?.pos ? HIDDEN : h.tiles.get(x) ?? HIDDEN));
        this.emitAll(envs.map((e) => ({ env: e, pos: e.ev.type === 'draw' && d ? [d.pos] : undefined })));
      });
      return;
    }
    // 次の局へは、この局の検算が済んでから（新しい局の錠前で、この局の鍵が届かなくなるため）
    if (p.phase === 'ended' && h.verified !== null && (this.nextRequested || this.o.autoNext)) {
      const n = nextStep(p);
      if (n.type === 'yame') return;
      this.hostStep = p.nextSeq;
      this.nextRequested = false;
      if (n.type === 'end') {
        this.emit({ seq: p.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: n.reason } });
        return;
      }
      this.beginHand({ roundIndex: n.roundIndex, dealer: n.dealer, honba: n.honba });
    }
  }

  /** ホスト：局の始まり・配牌（伏せた形＋位置）・ドラ表示牌 */
  private startRound(r: Round, dora: TileId) {
    let seq = this.pub.nextSeq;
    const items: { env: Envelope; pos?: number[] }[] = [{ env: { seq: seq++, to: 'all', ev: { type: 'roundStart', roundIndex: r.roundIndex, dealer: r.dealer, honba: r.honba } } }];
    for (const c of dealChunkPositions(r.dealer)) {
      items.push({ env: { seq: seq++, to: [c.seat], ev: { type: 'deal', seat: c.seat, tiles: c.positions.map(() => HIDDEN) } }, pos: c.positions });
    }
    items.push({ env: { seq: seq++, to: 'all', ev: { type: 'doraReveal', tile: dora } } });
    this.emitAll(items);
  }

  /** 席の持ち主として、打つ番なら打つ（CPU・自動の席はすぐ、人の席は見送るしかないときだけ自動） */
  private driveSeat(seat: Seat) {
    const v = this.views.get(seat);
    if (!v || this.queue.size > 0) return;
    // 局の終わり（やめるか選ぶ）以外は、山が配られてから
    if (v.phase !== 'ended' && !this.hand?.final) return;
    const legal = legalActions(v, seat);
    if (legal.length === 0) return;
    const kind = this.seats[seat]?.kind;
    const auto = kind === 'cpu' ? this.o.cpu : this.o.autoplay;
    if (auto) return this.perform(seat, auto(v, seat));
    // 人の席：見送るしかない返事・言えることが 1 つだけの宣言は自動（画面のボタンを待たない）
    if ((v.phase === 'claim' || v.phase === 'declare') && legal.length === 1) this.perform(seat, legal[0]);
  }

  private changed() {
    this.o.onChange?.();
  }
}

