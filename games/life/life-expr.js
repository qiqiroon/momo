// MOMO Life — 自由編集モードの条件の式（利用者が書く文字）を、ルールの組（life-rules.js の形）に直す
// 書き方：
//   A・B・C …   種族（周り 8 マスにいるその種族の数）。A+B は合計
//   ?           すべての種族の数（生き物の数）
//   比べ方      =  !=  <  <=  >  >=（＝ ≠ ≦ ≧ も可）。数は 0〜8
//   つなぎ      AND（& かつ）・OR（| または）・かっこ
//   数字だけ    「3」「23」のように数字だけを書くと、自分の種族の数がそのどれか（Conway の書き方）
//   空          何も書かなければ、そのルールは成り立たない
// 結果は「OR でつないだ組（組の中は AND）」。組は 8 つ、組の中の条件は 8 つまで（ルールの表の大きさ）
import { MAX_GROUPS, MAX_CONDS, FULL, SET_MAX } from './life-rules.js';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWX';   // 24 種族まで（合計の条件が扱える数）
export const FREE_MAX = SET_MAX;

class ExprError extends Error {}
const err = msg => { throw new ExprError(msg); };

// ── 字句 ──
function lex(src) {
  const out = [];
  const s = src.normalize('NFKC');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < s.length && /[0-9]/.test(s[j])) j++; out.push({ k: 'num', v: s.slice(i, j) }); i = j; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '!=', '==', '&&', '||', '<>'].includes(two)) {
      out.push(two === '&&' ? { k: 'and' } : two === '||' ? { k: 'or' } : { k: 'op', v: two === '==' ? '=' : two === '<>' ? '!=' : two }); i += 2; continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i; while (j < s.length && /[a-zA-Z]/.test(s[j])) j++;
      const w = s.slice(i, j).toUpperCase();
      if (w === 'AND') out.push({ k: 'and' });
      else if (w === 'OR') out.push({ k: 'or' });
      else if (w.length === 1) out.push({ k: 'sp', v: w });
      else err(`「${s.slice(i, j)}」がわからない（種族は 1 文字）`);
      i = j; continue;
    }
    if (s.startsWith('かつ', i)) { out.push({ k: 'and' }); i += 2; continue; }
    if (s.startsWith('または', i)) { out.push({ k: 'or' }); i += 3; continue; }
    const one = { '(': { k: '(' }, ')': { k: ')' }, '+': { k: '+' }, '?': { k: '?' }, '&': { k: 'and' }, '|': { k: 'or' },
      '=': { k: 'op', v: '=' }, '<': { k: 'op', v: '<' }, '>': { k: 'op', v: '>' }, '≠': { k: 'op', v: '!=' }, '≦': { k: 'op', v: '<=' }, '≤': { k: 'op', v: '<=' }, '≧': { k: 'op', v: '>=' }, '≥': { k: 'op', v: '>=' } }[c];
    if (!one) err(`「${c}」は使えない`);
    out.push(one); i++;
  }
  return out;
}

// 比べ方と数 → 許す個数の印（0〜8 の 9 ビット）
function opMask(op, n) {
  let m = 0;
  for (let v = 0; v <= 8; v++) {
    const ok = op === '=' ? v === n : op === '!=' ? v !== n : op === '<' ? v < n : op === '<=' ? v <= n : op === '>' ? v > n : v >= n;
    if (ok) m |= 1 << v;
  }
  return m;
}
const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=', '!=': '!=' };

// 文字 → 組の並び。S は種族の数（使える文字は A〜S 番目）、me は自分の番号
// 返り値：[[条件…], …]（life-rules.js の形）。式が空なら []
export function parseRule(src, S, me) {
  const text = (src ?? '').trim();
  if (!text) return [];
  // 数字だけ：自分の種族の数
  if (/^[0-8]+$/.test(text.normalize('NFKC'))) {
    let m = 0; for (const d of text.normalize('NFKC')) m |= 1 << Number(d);
    return [[{ t: 'species', id: me, m }]];
  }
  const tk = lex(text);
  let p = 0;
  const peek = () => tk[p], eat = k => (tk[p] && tk[p].k === k ? tk[p++] : null);

  // 合計：A+B+…、または ?。返り値は { t, id|set }
  function sum() {
    if (eat('?')) { if (peek()?.k === '+') err('? はほかの種族と足せない（? はすべての種族の数）'); return { t: 'alive' }; }
    let bits = 0;
    do {
      const a = eat('sp');
      if (!a) err('種族の文字（A・B …）か ? が要る');
      const id = LETTERS.indexOf(a.v) + 1;
      if (id < 1 || id > S) err(`種族 ${a.v} はいない（いまは ${LETTERS[0]}〜${LETTERS[S - 1]}）`);
      bits |= 1 << (id - 1);
    } while (eat('+'));
    const ids = [...Array(S).keys()].filter(i => (bits >>> i) & 1);
    return ids.length === 1 ? { t: 'species', id: ids[0] + 1 } : { t: 'set', set: bits >>> 0 };
  }
  function num() {
    const n = eat('num'); if (!n) err('0〜8 の数が要る');
    const v = Number(n.v); if (v > 8) err(`数は 0〜8（${n.v}）`);
    return v;
  }
  // 比べる式 1 つ → DNF（組の並び）
  function cmp() {
    let tgt, op, n;
    if (peek()?.k === 'num') { n = num(); const o = eat('op'); if (!o) err('比べ方（= < > など）が要る'); op = FLIP[o.v]; tgt = sum(); }
    else { tgt = sum(); const o = eat('op'); if (!o) err('比べ方（= < > など）が要る'); op = o.v; n = num(); }
    return [[{ ...tgt, m: opMask(op, n) }]];
  }
  function factor() {
    if (eat('(')) { const d = expr(); if (!eat(')')) err('かっこが閉じていない'); return d; }
    return cmp();
  }
  function term() {
    let d = factor();
    while (eat('and')) {
      const e = factor();
      const out = [];
      for (const g of d) for (const h of e) out.push([...g, ...h]);
      d = out;
    }
    return d;
  }
  function expr() {
    let d = term();
    while (eat('or')) d = d.concat(term());
    return d;
  }
  const d = expr();
  if (p < tk.length) err('式の終わりに余分な文字がある');
  // 組の中で同じ対象の条件は 1 つにまとめる（印の AND）。成り立たない組（印が 0）は捨てる
  const key = c => c.t + ':' + (c.id ?? c.set ?? '');
  const groups = [];
  for (const g of d) {
    const map = new Map();
    for (const c of g) { const k = key(c); map.set(k, map.has(k) ? { ...c, m: map.get(k).m & c.m } : c); }
    const conds = [...map.values()];
    if (conds.some(c => c.m === 0)) continue;
    const real = conds.filter(c => c.m !== FULL);
    if (!real.length) return [[]];   // いつでも成り立つ
    groups.push(real);
  }
  if (groups.length > MAX_GROUPS) err(`OR でつないだまとまりが多すぎる（${groups.length}。${MAX_GROUPS} まで）`);
  for (const g of groups) if (g.length > MAX_CONDS) err(`AND でつないだ条件が多すぎる（${g.length}。${MAX_CONDS} まで）`);
  return groups;
}

// 書いた式を確かめる（画面の入力欄用）。{ ok, groups } か { ok:false, msg }
export function checkRule(src, S, me) {
  try { return { ok: true, groups: parseRule(src, S, me) }; }
  catch (e) { if (e instanceof ExprError) return { ok: false, msg: e.message }; throw e; }
}

// 食べる相手の欄（セッション9）：種族の文字を並べる。「AB」＝A と B、「A-C」＝A・B・C、「?」＝自分以外のだれでも。
//   空白・読点・カンマは読み飛ばす。自分の文字を書いても、自分は食べない。空なら食べない
//   { ok, set }（set は種族の印。第 s-1 ビット＝種族 s）か { ok:false, msg }
export function checkTargets(src, S, me) {
  const s = (src ?? '').normalize('NFKC').toUpperCase().replace(/[\s,、，]/g, '');
  const all = ((S >= 32 ? 0xffffffff : (1 << S) - 1) >>> 0);
  const idx = ch => { if (!ch) return 0; const k = LETTERS.indexOf(ch); return k >= 0 && k < S ? k + 1 : 0; };
  let set = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '?' || ch === '？') { set = all; continue; }
    const a = idx(ch);
    if (!a) return { ok: false, msg: LETTERS.includes(ch) ? `${ch} の種族はまだ無い` : `「${ch}」は使えない（種族の文字・-・? だけ）` };
    if (s[i + 1] === '-' || s[i + 1] === '－' || s[i + 1] === '〜' || s[i + 1] === '~') {
      const b = idx(s[i + 2] ?? '');
      if (!b) return { ok: false, msg: '「-」の後ろに種族の文字が要る' };
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) set |= 1 << (k - 1);
      i += 2; continue;
    }
    set |= 1 << (a - 1);
  }
  set &= ~(1 << (me - 1));
  return { ok: true, set: set >>> 0 };
}
