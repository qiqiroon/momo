// MOMO Life — CPU で1世代を計算する手本（詳細仕様書 §1.2）
// テストの答え・GPU の答え合わせ・WebGPU が使えないときの代わりを兼ねる。
// stepWorld が多種族のルール（life-rules.js の compile の結果）で1世代を進める。GPU のシェーダーと同じ手順で書く。
// stepConway は段階1の手本。多種族版の答え合わせ（Conway のひな形と一致するか）に残している。
import { rand, SALT, probToThreshold } from './life-rand.js';
import { STRIDE, HEAD, GROUP_WORDS, RULE_WORDS, RULE, T, PICK } from './life-rules.js';

// 盤を作る。cells は Uint32Array（0＝空、1＝生き物）
export function makeBoard(W, H) {
  return { W, H, cells: new Uint32Array(W * H) };
}

// 種から盤を埋める（GPU の初期化と同じ式）。S 種族なら、生き物のマスの種族を等確率で選ぶ
export function fillRandom(board, seed, density, S = 1) {
  const thr = probToThreshold(density);
  const { W, H, cells } = board;
  for (let i = 0; i < W * H; i++)
    cells[i] = rand(seed, 0, i, SALT.INIT) < thr ? 1 + (rand(seed, 0, i, SALT.INIT_KIND) % S) : 0;
}

// 周りのマスの値 v が、条件の対象に当たるか（§3.1）
function hit(v, kind, id, me) {
  switch (kind) {
    case T.SPECIES: return v === id;
    case T.SELF: return v === me;
    case T.ALIVE: return v !== 0;
    case T.OTHER: return v !== 0 && v !== me;
    case T.EMPTY: return v === 0;
    case T.SET: return v !== 0 && ((id >>> (v - 1)) & 1) === 1;
  }
  return false;
}

// 種族 me のルール r が成り立つか。nb は周り8マスの値。組は AND、ルールは OR（§3.2）
function ruleHolds(table, me, r, nb) {
  const base = (me - 1) * STRIDE;
  const ng = table[base + r];
  for (let g = 0; g < ng; g++) {
    const go = base + HEAD + r * RULE_WORDS + g * GROUP_WORDS;
    const nc = table[go];
    let all = true;
    for (let c = 0; c < nc && all; c++) {
      const w0 = table[go + 1 + c * 2], m = table[go + 2 + c * 2];
      const kind = w0 & 255, id = w0 >>> 8;
      let n = 0;
      for (let k = 0; k < 8; k++) if (hit(nb[k], kind, id, me)) n++;
      if (((m >>> n) & 1) === 0) all = false;
    }
    if (all) return true;
  }
  return false;
}

// 種族 me の捕食が成り立てば、食べた種族の印（第 s-1 ビット＝種族 s。0 もありうる）を返す。成り立たなければ -1（§16）
// 食べた種族：成り立った組の条件で数えている種族のうち、周りに実際にいる種族（自分は除く）
function preyEaters(table, me, nb) {
  const base = (me - 1) * STRIDE;
  const ng = table[base + RULE.PREY];
  let out = 0, held = false;
  for (let g = 0; g < ng; g++) {
    const go = base + HEAD + RULE.PREY * RULE_WORDS + g * GROUP_WORDS;
    const nc = table[go];
    let all = true, eat = 0;
    for (let c = 0; c < nc && all; c++) {
      const w0 = table[go + 1 + c * 2], m = table[go + 2 + c * 2];
      const kind = w0 & 255, id = w0 >>> 8;
      let n = 0;
      for (let k = 0; k < 8; k++) if (hit(nb[k], kind, id, me)) { n++; if (nb[k] !== 0 && nb[k] !== me) eat |= 1 << (nb[k] - 1); }
      if (((m >>> n) & 1) === 0) all = false;
    }
    if (all) { held = true; out |= eat; }
  }
  // 食べる種族（自分以外）がいなければ食べられない（セッション9。自分の数だけで成り立つ式で、自分しかいないのに消えていた）
  // 自分は印に入らないので、印が -1（32 ビット全部）になることはない
  return held && out !== 0 ? out : -1;
}

// 食べる側のルール（eat が 3。自由編集モード、セッション9）：生きているマス（種族 c）を食べる種族の印を返す（0 なら食べられない）
//   種族 s が食べる：s の「食べる相手」（先頭の 5 語目の印）に c が入り、s の食べる条件（捕食の欄）がこのマスの周りで成り立ち、
//   周りに s が 1 つ以上いる。条件の「自分」は s として数える
function predators(table, S, c, nb) {
  let cand = 0;
  for (let s = 1; s <= S; s++) {
    if (s === c || !((table[(s - 1) * STRIDE + 5] >>> (c - 1)) & 1)) continue;
    let near = false;
    for (let k = 0; k < 8; k++) if (nb[k] === s) { near = true; break; }
    if (near && ruleHolds(table, s, RULE.PREY, nb)) cand |= 1 << (s - 1);
  }
  return cand;
}

// 誕生の判定（§4・§5）。全種族の誕生を調べ、候補の中から1種を選ぶ（候補なしは 0）。
// first が 0 でなく候補と重なれば、その中だけから選ぶ（食べた種族が先。§16）
// only が真なら誕生の条件は見ず、first の中から選ぶ（食べた種族に置き換わる。§18.5）
function birthPick(table, S, pick, nb, seed, gen, i, first, only = false) {
  let cand = first;
  if (!only) {
    cand = 0;
    for (let s = 1; s <= S; s++) if (ruleHolds(table, s, RULE.BIRTH, nb)) cand |= 1 << (s - 1);
    if ((cand & first) !== 0) cand &= first;
  }
  let cnt = 0, one = 0, best = 0, bestRank = 0xffffffff, wsum = 0;
  for (let s = 1; s <= S; s++) {
    if (!((cand >>> (s - 1)) & 1)) continue;
    cnt++;
    if (!one) one = s;
    const rk = table[(s - 1) * STRIDE + 4];
    if (rk < bestRank) { bestRank = rk; best = s; }
    wsum += table[(s - 1) * STRIDE + 3];
  }
  if (cnt <= 1) return one;
  if (pick === PICK.RANK) return best;
  const r = rand(seed, gen, i, SALT.BIRTH);
  let t = pick === PICK.WEIGHT ? r % wsum : r % cnt;
  for (let s = 1; s <= S; s++) {
    if (!((cand >>> (s - 1)) & 1)) continue;
    const w = pick === PICK.WEIGHT ? table[(s - 1) * STRIDE + 3] : 1;
    if (t < w) return s;
    t -= w;
  }
  return 0;
}

// 多種族の1世代（§4・§5・§16）。rules は compile の結果、gen はいま（読む側）の世代番号
// rules.eat が 1 なら、食べられたマスはその世代のうちに誕生の判定を受ける（食べた種族が先）。2 なら食べた種族に置き換わる
export function stepWorld(W, H, src, dst, wrap, rules, seed, gen) {
  const { S, pick, table, eat } = rules;
  const nb = new Uint32Array(8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 周り8マスを1回だけ読む（並びは GPU と同じ：左上から行ごと）
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        let xx = x + dx, yy = y + dy;
        if (wrap) { xx = (xx + W) % W; yy = (yy + H) % H; nb[k++] = src[yy * W + xx]; }
        else nb[k++] = (xx < 0 || yy < 0 || xx >= W || yy >= H) ? 0 : src[yy * W + xx];
      }
      const i = y * W + x;
      const c = src[i];
      if (c !== 0) {
        // 食べる側のルール：食べる種族がいれば、その中から等しい確率で1種に置き換わる（生き残りの条件は見ない）
        if (eat === 3) {
          const cand = predators(table, S, c, nb);
          dst[i] = cand ? birthPick(table, S, pick, nb, seed, gen, i, cand, true) : ruleHolds(table, c, RULE.SURVIVE, nb) ? c : 0;
          continue;
        }
        // 捕食が先、次に生存
        const eaters = preyEaters(table, c, nb);
        // eat：0＝空になる、1＝誕生の判定（食べた種族が先。§16）、2＝食べた種族に置き換わる（§18.5）
        if (eaters !== -1) dst[i] = eat === 0 ? 0 : birthPick(table, S, pick, nb, seed, gen, i, eaters, eat === 2);
        else dst[i] = ruleHolds(table, c, RULE.SURVIVE, nb) ? c : 0;
        continue;
      }
      // 空：誕生の候補から1種
      dst[i] = birthPick(table, S, pick, nb, seed, gen, i, 0);
    }
  }
}

// 1世代。wrap=true でトーラス、false で盤の外は空。src と dst は別の配列
export function stepConway(W, H, src, dst, wrap) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          let xx = x + dx, yy = y + dy;
          if (wrap) { xx = (xx + W) % W; yy = (yy + H) % H; }
          else if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          if (src[yy * W + xx] !== 0) n++;
        }
      }
      const c = src[y * W + x];
      dst[y * W + x] = c !== 0 ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
    }
  }
}

// 文字の絵から盤に置く（テスト用）。'#' や 'O' が生き物
export function placeArt(board, x0, y0, art) {
  const rows = art.trim().split('\n').map(s => s.trim());
  rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '#' || ch === 'O') board.cells[(y0 + j) * board.W + (x0 + i)] = 1;
  }));
}

export function liveSet(board) {
  const s = [];
  for (let i = 0; i < board.cells.length; i++) if (board.cells[i]) s.push(`${i % board.W},${Math.floor(i / board.W)}`);
  return s.sort().join(' ');
}
