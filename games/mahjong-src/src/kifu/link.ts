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
// 中国式（10-14 第16）：f＝'cn' なら a は中国式の全項目の値。山の枚数はルールから（108・136・144）。缺一門・換三張も選ぶ番。
// オンライン対局の換三張は、ホストのサイコロの目と受け取りが届いた順を作り直せないので、局ごとに x に控える。

import { strengthOf } from '../cpu/strength';
import { act, advance, legalActions, nextHand, rollForDealer, startRound, startRoundFromWall } from '../engine/round';
import { dealerByDice, huan3DirOf, huan3From } from '../engine/state';
import { CN_SETS, decodeCnValues, decodeRuleLink, decodeRuleValues, encodeCnValues, encodeRuleValues, type CnSetId } from '../engine/ruleSets';
import type { CnRuleKey, JpRuleKey, Rules } from '../engine/rules';
import { tileSetFor } from '../engine/tiles';
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
  /** 1＝一人用だが山は決まった並び（オンライン対局から作った同じ山で勝負）。o の山で作り直すが、オンライン対局ではない */
  l?: 1;
  /** 'cn'＝中国式（a は中国式の全項目の値） */
  f?: 'cn';
  /** オンライン対局の換三張：局ごと（何局目）に [サイコロ, サイコロ, 受け取った順の席 4 つ] */
  x?: Record<number, number[]>;
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
function learn(walls: Walls, learned: Map<number, number>, size: number) {
  for (const [m, tile] of learned) {
    const n = MARK - m;
    const hand = Math.floor(n / 200);
    const pos = n % 200;
    while (walls.length <= hand) walls.push(new Array<number>(size).fill(-1));
    walls[hand][pos] = tile;
  }
}

/** 使わなかった位置を残りの牌で埋める（読み直しでは使わない位置なので、どの牌でもよい） */
function fillWalls(walls: Walls): number[][] {
  return walls.map((w) => {
    const used = new Set(w.filter((x) => x >= 0));
    const rest = Array.from({ length: w.length }, (_, i) => i).filter((x) => !used.has(x));
    return w.map((x) => (x >= 0 ? x : rest.shift()!));
  });
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** いま誰かが選ぶ番か（選ぶ番なら、その出来事を出す席の候補） */
function choosing(s: GameState): boolean {
  if (s.phase === 'claim' || s.phase === 'discard' || s.phase === 'declare' || s.phase === 'que') return true;
  // 換三張：まだ出していない人がいるあいだは選ぶ番（4 人とも出したら、向きと受け取りは自動）
  if (s.phase === 'huan3') return s.huan3Out.some((x) => x === null);
  return s.phase === 'ended' && nextStep(s).type === 'yame';
}

/** 選ぶ番でないときに出る出来事（一人用の進め方と同じ。オンライン対局はホストの進め方と同じ） */
function automatic(s: GameState, head: Head, walls: Walls): Envelope[] {
  // オンライン対局の換三張：控えたサイコロの目で向きを決め、控えた順に受け取る（一人用は最後に出した人の出来事に含まれる）
  if (s.phase === 'huan3' && head.o) {
    const x = head.x?.[s.handCount - 1];
    if (!x) throw new Error('換三張の控えが無い');
    if (s.huan3Dir === null) {
      const dice: [number, number] = [x[0], x[1]];
      return [{ seq: s.nextSeq, to: 'all', ev: { type: 'huan3Swap', dice, dir: huan3DirOf(dice) } }];
    }
    const seat = x[2 + s.huan3Taken.filter(Boolean).length] as Seat;
    return [{ seq: s.nextSeq, to: [seat], ev: { type: 'huan3Take', seat, tiles: s.huan3Out[huan3From(seat, s.huan3Dir)]!.slice() } }];
  }
  if (!head.o) return s.phase === 'ended' ? nextHand(s, head.s) : advance(s);
  if (s.phase === 'ended') {
    const n = nextStep(s);
    if (n.type === 'end') return [{ seq: s.nextSeq, to: 'all', ev: { type: 'gameEnd', reason: n.reason } }];
    if (n.type !== 'round') throw new Error('次の局を決められない');
    return roundStartOnline(s.nextSeq, n, walls, s.handCount, s.rules);
  }
  return advance(s, (pos) => tileAt(walls, s.handCount - 1, pos));
}

/** 局の山（オンライン対局だけ。一人用は局面が種から持っている） */
const srcOf = (s: GameState, head: Head, walls: Walls) => (head.o ? (pos: number) => tileAt(walls, s.handCount - 1, pos) : undefined);

/** オンライン対局の局の始まり（table.ts の startRound と同じ並び） */
function roundStartOnline(seq: number, r: { roundIndex: number; dealer: Seat; honba: number }, walls: Walls, hand: number, rules: Rules | null): Envelope[] {
  return startRoundFromWall(seq, r, (pos) => tileAt(walls, hand, pos), rules);
}

/** 選んだ出来事の列：オンライン対局の換三張は、最後に出した人の端末も「出す」だけ（向きと受け取りは別の出来事） */
const chosenEnvs = (envs: Envelope[], head: Head) => (head.o && envs[0]?.ev.type === 'huan3Pass' ? envs.slice(0, 1) : envs);


/** 牌譜を、詰めた中身（縮める前のバイト列）にする */
export function packKifu(src: KifuSource): Uint8Array {
  const ev = src.events;
  if (ev[0]?.ev.type !== 'gameStart' || ev[1]?.ev.type !== 'dealerDice') throw new Error('対局の始まりが無い');
  const rules = ev[0].ev.rules;
  const head: Head =
    rules.family === 'cn'
      ? { v: KIFU_LINK_VERSION, f: 'cn', a: encodeCnValues(rules.values as Record<CnRuleKey, string>), s: src.seed, b: ev[1].ev.by, t: src.startedAt, e: src.set, n: ev.length }
      : { v: KIFU_LINK_VERSION, a: encodeRuleValues(rules.values as Record<JpRuleKey, string>), s: src.seed, b: ev[1].ev.by, t: src.startedAt, e: src.set, n: ev.length };
  const size = tileSetFor(rules).length;
  if (src.players.length) head.p = src.players;
  if (src.cpu) head.c = src.cpu;
  // 山の並び：控えがあればそれ、無ければ作り直しながら牌譜から読み取る
  const walls: Walls = (src.walls ?? []).map((w) => w.slice());
  if (src.mode === 'online' || src.walls) {
    const d = ev[1].ev;
    head.o = { d: [d.by, d.dice[0], d.dice[1]], w: walls.length };
    if (src.mode !== 'online') head.l = 1;
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
    learn(walls, learned, size);
    return gen();
  };
  take(make(() => start(head, rules, walls)));
  while (i < ev.length) {
    // オンライン対局の換三張：4 人とも出したら、牌譜のサイコロの目と受け取った順を控える
    if (head.o && s.phase === 'huan3' && s.huan3Dir === null && s.huan3Out.every((x) => x !== null)) {
      const sw = ev[i]?.ev;
      if (sw?.type !== 'huan3Swap') throw new Error(`${i} 番目が換三張の向きでない`);
      const order = ev.slice(i + 1, i + 5).map((e) => (e.ev.type === 'huan3Take' ? e.ev.seat : -1));
      if (order.includes(-1)) throw new Error('換三張の受け取りが 4 人そろっていない');
      head.x = { ...(head.x ?? {}), [s.handCount - 1]: [sw.dice[0], sw.dice[1], ...order] };
    }
    if (choosing(s)) {
      const want = ev[i];
      const seat = (want.ev as { seat?: Seat }).seat;
      if (seat === undefined) throw new Error(`${i} 番目は選んだ出来事でない`);
      const legal = legalActions(s, seat);
      const n = legal.findIndex((a) => {
        try {
          const envs = chosenEnvs(act(s, seat, a, srcOf(s, head, walls)), head);
          return unify(envs, ev.slice(i, i + envs.length), new Map());
        } catch {
          return false;
        }
      });
      if (n < 0) throw new Error(`${i} 番目の選んだことが、選べたことの中に無い（${JSON.stringify(want.ev).slice(0, 160)}）`);
      if (n < 63) out.push((seat << 6) | n);
      else out.push((seat << 6) | 63, n - 63);
      take(make(() => chosenEnvs(act(s, seat, legal[n], srcOf(s, head, walls)), head)));
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
  if (head.o) return [first, dice, ...roundStartOnline(2, { roundIndex: 0, dealer: after.chicha, honba: 0 }, walls, 0, rules)];
  return [first, dice, ...startRound(after, head.s, 0, after.chicha)];
}

/** 詰めた中身から牌譜の元（出来事の列）を作り直す。読めなければ例外 */
export function unpackKifu(bytes: Uint8Array): KifuSource {
  const len = bytes[0] | (bytes[1] << 8);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(2, 2 + len))) as Head;
  if (head.v !== 1 && head.v !== KIFU_LINK_VERSION) throw new Error('知らない版の牌譜のリンク');
  // 版 1 はセットとの差、版 2 は全項目の値
  let rules: Rules;
  if (head.f === 'cn') {
    const set: CnSetId = (CN_SETS as readonly string[]).includes(head.e) ? (head.e as CnSetId) : 'sichuan';
    const cv = head.a !== undefined ? decodeCnValues(head.a, set) : null;
    if (!cv) throw new Error('ルールを読めない');
    rules = { family: 'cn', values: cv };
  } else {
    const values = head.a !== undefined ? decodeRuleValues(head.a) : head.r !== undefined ? (decodeRuleLink(head.r)?.values ?? null) : null;
    if (!values) throw new Error('ルールを読めない');
    rules = { family: 'jp', values };
  }
  const size = tileSetFor(rules).length;
  let p = 2 + len;
  const walls: number[][] = [];
  for (let k = 0; k < (head.o?.w ?? 0); k++) {
    walls.push(Array.from(bytes.subarray(p, p + size)));
    p += size;
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
    take(chosenEnvs(act(s, seat, legal[n], srcOf(s, head, walls)), head));
  }
  if (events.length !== head.n) throw new Error('出来事の数が合わない');
  return { seed: head.s, startedAt: head.t, players: head.p ?? [], set: head.e, events, ...(head.c ? { cpu: strengthOf(head.c) } : {}), ...(head.o ? (head.l ? { walls } : { mode: 'online' as const, walls }) : {}) };
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
