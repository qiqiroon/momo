// MOMO Life — 連鎖して増える世界（詳細仕様書 §18）の①：種族を途中で足す仕組みと、捕食の輪（§18.5 で 4 組の輪に直した）
// 世界のデータは「種」と「いまの種族の数 n」だけで決まる（chainWorld）。足すたびに作り直すので、
// どのパソコンでも、同じ種・同じ世代なら同じ種族・同じルールになる。
// 足す時期（世代）は ChainState が決め、GPU 版と CPU の手本の両方が同じ世代でそろえる。
import { rand, SALT } from './life-rand.js';
import { compile, self, sp, MAX_SPECIES } from './life-rules.js';
import { MOTHER_DEFAULTS, defaultDensity, STAMP_WORDS, domainGap as gap, domArea } from './life-mother.js';

const U32 = 4294967296;
const TWO_PI = Math.PI * 2;

// 足す間隔（世代。Q23=A）と上限（Q29=A）、マザーの支配領域の一辺（マス。§18 の②）の最初の値
export const CHAIN_DEFAULTS = Object.freeze({ every: 2000, max: MAX_SPECIES, domain: 100, stamp: true, stampEvery: 300, learn: true, learnMin: 10000 });
// learnMin：学習時間（2026-11-19 セッション9）。ルールを持ってから（足されてから・引き直されてから）この世代数がたつまでは、
//   「弱い 4 種」「少ない 4 種」の決まりでは引き直さない（学ぶ時間を残す）。1 回の試しが 1,000 世代なので 10 回分
// 「弱い 4 種」「少ない 4 種」の数
export const REP_N = 4;

// 引き直した種族の見極め（Q68=A）：次の引き直しの世代に、支配領域の中の自分の数がこの割合（%）に届かなければ、また引き直す
export const FILL_MIN = 10;

// 置き場所の候補を試す回数。全部重なるときは、いちばん離れた候補にする
export const PLACE_TRIES = 64;

// lo〜hi から、違う数を want 個引いて、許す個数の印にする。slot は使い道の番号
function drawMask(seed, k, slot, lo, hi, want) {
  let m = 0, n = 0;
  for (let j = 0; n < want; j++) {
    const v = lo + rand(seed, k, slot * 1000 + j, SALT.CHAIN) % (hi - lo + 1);
    if (!((m >>> v) & 1)) { m |= 1 << v; n++; }
  }
  return m;
}

// 種族 k のルールの印。Conway（B3/S23）と同じ数え方で、誕生は数 1 つ、生存は数 2 つ（Q26=A・Q36=A）
//   k=1 は Conway。2 から先は、誕生を 2〜6 から 1 つ（Q37=A・§18.6）、生存は誕生と同じ数と、0〜8 から誕生と違う数 1 つ
//   survive は組の並び（いまは 1 組）
//   prey：k が食べるときの数。獲物のマスの周りに k が ちょうどこの数だけいれば食べる。2〜6 から 1 つ（Q39=A・Q71。k=1 も引く）
//   v は引き直しの回数（Q49。0 が最初のルール）。v ≥ 1 は乱数の番号を k＋v×256 に変えて引き直す
//   k=1 は Conway（B3/S23）で、捕食の数は 2 に固定。引き直さない（2026-11-19 セッション9。前は Q74 で捕食の数だけ引き直していた）
export function chainRule(seed, k, v = 0) {
  if (k === 1) return { birth: 1 << 3, survive: [(1 << 2) | (1 << 3)], prey: 1 << 2 };
  const kk = k + v * 256;
  const prey = drawMask(seed, kk, 3, 2, 6, 1);
  k = kk;
  // 生存の 2 つのうち 1 つは誕生と同じ数、もう 1 つは 0〜8 から誕生と違う数（§18.6）
  const birth = drawMask(seed, k, 0, 2, 6, 1);
  let other = 0;
  for (let j = 0; !other; j++) { const v = rand(seed, k, 1000 + j, SALT.CHAIN) % 9; if (!((birth >>> v) & 1)) other = 1 << v; }
  return { birth, survive: [birth | other], prey };
}

// e が v を食べるか（Q38=A）：番号を 4 で割った余りで 4 つの組に分け、組どうしで輪にする
//   1 の組（1・5・9…）は 2 の組（2・6・10…）を、2 の組は 3 の組を、3 の組は 4 の組を、4 の組は 1 の組を食べる
//   G：組の数（ふつう 4）。種族の上限が 4 より少ない狭い盤では上限の数にして、少ない種族でも輪が閉じるようにする（セッション10）
export const chainEats = (e, v, G = 4) => ((v - e) % G + G) % G === 1;

// 盤の広さに合わせた種族（＝マザー）の上限（セッション10）：全マザーの支配領域の面積の合計が、盤の面積の 1/3 以下。
//   4 以上なら 4 の倍数に切り下げる。32 を超えれば 32
export function chainMax(W, H, domain = CHAIN_DEFAULTS.domain) {
  const a = domain > 0 ? domArea(Math.floor(domain / 2)) : 0;
  let n = a ? Math.floor(W * H / 3 / a) : MAX_SPECIES;
  n = Math.min(MAX_SPECIES, n);
  if (n >= 4) n -= n % 4;
  return Math.max(1, n);
}

// 印 → '36' のような数字の並び
const digits = m => [...Array(9).keys()].filter(v => (m >>> v) & 1).join('');
// 例「B3S23E2」＝生まれる 3、生き残る 2 と 3、捕食する 2（利用者の書き方。E は eat）
export const chainLabel = r => `B${digits(r.birth)}S${digits(r.survive.reduce((a, m) => a | m, 0))}E${digits(r.prey)}`;

// 種族の色（Q74・Q77=B）：捕食の組（番号を 4 で割った余り）ごとに色相の近い色に寄せる
//   組の中心の色相は 1 の組＝緑 142・2 の組＝青 232・3 の組＝赤紫 322・4 の組＝黄 52（90 度ずつ）
//   組の中の 8 種（j＝0〜7）は、色相を 5 度ずつ（−17.5〜＋17.5 度）、明るさを 0.30〜0.86 の 8 段にずらし、
//   鮮やかさを濃い 0.95 とくすんだ 0.40 で交互にする（種族 1 もこの式。前の #4ade80 ではなくなる）
export const CHAIN_HUES = [142, 232, 322, 52];
// 種族の名前（セッション9）：組の色の頭文字＋組の中の順番。緑 G1・青 B1・赤紫 M1・黄 Y1・緑 G2 …（種族 1＝Conway は G1）
export const chainName = k => 'GBMY'[(k - 1) % 4] + (((k - 1) >> 2) + 1);
const CHAIN_LIGHT = [0.30, 0.38, 0.46, 0.54, 0.62, 0.70, 0.78, 0.86];
export function chainColor(k) {
  const g = (k - 1) % 4, j = (k - 1) >> 2;
  const h = (CHAIN_HUES[g] + (j - 3.5) * 5 + 360) % 360;
  return hslHex(h, j % 2 ? 0.40 : 0.95, CHAIN_LIGHT[j]);
}
function hslHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = n => { const t = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1)); };
  return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

// 種 seed で n 種族いるときの世界のデータ（§18.1・§18.5）
//   捕食は 4 つの組の輪（chainEats）。まだいない種族は相手から外れる（3 種以下のうちは輪が閉じない）
//   捕食の条件は誕生とは別（chainRule の prey）。成り立てば、誕生の条件にかかわらず食べた種族に置き換わる（preyReplace）
//   獲物 v の捕食の組：v を食べる種族 e ごとに 1 組「周りの e の数が e の捕食の数」（32 種で最大 8 組＝組の上限）
//   opts.ver：種族ごとの引き直しの回数（ver[k]。省略は 0）
export function chainWorld(seed, n, opts = {}) {
  if (!(n >= 1 && n <= MAX_SPECIES)) throw new Error(`種族の数は 1〜${MAX_SPECIES}: ${n}`);
  const ver = opts.ver ?? [], custom = opts.custom ?? [], G = opts.groups ?? 4;
  // custom[k]：読み出したルール（セッション10。マザーの値のファイルから）。あればそれを使う
  const rules = Array.from({ length: n }, (_, i) => custom[i + 1] ?? chainRule(seed, i + 1, ver[i + 1] ?? 0));
  const species = rules.map((r, i) => {
    const k = i + 1;
    const prey = [];
    for (let e = 1; e <= n; e++) if (chainEats(e, k, G)) prey.push([sp(e, rules[e - 1].prey)]);
    return {
      id: k, name: { ja: chainName(k), en: chainName(k) }, label: chainLabel(r), color: chainColor(k),
      birth: [[self(r.birth)]],
      survive: r.survive.map(m => [self(m)]),
      prey,
    };
  });
  return { pick: opts.pick ?? 'equal', preyReplace: true, init: { density: 0 }, species };
}

// でたらめな置き形（§18 の③。16×16＝u32 8 語）。密度は 30〜40% から 1 つ。番号 v で同じ種族の別の形を引ける
//   密度は rand(種, k, v*1000, CHAIN_STAMP)、ビット b は rand(種, k, v*1000+1+b, CHAIN_STAMP)
export function chainStamp(seed, k, v = 0) {
  const pct = 30 + rand(seed, k, v * 1000, SALT.CHAIN_STAMP) % 11;
  const thr = Math.floor(pct * 4294967296 / 100);
  const st = new Uint32Array(STAMP_WORDS);
  for (let b = 0; b < 256; b++) if (rand(seed, k, v * 1000 + 1 + b, SALT.CHAIN_STAMP) < thr) st[b >>> 5] |= 1 << (b & 31);
  return st;
}

// 種族 k のマザー。支配領域が、いまいるマザー（existing）の領域と重ならない場所に置く（Q28=A）
//   候補 j の場所は rand(種, k, 3j / 3j+1, CHAIN_PLACE)。前から順に試し、重ならない最初の候補にする
//   PLACE_TRIES 回とも重なれば（盤が狭いとき）、いちばん離れた候補にする（同じ離れ具合なら前の候補）
export function chainMother(seed, k, sp, W, H, opts = {}) {
  const domain = opts.domain ?? 0, wrap = opts.wrap ?? true, existing = opts.existing ?? [];
  const half = domain > 0 ? Math.floor(domain / 2) : 0;
  let bx = 0, by = 0, best = -Infinity;
  for (let j = 0; j < PLACE_TRIES; j++) {
    const x = rand(seed, k, 3 * j, SALT.CHAIN_PLACE) / U32 * W;
    const y = rand(seed, k, 3 * j + 1, SALT.CHAIN_PLACE) / U32 * H;
    let g = Infinity;
    for (const e of existing) {
      const eh = e.domain > 0 ? Math.floor(e.domain / 2) : 0;
      g = Math.min(g, gap(x, y, half, e.x, e.y, eh, W, H, wrap));
    }
    if (g > best) { best = g; bx = x; by = y; }
    if (g > 0) break;
  }
  return {
    ...MOTHER_DEFAULTS, density: defaultDensity(sp), kind: k, domain,
    stamp: opts.stamp ? chainStamp(seed, k) : null, stampEvery: opts.stampEvery ?? MOTHER_DEFAULTS.stampEvery, t0: opts.t0 ?? 0,
    learn: !!(opts.learn && opts.stamp && domain > 0),
    x: bx, y: by,
    dir: rand(seed, k, 2, SALT.CHAIN_PLACE) / U32 * TWO_PI,
  };
}

// 世代 gen の始めにいる種族の数：世代 0 は 1 種、every 世代ごとに 1 種ずつ増え、max で止まる
export const chainCount = (c, gen) => Math.min(c.max, 1 + Math.floor(gen / c.every));
// gen より後で種族の数が変わる最初の世代（もう変わらなければ Infinity）
export function chainNext(c, gen) {
  if (chainCount(c, gen) >= c.max) return Infinity;
  return (Math.floor(gen / c.every) + 1) * c.every;
}

// 動いている連鎖の世界。GPU 版と CPU の手本は、それぞれ1つ作って、世代の始めに sync を呼ぶ
export class ChainState {
  // opts: { every, max, pick, domain（支配領域の一辺。0 なら持たない）, wrap（盤の端をつなぐか。置き場所の離れ具合に使う）,
  //         stamp（置き形を押すか。false ならばらまき）, stampEvery（置き形を押す間隔。学習しないとき）,
  //         learn（置き形を学習するか。§18 の④。stamp と domain が要る） }
  constructor(seed, W, H, opts = {}) {
    this.seed = seed >>> 0; this.W = W; this.H = H;
    this.domain = opts.domain ?? 0; this.wrap = opts.wrap ?? true;
    this.stamp = opts.stamp ?? false; this.stampEvery = opts.stampEvery ?? CHAIN_DEFAULTS.stampEvery; this.learn = opts.learn ?? false;
    this.c = { every: opts.every ?? CHAIN_DEFAULTS.every, max: Math.min(MAX_SPECIES, opts.max ?? CHAIN_DEFAULTS.max) };
    if (!(this.c.every >= 1)) throw new Error('足す間隔は 1 以上: ' + this.c.every);
    this.pick = opts.pick ?? 'equal';
    this.n = 0;
    this.world = null;
    this.ver = new Array(MAX_SPECIES + 1).fill(0);   // 種族ごとのルールの引き直しの回数（Q49）
    this.lastRep = -1;                               // 最後に引き直した世代
    this.reps = [];                                  // 引き直しの記録 [世代, 種族, 回数]（1 回に複数の種族があれば 1 種族 1 件）
    this.trial = new Array(MAX_SPECIES + 1).fill(false);   // 領域を埋められるかまだ見極めていない種族（Q68=A は引き直した種族、Q69=B で種族 1 以外の足した種族も）
    this.thinN = 0;                                  // 盤にはいるが領域を埋められず引き直した回数（Q68=A。確かめ用）
    this.learnMin = opts.learnMin ?? CHAIN_DEFAULTS.learnMin;
    this.t0 = new Array(MAX_SPECIES + 1).fill(0);   // 種族がいまのルールを持った世代（足した世代か、最後に引き直した世代）
    this.noReplace = false;                          // ルールの引き直しを止める（利用者の操作。セッション10）
    this.custom = [];                                // 読み出したルール（custom[k]）。引き直したら消す
    this.loaded = [];                                // 読み出したが、まだ盤にいない種族の値（loaded[k]。足したときに使う）
    this.G = Math.min(4, this.c.max);                // 捕食の輪の組の数（狭い盤で上限が 4 より少なければ上限の数）
    this.repN = Math.max(1, Math.floor(REP_N * this.c.max / MAX_SPECIES));   // 「弱い」「少ない」で引き直す数。上限の割合で減らし、1 は残す
    this.minN = 0;                                   // 少なくともこの数の種族を出す（マザーの値を読み出したとき。セッション10）
  }
  wopts() { return { pick: this.pick, ver: this.ver, custom: this.custom, groups: this.G }; }
  // 読み出したルールを入れる（セッション10）。いまいる種族はすぐ、まだいない種族は足したときに使う。
  //   入れた種族は、その世代から学習時間を数え直し、見極めはしない
  loadRules(gen, list) {
    for (const e of list) {
      if (!(e.kind >= 2 && e.kind <= this.c.max) || !e.rule) continue;   // 種族 1（Conway）はルールを変えない
      this.custom[e.kind] = { birth: e.rule.birth >>> 0, survive: e.rule.survive.map(v => v >>> 0), prey: e.rule.prey >>> 0 };
      if (e.kind <= this.n) { this.t0[e.kind] = gen; this.trial[e.kind] = false; }
    }
    if (!this.n) return null;
    this.world = chainWorld(this.seed, this.n, this.wopts());
    return { world: this.world, rules: compile(this.world) };
  }
  // 世代 gen の始めに、いちばん少ない種族のルールを引き直す世代か（Q49）：上限の種族がそろったあと、足す間隔ごと
  //   上限は世代 (max−1)×every にそろうので、最初の引き直しは世代 max×every
  needCounts(gen) {
    return !this.noReplace && this.n === this.c.max && gen >= this.c.max * this.c.every && gen % this.c.every === 0 && gen !== this.lastRep;
  }
  // 引き直す。counts[s−1] は世代 gen の始め（供給の前）の盤の種族 s の数（7回目の利用者の指示）
  //   種族 1（Conway）はどの決まりでも引き直さない（セッション9）。
  //   盤の数が 0 の種族があれば、それを全部引き直す（dom を渡せば、領域を埋められない引き直したばかりの種族も）。
  //   0 が無ければ、学習時間（learnMin）がたった種族のうち、次の 2 つを合わせて引き直す（セッション9）：
  //     ・盤でいちばん多い組（番号を 4 で割った余りの組。数の和で比べ、同じなら番号の小さい組）を食べる組の、弱い 4 種
  //     ・捕食の組を問わず、盤でいちばん少ない 4 種
  //   どちらも数の少ない順。同じなら引き直しの回数が少ないほう、それも同じなら番号の小さいほう
  //   引き直した種族のマザーは学習を最初からやり直す（新しい置き形・t0＝gen）。盤にいるその種族はそのまま残す
  //   返す list：[{ kind, stamp, t0 }]（番号の小さい順）
  //   dom（Q68=A・Q69=B）：dom[s−1] は種族 s の支配領域の中の自分の数（MotherSet.domainCounts）。渡すと、見極め中の種族（種族 1 以外の足した種族と、引き直した種族）のうち
  //   領域のマスの FILL_MIN% に届かない種族も、0 の種族と一緒に引き直す（届いた種族は見極めを終える）
  //   ただし盤の数の多いほうの半分の種族は、届かなくても引き直さない（Q103=C。見極めは続ける）
  replace(gen, counts, dom = null) {
    const area = domArea(Math.floor(this.domain / 2));   // 円の支配領域のマスの数（Q74）
    let kinds = [];
    const why = {};   // 入れ替えた理由（セッション10。確かめ用）：zero＝0、thin＝領域を埋められない、eater＝多い組を食べる弱い種、small＝全体で少ない種
    const rankOf = s => { let r = 1; for (let q = 1; q <= this.n; q++) if (counts[q - 1] > counts[s - 1]) r++; return r; };
    const top = s => rankOf(s) <= Math.floor(this.n / 2);   // 盤の数の多いほうの半分（Q94=A・Q103=C）
    for (let s = 2; s <= this.n; s++) {
      const short = dom && this.trial[s] && dom[s - 1] * 100 < area * FILL_MIN;
      if (dom && this.trial[s] && !short) this.trial[s] = false;
      // Q103=C：多いほうの半分の種族は、領域を埋められなくても引き直さない（見極めは続け、少ないほうへ落ちたら引き直す）
      const thin = short && !top(s);
      if (thin && counts[s - 1] !== 0) this.thinN++;
      if (counts[s - 1] === 0 || thin) { kinds.push(s); why[s] = counts[s - 1] === 0 ? 'zero' : 'thin'; }
    }
    if (!kinds.length) {
      const G = this.G, sum = new Array(G).fill(0);
      for (let s = 1; s <= this.n; s++) sum[(s - 1) % G] += counts[s - 1];
      let g = 0;
      for (let r = 1; r < G; r++) if (sum[r] > sum[g]) g = r;
      const ready = s => s !== 1 && gen - this.t0[s] >= this.learnMin;
      const order = (a, b) => counts[a - 1] - counts[b - 1] || this.ver[a] - this.ver[b] || a - b;
      let eaters = [];
      for (let e = 1; e <= this.n; e++) if (chainEats(e, g + 1, G)) eaters.push(e);
      if (!eaters.length) for (let s = g + 1; s <= this.n; s += G) eaters.push(s);   // 食べる組がいない（4 種より少ないとき）：その組そのもの
      // 盤の数の多いほうの半分（n÷2 を切り捨てた数。4 種族なら 1 位と 2 位）は、どちらの決まりでも引き直さない（セッション10・Q94=A）。
      //   順位は「自分より多い種族の数＋1」（同じ数は同じ順位）。学習時間がたった種族だけから選ぶので、
      //   これが無いと、種族が少ない盤では、たった種族が多い種族だけのときにそれを引き直していた
      const keep = s => ready(s) && !top(s);
      eaters = eaters.filter(keep).sort(order).slice(0, this.repN);
      const small = [];
      for (let s = 2; s <= this.n; s++) if (keep(s)) small.push(s);
      small.sort(order);
      for (const k of small.slice(0, this.repN)) why[k] = 'small';
      for (const k of eaters) why[k] = 'eater';
      kinds = [...new Set([...eaters, ...small.slice(0, this.repN)])].sort((a, b) => a - b);
    }
    this.lastRep = gen;
    const list = [];
    for (const k of kinds) {
      const v = ++this.ver[k];
      delete this.custom[k];
      let rank = 1; for (let s = 1; s <= this.n; s++) if (counts[s - 1] > counts[k - 1]) rank++;
      this.reps.push([gen, k, v, why[k], counts[k - 1], dom ? dom[k - 1] : -1, rank]);   // 世代・種族・回数・理由・盤の数・領域の中の数・盤の数の順位
      this.trial[k] = true;
      this.t0[k] = gen;
      list.push({ kind: k, stamp: chainStamp(this.seed, k, v), t0: gen });
    }
    const world = chainWorld(this.seed, this.n, this.wopts());
    this.world = world;
    return { world, rules: compile(world), list };
  }
  // 世代 gen の始めに種族の数をそろえる。変わったら { world, rules, mothers（新しく足すマザー） }、変わらなければ null
  //   existing：いまいるマザー（MotherSet の ms）。新しいマザーは、これらの支配領域と重ならない場所に置く
  sync(gen, existing = []) {
    const want = Math.max(Math.min(this.minN, this.c.max), chainCount(this.c, gen));
    if (want === this.n) return null;
    if (want < this.n) throw new Error('連鎖の世界は世代を戻せない');
    const world = chainWorld(this.seed, want, this.wopts());
    const mothers = [];
    for (let k = this.n + 1; k <= want; k++) {
      this.trial[k] = k !== 1 && !this.custom[k];   // Q69=B：足した種族も見極める（種族 1 は引き直さないので見極めない。セッション9）
      const t0 = Math.min((k - 1) * this.c.every, gen);   // 読み出しで早く出した種族は、出した世代から（ふつうは同じ値）
      this.t0[k] = t0;
      mothers.push(chainMother(this.seed, k, world.species[k - 1], this.W, this.H,
        { domain: this.domain, wrap: this.wrap, existing: [...existing, ...mothers],
          stamp: this.stamp, stampEvery: this.stampEvery, learn: this.learn, t0 }));
    }
    this.n = want; this.world = world;
    return { world, rules: compile(world), mothers };
  }
  // gen より後で、種族が増えるか引き直す最初の世代
  next(gen) {
    if (this.n < this.c.max) return chainNext(this.c, gen);
    return Math.max(this.c.max * this.c.every, (Math.floor(gen / this.c.every) + 1) * this.c.every);
  }
}
