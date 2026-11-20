// MOMO Life — 対戦モード（セッション11）。エネルギーをためて型を置き合い、自分以外の種族を全滅させたら勝ち
// ここは盤の中身（CPU に読み戻した写し）だけを見て考える部品。GPU も画面も触らない（Node のテストで動かせる）。
//   エネルギー：1 秒ごとに、自分のマスの数だけ増える
//   （セッション11 の後半で、エネルギーは 1 マスにつき 1 秒に 2、倍にする境目は 5 秒に変えた）
//   値段：1 マスの値段は最初 10。「ブロック（4 マス）を置けるまでの秒数」が 10 秒より短いあいだ倍にしていく（Q108=A・Q109=B）。
//     マスが減ったら、10 秒より短くならない一番安い値段に戻る（Q110=B）
//   置ける場所：自分のマスから市街地距離（|dx|+|dy|）20 以内で、ほかの種族の陣地（ZOC＝その種族のマスから 20 以内）の外（Q111）。
//     型の生き物のマスが全部その中に入るときだけ置ける
//   型：10×10 の中に描いた形を 10 個まで持つ。置くと、型の生き物のマスのうち空いているマスに置く（自分のマスとの重なりは数えない）
//   コンピュータ（AI）：増やす（ブロックを広げる）・グライダーを敵へ撃つ・敵が近ければどんぐり（Acorn）で爆撃する。
//     爆撃の場所は、候補ごとに盤の一部を CPU の手本で少し先まで動かして、敵が一番減る所を選ぶ
import { checkRule, checkTargets } from './life-expr.js';
import { chainName, chainColor } from './life-chain.js';
import { compile } from './life-rules.js';
import { stepWorld } from './life-cpu.js';

const SEE = 15;   // コンピュータが「敵が近い」とみる距離（置ける範囲の外側にこれだけ足す）
export const BATTLE = Object.freeze({
  price0: 10,      // 1 マスの最初の値段
  range: 20,       // 置ける距離（市街地距離）
  rate: 2,         // 1 秒に 1 マスあたり入るエネルギー（セッション11：たまる時間を半分に）
  fastSec: 5,      // 置ける間隔がこの秒数より短くなったら値段を倍（たまる時間を半分にしたので、10 秒から 5 秒に）
  baseCells: 4,    // 置ける間隔を測る型の大きさ（ブロック）
  grid: 10,        // 型の大きさ（一辺）
  slots: 10,       // 型の数
  maxS: 8,         // 種族の数の上限
});

// ── 型 ──
// 10 行 × 10 文字（'O' が生き物）。最初の 7 つ：ブロック・ビーコン・グライダー 4 方向・どんぐり。残りは空
const pad = rows => { const out = rows.map(r => (r + '.'.repeat(BATTLE.grid)).slice(0, BATTLE.grid)); while (out.length < BATTLE.grid) out.push('.'.repeat(BATTLE.grid)); return out; };
export const DEFAULT_PATTERNS = Object.freeze([
  { key: 'block', rows: pad(['OO', 'OO']) },
  { key: 'beacon', rows: pad(['OO', 'OO', '..OO', '..OO']) },
  { key: 'gliderSE', rows: pad(['.O', '..O', 'OOO']) },   // 右下へ進む
  { key: 'gliderSW', rows: pad(['.O', 'O', 'OOO']) },     // 左下へ
  { key: 'gliderNE', rows: pad(['OOO', '..O', '.O']) },   // 右上へ
  { key: 'gliderNW', rows: pad(['OOO', 'O', '.O']) },     // 左上へ
  { key: 'acorn', rows: pad(['.O', '...O', 'OO..OOO']) },
  { key: 'empty', rows: pad([]) },
  { key: 'empty', rows: pad([]) },
  { key: 'empty', rows: pad([]) },
].map(p => Object.freeze({ key: p.key, rows: Object.freeze(p.rows) })));
export const defaultPatterns = () => DEFAULT_PATTERNS.map(p => ({ key: p.key, rows: [...p.rows] }));

// 型の生き物のマス（形の左上を 0,0 にそろえる）と、形の幅・高さ
export function patInfo(rows) {
  const pts = [];
  rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === 'O') pts.push([x, y]); });
  if (!pts.length) return { cells: [], w: 0, h: 0, n: 0 };
  const x0 = Math.min(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1]));
  const cells = pts.map(([x, y]) => [x - x0, y - y0]);
  return { cells, w: Math.max(...cells.map(p => p[0])) + 1, h: Math.max(...cells.map(p => p[1])) + 1, n: cells.length };
}
const GLIDER = { '1,1': 'gliderSE', '-1,1': 'gliderSW', '1,-1': 'gliderNE', '-1,-1': 'gliderNW' };
const PAT = Object.fromEntries(DEFAULT_PATTERNS.filter(p => p.key !== 'empty').map(p => [p.key, patInfo(p.rows)]));

// ── 世界（全種族が同じルール。食べる相手はだれでも） ──
// 対戦の色（黒い盤の上で見やすい明るさ。G・B・M・Y の順に 2 周）
export const BATTLE_COLORS = ['#4ade80', '#60a5fa', '#e879f9', '#facc15', '#a3e635', '#22d3ee', '#fb7185', '#fb923c'];
export const BATTLE_RULE = Object.freeze({ birth: '3', survive: '23', eat: '1', target: '?' });
export function battleWorld(S, rule = BATTLE_RULE) {
  const species = [];
  for (let id = 1; id <= S; id++) {
    const r = {};
    for (const k of ['birth', 'survive', 'eat']) {
      const c = checkRule(rule[k] ?? '', S, id);
      if (!c.ok) return { ok: false, field: k, msg: c.msg };
      r[k] = c.groups;
    }
    const tg = checkTargets(rule.target ?? '?', S, id);
    if (!tg.ok) return { ok: false, field: 'target', msg: tg.msg };
    species.push({ id, name: { ja: chainName(id), en: chainName(id) }, color: BATTLE_COLORS[id - 1] ?? chainColor(id),
      birth: r.birth, survive: r.survive, prey: r.eat, eatSet: tg.set });
  }
  return { ok: true, world: { pick: 'equal', eatMode: 'eater', init: { density: 0 }, species } };
}

// 種から作る乱数（0 以上 1 未満）
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 最初の 2×2 のブロックの左上。互いに離れた場所（はじめは盤の広さから決めた間隔、置けなければ少しずつ縮める）
export function startBlocks(W, H, S, seed, wrap) {
  const rnd = mulberry(seed ^ 0x51ed270b);
  const m = wrap ? 0 : 8;
  let sep = Math.floor(Math.sqrt((W * H) / S) * 0.6);
  const out = [];
  while (out.length < S) {
    let placed = false;
    for (let k = 0; k < 400 && !placed; k++) {
      const x = m + Math.floor(rnd() * (W - 2 - 2 * m)), y = m + Math.floor(rnd() * (H - 2 - 2 * m));
      if (out.every(([a, b]) => torusDist(a, b, x, y, W, H, wrap, 'cheb') >= sep)) { out.push([x, y]); placed = true; }
    }
    if (!placed) sep = Math.floor(sep * 0.9);
  }
  return out;
}
const wd = (d, n, wrap) => wrap ? ((d % n) + n + n / 2 | 0) % n - (n / 2 | 0) : d;   // 端をつなぐときの近い向きの差
function torusDist(x1, y1, x2, y2, W, H, wrap, kind = 'l1') {
  const dx = Math.abs(wd(x2 - x1, W, wrap)), dy = Math.abs(wd(y2 - y1, H, wrap));
  return kind === 'cheb' ? Math.max(dx, dy) : dx + dy;
}

// ── 盤の写し（1 秒に 1 回、GPU から読み戻した盤） ──
// 種族ごとのマスの一覧と、置ける範囲（自分のマスからの距離。範囲の外は 255）を受け持つ。範囲は使うときに計算する
export class Field {
  constructor(cells, W, H, wrap, S, range, scratch) {
    this.cells = cells; this.W = W; this.H = H; this.wrap = wrap; this.S = S; this.range = range;
    const N = W * H;
    this.counts = new Uint32Array(S + 1);
    for (let i = 0; i < N; i++) this.counts[cells[i]]++;
    // 種族ごとのマスの番号（種族の順に並べる）
    this.start = new Uint32Array(S + 2);
    for (let s = 1; s <= S; s++) this.start[s + 1] = this.start[s] + this.counts[s];
    this.list = scratch?.list && scratch.list.length >= N ? scratch.list : new Int32Array(N);
    const pos = this.start.slice();
    for (let i = 0; i < N; i++) { const v = cells[i]; if (v) this.list[pos[v]++] = i; }
    this.scratch = scratch ?? {};
    this.dists = []; this.near = [];
  }
  own(s) { return this.list.subarray(this.start[s], this.start[s + 1]); }
  idx(x, y) {
    if (this.wrap) { x = ((x % this.W) + this.W) % this.W; y = ((y % this.H) + this.H) % this.H; }
    else if (x < 0 || y < 0 || x >= this.W || y >= this.H) return -1;
    return y * this.W + x;
  }
  // 盤の上で、seeds（マスの番号の並びの並び）から市街地距離 limit までを数える。d は外を 255 にする。visit は届いたマスごとに呼ぶ
  bfs(d, seeds, limit, visit) {
    const { W, H, wrap } = this, N = W * H, sc = this.scratch;
    d.fill(255);
    const q = sc.queue && sc.queue.length >= N ? sc.queue : (sc.queue = new Int32Array(N));
    let head = 0, tail = 0;
    for (const L of seeds) for (const i of L) { d[i] = 0; q[tail++] = i; }
    while (head < tail) {
      const i = q[head++], di = d[i];
      if (visit) visit(i);
      if (di >= limit) continue;
      const x = i % W, y = (i / W) | 0;
      for (let k = 0; k < 4; k++) {
        let xx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), yy = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (wrap) { xx = (xx + W) % W; yy = (yy + H) % H; }
        else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (d[j] !== 255) continue;
        d[j] = di + 1; q[tail++] = j;
      }
    }
  }
  // 種族 s の置ける範囲：自分のマスから市街地距離 range 以内で、しかも、ほかの種族の陣地（ZOC＝そのマスから range 以内）の外（Q111）。
  //   値は自分のマスからの距離。自分の範囲の中でもほかの陣地なら 254、範囲の外は 255。あわせて、自分のマスから range+SEE 以内にいる敵のマス（near）を集める
  dist(s) {
    if (this.dists[s]) return this.dists[s];
    const N = this.W * this.H, sc = this.scratch, cells = this.cells;
    sc.dist = sc.dist || [];
    const d = sc.dist[s] && sc.dist[s].length === N ? sc.dist[s] : (sc.dist[s] = new Uint8Array(N));
    const near = [];
    this.bfs(d, [this.own(s)], this.range + SEE, i => { const v = cells[i]; if (v && v !== s) near.push(i); });
    const foe = sc.foe && sc.foe.length === N ? sc.foe : (sc.foe = new Uint8Array(N));
    const others = [];
    for (let e = 1; e <= this.S; e++) if (e !== s) others.push(this.own(e));
    this.bfs(foe, others, this.range);
    const R = this.range;
    for (let i = 0; i < N; i++) if (d[i] > R) d[i] = 255; else if (foe[i] !== 255) d[i] = 254;
    this.dists[s] = d; this.near[s] = near;
    return d;
  }
  // 型の生き物のマス（左上 x0,y0）が全部、種族 s の置ける範囲に入るなら、そのうち空いているマスの番号の並び。入らなければ null
  fit(s, info, x0, y0) {
    const d = this.dist(s), out = [];
    for (const [dx, dy] of info.cells) {
      const i = this.idx(x0 + dx, y0 + dy);
      if (i < 0 || d[i] > this.range) return null;
      if (!this.cells[i]) out.push(i);
    }
    return out;
  }
  // 左上 x0,y0・幅 w・高さ h の四角の中に生き物がいないか（盤の外は空とみなす）
  clear(x0, y0, w, h) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = this.idx(x, y); if (i >= 0 && this.cells[i]) return false; }
    return true;
  }
}

// 置ける範囲の縁（点線で描く線）。マスの角の座標で [x1,y1,x2,y2, …]。横・縦に続く辺は 1 本にまとめる
export function outline(d, W, H, wrap, range) {
  const seg = [];
  const inn = (x, y) => {
    if (wrap) { x = (x + W) % W; y = (y + H) % H; } else if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return d[y * W + x] <= range;
  };
  // 横の辺：マス (x,y-1) と (x,y) のあいだ（y = 0〜H）
  for (let y = 0; y <= H; y++) {
    if (wrap && y === H) break;
    let run = -1;
    for (let x = 0; x <= W; x++) {
      const edge = x < W && inn(x, y - 1) !== inn(x, y);
      if (edge && run < 0) run = x;
      if (!edge && run >= 0) { seg.push(run, y, x, y); run = -1; }
    }
  }
  for (let x = 0; x <= W; x++) {
    if (wrap && x === W) break;
    let run = -1;
    for (let y = 0; y <= H; y++) {
      const edge = y < H && inn(x - 1, y) !== inn(x, y);
      if (edge && run < 0) run = y;
      if (!edge && run >= 0) { seg.push(x, run, x, y); run = -1; }
    }
  }
  return new Float32Array(seg);
}

// ── エネルギーと値段 ──
export function newState(cfg = BATTLE) { return { energy: 0, price: cfg.price0, cells: 0, alive: true, act: 'wait' }; }
// 1 秒分：マスの数 × rate だけ増やす。値段は、置ける間隔が fastSec 秒より短くならない一番安い値段（最初の値段 × 2 の何乗か）。
//   マスが増えれば何度でも倍になり（Q108=A・Q109=B）、減れば下がる（Q110=B）
export function priceFor(cells, cfg = BATTLE) {
  let p = cfg.price0;
  while (cells > 0 && cfg.baseCells * p / (cells * cfg.rate) < cfg.fastSec) p *= 2;
  return p;
}
export function earn(st, cells, cfg = BATTLE) {
  st.cells = cells;
  if (!cells) { st.alive = false; return; }
  st.energy += cells * cfg.rate;
  st.price = priceFor(cells, cfg);
}

// ── 対戦の全体 ──
export class Battle {
  // opts: { W, H, wrap, S, seed, player（あなたの種族。1）, rules（compile の結果）, cfg }
  constructor(opts) {
    Object.assign(this, { W: opts.W, H: opts.H, wrap: opts.wrap, S: opts.S, seed: opts.seed >>> 0, player: opts.player ?? 1, rules: opts.rules });
    this.cfg = { ...BATTLE, ...(opts.cfg ?? {}) };
    this.st = [null];
    const rnd = mulberry(this.seed ^ 0xa5a5a5a5);
    for (let s = 1; s <= this.S; s++) {
      const st = newState(this.cfg);
      if (s !== this.player) st.ai = new AI(s, mulberry((this.seed + s * 7919) >>> 0), 0.25 + rnd() * 0.6);
      this.st.push(st);
    }
    this.field = null; this.scratch = {}; this.gen = 0; this.result = null;
  }
  // 最初の盤（各種族に 2×2 のブロックを 1 つ）
  initialCells() {
    const cells = new Uint32Array(this.W * this.H);
    this.starts = startBlocks(this.W, this.H, this.S, this.seed, this.wrap);
    this.starts.forEach(([x, y], k) => { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) cells[(y + dy) * this.W + x + dx] = k + 1; });
    return cells;
  }
  // 1 秒ごと：読み戻した盤でエネルギーを増やし、コンピュータが考えて置く。返り値の writes を盤に書く
  tick(cells, gen) {
    this.gen = gen;
    this.field = new Field(cells, this.W, this.H, this.wrap, this.S, this.cfg.range, this.scratch);
    for (let s = 1; s <= this.S; s++) if (this.st[s].alive) earn(this.st[s], this.field.counts[s], this.cfg);
    const writes = [];
    if (!this.result) {
      for (let s = 1; s <= this.S; s++) {
        const st = this.st[s];
        if (!st.ai || !st.alive) continue;
        const a = st.ai.decide(this, st);
        st.act = a ? a.act : st.ai.mode;
        if (a && a.list) {
          st.energy -= a.list.length * st.price;
          writes.push({ s, list: a.list });
          for (const i of a.list) this.field.cells[i] = s;   // 同じ秒のほかの種族が、置いたものを見られるように
        }
      }
      const me = this.st[this.player];
      if (!me.alive) this.result = 'lose';
      else if (this.st.every((st, s) => !st || s === this.player || !st.alive)) this.result = 'win';
    }
    return writes;
  }
  // あなたが型を置く。rows は型、x0,y0 は形の左上。置けたら { list }、置けなければ { why }
  place(rows, x0, y0, s = this.player) {
    const st = this.st[s], info = patInfo(rows);
    if (!this.field || !st.alive || this.result) return { why: 'over' };
    if (!info.n) return { why: 'empty' };
    const list = this.field.fit(s, info, x0, y0);
    if (!list) {
      const d = this.field.dist(s);
      return { why: info.cells.some(([dx, dy]) => d[this.field.idx(x0 + dx, y0 + dy)] === 254) ? 'zoc' : 'far' };
    }
    if (!list.length) return { why: 'full' };
    const cost = list.length * st.price;
    if (st.energy < cost) return { why: 'cost' };
    st.energy -= cost;
    for (const i of list) this.field.cells[i] = s;
    return { list };
  }
  states() { return this.st.slice(1).map(st => ({ income: st.cells * this.cfg.rate, energy: st.energy, price: st.price, cells: st.cells, alive: st.alive, act: st.act, aggr: st.ai ? st.ai.aggr : null })); }
}

// ── コンピュータ ──
// aggr（0.25〜0.85）が攻め気。高いほどグライダーを撃ち、どんぐりのためにエネルギーをためる
export class AI {
  constructor(s, rnd, aggr) { this.s = s; this.rnd = rnd; this.aggr = aggr; this.mode = 'grow'; this.escort = null; }
  decide(b, st) {
    const F = b.field, s = this.s, p = st.price, E = st.energy;
    const cost = k => PAT[k].n * p;
    F.dist(s);
    const near = F.near[s];
    // 次に何をするか（plan）を決めたら、置けるだけたまるまで変えない。値段は「ブロックが 10 秒より早く置けない」ように上がるので、
    // 決めずにいると、たまるたびにブロックを置いてしまい、グライダーやどんぐりの分までたまらない
    if (this.escort && b.gen >= this.escort.until) { this.escort = null; if (this.plan === 'bomb' && !near.length) this.plan = null; }
    if (near.length && this.plan !== 'bomb' && this.rnd() < this.aggr + 0.3) this.plan = 'bomb';   // 敵が範囲に入った
    if (!this.plan) this.plan = this.rnd() < this.aggr ? 'shoot' : 'grow';
    const need = cost(this.plan === 'bomb' ? 'acorn' : this.plan === 'shoot' ? 'gliderSE' : 'block');
    // グライダーを追っているあいだ（敵が範囲に入るのを待つ）：どんぐりの分をためる
    if (this.plan === 'bomb' && !near.length) { this.mode = this.escort ? 'escort' : 'save'; if (!this.escort) this.plan = null; return null; }
    if (E < need) { this.mode = this.escort ? 'escort' : 'save'; return null; }
    const plan = this.plan;
    this.plan = null;
    // ① 爆撃：範囲の中の敵のそばに、どんぐりを置く
    if (plan === 'bomb') { const a = this.bomb(b, near); if (a) { this.escort = null; this.mode = 'bomb'; return { act: 'bomb', list: a }; } }
    // ② 攻める：敵へグライダーを撃ち、そのグライダーについて行って、敵が範囲に入ったら爆撃する
    if (plan === 'shoot') {
      const g = this.shoot(b);
      if (g) { this.escort = { until: b.gen + g.k * 4 + 80 }; this.plan = 'bomb'; this.mode = 'shoot'; return { act: 'shoot', list: g.list }; }
    }
    // ③ 増やす（ほかがうまくいかなかったときも）：ブロックを範囲の縁のほうへ置いて、置ける範囲を広げる
    const a = this.grow(b);
    if (a) { this.mode = 'grow'; return { act: 'grow', list: a }; }
    this.mode = 'save';
    return null;
  }
  // ブロック：自分のマスから 6 マス以上離れた範囲の中で、周り 6×6 が空の所。範囲の縁に近く、敵から遠い所ほどよい
  grow(b) {
    const F = b.field, s = this.s, d = F.dist(s), own = F.own(s), R = b.cfg.range;
    let best = null, bestSc = -Infinity;
    for (let k = 0; k < 60 && own.length; k++) {
      const o = own[(this.rnd() * own.length) | 0];
      const r = 6 + ((this.rnd() * (R - 7)) | 0), a = this.rnd() * Math.PI * 2;
      const x = (o % F.W) + Math.round(Math.cos(a) * r * 0.7), y = ((o / F.W) | 0) + Math.round(Math.sin(a) * r * 0.7);
      const list = F.fit(s, PAT.block, x, y);
      if (!list || !F.clear(x - 2, y - 2, 6, 6)) continue;
      let sc = d[list[0]] + this.rnd() * 3;
      for (const e of F.near[s]) { const ex = e % F.W, ey = (e / F.W) | 0; if (torusDist(ex, ey, x, y, F.W, F.H, F.wrap) < 14) { sc -= 30; break; } }
      if (sc > bestSc) { bestSc = sc; best = list; }
    }
    return best;
  }
  // グライダー：いちばん近い敵のマスへ、斜めの線がちょうど通る場所から撃つ。途中に自分のマスがあれば撃たない
  shoot(b) {
    const F = b.field, s = this.s, d = F.dist(s), R = b.cfg.range;
    const T = this.target(F);
    if (T < 0) return null;
    const tx = T % F.W, ty = (T / F.W) | 0;
    const kmax = F.wrap ? Math.min(F.W, F.H) : Math.max(F.W, F.H);
    let best = null;
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      for (const off of [0, 1, -1]) {
        for (let k = 6; k < kmax; k++) {
          if (best && k >= best.k) break;
          // 敵から k 歩さかのぼった点（真ん中のマス）
          const cx = tx - sx * k + off, cy = ty - sy * k;
          const ci = F.idx(cx, cy);
          if (ci < 0) break;
          if (d[ci] > R - 2) continue;
          const info = PAT[GLIDER[`${sx},${sy}`]];
          const list = F.fit(s, info, cx - 1, cy - 1);
          if (!list || !F.clear(cx - 3, cy - 3, 7, 7)) continue;
          if (!this.pathClear(F, cx, cy, sx, sy, Math.min(k, 60))) continue;
          best = { k, list };
          break;
        }
      }
    }
    return best;
  }
  // 斜めの道（幅 5）の先 n 歩に自分のマスがないか
  pathClear(F, cx, cy, sx, sy, n) {
    for (let j = 4; j < n; j++) for (let w = -2; w <= 2; w++) {
      const i = F.idx(cx + sx * j + w, cy + sy * j);
      if (i >= 0 && F.cells[i] === this.s) return false;
    }
    return true;
  }
  // ねらう敵のマス：自分のマスと敵のマスを少しずつ選んで比べ、いちばん近い組の敵のほう
  target(F) {
    const own = F.own(this.s);
    if (!own.length) return -1;
    let best = -1, bd = Infinity;
    const enemies = [];
    for (let e = 1; e <= F.S; e++) if (e !== this.s && F.counts[e]) enemies.push(F.own(e));
    if (!enemies.length) return -1;
    const oN = Math.min(48, own.length);
    for (const L of enemies) {
      const step = Math.max(1, Math.floor(L.length / 512));
      for (let a = 0; a < L.length; a += step) {
        const ei = L[a], ex = ei % F.W, ey = (ei / F.W) | 0;
        for (let k = 0; k < oN; k++) {
          const oi = own[Math.floor(k * own.length / oN)];
          const dd = torusDist(oi % F.W, (oi / F.W) | 0, ex, ey, F.W, F.H, F.wrap, 'cheb');
          if (dd < bd) { bd = dd; best = ei; }
        }
      }
    }
    return best;
  }
  // どんぐり：近くの敵の陣地のすぐ外に候補を作り、盤の一部（56×56）を 48 世代だけ動かして、敵が一番減る所を選ぶ
  //   （どの候補でも敵が減らないときも、いちばん点の高い所に置く。どんぐりは長く広がり続けるので、先で効く）
  bomb(b, near) {
    const F = b.field, s = this.s, info = PAT.acorn;
    const cands = [];
    for (let k = 0; k < 24 && cands.length < 6; k++) {
      const e = near[(this.rnd() * near.length) | 0], ex = e % F.W, ey = (e / F.W) | 0;
      const a = this.rnd() * Math.PI * 2, r = b.cfg.range + 2 + this.rnd() * 6;   // 敵の陣地のすぐ外
      const x0 = Math.round(ex + Math.cos(a) * r) - 3, y0 = Math.round(ey + Math.sin(a) * r) - 1;
      const list = F.fit(s, info, x0, y0);
      if (!list || !F.clear(x0 - 1, y0 - 1, info.w + 2, info.h + 2)) continue;
      cands.push({ x0, y0, list });
    }
    let best = null, bestSc = -Infinity;
    for (const c of cands) {
      const sc = this.simScore(b, c);
      if (sc > bestSc) { bestSc = sc; best = c.list; }
    }
    return best;
  }
  // 候補を置いたときと置かないときを比べた点：敵の減った数 ＋ 自分の増えた数の半分
  simScore(b, c) {
    const F = b.field, n = 56, gens = 48;
    const cx = c.x0 + 3 - n / 2, cy = c.y0 + 1 - n / 2;
    const base = new Uint32Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = F.idx(cx + x, cy + y); base[y * n + x] = i >= 0 ? F.cells[i] : 0; }
    const run = withIt => {
      let a = base.slice(), t = new Uint32Array(n * n);
      if (withIt) for (const [dx, dy] of PAT.acorn.cells) a[(c.y0 + dy - cy) * n + (c.x0 + dx - cx)] = this.s;
      for (let g = 0; g < gens; g++) { stepWorld(n, n, a, t, false, b.rules, b.seed, b.gen + g); [a, t] = [t, a]; }
      let own = 0, foe = 0;
      for (const v of a) { if (v === this.s) own++; else if (v) foe++; }
      return { own, foe };
    };
    const r0 = run(false), r1 = run(true);
    return (r0.foe - r1.foe) + 0.5 * (r1.own - r0.own);
  }
}

export function battleRules(S, rule) {
  const w = battleWorld(S, rule);
  return w.ok ? { ...w, rules: compile(w.world) } : w;
}
