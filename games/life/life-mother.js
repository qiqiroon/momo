// MOMO Life — マザー（詳細仕様書 §7、定義書 §6、技術書 §7）
// マザーの動き（位置・向き・供給するかどうか）は CPU が決める。供給そのもの（どのマスに置くか）は、
// GPU の供給の段と、ここの supplyCPU（手本）が、同じ乱数・同じ手順で決める。
//
// 順番（技術書 §7.2 の推奨）：世代 t の盤 → 世代 t の供給 → 供給後の盤から世代 t+1 を計算 → マザーを世代 t+1 の位置へ動かす
import { rand, SALT, probToThreshold } from './life-rand.js';
import { STRIDE, PICK, MAX_SPECIES } from './life-rules.js';
import { LS, O as LO, learnInit, learnStamp, countDomain, countHalf } from './life-learn.js';

export const TILE = 16;                     // GPU の供給の区画（16×16 マス）。life-gpu.js の区画と同じ
export const MODE = Object.freeze({ EMPTY: 0, OVERWRITE: 1 });  // 空のマスにだけ置く（最初の値）／上書きしてよい
const MODE_NAMES = { empty: MODE.EMPTY, overwrite: MODE.OVERWRITE };
const TWO_PI = Math.PI * 2;
const U32 = 4294967296;

// マザー1つの最初の値（定義書 §6.2 の推奨。速さ・向きを変える間隔・供給の間隔は、動かしながら直す出発点）
export const MOTHER_DEFAULTS = Object.freeze({
  diameter: 10,    // 供給の円の直径（マス）
  speed: 0.25,     // 1世代に進むマス
  turnEvery: 0,    // 向きを変える間隔（世代）。0 なら変えない（travel のときは使わない）
  travel: true,    // 長い距離を旅する（セッション9）：向きを乱数で決め、TRAVEL_MIN〜盤の短い辺の 1/3 マス進んだら向きを変える
  interval: 1,     // 供給の間隔（世代）。1 なら毎世代
  active: true,    // 稼働（false＝休止。動きも供給も止まる）
  domain: 0,       // 支配領域の一辺（マス。§18 の②）。0 なら持たない。中心から縦横に floor(domain/2) マスの正方形
  stamp: null,     // 置き形（§18 の③）。16×16 の 256 ビット＝u32 8 語。持てば、円のばらまきの代わりに置き形を押す
  stampEvery: 300, // 置き形を押す間隔（世代）。t0 から数える
  t0: 0,           // マザーが足された世代（置き形を押す世代の起点）
  learn: false,    // 学習する（§18 の④。置き形と、支配領域か learnHalf が要る）。押す世代と形は学習の状態が決める
  learnHalf: 0,    // 学習で数える範囲の半分の幅（マス）。0 なら支配領域の半分の幅 × REACH（4種族の世界は支配領域なしで 150。セッション9）
  space: 0,        // ぶつかりを避ける円の一辺（マス。支配領域と同じ大きさの見えない円）。0 なら支配領域を使う（4種族の世界は 100）
});
// 学習の状態を持てるマザーの数（置き場所＝マザーの番号。連鎖の世界は種族の番号 −1 と同じ）
export const MAX_LEARN = 64;

// 置き形（§18 の③）：16×16 マス。ビット b＝(dy+8)*16+(dx+8) が 1 のマスに自分の種族、0 のマスは何もしない（Q58=A。dx,dy は中心からのずれ −8〜7）
// 旅の 1 区間の長さの下限（マス）。上限は盤の短い辺の 1/3（それが下限より短ければ下限）
export const TRAVEL_MIN = 100;

export const STAMP = 16, STAMP_WORDS = 8;
export const stampBit = (stamp, b) => (stamp[b >>> 5] >>> (b & 31)) & 1;
// マス (x,y) が中心 (cx,cy) の置き形の範囲に入れば、そのビットの番号。入らなければ −1（GPU と同じ整数の式）
export function inStamp(x, y, cx, cy, W, H, wrap) {
  let dx = x - cx, dy = y - cy;
  if (wrap) {
    dx = ((dx % W) + W) % W; if (2 * dx > W) dx -= W;
    dy = ((dy % H) + H) % H; if (2 * dy > H) dy -= H;
  }
  return (dx >= -8 && dx <= 7 && dy >= -8 && dy <= 7) ? (dy + 8) * 16 + (dx + 8) : -1;
}

// 密度の最初の値（§7.4）：その種族の「生存」で、自分の数として許す個数の平均 ÷ 9
export function defaultDensity(sp) {
  for (const g of sp.survive ?? []) for (const c of g) {
    if (c.t !== 'self') continue;
    let n = 0, sum = 0;
    for (let k = 0; k <= 8; k++) if ((c.m >>> k) & 1) { n++; sum += k; }
    if (n) return sum / n / 9;
  }
  return 0.278;
}

// 世界のデータの mothers から、マザーの一覧を作る（位置・向きが無ければ種から決める）
//   mothers: { count: n, ...共通の値 }  → 種族を順番に回して n 個（1,2,…,S,1,2,…）
//   mothers: [{ kind, x, y, ... }, …]   → そのまま（足りない値は最初の値）
export function planMothers(world, W, H, seed) {
  const m = world.mothers;
  if (!m) return [];
  let list;
  if (Array.isArray(m)) list = m.map(o => ({ ...o }));
  else {
    const { count = 0, ...each } = m;
    list = Array.from({ length: count }, (_, j) => ({ ...each, kind: world.species[j % world.species.length].id }));
  }
  return list.map((o, j) => {
    const sp = world.species[o.kind - 1];
    if (!sp) throw new Error(`マザー ${j + 1}：存在しない種族 ${o.kind}`);
    return {
      ...MOTHER_DEFAULTS,
      density: defaultDensity(sp),
      ...o,
      x: o.x ?? rand(seed, 0, j, SALT.MOTHER_PLACE) / U32 * W,
      y: o.y ?? rand(seed, 1, j, SALT.MOTHER_PLACE) / U32 * H,
      dir: o.dir ?? rand(seed, 0, j, SALT.MOTHER_MOVE) / U32 * TWO_PI,
      // 学習するのに置き形が無ければ、でたらめな最初の形（密度 30%。rand(種, 2, 番号×256＋ビット, MOTHER_PLACE)）
      stamp: o.stamp ?? (o.learn ? firstStamp(seed, j) : null),
    };
  });
}

function firstStamp(seed, j) {
  const st = new Uint32Array(STAMP_WORDS), thr = probToThreshold(0.3);
  for (let b = 0; b < STAMP * STAMP; b++) if (rand(seed, 2, j * 256 + b, SALT.MOTHER_PLACE) < thr) st[b >>> 5] |= 1 << (b & 31);
  return st;
}

// 動いているマザーの集まり。GPU 版と CPU の手本は、同じ一覧からそれぞれ1つ作って同じように進める
export class MotherSet {
  // list: planMothers の結果。mode: 'empty' | 'overwrite'
  constructor(list, W, H, wrap, seed, mode = 'empty') {
    if (!(mode in MODE_NAMES)) throw new Error('マザーの置き方が不明: ' + mode);
    this.ms = list.map(o => ({ ...o }));
    this.W = W; this.H = H; this.wrap = wrap; this.seed = seed >>> 0;
    this.mode = MODE_NAMES[mode];
    this.gen = 0;
    this.log = [];   // 供給の記録 [世代, 供給したマザーの数]（定義書 §6.3。直近だけ持つ）
    this.learn = new Uint32Array(MAX_LEARN * LS);     // 学習の状態（置き場所＝マザーの番号。§18 の④）
    this.learnNew = [];                               // 作ったばかりで GPU にまだ送っていない置き場所
    // 利用者の操作（セッション10）：off＝マザーを消す（動きも供給も止める）、noDomain＝支配領域で他の種族を消さない、
    //   frozen＝置き形の学習（組み換え）を止める（新しく学び始めるマザーも固定から始める）
    this.off = false; this.noDomain = false; this.frozen = false;
    this.ms.forEach((m, j) => { m.slot = j; this.initLearn(m); });
  }

  // マザーを足す（連鎖の世界で種族が増えたとき。§18）。番号は足した順に続く
  add(list) { for (const o of list) { const m = { ...o, slot: this.ms.length }; this.ms.push(m); this.initLearn(m); } }
  // 種族 kind のマザーの学習を最初からやり直す（ルールを引き直したとき。Q49）
  relearn(kind, stamp, t0) {
    const m = this.ms.find(o => o.kind === kind);
    if (!m) return;
    m.stamp = stamp; m.t0 = t0;
    this.initLearn(m);
  }
  initLearn(m) {
    if (!m.learn) return;
    if (!m.stamp || !(m.domain > 0 || m.learnHalf > 0)) throw new Error('学習するマザーには置き形と、支配領域か数える範囲が要る');
    if (m.slot >= MAX_LEARN) throw new Error(`学習するマザーは ${MAX_LEARN} 個まで`);
    learnInit(this.learn, m.slot, m.t0, m.stamp);
    if (this.frozen) this.learn[m.slot * LS + LO.FIXED] = 1;
    this.learnNew.push(m.slot);
  }
  // 保存したマザーの値を、いまのマザー m に入れる（セッション10）。学習の状態は、世代 gen から一番の形で新しい回を始める
  //   saved: { x, y, dir, leg, learn（LS 語） }。盤の大きさが違えば、位置は割合で合わせる（sW・sH は保存したときの盤）
  applySaved(m, saved, gen, sW = this.W, sH = this.H) {
    m.x = (saved.x / sW) * this.W; m.y = (saved.y / sH) * this.H;
    if (saved.dir != null) m.dir = saved.dir;
    m.leg = saved.leg ?? 0;
    if (!m.learn || !saved.learn) return;
    const o = m.slot * LS;
    this.learn.set(Uint32Array.from(saved.learn).subarray(0, LS), o);
    this.learn[o + LO.EP0] = gen >>> 0; this.learn[o + LO.MODE] = 0; this.learn[o + LO.CN] = 0;
    this.learn[o + LO.SCORE] = 0; this.learn[o + LO.ZERO] = 0;
    if (this.frozen) this.learn[o + LO.FIXED] = 1;
    m.stamp = this.learn.slice(o + LO.BEST, o + LO.BEST + STAMP_WORDS); m.t0 = gen;
    this.learnNew.push(m.slot);
  }

  // 支配領域の中の自分の種族の数（Q68=A。引き直した種族が領域を埋められるかの見極めに使う）。並びの番号は種族−1、領域が無ければ 0
  domainCounts(cells) {
    const c = new Uint32Array(MAX_SPECIES);
    if (!this.off && !this.noDomain) for (const m of this.ms) if (m.active && m.domain > 0)
    { const h = Math.floor(m.domain / 2); c[m.kind - 1] = countDomain(this.W, this.H, cells, cell(m.x, this.W), cell(m.y, this.H), domR(h), m.kind, this.wrap, domR2(h)); }
    return c;
  }
  // GPU に渡す支配領域の表：種族ごとに [中心 x, 中心 y, 円の半径の2乗＋1]（0 なら領域なし。Q74 で円に）
  domainTable() {
    const d = new Uint32Array(MAX_SPECIES * 3);
    if (!this.off && !this.noDomain) for (const m of this.ms) if (m.active && m.domain > 0) {
      const o = (m.kind - 1) * 3;
      d[o] = cell(m.x, this.W); d[o + 1] = cell(m.y, this.H); d[o + 2] = domR2(Math.floor(m.domain / 2)) + 1;
    }
    return d;
  }

  // いまの世代に供給の段で扱うマザーの一覧 [{ cx, cy, r2, kind, thr, half, stamp }]
  //   cx,cy は中心のマス、r2 は半径の2乗、half は支配領域の半分の幅（0 なら持たない）
  //   stamp は、この世代に押す置き形（押さない世代は null）。置き形を持つマザーは円のばらまきをしない
  //   支配領域を持つマザーは、供給しない世代も一覧に入る（thr＝0。領域の中を消す働きは毎世代）
  supplies() {
    const g = this.gen, out = [];
    let n = 0;
    if (this.off) return out;
    for (const m of this.ms) {
      if (!m.active) continue;
      const dh = m.domain > 0 ? Math.floor(m.domain / 2) : 0;   // 支配領域の半分の幅（学習で数える範囲はこれから決める）
      const half = this.noDomain ? 0 : dh;                       // 領域の中を消す働き（止めたら 0）
      const lrn = m.learn ? m.slot : null;
      const st = m.stamp && lrn == null ? (g >= m.t0 && (g - m.t0) % Math.max(1, Math.floor(m.stampEvery)) === 0) : false;
      const feed = !m.stamp && m.density > 0 && m.diameter > 0 && g % Math.max(1, Math.floor(m.interval)) === 0;
      if (!feed && !st && !half && lrn == null) continue;
      if (feed || st) n++;
      out.push({
        cx: cell(m.x, this.W), cy: cell(m.y, this.H),
        r2: feed ? Math.floor(m.diameter * m.diameter / 4) : 0,
        kind: m.kind, thr: feed ? probToThreshold(m.density) : 0, half,
        stamp: st ? m.stamp : null, learn: lrn, lh: m.learnHalf > 0 ? m.learnHalf : countHalf(dh),
      });
    }
    if (n) { this.log.push([g, n]); if (this.log.length > 256) this.log.shift(); }
    return out;
  }

  // 次の世代へ動かす（ランダムウォーク。§7.2）
  //   支配領域を持つマザーは、ほかのマザーの領域と重なったまま近づく動きをしない（§18.3 の Q28。7回目に作った）。
  //   そのときはその世代は動かず、向きだけ rand(種, 世代, 256＋番号, MOTHER_MOVE) で変える。番号の順に決める（前のマザーは動いたあとの場所）
  //   travel のマザー（セッション9）：区間の残り（leg）が無くなったら、向き rand(種, 世代, 512＋番号) と長さ rand(種, 世代, 768＋番号) を引き直す。
  //   ほかの領域とぶつかりそうなときも、その場で引き直す（その世代は動かない）
  newLeg(m, g, j) {
    m.dir = rand(this.seed, g, 512 + j, SALT.MOTHER_MOVE) / U32 * TWO_PI;
    const max = Math.max(TRAVEL_MIN, Math.floor(Math.min(this.W, this.H) / 3));
    m.leg = TRAVEL_MIN + rand(this.seed, g, 768 + j, SALT.MOTHER_MOVE) % (max - TRAVEL_MIN + 1);
  }
  advance() {
    const g = ++this.gen;
    if (this.off) return;   // マザーを消しているあいだは動かない（世代だけ進める）
    this.ms.forEach((m, j) => {
      if (!m.active) return;
      if (m.travel) { if (!(m.leg > 0)) this.newLeg(m, g, j); }
      else if (m.turnEvery > 0 && g % m.turnEvery === 0) m.dir = rand(this.seed, g, j, SALT.MOTHER_MOVE) / U32 * TWO_PI;
      let x = m.x + Math.cos(m.dir) * m.speed, y = m.y + Math.sin(m.dir) * m.speed, dir = m.dir;
      if (this.wrap) { x = wrapF(x, this.W); y = wrapF(y, this.H); }
      else {
        // 盤の端ではね返る
        if (x < 0) { x = -x; dir = Math.PI - dir; }
        if (x >= this.W) { x = 2 * this.W - x - 1e-9; dir = Math.PI - dir; }
        if (y < 0) { y = -y; dir = -dir; }
        if (y >= this.H) { y = 2 * this.H - y - 1e-9; dir = -dir; }
        x = Math.min(this.W - 1e-9, Math.max(0, x)); y = Math.min(this.H - 1e-9, Math.max(0, y));
      }
      if ((m.domain > 0 || m.space > 0) && this.closer(j, m.x, m.y, x, y)) {
        if (m.travel) this.newLeg(m, g, j);
        else m.dir = rand(this.seed, g, 256 + j, SALT.MOTHER_MOVE) / U32 * TWO_PI;
        return;
      }
      m.x = x; m.y = y; m.dir = dir;
      if (m.travel) m.leg -= m.speed;
    });
  }
  // マザー j が (x0,y0) から (x1,y1) へ動くと、ほかのマザーの支配領域と重なったまま近づくか
  closer(j, x0, y0, x1, y1) {
    const h = spaceHalf(this.ms[j]);
    for (let i = 0; i < this.ms.length; i++) {
      const e = this.ms[i];
      const eh = spaceHalf(e);
      if (i === j || !e.active || !eh) continue;
      const g1 = domainGap(x1, y1, h, e.x, e.y, eh, this.W, this.H, this.wrap);
      if (g1 <= 0 && g1 < domainGap(x0, y0, h, e.x, e.y, eh, this.W, this.H, this.wrap)) return true;
    }
    return false;
  }
}

// 支配領域は円（Q74。前は一辺 2h+1 の正方形）。面積を前の正方形とほぼ同じにする：半径の2乗＝(2h+1)²×7÷22（π≈22/7。GPU と同じ整数の式）
//   h は支配領域の値の半分（floor(domain/2)）。一辺 100 なら半径の2乗 3245・半径 56・マス 10,185（前は 10,201）
export const domR2 = h => h > 0 ? Math.floor((2 * h + 1) * (2 * h + 1) * 7 / 22) : 0;
export const domR = h => Math.floor(Math.sqrt(domR2(h)));
// 円の中のマスの数（見極めの 10% の分母）
export function domArea(h) {
  const r2 = domR2(h), r = domR(h);
  let n = 0;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r2) n++;
  return n;
}

// 2 つの支配領域の離れ具合（マス）：中心のマスどうしの距離 − 2 つの円の半径の和。正なら重ならない（Q74 で円に）
export function domainGap(x1, y1, h1, x2, y2, h2, W, H, wrap) {
  let dx = Math.floor(x1) - Math.floor(x2), dy = Math.floor(y1) - Math.floor(y2);
  if (wrap) {
    dx = ((dx % W) + W) % W; if (2 * dx > W) dx -= W;
    dy = ((dy % H) + H) % H; if (2 * dy > H) dy -= H;
  }
  return Math.sqrt(dx * dx + dy * dy) - (domR(h1) + domR(h2));
}

// ぶつかりを見る円の半分の幅（支配領域があればそれ、無ければ space）
const spaceHalf = m => Math.floor((m.domain > 0 ? m.domain : m.space > 0 ? m.space : 0) / 2);

function wrapF(v, n) { v %= n; return v < 0 ? v + n : v; }
function cell(v, n) { return ((Math.floor(v) % n) + n) % n; }

// マス (x,y) が中心 (cx,cy)・半径の2乗 r2 の円に入るか（GPU と同じ整数の式）
export function inCircle(x, y, cx, cy, r2, W, H, wrap) {
  let dx = x - cx, dy = y - cy;
  if (wrap) {
    dx = ((dx % W) + W) % W; if (2 * dx > W) dx -= W;
    dy = ((dy % H) + H) % H; if (2 * dy > H) dy -= H;
  }
  return dx * dx + dy * dy <= r2;
}

// マス (x,y) が中心 (cx,cy) の支配領域（半径の2乗 domR2(half) の円。Q74）に入るか（GPU と同じ整数の式）
export function inDomain(x, y, cx, cy, half, W, H, wrap) {
  if (!(half > 0)) return false;
  let dx = x - cx, dy = y - cy;
  if (wrap) {
    dx = ((dx % W) + W) % W; if (2 * dx > W) dx -= W;
    dy = ((dy % H) + H) % H; if (2 * dy > H) dy -= H;
  }
  return dx * dx + dy * dy <= domR2(half);
}

// 支配領域の中を消したあとのマスの値（dom は、かかる領域の種族の印。第 s-1 ビット＝種族 s）
export const clearByDomain = (cur, dom) => (dom !== 0 && cur !== 0 && !((dom >>> (cur - 1)) & 1)) ? 0 : cur;

// マザーの円と支配領域が触れる範囲の半分の幅
const reach = m => Math.max(Math.floor(Math.sqrt(m.r2)), domR(m.half ?? 0), m.stamp || m.learn != null ? 8 : 0);

// 円が触れるマスの x（または y）を、端の扱いに合わせて並べる（同じ値は1回だけ）
function span(c, r, n, wrap) {
  const out = new Set();
  for (let v = c - r; v <= c + r; v++) {
    if (wrap) out.add(((v % n) + n) % n);
    else if (v >= 0 && v < n) out.add(v);
  }
  return [...out];
}

// 1マスの供給の答え（§7.3）。thrs[s-1] はそのマスにかかる種族 s のしきい値（同じ種族のマザーが重なったら最大を1回だけ）
export function decide(cur, thrs, S, mode, rules, seed, gen, i) {
  if (mode === MODE.EMPTY && cur !== 0) return cur;
  const { pick, table } = rules;
  let cnt = 0, first = 0, best = 0, bestRank = 0xffffffff, wsum = 0, cand = 0;
  for (let s = 1; s <= S; s++) {
    const t = thrs[s - 1];
    if (t === 0) continue;
    if (rand(seed, gen, i, SALT.MOTHER | (s << 8)) >= t) continue;
    cnt++; cand |= 1 << (s - 1);
    if (!first) first = s;
    const rk = table[(s - 1) * STRIDE + 4];
    if (rk < bestRank) { bestRank = rk; best = s; }
    wsum += table[(s - 1) * STRIDE + 3];
  }
  if (cnt === 0) return cur;         // 当たらなかったマスは元のまま
  if (cnt === 1) return first;
  if (pick === PICK.RANK) return best;
  const r = rand(seed, gen, i, SALT.MOTHER_PICK);
  let t = pick === PICK.WEIGHT ? r % wsum : r % cnt;
  for (let s = 1; s <= S; s++) {
    if (!((cand >>> (s - 1)) & 1)) continue;
    const w = pick === PICK.WEIGHT ? table[(s - 1) * STRIDE + 3] : 1;
    if (t < w) return s;
    t -= w;
  }
  return cur;
}

// CPU の手本：世代 gen の供給を盤 cells にそのまま書く。list は MotherSet.supplies() の結果
// 区画を使わず、マザーごとに円と支配領域の中のマスを直接たどる（GPU の区画の作り方とは別の道で同じ答えを出す）
// 1マスの順番：支配領域の中で、その領域の種族でない生き物を消す → 置き形 → 供給（§18 の②・③）
//   置き形の範囲のマスは、置き形で決まる（ばらまきの抽選はしない）。置き形が重なったら、1 のビットのうち一番小さい種族。
//   どれも 0 なら何もしない（Q58=A。領域の掃除のあとのまま。前は空にしていた）
// learn：学習の状態（MotherSet の learn）。学習するマザーの置き形と押す世代は、ここから決まる
export function supplyCPU(W, H, cells, list, wrap, rules, seed, gen, mode, learn = null) {
  if (!list.length) return 0;
  const S = rules.S;
  const touched = new Map(); // マスの番号 → { t: 種族ごとのしきい値, dom: 支配領域の種族の印 }
  for (const m of list) {
    const r = reach(m);
    for (const y of span(m.cy, r, H, wrap)) for (const x of span(m.cx, r, W, wrap)) {
      const inC = inCircle(x, y, m.cx, m.cy, m.r2, W, H, wrap), inS = inDomain(x, y, m.cx, m.cy, m.half, W, H, wrap);
      const stamp = m.learn != null ? (learn ? learnStamp(learn, m.learn, gen) : null) : m.stamp;
      const b = stamp ? inStamp(x, y, m.cx, m.cy, W, H, wrap) : -1;
      if (!inC && !inS && b < 0) continue;
      const i = y * W + x;
      let e = touched.get(i);
      if (!e) { e = { t: new Uint32Array(S), dom: 0, sHit: false, sOne: 0 }; touched.set(i, e); }
      if (inC && m.thr > e.t[m.kind - 1]) e.t[m.kind - 1] = m.thr;
      if (inS) e.dom |= 1 << (m.kind - 1);
      if (b >= 0) { e.sHit = true; if (stampBit(stamp, b) && (!e.sOne || m.kind < e.sOne)) e.sOne = m.kind; }
    }
  }
  let placed = 0;
  for (const [i, e] of touched) {
    const c = clearByDomain(cells[i], e.dom);
    const v = e.sHit ? (e.sOne || c) : decide(c, e.t, S, mode, rules, seed, gen, i);   // 置き形の 0 のマスは何もしない（Q58=A）
    if (v !== cells[i]) { cells[i] = v; placed++; }
  }
  return placed;
}

// GPU に渡す形（1世代分）：区画ごとに「かかるマザー」を並べる（§7.3）
//   tiles：区画ごとに4語 [tx | ty<<16, 番号の並びの始まり, 個数, 0]
//   idx：マザーの番号の並び
//   ms：マザーごとに MS_WORDS 語 [cx | cy<<16, r2, 種族 | 支配領域の半分の幅<<8 | 学習するか<<30 | 置き形を押すか<<31, しきい値, 置き形 8 語]
//       学習するマザーは、置き形の 1 語目に学習の置き場所（GPU は学習の状態から押す世代と形を読む）
export const MS_WORDS = 4 + STAMP_WORDS;
export function packSupplies(list, W, H, wrap) {
  const map = new Map();
  list.forEach((m, j) => {
    const r = reach(m);
    const txs = new Set(span(m.cx, r, W, wrap).map(x => Math.floor(x / TILE)));
    const tys = new Set(span(m.cy, r, H, wrap).map(y => Math.floor(y / TILE)));
    for (const ty of tys) for (const tx of txs) {
      const key = tx | (ty << 16);
      let a = map.get(key);
      if (!a) { a = []; map.set(key, a); }
      a.push(j);
    }
  });
  const tiles = new Uint32Array(map.size * 4);
  const idx = [];
  let k = 0;
  for (const [key, a] of map) {
    tiles[k * 4] = key; tiles[k * 4 + 1] = idx.length; tiles[k * 4 + 2] = a.length;
    idx.push(...a); k++;
  }
  const ms = new Uint32Array(list.length * MS_WORDS);
  list.forEach((m, j) => {
    const o = j * MS_WORDS;
    ms[o] = m.cx | (m.cy << 16); ms[o + 1] = m.r2; ms[o + 3] = m.thr;
    ms[o + 2] = (m.kind | ((m.half ?? 0) << 8) | (m.learn != null ? 0x40000000 : 0) | (m.stamp ? 0x80000000 : 0)) >>> 0;
    if (m.learn != null) ms[o + 4] = m.learn;
    else if (m.stamp) for (let w = 0; w < STAMP_WORDS; w++) ms[o + 4 + w] = m.stamp[w] >>> 0;
  });
  return { nTiles: map.size, tiles, idx: Uint32Array.from(idx), ms };
}
