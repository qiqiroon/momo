// MOMO Life — マザーの学習（詳細仕様書 §18 の④）：置き形を試して、支配領域の中で増えた自分の数で採点し、良い形に入れ替える
//
// 学習の状態はマザーごとに LS 語の整数の並び（下の O の位置）。GPU は同じ並びを GPU の中に持ち、
// 毎世代「供給 → 数える → 判断」を GPU の中で行う（読み戻しを待たない）。CPU の手本はこのファイルの関数で同じ判断をする。
// 置き場所はマザーの種族の番号 −1（連鎖の世界は 1 種族に 1 マザー）。
//
// 1世代の順番：盤（世代 g）→ 供給（領域の中を消す・押す世代なら置き形を押す）→ 数える → 判断 → 計算（世代 g+1 へ）
import { rand, SALT } from './life-rand.js';

export const LEARN = Object.freeze({
  L: 1000,          // 1回の試しの長さ（世代）。押した世代から数えて L 世代目の数え上げで終わる（Q60=B。前は 300）
  C: 20,            // 数え上げの間隔（世代）
  REACH: 3,         // 数える範囲の半分の幅＝支配領域の半分の幅 × REACH（Q62=A。出ていったグライダーも数える。支配領域そのものは広げない）
  ZERO_STOP: 3,     // 候補の回で、自分の数 0 の数え上げがこの回数続いたら打ち切り（Q32=A）
  LOSE_STOP: 200,   // 候補がこの回数続けて負けたら学習を終えて固定（Q30=A。毎回候補にしたので Q63=A で 20→200）
  EXPLORE: 4,       // 最初のこの回数は、毎回でたらめな候補を試す（広く探す）
  CAND_EVERY: 1,    // 候補を試す間隔（回）。1 なら毎回（Q61=A。前は 10 回に 1 回）。一番の形の点は、覚えている点で比べる
  RESTART_EVERY: 5, // 候補の 5 回に 1 回は、でたらめな形から始め直す（ほかは一番の形の 1〜3 マスを反転）
  RING: 9,          // 一番の形の点を覚える数（Q31=A。この平均と比べる）
  CONFIRM: 3,       // 候補が勝ったら、合わせてこの回数試し、その平均でも勝てば入れ替える（Q46=A）
});
export const LS = 48;   // 1 マザーの語数
export const O = Object.freeze({
  EP0: 0,    // いまの回を始めた世代（この世代に置き形を押す）
  EPN: 1,    // 終えた回の数
  SCORE: 2,  // いまの回の点（i32）
  BASE: 3,   // 押した直後の数
  ZERO: 4,   // 0 の数え上げが続いた数
  LOSS: 5,   // 候補が続けて負けた数
  FIXED: 6,  // 1 なら学習を終えた
  RN: 7,     // 覚えている一番の形の点の数（最大 RING）
  RPOS: 8,   // 次に書く場所
  RING: 9,   // 一番の形の点 9 個（i32）
  MODE: 18,  // いまの回：0＝一番の形、1＝候補（1 回目）、2＝勝った候補の確かめ（Q46=A）
  TRIES: 19, // 作った候補の数（乱数の番号に使う）
  WINS: 20,  // 候補が勝った数
  LAST: 21,  // 前の回の点（i32。画面に出す用）
  CN: 22,    // 確かめ中の候補を試した回数
  CS: 40,    // 確かめ中の候補の点（CONFIRM 個。i32）
  BEST: 24,  // 一番の形（8 語）
  CAND: 32,  // 候補（8 語）
});

// 学習の状態を作る（マザーを足したとき）。stamp は最初の一番の形
export function learnInit(st, slot, t0, stamp) {
  const o = slot * LS;
  st.fill(0, o, o + LS);
  st[o + O.EP0] = t0 >>> 0;
  for (let w = 0; w < 8; w++) st[o + O.BEST + w] = stamp[w] >>> 0;
}

// 世代 gen に押す置き形（押さない世代は null）
export function learnStamp(st, slot, gen) {
  const o = slot * LS;
  if (st[o + O.EP0] !== (gen >>> 0)) return null;
  const b = o + (st[o + O.MODE] ? O.CAND : O.BEST);
  return st.subarray(b, b + 8);
}

// 支配領域の中の、種族 kind の数（端をつなぐ盤で領域が盤より大きくても、1 マスは 1 回だけ数える）
//   r2 を渡すと、縦横 half マスの正方形のうち、中心からの距離の2乗が r2 以下のマスだけ数える（円の支配領域。Q74）。学習の数える範囲は正方形のまま
export function countDomain(W, H, cells, cx, cy, half, kind, wrap, r2 = 0) {
  let n = 0;
  for (let oy = -half; oy <= half; oy++) {
    let y = cy + oy;
    if (wrap) { y = ((y % H) + H) % H; if (norm(y - cy, H) !== oy) continue; }
    else if (y < 0 || y >= H) continue;
    for (let ox = -half; ox <= half; ox++) {
      let x = cx + ox;
      if (wrap) { x = ((x % W) + W) % W; if (norm(x - cx, W) !== ox) continue; }
      else if (x < 0 || x >= W) continue;
      if (r2 && ox * ox + oy * oy > r2) continue;
      if (cells[y * W + x] === kind) n++;
    }
  }
  return n;
}
// 端をつなぐ盤のずれを −n/2〜n/2 にそろえる（inSquare と同じ式）
function norm(d, n) { d = ((d % n) + n) % n; if (2 * d > n) d -= n; return d; }

// この世代に数えるか（押した世代と、そこから C 世代ごと）
export function learnSamples(st, slot, gen) {
  const d = ((gen >>> 0) - st[slot * LS + O.EP0]) | 0;
  return d >= 0 && d % LEARN.C === 0;
}

// 判断（毎世代、数えたあと）。cnt はこの世代の領域の中の自分の数。seed・kind は候補の乱数に使う
export function learnUpdate(st, slot, cnt, gen, seed, kind) {
  const o = slot * LS;
  const d = ((gen >>> 0) - st[o + O.EP0]) | 0;
  if (d < 0 || d % LEARN.C !== 0) return;
  if (d === 0) { st[o + O.BASE] = cnt; st[o + O.SCORE] = 0; st[o + O.ZERO] = 0; return; }
  // 点（Q57=C）：数え上げごとに「増えた分 max(0, 数 − 押した直後の数)」と「いた数」を足す（減った分は引かない）
  const score = ((st[o + O.SCORE] | 0) + Math.max(0, cnt - st[o + O.BASE]) + cnt) | 0;
  st[o + O.SCORE] = score >>> 0;
  st[o + O.ZERO] = cnt === 0 ? st[o + O.ZERO] + 1 : 0;
  const mode = st[o + O.MODE];
  if (!(d >= LEARN.L || (mode !== 0 && st[o + O.ZERO] >= LEARN.ZERO_STOP))) return;
  // 回の終わり
  const rn = st[o + O.RN];
  let confirm = false;   // 次の回も同じ候補で確かめる
  if (mode !== 0) {
    let sum = 0;
    for (let j = 0; j < rn; j++) sum = (sum + (st[o + O.RING + j] | 0)) | 0;
    const cn = mode === 1 ? 0 : st[o + O.CN];
    st[o + O.CS + cn] = score >>> 0; st[o + O.CN] = cn + 1;
    let csum = 0;
    for (let j = 0; j <= cn; j++) csum = (csum + (st[o + O.CS + j] | 0)) | 0;
    // 候補の点の平均 ＞ 一番の形の点の平均（どちらも掛け算で比べる）
    const win = rn === 0 || Math.imul(csum, rn) > Math.imul(sum, cn + 1);
    if (win && cn + 1 < LEARN.CONFIRM) confirm = true;
    else if (win) {
      for (let w = 0; w < 8; w++) st[o + O.BEST + w] = st[o + O.CAND + w];
      for (let j = 0; j < LEARN.CONFIRM; j++) st[o + O.RING + j] = st[o + O.CS + j];
      st[o + O.RN] = LEARN.CONFIRM; st[o + O.RPOS] = LEARN.CONFIRM % LEARN.RING;
      st[o + O.LOSS] = 0; st[o + O.WINS]++;
    } else if (sum !== 0 && ++st[o + O.LOSS] >= LEARN.LOSE_STOP) st[o + O.FIXED] = 1;   // 一番の形が 0 点のあいだの負けは数えない
  } else {
    st[o + O.RING + st[o + O.RPOS]] = score >>> 0;
    st[o + O.RPOS] = (st[o + O.RPOS] + 1) % LEARN.RING;
    st[o + O.RN] = Math.min(rn + 1, LEARN.RING);
  }
  st[o + O.LAST] = score >>> 0;
  const n = ++st[o + O.EPN];
  st[o + O.EP0] = ((gen >>> 0) + 1) >>> 0;
  if (confirm) { st[o + O.MODE] = 2; return; }
  // 一番の形がまだ一度も増えていない（覚えた点がすべて 0）あいだは、毎回でたらめな新しい形を試す（しつくす探し方）
  let rs = 0;
  for (let j = 0; j < st[o + O.RN]; j++) rs = (rs + (st[o + O.RING + j] | 0)) | 0;
  const zero = rs === 0;
  const cand = !st[o + O.FIXED] && (zero || n <= LEARN.EXPLORE || n % LEARN.CAND_EVERY === LEARN.CAND_EVERY - 1);
  st[o + O.MODE] = cand ? 1 : 0;
  if (cand) makeCand(st, o, n, seed, kind, zero);
}

// 候補を作る。乱数は rand(種, 種族, 候補の番号×1000＋j, LEARN)
//   でたらめな形：一辺 4〜16 の正方形（置き形の中央）の中を、密度 10〜60% で埋める
function makeCand(st, o, n, seed, kind, zero) {
  const t = st[o + O.TRIES]++;
  const r = j => rand(seed, kind, t * 1000 + j, SALT.LEARN);
  if (zero || n <= LEARN.EXPLORE || t % LEARN.RESTART_EVERY === LEARN.RESTART_EVERY - 1) {
    const sz = 4 + r(0) % 13, pct = 10 + r(1) % 51, off = 8 - (sz >>> 1);
    const thr = (pct * 42949672 + Math.floor(pct * 96 / 100)) >>> 0;   // floor(pct × 2^32 ÷ 100)
    for (let w = 0; w < 8; w++) st[o + O.CAND + w] = 0;
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const b = (off + y) * 16 + off + x;
      if (r(2 + y * 16 + x) < thr) st[o + O.CAND + (b >>> 5)] |= 1 << (b & 31);
    }
  } else {
    for (let w = 0; w < 8; w++) st[o + O.CAND + w] = st[o + O.BEST + w];
    const k = 1 + r(0) % 3;
    for (let j = 0; j < k; j++) { const b = r(1 + j) % 256; st[o + O.CAND + (b >>> 5)] ^= 1 << (b & 31); }
  }
}

// CPU の手本：供給のあとに呼ぶ。list は MotherSet.supplies() の結果（learn を持つマザーだけ扱う）
export function learnCPU(W, H, cells, list, wrap, st, seed, gen) {
  for (const m of list) {
    if (m.learn == null || !learnSamples(st, m.learn, gen)) continue;
    learnUpdate(st, m.learn, countDomain(W, H, cells, m.cx, m.cy, m.lh ?? countHalf(m.half), m.kind, wrap), gen, seed, m.kind);
  }
}

// 数える範囲の半分の幅（Q62=A）
export const countHalf = half => half * LEARN.REACH;

// GPU に渡す形（1世代分）：学習するマザーごとに4語 [置き場所 | 種族<<8, cx | cy<<16, 数える範囲の半分の幅, 0]
export function packLearn(list) {
  const ls = list.filter(m => m.learn != null);
  const a = new Uint32Array(ls.length * 4);
  let maxHalf = 0;
  ls.forEach((m, j) => { const h = m.lh ?? countHalf(m.half); a[j * 4] = m.learn | (m.kind << 8); a[j * 4 + 1] = m.cx | (m.cy << 16); a[j * 4 + 2] = h; maxHalf = Math.max(maxHalf, h); });
  return { n: ls.length, words: a, maxHalf };
}

// GPU の WGSL（数える段・判断の段）。L は学習の状態（read_write）、CNT は数（atomic）
export const LEARN_WGSL_CONSTS = `
const LS = ${LS}u;
const L_EP0 = ${O.EP0}u; const L_EPN = ${O.EPN}u; const L_SCORE = ${O.SCORE}u; const L_BASE = ${O.BASE}u;
const L_ZERO = ${O.ZERO}u; const L_LOSS = ${O.LOSS}u; const L_FIXED = ${O.FIXED}u; const L_RN = ${O.RN}u;
const L_RPOS = ${O.RPOS}u; const L_RING = ${O.RING}u; const L_MODE = ${O.MODE}u; const L_TRIES = ${O.TRIES}u;
const L_WINS = ${O.WINS}u; const L_LAST = ${O.LAST}u; const L_BEST = ${O.BEST}u; const L_CAND = ${O.CAND}u;
const L_CN = ${O.CN}u; const L_CS = ${O.CS}u; const CONFIRM = ${LEARN.CONFIRM}u;
const LC = ${LEARN.C}; const LL = ${LEARN.L}; const ZERO_STOP = ${LEARN.ZERO_STOP}u; const LOSE_STOP = ${LEARN.LOSE_STOP}u;
const EXPLORE = ${LEARN.EXPLORE}u; const CAND_EVERY = ${LEARN.CAND_EVERY}u; const RESTART_EVERY = ${LEARN.RESTART_EVERY}u; const RING_N = ${LEARN.RING}u;
const SALT_LEARN = ${SALT.LEARN}u;
`;
