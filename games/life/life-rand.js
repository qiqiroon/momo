// MOMO Life — 再現できる乱数（詳細仕様書 §6）
// 前の乱数の続きを使わず、「種・世代・マスの番号・使い道」から毎回かき混ぜて作る。
// 同じ計算を WGSL 側（RAND_WGSL）にも持ち、JavaScript と GPU で同じ値を出す。

// PCG のかき混ぜ（32 ビット整数 → 32 ビット整数）
export function pcg(v) {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

// 使い道の番号（salt）。同じマス・同じ世代でも、使い道ごとに別の乱数にする
// MOTHER は種族ごとに別の乱数にするため、実際には MOTHER | (種族の番号 << 8) を使う
export const SALT = Object.freeze({ INIT: 1, BIRTH: 2, MOTHER: 3, MOTHER_MOVE: 4, INIT_KIND: 5, MOTHER_PICK: 6, MOTHER_PLACE: 7, CHAIN: 8, CHAIN_PLACE: 9, CHAIN_STAMP: 10, LEARN: 11 });

export function rand(seed, gen, idx, salt) {
  return pcg(pcg(pcg((seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0) ^ (gen >>> 0)) ^ (idx >>> 0));
}

// 確率 p（0〜1）を、整数のしきい値に直す。rand(...) < threshold なら当たり
export function probToThreshold(p) {
  if (p <= 0) return 0;
  if (p >= 1) return 0xffffffff;
  return Math.floor(p * 4294967296) >>> 0;
}

export const RAND_WGSL = /* wgsl */`
fn pcg(v : u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand4(seed : u32, gen : u32, idx : u32, salt : u32) -> u32 {
  return pcg(pcg(pcg(seed ^ (salt * 0x9e3779b9u)) ^ gen) ^ idx);
}
`;
