// MOMO Life — WebGPU の計算と描画（詳細仕様書 §2・§4〜§6・§10、技術書 §2・§4・§9）
// 盤は GPU の上に2枚（ping-pong）。毎世代、盤を CPU に読み戻さない。
// ルールは life-rules.js の compile が作る数の並びを、そのまま GPU に置いて読む（CPU の手本 stepWorld と同じ手順）。
import { RAND_WGSL, SALT, probToThreshold } from './life-rand.js';
import { STRIDE, HEAD, GROUP_WORDS, RULE_WORDS, MAX_SPECIES, hexToRGBA } from './life-rules.js';
import { packSupplies, TILE, MS_WORDS, MAX_LEARN } from './life-mother.js';
import { LS, packLearn, LEARN_WGSL_CONSTS } from './life-learn.js';

const WG = 16;          // 計算の区画（16×16 マス）
const SLOT = 256;       // 世代ごとの設定の置き場の幅（バイト。動的オフセットの決まりで 256）
const MAX_SLOTS = 256;  // 1回に送れる世代の数。これを超えるときは分けて送る
const PARAMS_BYTES = 64; // Params の大きさ（u32 × 16）

const COMMON_WGSL = /* wgsl */`
struct Params {
  W : u32, H : u32, gen : u32, seed : u32,
  wrap : u32, thr : u32, salt : u32, S : u32,
  pick : u32, tb : u32, ib : u32, mb : u32,   // tb/ib/mb: マザーの並び（M）の中の、区画・番号・マザーの始まり
  mode : u32, eat : u32, lb : u32, nl : u32,  // mode: 0＝空のマスにだけ置く、1＝上書き。eat: 1＝食べられたマスもその世代で誕生の判定（§16）
                                              // lb/nl: 学習するマザーの並び（M の中の始まり・数。§18 の④）
};
${RAND_WGSL}
`;

const STEP_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> src : array<u32>;
@group(0) @binding(2) var<storage, read_write> dst : array<u32>;
@group(0) @binding(3) var<storage, read> R : array<u32>;

const STRIDE = ${STRIDE}u;
const HEAD = ${HEAD}u;
const GW = ${GROUP_WORDS}u;
const RW = ${RULE_WORDS}u;

fn at(x : i32, y : i32) -> u32 {
  var xx = x; var yy = y;
  let W = i32(P.W); let H = i32(P.H);
  if (P.wrap != 0u) {
    if (xx < 0) { xx += W; } else if (xx >= W) { xx -= W; }
    if (yy < 0) { yy += H; } else if (yy >= H) { yy -= H; }
  } else if (xx < 0 || yy < 0 || xx >= W || yy >= H) { return 0u; }
  return src[u32(yy) * P.W + u32(xx)];
}

// 周りのマスの値 v が、条件の対象に当たるか（§3.1）
fn hit(v : u32, kind : u32, id : u32, me : u32) -> bool {
  switch kind {
    case 0u: { return v == id; }
    case 1u: { return v == me; }
    case 2u: { return v != 0u; }
    case 3u: { return v != 0u && v != me; }
    case 5u: { return v != 0u && v <= 24u && ((id >> (v - 1u)) & 1u) != 0u; }
    default: { return v == 0u; }
  }
}

// 種族 me のルール r（0 捕食・1 生存・2 誕生）が成り立つか。組は AND、ルールは OR
fn ruleHolds(me : u32, r : u32, nb : ptr<function, array<u32, 8>>) -> bool {
  let base = (me - 1u) * STRIDE;
  let ng = R[base + r];
  for (var g = 0u; g < ng; g++) {
    let go = base + HEAD + r * RW + g * GW;
    let nc = R[go];
    var all = true;
    for (var c = 0u; c < nc && all; c++) {
      let w0 = R[go + 1u + c * 2u];
      let m = R[go + 2u + c * 2u];
      let kind = w0 & 255u; let id = w0 >> 8u;
      var n = 0u;
      for (var k = 0u; k < 8u; k++) { if (hit((*nb)[k], kind, id, me)) { n++; } }
      if (((m >> n) & 1u) == 0u) { all = false; }
    }
    if (all) { return true; }
  }
  return false;
}

@compute @workgroup_size(${WG}, ${WG})
fn step(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let x = i32(id.x); let y = i32(id.y);
  // 周り8マスを1回だけ読む（並びは CPU の手本と同じ）
  var nb : array<u32, 8>;
  var k = 0u;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      nb[k] = at(x + dx, y + dy); k++;
    }
  }
  let i = id.y * P.W + id.x;
  let c = src[i];
  if (c != 0u) {
    // 食べる側のルール（eat が 3）：食べる種族がいれば、その中から1種に置き換わる（生き残りの条件は見ない）
    if (P.eat == 3u) {
      let cand = predators(c, &nb);
      var r = 0u;
      if (cand != 0u) { r = birthPick(&nb, i, cand, true); } else if (ruleHolds(c, 1u, &nb)) { r = c; }
      dst[i] = r;
      return;
    }
    // 捕食が先、次に生存
    var eaters = 0u;
    if (preyEaters(c, &nb, &eaters)) {
      var r = 0u;
      if (P.eat == 1u) { r = birthPick(&nb, i, eaters, false); }
      if (P.eat == 2u) { r = birthPick(&nb, i, eaters, true); }
      dst[i] = r;
    } else {
      var r = 0u;
      if (ruleHolds(c, 1u, &nb)) { r = c; }
      dst[i] = r;
    }
    return;
  }
  // 空：誕生の候補から1種
  dst[i] = birthPick(&nb, i, 0u, false);
}

// 生きているマス（種族 c）を食べる種族の印（life-cpu.js の predators と同じ）
fn predators(c : u32, nb : ptr<function, array<u32, 8>>) -> u32 {
  var cand = 0u;
  for (var s = 1u; s <= P.S; s++) {
    if (s == c || ((R[(s - 1u) * STRIDE + 5u] >> (c - 1u)) & 1u) == 0u) { continue; }
    var near = false;
    for (var k = 0u; k < 8u; k++) { if ((*nb)[k] == s) { near = true; } }
    if (near && ruleHolds(s, 0u, nb)) { cand |= 1u << (s - 1u); }
  }
  return cand;
}

// 種族 me の捕食が成り立つか。成り立てば *eaters に食べた種族の印（第 s-1 ビット＝種族 s）を入れる（§16）
// 食べた種族：成り立った組の条件で数えている種族のうち、周りに実際にいる種族（自分は除く）
fn preyEaters(me : u32, nb : ptr<function, array<u32, 8>>, eaters : ptr<function, u32>) -> bool {
  let base = (me - 1u) * STRIDE;
  let ng = R[base];
  var held = false; var out = 0u;
  for (var g = 0u; g < ng; g++) {
    let go = base + HEAD + g * GW;
    let nc = R[go];
    var all = true; var eat = 0u;
    for (var c = 0u; c < nc && all; c++) {
      let w0 = R[go + 1u + c * 2u];
      let m = R[go + 2u + c * 2u];
      let kind = w0 & 255u; let id = w0 >> 8u;
      var n = 0u;
      for (var k = 0u; k < 8u; k++) {
        let v = (*nb)[k];
        if (hit(v, kind, id, me)) { n++; if (v != 0u && v != me) { eat |= 1u << (v - 1u); } }
      }
      if (((m >> n) & 1u) == 0u) { all = false; }
    }
    if (all) { held = true; out |= eat; }
  }
  *eaters = out;
  return held && out != 0u;   // 食べる種族（自分以外）がいなければ食べられない（セッション9）
}

// 誕生の判定（§4・§5）。first と候補が重なれば、その中だけから選ぶ（食べた種族が先。§16）
// only が true なら誕生の条件は見ず、first の中から選ぶ（食べた種族に置き換わる。§18.5）
fn birthPick(nb : ptr<function, array<u32, 8>>, i : u32, first : u32, only : bool) -> u32 {
  var cand = first;
  if (!only) {
    cand = 0u;
    for (var s = 1u; s <= P.S; s++) { if (ruleHolds(s, 2u, nb)) { cand |= 1u << (s - 1u); } }
    if ((cand & first) != 0u) { cand &= first; }
  }
  var cnt = 0u; var one = 0u; var best = 0u; var bestRank = 0xffffffffu; var wsum = 0u;
  for (var s = 1u; s <= P.S; s++) {
    if (((cand >> (s - 1u)) & 1u) == 0u) { continue; }
    cnt++;
    if (one == 0u) { one = s; }
    let rk = R[(s - 1u) * STRIDE + 4u];
    if (rk < bestRank) { bestRank = rk; best = s; }
    wsum += R[(s - 1u) * STRIDE + 3u];
  }
  if (cnt <= 1u) { return one; }
  if (P.pick == 1u) { return best; }
  let rnd = rand4(P.seed, P.gen, i, ${SALT.BIRTH}u);
  var t = rnd % cnt;
  if (P.pick == 2u) { t = rnd % wsum; }
  for (var s = 1u; s <= P.S; s++) {
    if (((cand >> (s - 1u)) & 1u) == 0u) { continue; }
    var w = 1u;
    if (P.pick == 2u) { w = R[(s - 1u) * STRIDE + 3u]; }
    if (t < w) { return s; }
    t -= w;
  }
  return 0u;
}

@compute @workgroup_size(${WG}, ${WG})
fn init(@builtin(global_invocation_id) id : vec3<u32>) {
  if (id.x >= P.W || id.y >= P.H) { return; }
  let i = id.y * P.W + id.x;
  var v = 0u;
  if (rand4(P.seed, 0u, i, ${SALT.INIT}u) < P.thr) { v = 1u + rand4(P.seed, 0u, i, ${SALT.INIT_KIND}u) % P.S; }
  dst[i] = v;
}
`;

// マザーの供給の段（詳細仕様書 §7.3）。区画（16×16）ごとに1つの作業班で、その区画にかかるマザーだけを調べる。
// 各マスは、かかる全マザーの候補を集めてから1回だけ書く（life-mother.js の decide と同じ手順）
const SUPPLY_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> board : array<u32>;
@group(0) @binding(2) var<storage, read> M : array<u32>;
@group(0) @binding(3) var<storage, read> R : array<u32>;
@group(0) @binding(4) var<storage, read> L : array<u32>;

const STRIDE = ${STRIDE}u;
${LEARN_WGSL_CONSTS}

@compute @workgroup_size(${TILE}, ${TILE})
fn supply(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) l : vec3<u32>) {
  let th = P.tb + wg.x * 4u;
  let txy = M[th];
  let x = (txy & 0xffffu) * ${TILE}u + l.x;
  let y = (txy >> 16u) * ${TILE}u + l.y;
  if (x >= P.W || y >= P.H) { return; }
  let i = y * P.W + x;
  let orig = board[i];
  let W = i32(P.W); let H = i32(P.H);
  var thr : array<u32, ${MAX_SPECIES}>;
  var hitAny = false;
  var dom = 0u;   // このマスにかかる支配領域の種族の印（§18 の②）
  var sHit = false; var sOne = 0u;   // 置き形の範囲か／1 のビットの一番小さい種族
  let start = M[th + 1u]; let n = M[th + 2u];
  for (var q = 0u; q < n; q++) {
    let mi = P.mb + M[P.ib + start + q] * ${MS_WORDS}u;
    let cxy = M[mi];
    var dx = i32(x) - i32(cxy & 0xffffu);
    var dy = i32(y) - i32(cxy >> 16u);
    if (P.wrap != 0u) {
      dx = ((dx % W) + W) % W; if (2 * dx > W) { dx -= W; }
      dy = ((dy % H) + H) % H; if (2 * dy > H) { dy -= H; }
    }
    let k = (M[mi + 2u] & 255u) - 1u;
    let half = i32((M[mi + 2u] >> 8u) & 0x3fffffu);   // 第 8〜29 ビット（30 は学習、31 は置き形の印）
    if (u32(dx * dx + dy * dy) <= M[mi + 1u]) {
      thr[k] = max(thr[k], M[mi + 3u]);
      hitAny = true;
    }
    if (half > 0 && dx * dx + dy * dy <= (2 * half + 1) * (2 * half + 1) * 7 / 22) { dom |= 1u << k; hitAny = true; }   // 支配領域は円（Q74。domR2 と同じ式）
    // 置き形（§18 の③）：範囲のマスは置き形で決まる。重なったら 1 のビットのうち一番小さい種族
    //   学習するマザー（印 1<<30）は、学習の状態の「押す世代」と形を使う（§18 の④）
    let lrn = ((M[mi + 2u] >> 30u) & 1u) != 0u;
    var sb = mi + 4u; var press = (M[mi + 2u] >> 31u) != 0u;
    if (lrn) {
      let o = M[mi + 4u] * LS;
      press = L[o + L_EP0] == P.gen;
      sb = o + select(L_BEST, L_CAND, L[o + L_MODE] != 0u);
    }
    if (press && dx >= -8 && dx <= 7 && dy >= -8 && dy <= 7) {
      sHit = true; hitAny = true;
      let b = u32((dy + 8) * 16 + (dx + 8));
      var w = 0u;
      if (lrn) { w = L[sb + (b >> 5u)]; } else { w = M[sb + (b >> 5u)]; }
      if (((w >> (b & 31u)) & 1u) != 0u && (sOne == 0u || k + 1u < sOne)) { sOne = k + 1u; }
    }
  }
  if (!hitAny) { return; }
  // 支配領域の中では、その領域の種族でない生き物は消える（供給より先）
  var cur = orig;
  if (dom != 0u && cur != 0u && ((dom >> (cur - 1u)) & 1u) == 0u) { cur = 0u; }
  // 置き形の範囲：1 のビットのマスは自分の種族。0 のビットのマスは何もしない（Q58=A。領域の掃除のあとのまま）
  if (sHit) { var v = cur; if (sOne != 0u) { v = sOne; } if (v != orig) { board[i] = v; } return; }
  if (P.mode == 0u && cur != 0u) { if (cur != orig) { board[i] = cur; } return; }
  var cnt = 0u; var first = 0u; var best = 0u; var bestRank = 0xffffffffu; var wsum = 0u; var cand = 0u;
  for (var s = 1u; s <= P.S; s++) {
    let t = thr[s - 1u];
    if (t == 0u) { continue; }
    if (rand4(P.seed, P.gen, i, ${SALT.MOTHER}u | (s << 8u)) >= t) { continue; }
    cnt++; cand |= 1u << (s - 1u);
    if (first == 0u) { first = s; }
    let rk = R[(s - 1u) * STRIDE + 4u];
    if (rk < bestRank) { bestRank = rk; best = s; }
    wsum += R[(s - 1u) * STRIDE + 3u];
  }
  if (cnt == 0u) { if (cur != orig) { board[i] = cur; } return; }
  var out = first;
  if (cnt > 1u) {
    if (P.pick == 1u) { out = best; }
    else {
      let rnd = rand4(P.seed, P.gen, i, ${SALT.MOTHER_PICK}u);
      var t = rnd % cnt;
      if (P.pick == 2u) { t = rnd % wsum; }
      out = 0u;
      for (var s = 1u; s <= P.S && out == 0u; s++) {
        if (((cand >> (s - 1u)) & 1u) == 0u) { continue; }
        var w = 1u;
        if (P.pick == 2u) { w = R[(s - 1u) * STRIDE + 3u]; }
        if (t < w) { out = s; } else { t -= w; }
      }
    }
  }
  board[i] = out;
}
`;

// 学習（§18 の④）：数える段。学習するマザーごとに、支配領域の中の自分の数を CNT に足す（数える世代だけ）
//   区画 (wg.x, wg.y) は領域の左上からの 16×16、wg.z はマザー。life-learn.js の countDomain と同じマスを 1 回ずつ数える
const COUNT_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> board : array<u32>;
@group(0) @binding(2) var<storage, read> M : array<u32>;
@group(0) @binding(3) var<storage, read> L : array<u32>;
@group(0) @binding(4) var<storage, read_write> CNT : array<atomic<u32>>;
${LEARN_WGSL_CONSTS}
var<workgroup> wc : atomic<u32>;

fn normD(d0 : i32, n : i32) -> i32 { var d = ((d0 % n) + n) % n; if (2 * d > n) { d -= n; } return d; }

@compute @workgroup_size(16, 16)
fn count(@builtin(workgroup_id) wg : vec3<u32>, @builtin(local_invocation_id) l : vec3<u32>, @builtin(local_invocation_index) li : u32) {
  if (li == 0u) { atomicStore(&wc, 0u); }
  workgroupBarrier();
  let e = P.lb + wg.z * 4u;
  let slot = M[e] & 255u; let kind = (M[e] >> 8u) & 255u;
  let cx = i32(M[e + 1u] & 0xffffu); let cy = i32(M[e + 1u] >> 16u);
  let half = i32(M[e + 2u]);
  let d = bitcast<i32>(P.gen - L[slot * LS + L_EP0]);
  let ox = i32(wg.x * 16u + l.x) - half; let oy = i32(wg.y * 16u + l.y) - half;
  let W = i32(P.W); let H = i32(P.H);
  var x = cx + ox; var y = cy + oy;
  var good = d >= 0 && d % LC == 0 && ox <= half && oy <= half;
  if (P.wrap != 0u) {
    x = ((x % W) + W) % W; y = ((y % H) + H) % H;
    good = good && normD(x - cx, W) == ox && normD(y - cy, H) == oy;
  } else { good = good && x >= 0 && x < W && y >= 0 && y < H; }
  if (good && board[u32(y) * P.W + u32(x)] == kind) { atomicAdd(&wc, 1u); }
  workgroupBarrier();
  if (li == 0u) { let c = atomicLoad(&wc); if (c > 0u) { atomicAdd(&CNT[slot], c); } }
}
`;

// 学習：判断の段。マザーごとに 1 本。life-learn.js の learnUpdate と同じ手順
const LEARN_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> M : array<u32>;
@group(0) @binding(2) var<storage, read_write> L : array<u32>;
@group(0) @binding(3) var<storage, read_write> CNT : array<atomic<u32>>;
${LEARN_WGSL_CONSTS}

fn makeCand(o : u32, n : u32, kind : u32, zero : bool) {
  let t = L[o + L_TRIES]; L[o + L_TRIES] = t + 1u;
  if (zero || n <= EXPLORE || t % RESTART_EVERY == RESTART_EVERY - 1u) {
    let sz = 4u + rand4(P.seed, kind, t * 1000u, SALT_LEARN) % 13u;
    let pct = 10u + rand4(P.seed, kind, t * 1000u + 1u, SALT_LEARN) % 51u;
    let off = 8u - (sz >> 1u);
    let thr = pct * 42949672u + (pct * 96u) / 100u;
    for (var w = 0u; w < 8u; w++) { L[o + L_CAND + w] = 0u; }
    for (var y = 0u; y < sz; y++) {
      for (var x = 0u; x < sz; x++) {
        let b = (off + y) * 16u + off + x;
        if (rand4(P.seed, kind, t * 1000u + 2u + y * 16u + x, SALT_LEARN) < thr) { L[o + L_CAND + (b >> 5u)] |= 1u << (b & 31u); }
      }
    }
  } else {
    for (var w = 0u; w < 8u; w++) { L[o + L_CAND + w] = L[o + L_BEST + w]; }
    let k = 1u + rand4(P.seed, kind, t * 1000u, SALT_LEARN) % 3u;
    for (var j = 0u; j < k; j++) {
      let b = rand4(P.seed, kind, t * 1000u + 1u + j, SALT_LEARN) % 256u;
      L[o + L_CAND + (b >> 5u)] ^= 1u << (b & 31u);
    }
  }
}

@compute @workgroup_size(32)
fn learn(@builtin(local_invocation_index) t : u32) {
  if (t >= P.nl) { return; }
  let e = P.lb + t * 4u;
  let slot = M[e] & 255u; let kind = (M[e] >> 8u) & 255u;
  let cnt = atomicExchange(&CNT[slot], 0u);
  let o = slot * LS;
  let d = bitcast<i32>(P.gen - L[o + L_EP0]);
  if (d < 0 || d % LC != 0) { return; }
  if (d == 0) { L[o + L_BASE] = cnt; L[o + L_SCORE] = 0u; L[o + L_ZERO] = 0u; return; }
  let score = bitcast<i32>(L[o + L_SCORE]) + max(0i, bitcast<i32>(cnt) - bitcast<i32>(L[o + L_BASE])) + bitcast<i32>(cnt);
  L[o + L_SCORE] = bitcast<u32>(score);
  if (cnt == 0u) { L[o + L_ZERO] += 1u; } else { L[o + L_ZERO] = 0u; }
  let mode = L[o + L_MODE];
  if (!(d >= LL || (mode != 0u && L[o + L_ZERO] >= ZERO_STOP))) { return; }
  let rn = L[o + L_RN];
  var confirm = false;
  if (mode != 0u) {
    var sum = 0i;
    for (var j = 0u; j < rn; j++) { sum += bitcast<i32>(L[o + L_RING + j]); }
    var cn = 0u; if (mode != 1u) { cn = L[o + L_CN]; }
    L[o + L_CS + cn] = bitcast<u32>(score); L[o + L_CN] = cn + 1u;
    var csum = 0i;
    for (var j = 0u; j <= cn; j++) { csum += bitcast<i32>(L[o + L_CS + j]); }
    let win = rn == 0u || csum * bitcast<i32>(rn) > sum * bitcast<i32>(cn + 1u);
    if (win && cn + 1u < CONFIRM) { confirm = true; }
    else if (win) {
      for (var w = 0u; w < 8u; w++) { L[o + L_BEST + w] = L[o + L_CAND + w]; }
      for (var j = 0u; j < CONFIRM; j++) { L[o + L_RING + j] = L[o + L_CS + j]; }
      L[o + L_RN] = CONFIRM; L[o + L_RPOS] = CONFIRM % RING_N;
      L[o + L_LOSS] = 0u; L[o + L_WINS] += 1u;
    } else {
      if (sum != 0i) {
        L[o + L_LOSS] += 1u;
        if (L[o + L_LOSS] >= LOSE_STOP) { L[o + L_FIXED] = 1u; }
      }
    }
  } else {
    L[o + L_RING + L[o + L_RPOS]] = bitcast<u32>(score);
    L[o + L_RPOS] = (L[o + L_RPOS] + 1u) % RING_N;
    L[o + L_RN] = min(rn + 1u, RING_N);
  }
  L[o + L_LAST] = bitcast<u32>(score);
  let n = L[o + L_EPN] + 1u; L[o + L_EPN] = n;
  L[o + L_EP0] = P.gen + 1u;
  if (confirm) { L[o + L_MODE] = 2u; return; }
  var rs = 0i;
  for (var j = 0u; j < L[o + L_RN]; j++) { rs += bitcast<i32>(L[o + L_RING + j]); }
  let zero = rs == 0i;
  let cand = L[o + L_FIXED] == 0u && (zero || n <= EXPLORE || n % CAND_EVERY == CAND_EVERY - 1u);
  L[o + L_MODE] = select(0u, 1u, cand);
  if (cand) { makeCand(o, n, kind, zero); }
}
`;

// 盤全体の種族ごとの数（Q49 のルールの引き直しに使う。引き直す世代にだけ動かす）
//   POP の後ろ半分は、種族ごとの支配領域の中の自分の数（Q68=A）。D は種族ごとに [中心 x, 中心 y, 半分の幅＋1]（0 なら領域なし）
const POP_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> board : array<u32>;
@group(0) @binding(2) var<storage, read_write> POP : array<atomic<u32>>;
@group(0) @binding(3) var<storage, read> D : array<u32>;
var<workgroup> h : array<atomic<u32>, ${2 * MAX_SPECIES}>;
fn offs(a : u32, c : u32, n : u32) -> i32 {
  if (P.wrap == 0u) { return i32(a) - i32(c); }
  var d = i32((a + n - c % n) % n);
  if (2 * d > i32(n)) { d = d - i32(n); }
  return d;
}
@compute @workgroup_size(${WG}, ${WG})
fn pop(@builtin(global_invocation_id) id : vec3<u32>, @builtin(local_invocation_index) li : u32) {
  if (li < ${2 * MAX_SPECIES}u) { atomicStore(&h[li], 0u); }
  workgroupBarrier();
  if (id.x < P.W && id.y < P.H) {
    let v = board[id.y * P.W + id.x];
    if (v != 0u) {
      atomicAdd(&h[v - 1u], 1u);
      let e = (v - 1u) * 3u;
      let hp = D[e + 2u];
      if (hp != 0u) {
        let dx = offs(id.x, D[e], P.W); let dy = offs(id.y, D[e + 1u], P.H);
        if (dx * dx + dy * dy <= i32(hp) - 1) { atomicAdd(&h[${MAX_SPECIES}u + v - 1u], 1u); }
      }
    }
  }
  workgroupBarrier();
  if (li < ${2 * MAX_SPECIES}u) { let c = atomicLoad(&h[li]); if (c > 0u) { atomicAdd(&POP[li], c); } }
}
`;

// 区画（16×16 マス）ごとの生き物の数（自由編集モードのランダム生成で、空いた場所を探す。セッション9）
const OCC_WGSL = COMMON_WGSL + /* wgsl */`
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> board : array<u32>;
@group(0) @binding(2) var<storage, read_write> OCC : array<u32>;
var<workgroup> n : atomic<u32>;
@compute @workgroup_size(${WG}, ${WG})
fn occ(@builtin(global_invocation_id) id : vec3<u32>, @builtin(local_invocation_index) li : u32, @builtin(workgroup_id) wg : vec3<u32>) {
  if (li == 0u) { atomicStore(&n, 0u); }
  workgroupBarrier();
  if (id.x < P.W && id.y < P.H) { if (board[id.y * P.W + id.x] != 0u) { atomicAdd(&n, 1u); } }
  workgroupBarrier();
  if (li == 0u) { OCC[wg.y * ((P.W + ${WG - 1}u) / ${WG}u) + wg.x] = atomicLoad(&n); }
}
`;
export const OCC_TILE = WG;
// 世代ごとの数の記録（ランダム生成で、人口が落ち着いたかを見る）：HIST_N 世代分の輪。1 世代は 256 バイト（種族ごとの数 × 2）
export const HIST_N = 256;

const RENDER_WGSL = /* wgsl */`
struct View {
  W : u32, H : u32, wrap : u32, fx : u32,     // fx: 効果（フェード）の入り切り
  ox : f32, oy : f32, cpp : f32, t : f32,     // ox,oy: 画面の左上が盤のどこか（マス単位） cpp: 1画素が何マスか  t: フェードの進み 0〜1
  cw : f32, ch : f32, p0 : f32, p1 : f32,     // 画面の画素数
  grid : vec4<f32>, edge : vec4<f32>,
};
@group(0) @binding(0) var<uniform> V : View;
@group(0) @binding(1) var<storage, read> cur : array<u32>;
@group(0) @binding(2) var<storage, read> prev : array<u32>;
@group(0) @binding(3) var<uniform> PAL : array<vec4<f32>, ${MAX_SPECIES + 1}>; // 0 は空のマス（背景）、1〜 は種族の色

@vertex
fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
  let p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
  let fx = V.ox + pos.x * V.cpp;
  let fy = V.oy + pos.y * V.cpp;
  var cx = i32(floor(fx)); var cy = i32(floor(fy));
  let W = i32(V.W); let H = i32(V.H);
  if (V.wrap != 0u) {
    cx = ((cx % W) + W) % W; cy = ((cy % H) + H) % H;
  } else if (cx < 0 || cy < 0 || cx >= W || cy >= H) {
    return V.edge;
  }
  let i = u32(cy) * V.W + u32(cx);
  let a = min(cur[i], ${MAX_SPECIES}u);
  let b = min(prev[i], ${MAX_SPECIES}u);
  var col = PAL[a];
  // 生まれた・消えたマスは、前の色から今の色へだんだん変える（内部の状態には戻さない）
  // 混ぜるのは目に見える明るさ（光の量）で行う。画面の値のまま半分ずつ混ぜると中ほどで暗く見え、盤全体が明滅する
  if (V.fx != 0u && a != b) {
    let g = vec3(2.2);
    col = vec4(pow(mix(pow(PAL[b].rgb, g), pow(PAL[a].rgb, g), V.t), 1.0 / g), 1.0);
  }
  // 大きく拡大したときだけ、マスの境目を薄く出す
  if (V.cpp < 0.125) {
    let gx = fract(fx); let gy = fract(fy);
    let e = V.cpp * 1.0;
    if (gx < e || gy < e) { col = mix(col, V.grid, 0.6); }
  }
  return col;
}
`;

export async function getGPU() {
  if (!('gpu' in navigator)) return { ok: false, why: 'no-navigator-gpu' };
  if (!window.isSecureContext) return { ok: false, why: 'not-secure' };
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return { ok: false, why: 'no-adapter' };
  const wantTs = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: wantTs ? ['timestamp-query'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  return { ok: true, adapter, device, timestamps: wantTs };
}

export class LifeGPU {
  // opts: { W, H, wrap, seed, density, rules（compile の結果）, mothers（MotherSet。省略可）,
  //         palette（[背景, 種族1, …] の RGBA）, canvas（省略可）, format（省略可）,
  //         chain（ChainState。省略可。連鎖の世界 §18。rules は世代 0 の sync の結果を使う） }
  constructor(device, opts) {
    this.device = device;
    this.W = opts.W; this.H = opts.H;
    this.wrap = opts.wrap !== false;
    this.seed = opts.seed >>> 0;
    this.gen = 0;
    this.cur = 0; // いまの世代が入っているのは bufs[cur]

    const N = this.W * this.H;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.bufs = [0, 1].map(() => device.createBuffer({ size: N * 4, usage }));
    // 世代ごとの設定（Params）を SLOT バイトずつ並べて置き、動的オフセットで選ぶ（1回の送信の中で世代の番号を変えるため）
    this.params = device.createBuffer({ size: SLOT * MAX_SLOTS, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.slotData = new Uint32Array(SLOT / 4 * MAX_SLOTS);
    this.rulesBuf = device.createBuffer({ size: MAX_SPECIES * STRIDE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAMS_BYTES } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const mod = device.createShaderModule({ code: STEP_WGSL });
    this.stepPipe = device.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'step' } });
    this.initPipe = device.createComputePipeline({ layout, compute: { module: mod, entryPoint: 'init' } });
    // stepBG[k]：bufs[k] を読んで bufs[1-k] に書く。初期化は stepBG[1]（bufs[0] に書く）を使う
    this.stepBG = [0, 1].map(k => device.createBindGroup({
      layout: bgl,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.bufs[1 - k] } },
                { binding: 3, resource: { buffer: this.rulesBuf } }],
    }));
    this.groups = [Math.ceil(this.W / WG), Math.ceil(this.H / WG)];

    // マザーの供給の段：盤を読んで同じ盤に書く。M はマザーの並び（世代ごとに CPU が作って送る）
    this.mothers = opts.mothers ?? null;
    this.supBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: PARAMS_BYTES } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    ] });
    // 学習（§18 の④）：状態（種族ごとに LS 語）と数（種族ごとに 1 語）
    this.learnBuf = device.createBuffer({ size: MAX_LEARN * LS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.cntBuf = device.createBuffer({ size: MAX_SPECIES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const ent = (b, type, dyn = false) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: dyn ? { type, hasDynamicOffset: true, minBindingSize: PARAMS_BYTES } : { type } });
    this.cntBGL = device.createBindGroupLayout({ entries: [ent(0, 'uniform', true), ent(1, 'read-only-storage'), ent(2, 'read-only-storage'), ent(3, 'read-only-storage'), ent(4, 'storage')] });
    this.lrnBGL = device.createBindGroupLayout({ entries: [ent(0, 'uniform', true), ent(1, 'read-only-storage'), ent(2, 'storage'), ent(3, 'storage')] });
    this.cntPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.cntBGL] }),
      compute: { module: device.createShaderModule({ code: COUNT_WGSL }), entryPoint: 'count' },
    });
    this.lrnPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.lrnBGL] }),
      compute: { module: device.createShaderModule({ code: LEARN_WGSL }), entryPoint: 'learn' },
    });
    // 盤全体の種族ごとの数（Q49）
    this.popBuf = device.createBuffer({ size: 2 * MAX_SPECIES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.popRB = device.createBuffer({ size: 2 * MAX_SPECIES * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.domBuf = device.createBuffer({ size: 3 * MAX_SPECIES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });   // 支配領域の表（Q68=A）
    this.popBGL = device.createBindGroupLayout({ entries: [ent(0, 'uniform', true), ent(1, 'read-only-storage'), ent(2, 'storage'), ent(3, 'read-only-storage')] });
    this.popPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.popBGL] }),
      compute: { module: device.createShaderModule({ code: POP_WGSL }), entryPoint: 'pop' },
    });
    this.popBG = [0, 1].map(k => device.createBindGroup({
      layout: this.popBGL,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.popBuf } },
                { binding: 3, resource: { buffer: this.domBuf } }],
    }));
    this.popWait = null; this.popGen = -1; this.popCounts = null;
    // 世代ごとの数の記録（hist が真のあいだだけ、毎世代の計算のあとに数える）
    this.hist = false; this.histBusy = false;
    this.histBuf = device.createBuffer({ size: HIST_N * 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    this.histRB = device.createBuffer({ size: HIST_N * 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const histBGL = device.createBindGroupLayout({ entries: [ent(0, 'uniform', true), ent(1, 'read-only-storage'),
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage', hasDynamicOffset: true, minBindingSize: 256 } }, ent(3, 'read-only-storage')] });
    this.histPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [histBGL] }),
      compute: { module: device.createShaderModule({ code: POP_WGSL }), entryPoint: 'pop' },
    });
    this.histBG = [0, 1].map(k => device.createBindGroup({
      layout: histBGL,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.histBuf, size: 256 } },
                { binding: 3, resource: { buffer: this.domBuf } }],
    }));
    this.supPipe = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.supBGL] }),
      compute: { module: device.createShaderModule({ code: SUPPLY_WGSL }), entryPoint: 'supply' },
    });
    this.mCap = 0;
    this.ensureM(4096);

    this.chain = opts.chain ?? null;
    this.palette = opts.palette ?? null;
    if (opts.canvas) this.attachCanvas(opts.canvas, opts.format);
    if (this.chain) this.syncChain();
    else this.setRules(opts.rules);
    this.sendLearn();
    if (this.palette && this.palBuf) this.setPalette(this.palette);
    this.reset(this.seed, opts.density ?? 0.278);
  }

  // ルールを入れ替える（世代の途中では呼ばない。§3.4）
  setRules(rules) {
    if (!rules || rules.S < 1 || rules.S > MAX_SPECIES) throw new Error('rules が正しくない');
    this.rules = rules;
    this.device.queue.writeBuffer(this.rulesBuf, 0, rules.table);
  }

  // 連鎖の世界（§18）：いまの世代の始めに種族の数をそろえる。増えたらルール・マザー・色を入れ替える
  syncChain() {
    const r = this.chain.sync(this.gen, this.mothers ? this.mothers.ms : []);
    if (!r) return false;
    this.setRules(r.rules);
    if (this.mothers) { this.mothers.add(r.mothers); this.sendLearn(); }
    if (this.palette) {
      this.palette = [this.palette[0], ...r.world.species.map(s => hexToRGBA(s.color))];
      if (this.palBuf) this.setPalette(this.palette);
    }
    return true;
  }

  // 足したばかりのマザーの学習の状態を GPU に送る（それより前に GPU が進めた分は触らない）
  sendLearn() {
    if (!this.mothers) return;
    for (const slot of this.mothers.learnNew)
      this.device.queue.writeBuffer(this.learnBuf, slot * LS * 4, this.mothers.learn, slot * LS, LS);
    this.mothers.learnNew = [];
  }
  // 学習の状態を CPU に読む（画面に出す・答え合わせ用。毎世代は使わない）
  async readLearn() {
    const size = MAX_LEARN * LS * 4;
    const rb = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.learnBuf, 0, rb, 0, size);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    return out;
  }

  // マザーの並びの置き場を words 語以上にする（足りなければ作り直す）
  ensureM(words) {
    if (words <= this.mCap) return;
    if (this.mBuf) this.mBuf.destroy();
    this.mCap = Math.max(words, this.mCap * 2);
    this.mBuf = this.device.createBuffer({ size: this.mCap * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    // supBG[k]：bufs[k] に供給する
    this.supBG = [0, 1].map(k => this.device.createBindGroup({
      layout: this.supBGL,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.mBuf } },
                { binding: 3, resource: { buffer: this.rulesBuf } },
                { binding: 4, resource: { buffer: this.learnBuf } }],
    }));
    // cntBG[k]：bufs[k] を数える。lrnBG：判断
    this.cntBG = [0, 1].map(k => this.device.createBindGroup({
      layout: this.cntBGL,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.mBuf } },
                { binding: 3, resource: { buffer: this.learnBuf } },
                { binding: 4, resource: { buffer: this.cntBuf } }],
    }));
    this.lrnBG = this.device.createBindGroup({
      layout: this.lrnBGL,
      entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                { binding: 1, resource: { buffer: this.mBuf } },
                { binding: 2, resource: { buffer: this.learnBuf } },
                { binding: 3, resource: { buffer: this.cntBuf } }],
    });
  }

  // slot 番目の置き場に、世代 gen の設定を書く（まだ GPU には送らない）
  fillSlot(slot, gen, extra = {}) {
    const o = slot * SLOT / 4, d = this.slotData;
    d[o] = this.W; d[o + 1] = this.H; d[o + 2] = gen >>> 0; d[o + 3] = this.seed;
    d[o + 4] = this.wrap ? 1 : 0; d[o + 5] = extra.thr ?? 0; d[o + 6] = extra.salt ?? 0; d[o + 7] = this.rules.S;
    d[o + 8] = this.rules.pick; d[o + 9] = extra.tb ?? 0; d[o + 10] = extra.ib ?? 0; d[o + 11] = extra.mb ?? 0;
    d[o + 12] = this.mothers ? this.mothers.mode : 0;
    d[o + 13] = this.rules.eat ?? 1;
    d[o + 14] = extra.lb ?? 0; d[o + 15] = extra.nl ?? 0;
  }
  sendSlots(n) { this.device.queue.writeBuffer(this.params, 0, this.slotData, 0, n * SLOT / 4); }

  // 種から盤を作り直す（世代 0）
  reset(seed, density) {
    this.seed = seed >>> 0; this.gen = 0; this.cur = 0;
    this.fillSlot(0, 0, { thr: probToThreshold(density) });
    this.sendSlots(1);
    const enc = this.device.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(this.initPipe); p.setBindGroup(0, this.stepBG[1], [0]);
    p.dispatchWorkgroups(...this.groups); p.end();
    // 「前の世代」も同じにしておく（フェードが最初に光らないように）
    enc.copyBufferToBuffer(this.bufs[0], 0, this.bufs[1], 0, this.W * this.H * 4);
    this.device.queue.submit([enc.finish()]);
  }

  // CPU で作った盤をそのまま入れる（答え合わせ用）
  upload(cells) {
    this.gen = 0; this.cur = 0;
    this.device.queue.writeBuffer(this.bufs[0], 0, cells);
    this.device.queue.writeBuffer(this.bufs[1], 0, cells);
  }

  // n 世代進める。ts（GpuTimer）を渡すと、計算の前後の GPU 時刻を書く（n が MAX_SLOTS 以下のときだけ）
  // 1世代は「マザーの供給（あれば）→ 計算」の順（技術書 §7.2）
  // 連鎖の世界では、種族が増える世代で送る単位を分け、その世代の始めにルールを入れ替える
  // 進めた世代の数を返す。いちばん少ない種族のルールを引き直す世代（Q49）では、盤全体の数を GPU から読み終えるまで
  // その世代で止まる（0 を返すことがある）。読み終えるのを待つには settle() を使う
  step(n = 1, ts = null) {
    if (!this.chain) { this.stepRaw(n, ts); return n; }
    let done = 0;
    while (done < n) {
      this.syncChain();
      if (this.chain.needCounts(this.gen)) {
        if (this.popGen !== this.gen) { this.startPop(); break; }
        if (!this.popCounts) break;
        this.applyReplace();
      }
      const k = Math.min(n - done, this.chain.next(this.gen) - this.gen);
      this.stepRaw(k, ts);
      done += k;
    }
    return done;
  }
  // 盤全体の種族ごとの数を数えて読み戻し始める（いまの世代の始め＝供給の前の盤）
  startPop() {
    this.popGen = this.gen; this.popCounts = null;
    this.fillSlot(0, this.gen); this.sendSlots(1);
    this.device.queue.writeBuffer(this.popBuf, 0, new Uint32Array(2 * MAX_SPECIES));
    this.device.queue.writeBuffer(this.domBuf, 0, this.mothers ? this.mothers.domainTable() : new Uint32Array(3 * MAX_SPECIES));
    const enc = this.device.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(this.popPipe); p.setBindGroup(0, this.popBG[this.cur], [0]);
    p.dispatchWorkgroups(...this.groups); p.end();
    enc.copyBufferToBuffer(this.popBuf, 0, this.popRB, 0, 2 * MAX_SPECIES * 4);
    this.device.queue.submit([enc.finish()]);
    const gen = this.gen;
    this.popWait = this.popRB.mapAsync(GPUMapMode.READ).then(() => {
      const c = new Uint32Array(this.popRB.getMappedRange().slice(0));
      this.popRB.unmap();
      if (this.popGen === gen) this.popCounts = c;
    });
  }
  // 読み戻した数で種族のルールを引き直す（ChainState.replace）。引き直した種族のマザーは学習を最初からやり直す
  applyReplace() {
    const c = this.popCounts;   // 前半は盤全体の数、後半は支配領域の中の自分の数（Q68=A）
    const r = this.chain.replace(this.gen, c.subarray(0, MAX_SPECIES), this.mothers ? c.subarray(MAX_SPECIES) : null);
    this.popCounts = null;
    this.setRules(r.rules);
    if (this.mothers) { for (const q of r.list) this.mothers.relearn(q.kind, q.stamp, q.t0); this.sendLearn(); }
  }
  // 引き直しのための読み戻しを待つ
  async settle() { if (this.popWait) await this.popWait; }
  stepRaw(n = 1, ts = null) {
    while (n > MAX_SLOTS) { this.stepRaw(MAX_SLOTS); n -= MAX_SLOTS; }
    if (n <= 0) return;
    // 世代ごとのマザーの並びを作って1つにつなげる
    const tilesPerGen = new Array(n).fill(0);
    const learnPerGen = new Array(n).fill(null);   // [学習するマザーの数, 領域の区画の数（一辺）]
    const parts = [];
    let words = 0;
    for (let g = 0; g < n; g++) {
      const extra = {};
      if (this.mothers) {
        const list = this.mothers.supplies();
        this.mothers.advance();
        if (list.length) {
          const p = packSupplies(list, this.W, this.H, this.wrap);
          extra.tb = words; words += p.tiles.length;
          extra.ib = words; words += p.idx.length;
          extra.mb = words; words += p.ms.length;
          parts.push(p.tiles, p.idx, p.ms);
          tilesPerGen[g] = p.nTiles;
          const lp = packLearn(list);
          if (lp.n) {
            extra.lb = words; words += lp.words.length; extra.nl = lp.n;
            parts.push(lp.words);
            learnPerGen[g] = [lp.n, Math.ceil((2 * lp.maxHalf + 1) / 16)];
          }
        }
      }
      this.fillSlot(g, this.gen + g, extra);
    }
    this.sendSlots(n);
    if (words) {
      this.ensureM(words);
      const all = new Uint32Array(words);
      let o = 0; for (const a of parts) { all.set(a, o); o += a.length; }
      this.device.queue.writeBuffer(this.mBuf, 0, all);
    }
    // 計算の段の並び（時刻を測るときは、最初の段の始まりと最後の段の終わりに書く）
    const passes = [];
    for (let g = 0; g < n; g++) {
      if (tilesPerGen[g]) passes.push({ g, sup: true });
      if (learnPerGen[g]) { passes.push({ g, cnt: true }); passes.push({ g, lrn: true }); }
      passes.push({ g, sup: false });
    }
    const enc = this.device.createCommandEncoder();
    passes.forEach((q, k) => {
      const desc = {};
      if (ts && k === 0) desc.timestampWrites = { querySet: ts.querySet, beginningOfPassWriteIndex: ts.begin };
      if (ts && k === passes.length - 1) desc.timestampWrites = { ...(desc.timestampWrites || { querySet: ts.querySet }), endOfPassWriteIndex: ts.end };
      const p = enc.beginComputePass(desc);
      if (q.sup) {
        p.setPipeline(this.supPipe); p.setBindGroup(0, this.supBG[this.cur], [q.g * SLOT]);
        p.dispatchWorkgroups(tilesPerGen[q.g]);
      } else if (q.cnt) {
        const [nl, t] = learnPerGen[q.g];
        p.setPipeline(this.cntPipe); p.setBindGroup(0, this.cntBG[this.cur], [q.g * SLOT]);
        p.dispatchWorkgroups(t, t, nl);
      } else if (q.lrn) {
        p.setPipeline(this.lrnPipe); p.setBindGroup(0, this.lrnBG, [q.g * SLOT]);
        p.dispatchWorkgroups(1);
      } else {
        p.setPipeline(this.stepPipe); p.setBindGroup(0, this.stepBG[this.cur], [q.g * SLOT]);
        p.dispatchWorkgroups(...this.groups);
        this.cur = 1 - this.cur;
      }
      p.end();
      if (this.hist && !q.sup && !q.cnt && !q.lrn) {
        // 計算したあとの盤（世代 gen+g+1）の数を、輪の (gen+g+1) % HIST_N 番目に書く
        const off = ((this.gen + q.g + 1) % HIST_N) * 256;
        enc.clearBuffer(this.histBuf, off, 256);
        const h = enc.beginComputePass();
        h.setPipeline(this.histPipe); h.setBindGroup(0, this.histBG[this.cur], [q.g * SLOT, off]);
        h.dispatchWorkgroups(...this.groups); h.end();
      }
    });
    this.gen += n;
    if (ts && ts.resolve) ts.resolve(enc);
    this.device.queue.submit([enc.finish()]);
  }

  // いまの盤を CPU に読む（答え合わせ・保存のときだけ使う。毎世代は使わない）
  async read() {
    const size = this.W * this.H * 4;
    const rb = this.device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufs[this.cur], 0, rb, 0, size);
    this.device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const out = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    return out;
  }

  // 1 マスを書きかえる（自由編集モードの「置く・消す」）。前の世代にも同じ値を書いて、フェードで光らせない
  setCells(list) {
    for (const [i, v] of list) {
      const a = new Uint32Array([v]);
      this.device.queue.writeBuffer(this.bufs[0], i * 4, a);
      this.device.queue.writeBuffer(this.bufs[1], i * 4, a);
    }
  }

  // 人口グラフ用：盤全体の種族ごとの数を読む（引き直しの読み戻しとは別の入れ物。読んでいる最中なら null）
  // 返り値 { gen, counts: Uint32Array(MAX_SPECIES) }
  async readCounts() {
    if (this.gBusy || this.dead) return null;
    if (!this.gBuf) {
      this.gBuf = this.device.createBuffer({ size: 2 * MAX_SPECIES * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      this.gRB = this.device.createBuffer({ size: MAX_SPECIES * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      this.gBG = [0, 1].map(k => this.device.createBindGroup({
        layout: this.popBGL,
        entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                  { binding: 1, resource: { buffer: this.bufs[k] } },
                  { binding: 2, resource: { buffer: this.gBuf } },
                  { binding: 3, resource: { buffer: this.domBuf } }],
      }));
    }
    this.gBusy = true;
    const gen = this.gen;
    try {
      this.device.queue.writeBuffer(this.gBuf, 0, new Uint32Array(2 * MAX_SPECIES));
      const enc = this.device.createCommandEncoder();
      const p = enc.beginComputePass();
      p.setPipeline(this.popPipe); p.setBindGroup(0, this.gBG[this.cur], [0]);   // 枠 0 の盤の大きさ・端だけを使う
      p.dispatchWorkgroups(...this.groups); p.end();
      enc.copyBufferToBuffer(this.gBuf, 0, this.gRB, 0, MAX_SPECIES * 4);
      this.device.queue.submit([enc.finish()]);
      await this.gRB.mapAsync(GPUMapMode.READ);
      const counts = new Uint32Array(this.gRB.getMappedRange().slice(0));
      this.gRB.unmap();
      return { gen, counts };
    } catch (e) { return null; }
    finally { this.gBusy = false; }
  }

  // 世代ごとの数の輪を読む。{ gen, data }：data[(g % HIST_N) * 64 + s − 1] が世代 g の種族 s の数（g は gen から HIST_N 世代前まで）
  //   読んでいる最中なら null。hist を真にした世代より前の分は意味がない
  async readHist() {
    if (this.histBusy || this.dead) return null;
    this.histBusy = true;
    const gen = this.gen;
    try {
      const enc = this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.histBuf, 0, this.histRB, 0, HIST_N * 256);
      this.device.queue.submit([enc.finish()]);
      await this.histRB.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(this.histRB.getMappedRange().slice(0));
      this.histRB.unmap();
      return { gen, data };
    } catch (e) { return null; }
    finally { this.histBusy = false; }
  }
  // 区画（16×16 マス）ごとの生き物の数を読む。{ tw, th, occ }（occ[ty*tw+tx]）。読んでいる最中なら null
  async readOcc() {
    if (this.occBusy || this.dead) return null;
    const [tw, th] = this.groups;
    if (!this.occBuf) {
      this.occBuf = this.device.createBuffer({ size: tw * th * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      this.occRB = this.device.createBuffer({ size: tw * th * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const ent = (b, type, dyn = false) => ({ binding: b, visibility: GPUShaderStage.COMPUTE, buffer: dyn ? { type, hasDynamicOffset: true, minBindingSize: PARAMS_BYTES } : { type } });
      const bgl = this.device.createBindGroupLayout({ entries: [ent(0, 'uniform', true), ent(1, 'read-only-storage'), ent(2, 'storage')] });
      this.occPipe = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
        compute: { module: this.device.createShaderModule({ code: OCC_WGSL }), entryPoint: 'occ' },
      });
      this.occBG = [0, 1].map(k => this.device.createBindGroup({
        layout: bgl,
        entries: [{ binding: 0, resource: { buffer: this.params, size: PARAMS_BYTES } },
                  { binding: 1, resource: { buffer: this.bufs[k] } },
                  { binding: 2, resource: { buffer: this.occBuf } }],
      }));
    }
    this.occBusy = true;
    try {
      const enc = this.device.createCommandEncoder();
      const p = enc.beginComputePass();
      p.setPipeline(this.occPipe); p.setBindGroup(0, this.occBG[this.cur], [0]);   // 枠 0 の盤の大きさだけを使う
      p.dispatchWorkgroups(tw, th); p.end();
      enc.copyBufferToBuffer(this.occBuf, 0, this.occRB, 0, tw * th * 4);
      this.device.queue.submit([enc.finish()]);
      await this.occRB.mapAsync(GPUMapMode.READ);
      const occ = new Uint32Array(this.occRB.getMappedRange().slice(0));
      this.occRB.unmap();
      return { tw, th, occ, gen: this.gen };
    } catch (e) { return null; }
    finally { this.occBusy = false; }
  }

  // ── 描画 ──
  attachCanvas(canvas, format) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('webgpu');
    this.format = format || navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.viewBuf = this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.palBuf = this.device.createBuffer({ size: (MAX_SPECIES + 1) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const mod = this.device.createShaderModule({ code: RENDER_WGSL });
    this.renderPipe = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: mod, entryPoint: 'vs' },
      fragment: { module: mod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    // renderBG[k]：いまの世代が bufs[k]、前の世代が bufs[1-k]
    this.renderBG = [0, 1].map(k => this.device.createBindGroup({
      layout: this.renderPipe.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.viewBuf } },
                { binding: 1, resource: { buffer: this.bufs[k] } },
                { binding: 2, resource: { buffer: this.bufs[1 - k] } },
                { binding: 3, resource: { buffer: this.palBuf } }],
    }));
  }

  // palette: [背景, 種族1, 種族2, …] の [r,g,b,a]（0〜1）
  setPalette(palette) {
    const f = new Float32Array((MAX_SPECIES + 1) * 4);
    palette.slice(0, MAX_SPECIES + 1).forEach((c, i) => f.set(c, i * 4));
    this.device.queue.writeBuffer(this.palBuf, 0, f);
  }

  // view: { ox, oy, cpp, t, fade, colors:{grid,edge} }
  render(view) {
    const f = new Float32Array(24);
    const u = new Uint32Array(f.buffer);
    u[0] = this.W; u[1] = this.H; u[2] = this.wrap ? 1 : 0; u[3] = view.fade ? 1 : 0;
    f[4] = view.ox; f[5] = view.oy; f[6] = view.cpp; f[7] = Math.min(1, Math.max(0, view.t));
    f[8] = this.canvas.width; f[9] = this.canvas.height;
    const c = view.colors;
    f.set(c.grid, 12); f.set(c.edge, 16);
    this.device.queue.writeBuffer(this.viewBuf, 0, f);
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(this.renderPipe); pass.setBindGroup(0, this.renderBG[this.cur]);
    pass.draw(3); pass.end();
    this.device.queue.submit([enc.finish()]);
  }

  destroy() {
    this.dead = true;
    if (this.gBuf) { this.gBuf.destroy(); this.gRB.destroy(); }
    if (this.occBuf) { this.occBuf.destroy(); this.occRB.destroy(); }
    this.histBuf.destroy(); this.histRB.destroy();
    this.bufs.forEach(b => b.destroy());
    this.params.destroy(); this.rulesBuf.destroy(); this.mBuf.destroy(); this.learnBuf.destroy(); this.cntBuf.destroy(); this.popBuf.destroy(); this.popRB.destroy(); this.domBuf.destroy();
    if (this.viewBuf) { this.viewBuf.destroy(); this.palBuf.destroy(); }
  }
}

// GPU の時刻を測る道具（timestamp-query）。測った区間の ms を返す
export class GpuTimer {
  constructor(device) {
    this.device = device;
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    this.res = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.rb = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.begin = 0; this.end = 1;
    this.resolve = enc => { enc.resolveQuerySet(this.querySet, 0, 2, this.res, 0); enc.copyBufferToBuffer(this.res, 0, this.rb, 0, 16); };
  }
  async ms() {
    await this.rb.mapAsync(GPUMapMode.READ);
    const t = new BigUint64Array(this.rb.getMappedRange().slice(0));
    this.rb.unmap();
    return Number(t[1] - t[0]) / 1e6;
  }
  destroy() { this.querySet.destroy(); this.res.destroy(); this.rb.destroy(); }
}
