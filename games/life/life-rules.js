// MOMO Life — 種族とルールのデータ（詳細仕様書 §3・§5）
// 画面で編集する形（読みやすいデータ）と、GPU・CPU の手本に渡す「決まった長さの数の並び」の両方を受け持つ。
// ルールの判定に使うのは、ここで作る数の並び（compile の結果）だけ。CPU の手本も GPU も同じ並びを読む。

// ── 条件の対象（§3.1）──
// SET：いくつかの種族の合計（自由編集モードの「A+B」）。種族の印（第 s-1 ビット＝種族 s）を id の場所に入れるので、種族 1〜24 だけ
export const T = Object.freeze({ SPECIES: 0, SELF: 1, ALIVE: 2, OTHER: 3, EMPTY: 4, SET: 5 });
const T_NAMES = { species: T.SPECIES, self: T.SELF, alive: T.ALIVE, other: T.OTHER, empty: T.EMPTY, set: T.SET };
export const SET_MAX = 24;

// 誕生が重なったときの選び方（§5）
export const PICK = Object.freeze({ EQUAL: 0, RANK: 1, WEIGHT: 2 });
const PICK_NAMES = { equal: PICK.EQUAL, rank: PICK.RANK, weight: PICK.WEIGHT };

// 上限（§3.2・§17）
export const MAX_SPECIES = 32;
export const MAX_GROUPS = 8;
export const MAX_CONDS = 8;

// ── 数の並びの形 ──
// 種族 s（1〜S）は table[(s-1)*STRIDE …] から。
//   先頭 8：[捕食の組の数, 生存の組の数, 誕生の組の数, 重み, 順位, 食べる相手の印, 0, 0]
//   続いてルール3つ（捕食・生存・誕生の順）× 組 8 × （条件の数 1 ＋ 条件 8 × 2）
//   条件 2 語：[対象の種類 | (種族の番号 << 8), 許す個数の印（9 ビット）]
export const RULE = Object.freeze({ PREY: 0, SURVIVE: 1, BIRTH: 2 });
export const HEAD = 8;
export const GROUP_WORDS = 1 + MAX_CONDS * 2;      // 17
export const RULE_WORDS = MAX_GROUPS * GROUP_WORDS; // 136
export const STRIDE = HEAD + 3 * RULE_WORDS;        // 416

// ── 許す個数の印を作る道具 ──
export const FULL = 0x1ff;
export function mask(...ns) { let m = 0; for (const n of ns) { if (n < 0 || n > 8) throw new Error('個数は 0〜8: ' + n); m |= 1 << n; } return m; }
export const atLeast = n => FULL & ~((1 << n) - 1);
export const atMost = n => (1 << (n + 1)) - 1;
export const range = (a, b) => atMost(b) & atLeast(a);

// 条件を作る道具
export const self = m => ({ t: 'self', m });
export const sp = (id, m) => ({ t: 'species', id, m });
export const alive = m => ({ t: 'alive', m });
export const other = m => ({ t: 'other', m });
export const empty = m => ({ t: 'empty', m });
export const set = (bits, m) => ({ t: 'set', set: bits >>> 0, m });

// 「B3/S23」の形から、自分の数だけを見る誕生・生存のルールを作る
export function fromBS(text) {
  const mt = /^B([0-8]*)\/S([0-8]*)$/i.exec(text.replace(/\s/g, ''));
  if (!mt) throw new Error('B…/S… の形ではない: ' + text);
  const ds = s => [...s].map(Number);
  return { birth: [[self(mask(...ds(mt[1])))]], survive: [[self(mask(...ds(mt[2])))]] };
}

// ── ひな形（§3.6）──
const GREEN = '#4ade80', CYAN = '#22d3ee', PINK = '#f472b6', YELLOW = '#facc15';

export const TEMPLATES = Object.freeze({
  // §3.5 の4種族。緑・水色・桃は、じゃんけんの形で食い合う。黄は中立
  four: () => ({
    pick: 'equal',
    init: { density: 0.278 },
    // マザー（§7）：種族を順に回して 12 個（1種族 3 個）。置き方は空のマスだけ
    // セッション9：連鎖の世界と同じく、長い旅をして置き形を押し、置き形を学ぶ。支配領域は持たない（ぶつかりは見えない円 space で避ける）。
    //   学習で数える範囲は 301×301（連鎖の世界と同じ広さ）。ほかの種族とまざって点が狂ってもよい（利用者の指示）。ルールは引き直さない
    mothers: { count: 12, travel: true, learn: true, learnHalf: 150, space: 100 },
    motherMode: 'empty',
    species: [
      { id: 1, name: { ja: '緑', en: 'Green' },  color: GREEN,  ...fromBS('B3/S23'),   prey: [[sp(2, atLeast(2))]] },
      { id: 2, name: { ja: '水色', en: 'Cyan' }, color: CYAN,   ...fromBS('B36/S23'),  prey: [[sp(3, atLeast(2))]] },
      { id: 3, name: { ja: '桃', en: 'Pink' },   color: PINK,   ...fromBS('B368/S245'), prey: [[sp(1, atLeast(2))]] },
      { id: 4, name: { ja: '黄', en: 'Yellow' }, color: YELLOW, ...fromBS('B36/S125'), prey: [] },
    ],
  }),
  // ふつうの Conway（1種族）
  conway: () => ({
    pick: 'equal',
    init: { density: 0.278 },
    species: [
      { id: 1, name: { ja: '緑', en: 'Green' }, color: GREEN, ...fromBS('B3/S23'), prey: [] },
    ],
  }),
});

// ── 検査と正規化 ──
// 間違いがあれば、どこが悪いかを書いた Error を投げる
export function validate(world) {
  const S = world.species?.length ?? 0;
  if (S < 1 || S > MAX_SPECIES) throw new Error(`種族の数は 1〜${MAX_SPECIES}: ${S}`);
  world.species.forEach((s, i) => {
    if (s.id !== i + 1) throw new Error(`種族の番号は 1 から順に並べる（${i + 1} 番目が ${s.id}）`);
    if (!(Number.isInteger(s.weight ?? 1) && (s.weight ?? 1) >= 1)) throw new Error(`種族 ${s.id} の重みは 1 以上の整数`);
    for (const key of ['prey', 'survive', 'birth']) {
      const rule = s[key] ?? [];
      if (rule.length > MAX_GROUPS) throw new Error(`種族 ${s.id} の ${key}：組は ${MAX_GROUPS} 個まで`);
      rule.forEach((g, gi) => {
        if (g.length > MAX_CONDS) throw new Error(`種族 ${s.id} の ${key} の組 ${gi + 1}：条件は ${MAX_CONDS} 個まで`);
        g.forEach(c => {
          if (!(c.t in T_NAMES)) throw new Error(`種族 ${s.id} の ${key}：対象の種類が不明 ${c.t}`);
          if (c.t === 'species' && !(c.id >= 1 && c.id <= S)) throw new Error(`種族 ${s.id} の ${key}：存在しない種族 ${c.id}`);
          if (c.t === 'set' && !(Number.isInteger(c.set) && c.set > 0 && c.set < (1 << Math.min(S, SET_MAX)))) throw new Error(`種族 ${s.id} の ${key}：合計の種族は 1〜${Math.min(S, SET_MAX)}`);
          if (!(Number.isInteger(c.m) && c.m >= 0 && c.m <= FULL)) throw new Error(`種族 ${s.id} の ${key}：個数の印が 0〜511 でない`);
        });
      });
    }
  });
  if (world.pick && !(world.pick in PICK_NAMES)) throw new Error('誕生の選び方が不明: ' + world.pick);
  return true;
}

// 世界のデータ → { S, pick, table: Uint32Array(S*STRIDE) }
export function compile(world) {
  validate(world);
  const S = world.species.length;
  const table = new Uint32Array(S * STRIDE);
  world.species.forEach((s, i) => {
    const base = i * STRIDE;
    [s.prey ?? [], s.survive ?? [], s.birth ?? []].forEach((rule, r) => {
      table[base + r] = rule.length;
      rule.forEach((g, gi) => {
        const go = base + HEAD + r * RULE_WORDS + gi * GROUP_WORDS;
        table[go] = g.length;
        g.forEach((c, ci) => {
          table[go + 1 + ci * 2] = (T_NAMES[c.t] | ((c.t === 'species' ? c.id : c.t === 'set' ? c.set : 0) << 8)) >>> 0;
          table[go + 2 + ci * 2] = c.m;
        });
      });
    });
    table[base + 3] = s.weight ?? 1;
    table[base + 4] = s.rank ?? s.id;
    table[base + 5] = (s.eatSet ?? 0) >>> 0;   // 食べる相手の印（eat が 3 のときだけ使う。第 s-1 ビット＝種族 s）
  });
  // eat：食べられたマスをどうするか。0＝空（preyBirth: false）、1＝誕生の判定を受ける・食べた種族が先（§16。最初の値）、
  //      2＝誕生の条件にかかわらず、食べた種族に置き換わる（preyReplace: true。連鎖の世界 §18.5）
  //      3＝食べる側のルール（eatMode: 'eater'。自由編集モード、セッション9）。捕食の欄は「食べる条件」、食べる相手は eatSet
  const eat = world.eatMode === 'eater' ? 3 : world.preyReplace ? 2 : world.preyBirth === false ? 0 : 1;
  return { S, pick: PICK_NAMES[world.pick ?? 'equal'], eat, table };
}

// 色 '#rrggbb' → [r,g,b,1]（0〜1）
export function hexToRGBA(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255, 1];
}
