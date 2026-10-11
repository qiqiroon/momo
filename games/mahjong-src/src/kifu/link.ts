// 牌譜のリンク（段階6の6d・Q41＝A）：山の並びと各人の選択だけに詰めて、短いリンクにする。
//
// CPU と対局の牌譜は、山・親決めのサイコロが種から決まる。だから「種＋ルール＋各人が選んだこと」があれば、
// 一人用と同じ進め方（round.ts の advance・act・nextHand）で出来事の列をそっくり作り直せる。
//  - 選んだこと＝その時に選べたこと（legalActions）の何番目か。1 つ 1 バイト（席 2 ビット＋番号 6 ビット・63 以上は 2 バイト目）
//  - 返事（見送る・鳴く・ロン）は届いた順に並べる（順番で結果は変わらないが、列をそっくり同じにするため）
//  - 頭に {v, r＝ルールのリンクの書き方, s＝種, b＝親決めを振った人, t＝始めた時刻, p＝席の名前} を JSON で置く
//  - 全体を deflate で縮め、URL に使える base64 にする
// 作り直した列が元と食い違えば読まない（例外）。
// オンライン対局（Q42＝A）は山を種から作れないので、局ごとの山の並び（136 バイト）を頭のあとに置き、
// ホストの進め方（局の始まり・配牌の塊・ドラ表示牌・advance・対局の終わり）で作り直す。親決めのサイコロは頭に入れる。
// 山の並びが手元に無い牌譜（ファイルから読んだもの）は、作り直しながら牌譜の出来事から山の位置の牌を読み取る（使わない位置は残りの牌で埋める）。
// 版 2（10-11）：ルールは全項目の値をそのまま書く（a）。版 1 はセットとの差だけ（r）だったので、あとでセットの値が変わると読み違える。

import { strengthOf } from '../cpu/strength';
import { act, advance, dealChunkPositions, legalActions, nextHand, rollForDealer, startRound } from '../engine/round';
import { doraIndicatorPos } from '../engine/dora';
import { dealerByDice } from '../engine/state';
import { decodeRuleLink, decodeRuleValues, encodeRuleValues } from '../engine/ruleSets';
import type { JpRuleKey, Rules } from '../engine/rules';
import { nextStep } from '../engine/game';
import { apply, initialState, type GameState } from '../engine/state';
import type { Envelope, Seat } from '../engine/events';
import type { KifuSource } from './kifu';

export const KIFU_LINK_VERSION = 2;

interface Head {
  v: number;
  /** 版 1：ルール（セットとの差） */
  r?: string;
  /** 版 2：ルール（全項目の値） */
  a?: string;
  s: string;
  b: Seat;
  t: string;
  /** 出来事の数（作り直すのはここまで＝途中で保存した対局もそっくり同じ長さにする） */
  n: number;
  /** 牌譜に残すセットの名前（KifuSource.set） */
  e: string;
  p?: KifuSource['players'];
  /** オンライン対局：親決めのサイコロ [振った人, 目, 目] と、山の並びの数（局の数） */
  o?: { d: [Seat, number, number]; w: number };
  /** CPU の強さ（段階7で追加。無ければ書かれる前のリンク） */
  c?: KifuSource['cpu'];
}

/** 局ごとの山（位置→牌の背番号。まだ分からない位置は -1） */
type Walls = number[][];

/** まだ分からない山の位置の目印（局と位置を入れた負の数。牌の背番号・伏せた牌とは重ならない） */
const MARK = -1000;
const markOf = (hand: number, pos: number) => MARK - hand * 200 - pos;
/** 山の位置の牌（分からなければ目印） */
const tileAt = (walls: Walls, hand: number, pos: number) => {
  const w = walls[hand];
  return w && w[pos] >= 0 ? w[pos] : markOf(hand, pos);
};

/** 目印を含む作り直しと牌譜の出来事を突き合わせる。目印のところは牌譜の牌を読み取る（形が違えば false） */
function unify(g: unknown, t: unknown, learned: Map<number, number>): boolean {
  if (typeof g === 'number' && g <= MARK) {
    if (typeof t !== 'number' || t < 0) return false;
    const prev = learned.get(g);
    if (prev !== undefined && prev !== t) return false;
    learned.set(g, t);
    return true;
  }
  if (Array.isArray(g)) return Array.isArray(t) && g.length === t.length && g.every((x, k) => unify(x, t[k], learned));
  if (g && typeof g === 'object') {
    if (!t || typeof t !== 'object' || Array.isArray(t)) return false;
    const ka = Object.keys(g);
    const kb = Object.keys(t);
    return ka.length === kb.length && ka.every((k, idx) => kb[idx] === k && unify((g as Record<string, unknown>)[k], (t as Record<string, unknown>)[k], learned));
  }
  return g === t;
}

/** 読み取った牌を山に書き込む */
function learn(walls: Walls, learned: Map<number, number>) {
  for (const [m, tile] of learned) {
    const n = MARK - m;
    const hand = Math.floor(n / 200);
    const pos = n % 200;
    while (walls.length <= hand) walls.push(new Array<number>(136).fill(-1));
    walls[hand][pos] = tile;
  }
}

/** 使わなかった位置を残りの牌で埋める（読み直しでは使わない位置なので、どの牌でもよい） */
function fillWalls(walls: Walls): number[][] {
  return walls.map((w) => {
    const used = new Set(w.filter((x) => x >= 0));
    const rest = Array.from({ length: 136 }, (_, i) => i).filter((x) => !used.has(x));
    return w.map((x) => (x >= 0 ? x : rest.shift()!));
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** いま誰かが選ぶ番か（選ぶ番なら、その出来事を出す席の候補） */
function choosing(s: GameState): boolean {
  if (s.phase === 'claim' || s.phase === 'discard' || s.phase === 'declare') return true;
  return s.phase === 'ended' && nextStep(s).type === 'yame';
}

/** 選ぶ番でないときに出る出来事（一人用の進め方と同じ。オンライン対局はホストの進め方と同じ） */
function automatic(s: GameState, head: Head, walls: Walls): Envelope[] {
  if (!head.o) return s.phase === 'ended' ? nextHand(s, head.s) : advance(s);
  if (s.phase === 'ended') {
    const n = nextStep(s);
    if (n.type === 'end') return [{ seq: s.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: n.reason } }];
    if (n.type !== 'round') throw new Error('次の局を決められない');
    return roundStartOnline(s.nextSeq, n, walls, s.handCount);
  }
  return advance(s, (pos) => tileAt(walls, s.handCount - 1, pos));
}

/** 局の山（オンライン対局だけ。一人用は局面が種から持っている） */
const srcOf = (s: GameState, head: Head, walls: Walls) => (head.o ? (pos: number) => tileAt(walls, s.handCount - 1, pos) : undefined);

/** オンライン対局の局の始まり（table.ts の startRound と同じ並び） */
function roundStartOnline(seq: number, r: { roundIndex: number; dealer: Seat; honba: number }, walls: Walls, hand: number): Envelope[] {
  const at = (pos: number) => tileAt(walls, hand, pos);
  const out: Envelope[] = [{ seq: seq++, to: 'all', ev: { type: 'roundStart', roundIndex: r.roundIndex, dealer: r.dealer, honba: r.honba } }];
  for (const c of dealChunkPositions(r.dealer)) out.push({ seq: seq++, to: [c.seat], ev: { type: 'deal', seat: c.seat, tiles: c.positions.map(at) } });
  out.push({ seq: seq++, to: 'all', ev: { type: 'doraReveal', tile: at(doraIndicatorPos(136, 0)) } });
  return out;
}

/** 牌譜を、詰めた中身（縮める前のバイト列）にする */
export function packKifu(src: KifuSource): Uint8Array {
  const ev = src.events;
  if (ev[0]?.ev.type !== 'gameStart' || ev[1]?.ev.type !== 'dealerDice') throw new Error('対局の始まりが無い');
  const rules = ev[0].ev.rules;
  if (rules.family !== 'jp') throw new Error('日本式だけ');
  const head: Head = { v: KIFU_LINK_VERSION, a: encodeRuleValues(rules.values as Record<JpRuleKey, string>), s: src.seed, b: ev[1].ev.by, t: src.startedAt, e: src.set, n: ev.length };
  if (src.players.length) head.p = src.players;
  if (src.cpu) head.c = src.cpu;
  // 山の並び：控えがあればそれ、無ければ作り直しながら牌譜から読み取る
  const walls: Walls = (src.walls ?? []).map((w) => w.slice());
  if (src.mode === 'online') {
    const d = ev[1].ev;
    head.o = { d: [d.by, d.dice[0], d.dice[1]], w: walls.length };
  }
  const out: number[] = [];
  // 作り直しながら進め、選んだところだけを書く（作り直した列が元と同じことも同時に確かめる）
  let s = initialState();
  let i = 0;
  const take = (envs: Envelope[]) => {
    for (const e of envs) {
      if (!same(e, ev[i])) throw new Error(`牌譜を詰められない（${i} 番目の出来事が作り直したものと違う）`);
      s = apply(s, e);
      i++;
    }
  };
  /** 作り直す。分からない山の位置があれば、牌譜の出来事から読み取ってから作り直す */
  const make = (gen: () => Envelope[]): Envelope[] => {
    const envs = gen();
    const learned = new Map<number, number>();
    if (!unify(envs, ev.slice(i, i + envs.length), learned)) return envs;
    if (learned.size === 0) return envs;
    learn(walls, learned);
    return gen();
  };
  take(make(() => start(head, rules, walls)));
  while (i < ev.length) {
    if (choosing(s)) {
      const want = ev[i];
      const seat = (want.ev as { seat?: Seat }).seat;
      if (seat === undefined) throw new Error(`${i} 番目は選んだ出来事でない`);
      const legal = legalActions(s, seat);
      const n = legal.findIndex((a) => {
        try {
          const envs = act(s, seat, a, srcOf(s, head, walls));
          return unify(envs, ev.slice(i, i + envs.length), new Map());
        } catch {
          return false;
        }
      });
      if (n < 0) throw new Error(`${i} 番目の選んだことが、選べたことの中に無い`);
      if (n < 63) out.push((seat << 6) | n);
      else out.push((seat << 6) | 63, n - 63);
      take(make(() => act(s, seat, legal[n], srcOf(s, head, walls))));
    } else {
      take(make(() => automatic(s, head, walls)));
    }
  }
  const full = head.o ? fillWalls(walls) : [];
  if (head.o) head.o.w = full.length;
  const h = new TextEncoder().encode(JSON.stringify(head));
  return Uint8Array.from([h.length & 0xff, h.length >> 8, ...h, ...full.flat(), ...out]);
}

/** 対局の始まり（ルール・親決め・最初の局） */
function start(head: Head, rules: Rules, walls: Walls): Envelope[] {
  const first: Envelope = { seq: 0, to: 'all', ev: { type: 'gameStart', rules } };
  const dice: Envelope = head.o
    ? { seq: 1, to: 'all', ev: { type: 'dealerDice', by: head.o.d[0], dice: [head.o.d[1], head.o.d[2]], dealer: dealerByDice(head.o.d[0], [head.o.d[1], head.o.d[2]]) } }
    : { seq: 1, to: 'all', ev: rollForDealer(head.s, head.b) };
  const after = apply(apply(initialState(), first), dice);
  if (head.o) return [first, dice, ...roundStartOnline(2, { roundIndex: 0, dealer: after.chicha, honba: 0 }, walls, 0)];
  return [first, dice, ...startRound(after, head.s, 0, after.chicha)];
}

/** 詰めた中身から牌譜の元（出来事の列）を作り直す。読めなければ例外 */
export function unpackKifu(bytes: Uint8Array): KifuSource {
  const len = bytes[0] | (bytes[1] << 8);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(2, 2 + len))) as Head;
  if (head.v !== 1 && head.v !== KIFU_LINK_VERSION) throw new Error('知らない版の牌譜のリンク');
  // 版 1 はセットとの差、版 2 は全項目の値
  const values = head.a !== undefined ? decodeRuleValues(head.a) : head.r !== undefined ? (decodeRuleLink(head.r)?.values ?? null) : null;
  if (!values) throw new Error('ルールを読めない');
  const rules: Rules = { family: 'jp', values };
  let p = 2 + len;
  const walls: number[][] = [];
  for (let k = 0; k < (head.o?.w ?? 0); k++) {
    walls.push(Array.from(bytes.subarray(p, p + 136)));
    p += 136;
  }
  const events: Envelope[] = [];
  let s = initialState();
  const take = (envs: Envelope[]) => {
    for (const e of envs) {
      s = apply(s, e);
      events.push(e);
    }
  };
  take(start(head, rules, walls));
  while (events.length < head.n) {
    if (!choosing(s)) {
      take(automatic(s, head, walls));
      continue;
    }
    if (p >= bytes.length) throw new Error('選んだことが足りない');
    const b = bytes[p++];
    const seat = (b >> 6) as Seat;
    let n = b & 63;
    if (n === 63) n += bytes[p++];
    const legal = legalActions(s, seat);
    if (!legal[n]) throw new Error('選んだことが選べたことの中に無い');
    take(act(s, seat, legal[n], srcOf(s, head, walls)));
  }
  if (events.length !== head.n) throw new Error('出来事の数が合わない');
  return { seed: head.s, startedAt: head.t, players: head.p ?? [], set: head.e, events, ...(head.c ? { cpu: strengthOf(head.c) } : {}), ...(head.o ? { mode: 'online' as const, walls } : {}) };
}

// ---- 縮める・URL の文字にする ----

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter();
  void w.write(bytes as Uint8Array<ArrayBuffer>).catch(() => undefined);
  void w.close().catch(() => undefined);
  const r = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of parts) {
    out.set(x, at);
    at += x.length;
  }
  return out;
}

const toB64url = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function fromB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** 牌譜をリンクの文字（#kifu= のあと）にする */
export async function encodeKifuLink(src: KifuSource): Promise<string> {
  return toB64url(await pipe(packKifu(src), new CompressionStream('deflate-raw')));
}

/** リンクの文字から牌譜の元を作り直す。読めなければ例外 */
export async function decodeKifuLink(code: string): Promise<KifuSource> {
  return unpackKifu(await pipe(fromB64url(code), new DecompressionStream('deflate-raw')));
}
