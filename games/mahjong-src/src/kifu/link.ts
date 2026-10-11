// 牌譜のリンク（段階6の6d・Q41＝A）：山の並びと各人の選択だけに詰めて、短いリンクにする。
//
// CPU と対局の牌譜は、山・親決めのサイコロが種から決まる。だから「種＋ルール＋各人が選んだこと」があれば、
// 一人用と同じ進め方（round.ts の advance・act・nextHand）で出来事の列をそっくり作り直せる。
//  - 選んだこと＝その時に選べたこと（legalActions）の何番目か。1 つ 1 バイト（席 2 ビット＋番号 6 ビット・63 以上は 2 バイト目）
//  - 返事（見送る・鳴く・ロン）は届いた順に並べる（順番で結果は変わらないが、列をそっくり同じにするため）
//  - 頭に {v, r＝ルールのリンクの書き方, s＝種, b＝親決めを振った人, t＝始めた時刻, p＝席の名前} を JSON で置く
//  - 全体を deflate で縮め、URL に使える base64 にする
// 作り直した列が元と食い違えば読まない（例外）。オンライン対局の牌譜（山を種から作れない）は、このあと足す。

import { act, advance, legalActions, nextHand, rollForDealer, startRound } from '../engine/round';
import { decodeRuleLink, encodeRuleLink, JP_SETS, type SetId } from '../engine/ruleSets';
import type { JpRuleKey, Rules } from '../engine/rules';
import { nextStep } from '../engine/game';
import { apply, initialState, type GameState } from '../engine/state';
import type { Envelope, Seat } from '../engine/events';
import type { KifuSource } from './kifu';

export const KIFU_LINK_VERSION = 1;

interface Head {
  v: number;
  r: string;
  s: string;
  b: Seat;
  t: string;
  /** 牌譜に残すセットの名前（KifuSource.set） */
  e: string;
  p?: KifuSource['players'];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** いま誰かが選ぶ番か（選ぶ番なら、その出来事を出す席の候補） */
function choosing(s: GameState): boolean {
  if (s.phase === 'claim' || s.phase === 'discard' || s.phase === 'declare') return true;
  return s.phase === 'ended' && nextStep(s).type === 'yame';
}

/** 選ぶ番でないときに出る出来事（一人用の進め方と同じ） */
function automatic(s: GameState, seed: string): Envelope[] {
  if (s.phase === 'ended') return nextHand(s, seed);
  return advance(s);
}

/** 牌譜（CPU と対局）を、詰めた中身（縮める前のバイト列）にする */
export function packKifu(src: KifuSource): Uint8Array {
  const ev = src.events;
  if (ev[0]?.ev.type !== 'gameStart' || ev[1]?.ev.type !== 'dealerDice') throw new Error('対局の始まりが無い');
  const rules = ev[0].ev.rules;
  if (rules.family !== 'jp') throw new Error('日本式だけ');
  const base: SetId = (JP_SETS as readonly string[]).includes(src.set) ? (src.set as SetId) : 'general';
  const head: Head = { v: KIFU_LINK_VERSION, r: encodeRuleLink({ base, values: rules.values as Record<JpRuleKey, string> }), s: src.seed, b: ev[1].ev.by, t: src.startedAt, e: src.set };
  if (src.players.length) head.p = src.players;
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
  take(start(head, rules));
  while (i < ev.length) {
    if (choosing(s)) {
      const want = ev[i];
      const seat = (want.ev as { seat?: Seat }).seat;
      if (seat === undefined) throw new Error(`${i} 番目は選んだ出来事でない`);
      const legal = legalActions(s, seat);
      const n = legal.findIndex((a) => {
        try {
          const envs = act(s, seat, a);
          return envs.every((e, k) => same(e, ev[i + k]));
        } catch {
          return false;
        }
      });
      if (n < 0) throw new Error(`${i} 番目の選んだことが、選べたことの中に無い`);
      if (n < 63) out.push((seat << 6) | n);
      else out.push((seat << 6) | 63, n - 63);
      take(act(s, seat, legal[n]));
    } else {
      take(automatic(s, head.s));
    }
  }
  const h = new TextEncoder().encode(JSON.stringify(head));
  return Uint8Array.from([h.length & 0xff, h.length >> 8, ...h, ...out]);
}

/** 対局の始まり（ルール・親決め・最初の局） */
function start(head: Head, rules: Rules): Envelope[] {
  const first: Envelope = { seq: 0, to: 'all', ev: { type: 'gameStart', rules } };
  const dice: Envelope = { seq: 1, to: 'all', ev: rollForDealer(head.s, head.b) };
  const after = apply(apply(initialState(), first), dice);
  return [first, dice, ...startRound(after, head.s, 0, after.chicha)];
}

/** 詰めた中身から牌譜の元（出来事の列）を作り直す。読めなければ例外 */
export function unpackKifu(bytes: Uint8Array): KifuSource {
  const len = bytes[0] | (bytes[1] << 8);
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(2, 2 + len))) as Head;
  if (head.v !== KIFU_LINK_VERSION) throw new Error('知らない版の牌譜のリンク');
  const choice = decodeRuleLink(head.r);
  if (!choice) throw new Error('ルールを読めない');
  const rules: Rules = { family: 'jp', values: choice.values };
  const events: Envelope[] = [];
  let s = initialState();
  const take = (envs: Envelope[]) => {
    for (const e of envs) {
      s = apply(s, e);
      events.push(e);
    }
  };
  take(start(head, rules));
  let p = 2 + len;
  while (p < bytes.length || (!choosing(s) && s.phase !== 'gameover')) {
    if (events.length > 20000) throw new Error('牌譜が終わらない');
    if (!choosing(s)) {
      if (s.phase === 'gameover') break;
      take(automatic(s, head.s));
      continue;
    }
    if (p >= bytes.length) break; // 途中で保存した対局（選ぶ番で終わっている）
    const b = bytes[p++];
    const seat = (b >> 6) as Seat;
    let n = b & 63;
    if (n === 63) n += bytes[p++];
    const legal = legalActions(s, seat);
    if (!legal[n]) throw new Error('選んだことが選べたことの中に無い');
    take(act(s, seat, legal[n]));
  }
  return { seed: head.s, startedAt: head.t, players: head.p ?? [], set: head.e, events };
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
