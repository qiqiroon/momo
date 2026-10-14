// 同じ山で勝負（段階6の6e・Q45＝A）：ルールと山の種をリンクで渡し、受け取った人が同じ配牌・ツモで CPU と打つ。
// 鳴けばツモの順がずれる（ふつうの麻雀のまま）。送った人の成績（終わった対局なら順位と最終得点）も入れて、比べられるようにする。
// リンクの中身は JSON を URL に使える base64 にしたもの：{v, b＝基にしたセット, a＝ルールの全項目の値, s＝種, y＝送った人の成績, c＝CPU の強さ, o＝山の並び}
// CPU の強さ（段階7・Q4=A）：受け取った人は送った人と同じ強さで打つ（変えられない）。c が無い古いリンクは Hard
// ルールは全項目の値をそのまま書く（あとでセットの値が変わっても、送った人と同じルールで打てる）
//
// オンライン対局から（10-12・Q5=A）：オンラインの山は種から作れないので、局ごとの山の並び（136 枚）と親決めのサイコロを入れる（o）。
// 受け取った人は CPU 相手に一人で打つ。送った人の席が受け取った人の席（席 0）になるよう、席を回して入れる（親決めを振った人をずらす）。
// 送った人の対局より局が多くなったら、そこから先は種 s から作った新しい山で続ける。

import { strengthOf, type Strength } from '../cpu/strength';
import type { Seat } from '../engine/events';
import { finalResult } from '../engine/final';
import { apply, initialState } from '../engine/state';
import type { KifuSource } from './kifu';
import { CN_SETS, cnNearestSet, cnValuesOf, decodeCnValues, decodeRuleValues, encodeCnValues, encodeRuleValues, generalChoice, JP_SETS, type CnSetId, type RuleChoice, type SetId } from '../engine/ruleSets';
import type { CnRuleKey } from '../engine/rules';

export const SAME_LINK_VERSION = 1;

/** オンライン対局の山（席は受け取った人から見た番号に回したもの） */
export interface SameWallOnline {
  /** 親決めのサイコロを振った人 */
  by: Seat;
  dice: [number, number];
  /** 局ごとの山の並び（位置→牌の背番号。どれも 0〜135 を 1 回ずつ） */
  walls: number[][];
}

export interface SameWall {
  choice: RuleChoice;
  seed: string;
  /** CPU の強さ */
  strength: Strength;
  /** 送った人の成績（終わった対局のとき） */
  result?: { rank: number; total: number };
  /** オンライン対局から作ったリンク（無ければ CPU と対局から＝山は種から作る） */
  online?: SameWallOnline;
}

const bytesToB64url = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function b64urlToBytes(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
}
const toB64url = (text: string) => bytesToB64url(new TextEncoder().encode(text));
const fromB64url = (s: string) => new TextDecoder().decode(b64urlToBytes(s));

/** 山の並びとして正しいか（n 枚・0〜n-1 を 1 回ずつ。日本式・香港 136・四川 108・国標 144） */
const isWall = (w: readonly number[], n: number) => w.length === n && new Set(w).size === n && w.every((x) => Number.isInteger(x) && x >= 0 && x < n);
const WALL_SIZES = [108, 136, 144];

export function encodeSameLink(w: SameWall): string {
  const o: { v: number; b: string; a: string; s: string; c: Strength; y?: [number, number]; o?: { d: [Seat, number, number]; w: string; n?: number } } = w.choice.cn
    ? // 中国式（2026-10-13 第16）：b は中国式のセット名、a は中国式の全項目の値
      { v: SAME_LINK_VERSION, b: w.choice.cn, a: encodeCnValues(cnValuesOf(w.choice.cnValues, w.choice.cn)), s: w.seed, c: w.strength }
    : { v: SAME_LINK_VERSION, b: w.choice.base, a: encodeRuleValues(w.choice.values), s: w.seed, c: w.strength };
  if (w.result) o.y = [w.result.rank, w.result.total];
  if (w.online) {
    const n = w.online.walls[0]?.length ?? 136;
    o.o = { d: [w.online.by, w.online.dice[0], w.online.dice[1]], w: bytesToB64url(Uint8Array.from(w.online.walls.flat())), ...(n !== 136 ? { n } : {}) };
  }
  return toB64url(JSON.stringify(o));
}

function decodeOnline(raw: unknown): SameWallOnline | null | undefined {
  if (raw === undefined) return undefined;
  const o = raw as { d?: unknown; w?: unknown; n?: unknown };
  // 山の枚数（中国式は 108・144 もある。無い古いリンクは 136）
  const n = o.n === undefined ? 136 : Number(o.n);
  if (!WALL_SIZES.includes(n)) return null;
  if (!Array.isArray(o.d) || o.d.length !== 3 || typeof o.w !== 'string') return null;
  const [by, d1, d2] = o.d as number[];
  if (![0, 1, 2, 3].includes(by) || ![d1, d2].every((d) => Number.isInteger(d) && d >= 1 && d <= 6)) return null;
  const bytes = b64urlToBytes(o.w);
  if (bytes.length === 0 || bytes.length % n !== 0) return null;
  const walls = Array.from({ length: bytes.length / n }, (_, k) => Array.from(bytes.subarray(k * n, k * n + n)));
  if (!walls.every((w) => isWall(w, n))) return null;
  return { by: by as Seat, dice: [d1, d2], walls };
}

/** 読めなければ null */
export function decodeSameLink(code: string): SameWall | null {
  try {
    const o = JSON.parse(fromB64url(code)) as { v?: unknown; b?: unknown; a?: unknown; s?: unknown; c?: unknown; y?: unknown; o?: unknown };
    if (o.v !== SAME_LINK_VERSION || typeof o.a !== 'string' || typeof o.s !== 'string' || !o.s) return null;
    const online = decodeOnline(o.o);
    if (online === null) return null;
    let choice: RuleChoice;
    if (typeof o.b === 'string' && (CN_SETS as readonly string[]).includes(o.b)) {
      // 中国式：オンライン対局にはまだ対応していない＝山の並びは無いはず
      const cnValues = decodeCnValues(o.a, o.b as CnSetId);
      if (!cnValues) return null;
      choice = { ...generalChoice(), cn: o.b as CnSetId, cnValues };
    } else {
      const values = decodeRuleValues(o.a);
      if (!values) return null;
      const base: SetId = typeof o.b === 'string' && (JP_SETS as readonly string[]).includes(o.b) ? (o.b as SetId) : 'general';
      choice = { base, values };
    }
    const y = Array.isArray(o.y) && o.y.length === 2 && o.y.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { rank: o.y[0] as number, total: o.y[1] as number } : undefined;
    return { choice, seed: o.s, strength: strengthOf(o.c), ...(y ? { result: y } : {}), ...(online ? { online } : {}) };
  } catch {
    return null;
  }
}

/** 山の並びのうち、まだ分からない位置（-1）を残りの牌で埋める（その位置は対局で使わなかった＝どの牌でもよい） */
export function fillWall(w: readonly number[]): number[] {
  const used = new Set(w.filter((x) => x >= 0));
  const rest = Array.from({ length: w.length }, (_, i) => i).filter((x) => !used.has(x));
  return w.map((x) => (x >= 0 ? x : rest.shift()!));
}

/**
 * 牌譜から、同じ山で勝負のリンクの中身を作る。終わった対局なら自分の順位と最終得点も入れる。
 * 山の並びを持つ牌譜（オンライン対局・決まった山で打った対局）は並びと親決めのサイコロを入れ、
 * 自分の席が受け取った人の席（席 0）になるよう、サイコロを振った人を回す（Q5=A）
 */
export function sameWallOf(src: KifuSource): SameWall {
  let s = initialState();
  for (const e of src.events) s = apply(s, e);
  const values = (s.rules?.family === 'jp' ? s.rules.values : {}) as RuleChoice['values'];
  const base = (JP_SETS as readonly string[]).includes(src.set) ? (src.set as SetId) : 'general';
  // 中国式：基にしたセットは牌譜のセット名（カスタムなら一番近いセット）
  const cnValues = s.rules?.family === 'cn' ? (s.rules.values as Record<CnRuleKey, string>) : null;
  const cn = cnValues ? ((CN_SETS as readonly string[]).includes(src.set) ? (src.set as CnSetId) : cnNearestSet(cnValues)) : null;
  const mySeat = src.me ?? 0;
  const me = s.phase === 'gameover' ? finalResult(s).find((r) => r.seat === mySeat) : undefined;
  const dice = src.events[1]?.ev;
  const online =
    src.walls?.length && dice?.type === 'dealerDice'
      ? { by: ((dice.by - mySeat + 4) % 4) as Seat, dice: [dice.dice[0], dice.dice[1]] as [number, number], walls: src.walls.map(fillWall) }
      : undefined;
  // オンライン対局の種は「online」だけなので、局が多くなったときの山の種は始めた時刻で分ける
  const seed = src.mode === 'online' ? `online-${src.startedAt}` : src.seed;
  return { choice: cn ? { ...generalChoice(), cn, cnValues: { ...cnValues! } } : { base, values }, seed, strength: strengthOf(src.cpu), ...(me ? { result: { rank: me.rank, total: me.total } } : {}), ...(online ? { online } : {}) };
}
