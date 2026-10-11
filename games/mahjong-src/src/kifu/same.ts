// 同じ山で勝負（段階6の6e・Q45＝A）：ルールと山の種をリンクで渡し、受け取った人が同じ配牌・ツモで CPU と打つ。
// 鳴けばツモの順がずれる（ふつうの麻雀のまま）。送った人の成績（終わった対局なら順位と最終得点）も入れて、比べられるようにする。
// リンクの中身は JSON を URL に使える base64 にしたもの：{v, b＝基にしたセット, a＝ルールの全項目の値, s＝種, y＝送った人の成績, c＝CPU の強さ}
// CPU の強さ（段階7・Q4=A）：受け取った人は送った人と同じ強さで打つ（変えられない）。c が無い古いリンクは Hard
// ルールは全項目の値をそのまま書く（あとでセットの値が変わっても、送った人と同じルールで打てる）

import { strengthOf, type Strength } from '../cpu/strength';
import { decodeRuleValues, encodeRuleValues, JP_SETS, type RuleChoice, type SetId } from '../engine/ruleSets';

export const SAME_LINK_VERSION = 1;

export interface SameWall {
  choice: RuleChoice;
  seed: string;
  /** CPU の強さ */
  strength: Strength;
  /** 送った人の成績（終わった対局のとき） */
  result?: { rank: number; total: number };
}

const toB64url = (text: string) =>
  btoa(Array.from(new TextEncoder().encode(text), (x) => String.fromCharCode(x)).join(''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
function fromB64url(s: string): string {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSameLink(w: SameWall): string {
  const o: { v: number; b: string; a: string; s: string; c: Strength; y?: [number, number] } = { v: SAME_LINK_VERSION, b: w.choice.base, a: encodeRuleValues(w.choice.values), s: w.seed, c: w.strength };
  if (w.result) o.y = [w.result.rank, w.result.total];
  return toB64url(JSON.stringify(o));
}

/** 読めなければ null */
export function decodeSameLink(code: string): SameWall | null {
  try {
    const o = JSON.parse(fromB64url(code)) as { v?: unknown; b?: unknown; a?: unknown; s?: unknown; c?: unknown; y?: unknown };
    if (o.v !== SAME_LINK_VERSION || typeof o.a !== 'string' || typeof o.s !== 'string' || !o.s) return null;
    const values = decodeRuleValues(o.a);
    if (!values) return null;
    const base: SetId = typeof o.b === 'string' && (JP_SETS as readonly string[]).includes(o.b) ? (o.b as SetId) : 'general';
    const choice: RuleChoice = { base, values };
    const y = Array.isArray(o.y) && o.y.length === 2 && o.y.every((n) => typeof n === 'number' && Number.isFinite(n)) ? { rank: o.y[0] as number, total: o.y[1] as number } : undefined;
    return { choice, seed: o.s, strength: strengthOf(o.c), ...(y ? { result: y } : {}) };
  } catch {
    return null;
  }
}
