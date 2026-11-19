// MOMO Life — 自由編集モードのランダム生成（セッション9）
// 種族ごとに、空いた 16×16 の場所へ形を 1 つ置き、その種族の盤全体の数が落ち着くまで待って、次の形を置く。
// 落ち着くまでの世代の数（増えたり減ったりしていた長さ）が長い形を 4 つ覚え、
// 「覚えた形 4 つ → でたらめな形 4 つ」の順に置き続ける。
// ここは数の判断だけ（画面と GPU には触らない）。乱数は呼ぶ側が渡す（0 以上 1 未満を返す関数）

import { STAMP, STAMP_WORDS } from './life-mother.js';

export const GEN = Object.freeze({
  SAME: 10,     // この世代数、数が同じなら落ち着いた
  PMAX: 5,      // 繰り返しの長さの上限（10 世代の中に 2 回あらわれる長さ）
  WAIT: 2,      // 繰り返しを見つけたあと、さらにこの回数くり返したら落ち着いた（合わせて 4 回）
  CAP: 10000,   // 落ち着かないまま、この世代数たったら打ち切って次へ（点はこの値。Q89=B）
  KEEP: 4,      // 覚える形の数
  ROUND: 8,     // 覚えた形 KEEP 個 → でたらめな形（ROUND − KEEP）個 の 1 巡
  RECHECK: 3,   // 覚えた形が、覚えた点より短く終わることがこの回数続いたら、点を覚え直す
});

// h：置いたあとの世代ごとの数（h[0] が置いた次の世代）。落ち着いたら { start, period }、まだなら null
//   start：落ち着いた動きが始まった世代（置いてから数えて）。これが点になる
//   period：1＝同じ数が続く、2〜5＝その長さで繰り返す、0＝打ち切り
export function steady(h) {
  const t = h.length;
  if (t >= GEN.SAME) {
    let same = true;
    for (let k = 1; k < GEN.SAME && same; k++) if (h[t - 1 - k] !== h[t - 1]) same = false;
    if (same) return { start: t - GEN.SAME, period: 1 };
  }
  for (let p = 2; p <= GEN.PMAX; p++) {
    const L = (2 + GEN.WAIT) * p;
    if (t < L) break;
    let rep = true, flat = true;
    for (let k = 0; k < L - p && rep; k++) if (h[t - 1 - k] !== h[t - 1 - k - p]) rep = false;
    if (!rep) continue;
    for (let k = 1; k < p && flat; k++) if (h[t - 1 - k] !== h[t - 1]) flat = false;
    if (flat) continue;   // ずっと同じ数は、同じ数が SAME 世代続くのを待つ
    // いちばん短い繰り返しの長さだけを採る（2 で繰り返すものは 4 でも繰り返す）
    let shorter = false;
    for (let q = 2; q < p && !shorter; q++) if (p % q === 0) {
      let ok = true;
      for (let k = 0; k < L - q && ok; k++) if (h[t - 1 - k] !== h[t - 1 - k - q]) ok = false;
      if (ok) shorter = true;
    }
    if (shorter) continue;
    return { start: t - L, period: p };
  }
  if (t >= GEN.CAP) return { start: GEN.CAP, period: 0 };
  return null;
}

// でたらめな形：16×16 全体を、密度 15〜50% で埋める
export function randomPattern(rnd) {
  const bits = new Uint32Array(STAMP_WORDS);
  const d = 0.15 + rnd() * 0.35;
  for (let b = 0; b < STAMP * STAMP; b++) if (rnd() < d) bits[b >>> 5] |= 1 << (b & 31);
  return bits;
}
const same = (a, b) => a.every((w, i) => w === b[i]);

// 覚えた形の一覧 best（点の大きい順。{ bits, score }）に、形と点を入れる。同じ形なら点の大きいほうを残す
export function keepBest(best, bits, score) {
  const i = best.findIndex(e => same(e.bits, bits));
  if (i >= 0) { if (score <= best[i].score) return best; best.splice(i, 1); }
  best.push({ bits: Uint32Array.from(bits), score, short: [] });
  best.sort((a, b) => b.score - a.score);
  if (best.length > GEN.KEEP) best.length = GEN.KEEP;
  return best;
}

// 置いた形の結果を覚える（セッション9の4回目）。cur は nextPattern の結果、st は steady の結果
//   打ち切り（10,000 世代たっても落ち着かない）も、点 10,000 として覚える（Q89=B）
//   覚えた形を置き直して、覚えた点より短く終わることが RECHECK 回続いたら、点の覚え違いの見込みとして、
//   その RECHECK 回の最長を点に覚え直して順位を並べ直す（順位が下がっても一覧からは外さない＝4 位にとどまる）。
//   覚えた点以上なら、続いた回数は 0 に戻し、点は大きいほうにする
export function recordResult(best, cur, st) {
  if (!st) return best;
  const score = st.start;
  const e = cur.from > 0 ? best.find(x => same(x.bits, cur.bits)) : null;
  if (!e) return keepBest(best, cur.bits, score);
  if (score < e.score) {
    e.short.push(score);
    if (e.short.length < GEN.RECHECK) return best;
    e.score = Math.max(...e.short);
    e.short = [];
  } else { e.score = score; e.short = []; }
  best.sort((a, b) => b.score - a.score);
  return best;
}

// 次に置く形（n は何番目に置くか。0 から数える）。1 巡の前半は覚えた形、後半はでたらめな形（覚えた形が足りなければ、でたらめな形）
export function nextPattern(best, n, rnd) {
  const k = n % GEN.ROUND;
  if (k < GEN.KEEP && k < best.length) return { bits: Uint32Array.from(best[k].bits), from: k + 1 };
  return { bits: randomPattern(rnd), from: 0 };
}

// 区画ごとの生き物の数（occ。一辺 tw×th）から、置き場所の区画を選ぶ。自分と周り 8 区画が空の区画を先に、無ければ自分が空の区画。
//   taken：ほかの種族がいま使っている区画の番号（選ばない）。無ければ -1
export function pickTile(occ, tw, th, wrap, rnd, taken = new Set()) {
  const free1 = [], free9 = [];
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const i = ty * tw + tx;
    if (occ[i] || taken.has(i)) continue;
    free1.push(i);
    let ok = true;
    for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) {
      let x = tx + dx, y = ty + dy;
      if (wrap) { x = (x + tw) % tw; y = (y + th) % th; }
      else if (x < 0 || y < 0 || x >= tw || y >= th) continue;
      const j = y * tw + x;
      if (occ[j] || taken.has(j)) ok = false;
    }
    if (ok) free9.push(i);
  }
  const list = free9.length ? free9 : free1;
  return list.length ? list[Math.floor(rnd() * list.length)] : -1;
}
