// ヒントの計算（仕様書 §8）。DOM を触らない（Worker の中でも、テストでも動く）。
//
// 「プレイヤーが置いた駒はそのまま」にして、残りの空きマスを残りの駒で敷き詰める置き方を1つ探す（§8.2）。
//   1. 近道：置いた駒がすべて、手元の完成形（解データ）と同じ置き場所なら、計算せずに完成形の残りを使う
//   2. そうでなければ Algorithm X（Dancing Links）で探す。製造機（generator\lib\dlx.mjs）と同じ考え方。
//      止めたり続けたりできるよう、ジェネレーター関数にして一定の手数ごとに yield する（休み入りの計算。§8.3）
//
// 穴あき駒は、穴も埋めた形で盤面に当てる（穴の乗るマスは「埋まった」扱い。§6.2）

import { type Cell, holesOf, keyOf, normalize, orient } from './geometry';
import { type Placement } from './levels';

export interface HintUnit {
  piece: number;
  copy: number;
  /** 駒の基準の向きの形 */
  cells: Cell[];
}

export interface HintProblem {
  /** まだ埋まっていない盤面のマス */
  empty: Cell[];
  /** まだ置いていない駒 */
  units: HintUnit[];
  /** 駒の大きさ（穴あき駒が無いときの、区画の大きさの下調べに使う） */
  n: number;
}

export type HintResult = { status: 'solved'; placements: Placement[] } | { status: 'none' };

const ck = (x: number, y: number): string => x + ',' + y;

/** その駒が占めるマス（穴も含む） */
export function solidCells(cells: readonly Cell[], o: number, x: number, y: number): Cell[] {
  const s = orient(cells, o);
  return [...s, ...holesOf(s)].map(([a, b]) => [a + x, b + y] as Cell);
}

/** 近道：置いた駒がすべて完成形のどれかと同じマスを占めているなら、完成形の残りを返す。合わなければ null */
export function fromKnownSolution(
  solution: readonly Placement[],
  placed: readonly Placement[],
  baseCells: (piece: number) => readonly Cell[],
): Placement[] | null {
  // 駒の形と、占めるマス（盤面の上の位置そのまま）で見分ける。同じ形の個どうしは区別しない
  const key = (pl: Placement) =>
    pl.piece + '|' + keyOf(solidCells(baseCells(pl.piece), pl.o, pl.x, pl.y).sort((p, q) => p[1] - q[1] || p[0] - q[0]));
  const pool = new Map<string, Placement[]>();
  for (const s of solution) {
    const k = key(s);
    pool.set(k, [...(pool.get(k) ?? []), s]);
  }
  for (const p of placed) {
    const list = pool.get(key(p));
    if (!list || !list.length) return null;
    list.pop();
  }
  // 残った完成形の置き場所を、まだ置いていない個に割り当てる（同じ形の個どうしは入れ替えてよい）
  const usedCopies = new Map<number, Set<number>>();
  for (const p of placed) usedCopies.set(p.piece, (usedCopies.get(p.piece) ?? new Set()).add(p.copy));
  const out: Placement[] = [];
  const nextFree = new Map<number, number>();
  for (const list of pool.values()) {
    for (const s of list) {
      let c = nextFree.get(s.piece) ?? 0;
      while (usedCopies.get(s.piece)?.has(c)) c++;
      nextFree.set(s.piece, c + 1);
      out.push({ piece: s.piece, copy: c, o: s.o, x: s.x, y: s.y });
    }
  }
  return out;
}

/**
 * 残りを Dancing Links で探す。yield するたびに、呼ぶ側は休みを入れたり止めたりできる。
 * @param stepsPerYield 何手ごとに yield するか
 */
export function* solveSteps(problem: HintProblem, stepsPerYield = 2000): Generator<void, HintResult> {
  const { empty, units } = problem;
  if (!units.length) return empty.length ? { status: 'none' } : { status: 'solved', placements: [] };

  // 下調べ：穴あき駒が無ければ、つながった空きの区画は、どれも駒の大きさの倍数でないと埋まらない
  const holey = units.some((u) => holesOf(u.cells).length > 0);
  if (!holey && !regionsOk(empty, problem.n)) return { status: 'none' };

  const idx = new Map(empty.map(([x, y], i) => [ck(x, y), i]));
  const U = units.length;
  const C = U + empty.length;

  interface Row { unit: number; o: number; x: number; y: number; cols: number[] }
  const rows: Row[] = [];
  units.forEach((u, ui) => {
    const seen = new Set<string>();
    for (let o = 0; o < 8; o++) {
      const solid = normalize(solidCells(u.cells, o, 0, 0));
      const k = keyOf(solid);
      if (seen.has(k)) continue; // 対称な駒は同じ形の向きを1回だけ
      seen.add(k);
      // orient の結果と solid は同じ原点（穴は駒の内側なので）
      for (const [bx, by] of empty) {
        const ox = bx - solid[0][0], oy = by - solid[0][1];
        const cols = [ui];
        let ok = true;
        for (const [x, y] of solid) {
          const i = idx.get(ck(x + ox, y + oy));
          if (i === undefined) { ok = false; break; }
          cols.push(U + i);
        }
        if (ok) rows.push({ unit: ui, o, x: ox, y: oy, cols });
      }
    }
  });

  // 同じ形の個どうしの入れ替えで同じ置き方を何度もたどらないよう、個の番号の順に置き場所の番号も並ぶものだけにする
  const prevUnit = units.map((u, i) => (i > 0 && units[i - 1].piece === u.piece ? i - 1 : -1));
  const nextUnit = units.map((u, i) => (i + 1 < U && units[i + 1].piece === u.piece ? i + 1 : -1));
  const orderOf = new Int32Array(rows.length);
  {
    const seenPos = new Map<string, number>();
    rows.forEach((r, ri) => {
      const k = units[r.unit].piece + '|' + r.cols.slice(1).join(',');
      if (!seenPos.has(k)) seenPos.set(k, seenPos.size);
      orderOf[ri] = seenPos.get(k)!;
    });
  }

  // 配列の Dancing Links
  const L: number[] = [], R: number[] = [], Up: number[] = [], Dn: number[] = [], COL: number[] = [], ROW: number[] = [];
  const S = new Int32Array(C);
  for (let c = 0; c <= C; c++) { Up[c] = Dn[c] = c; COL[c] = c; ROW[c] = -1; }
  for (let c = 0; c < C; c++) { L[c] = c === 0 ? C : c - 1; R[c] = c === C - 1 ? C : c + 1; }
  L[C] = C - 1; R[C] = 0;
  let next = C + 1;
  rows.forEach((r, ri) => {
    let first = -1;
    for (const c of r.cols) {
      const nd = next++;
      COL[nd] = c; ROW[nd] = ri;
      Up[nd] = Up[c]; Dn[nd] = c; Dn[Up[c]] = nd; Up[c] = nd; S[c]++;
      if (first < 0) { first = nd; L[nd] = R[nd] = nd; } else { L[nd] = L[first]; R[nd] = first; R[L[first]] = nd; L[first] = nd; }
    }
  });
  const cover = (c: number) => {
    L[R[c]] = L[c]; R[L[c]] = R[c];
    for (let i = Dn[c]; i !== c; i = Dn[i]) for (let j = R[i]; j !== i; j = R[j]) { Up[Dn[j]] = Up[j]; Dn[Up[j]] = Dn[j]; S[COL[j]]--; }
  };
  const uncover = (c: number) => {
    for (let i = Up[c]; i !== c; i = Up[i]) for (let j = L[i]; j !== i; j = L[j]) { S[COL[j]]++; Up[Dn[j]] = j; Dn[Up[j]] = j; }
    L[R[c]] = c; R[L[c]] = c;
  };

  const chosen = new Int32Array(U).fill(-1);
  const sol: number[] = [];
  let steps = 0;
  function* search(): Generator<void, boolean> {
    if (R[C] === C) return true;
    if (++steps >= stepsPerYield) { steps = 0; yield; }
    let c = -1, best = Infinity;
    for (let j = R[C]; j !== C; j = R[j]) if (S[j] < best) { best = S[j]; c = j; if (best === 0) break; }
    if (best === 0) return false;
    cover(c);
    for (let r = Dn[c]; r !== c; r = Dn[r]) {
      const ri = ROW[r];
      const u = rows[ri].unit;
      const pu = prevUnit[u], nu = nextUnit[u], ord = orderOf[ri];
      if (pu >= 0 && chosen[pu] >= 0 && chosen[pu] >= ord) continue;
      if (nu >= 0 && chosen[nu] >= 0 && chosen[nu] <= ord) continue;
      chosen[u] = ord;
      sol.push(ri);
      for (let j = R[r]; j !== r; j = R[j]) cover(COL[j]);
      if (yield* search()) return true;
      for (let j = L[r]; j !== r; j = L[j]) uncover(COL[j]);
      sol.pop();
      chosen[u] = -1;
    }
    uncover(c);
    return false;
  }
  if (!(yield* search())) return { status: 'none' };
  return {
    status: 'solved',
    placements: sol.map((ri) => {
      const r = rows[ri], u = units[r.unit];
      return { piece: u.piece, copy: u.copy, o: r.o, x: r.x, y: r.y };
    }),
  };
}

/** 最後まで一気に解く（テスト用） */
export function solveAll(problem: HintProblem): HintResult {
  const it = solveSteps(problem, 1e9);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** つながった空きの区画が、どれも n の倍数の大きさか */
function regionsOk(empty: readonly Cell[], n: number): boolean {
  const left = new Set(empty.map(([x, y]) => ck(x, y)));
  for (const [sx, sy] of empty) {
    if (!left.has(ck(sx, sy))) continue;
    let size = 0;
    const st: Cell[] = [[sx, sy]];
    left.delete(ck(sx, sy));
    while (st.length) {
      const [x, y] = st.pop()!;
      size++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = ck(x + dx, y + dy);
        if (left.has(k)) { left.delete(k); st.push([x + dx, y + dy]); }
      }
    }
    if (size % n) return false;
  }
  return true;
}

/** 解の中から、ヒントに出す駒を1つ選ぶ：空きマスを左上から読んで、最初の空きマスを埋める駒（§8.2） */
export function pickHint(rest: readonly Placement[], empty: readonly Cell[], baseCells: (piece: number) => readonly Cell[]): Placement | null {
  if (!rest.length) return null;
  const first = [...empty].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  if (!first) return rest[0];
  for (const pl of rest) {
    if (solidCells(baseCells(pl.piece), pl.o, pl.x, pl.y).some(([x, y]) => x === first[0] && y === first[1])) return pl;
  }
  return rest[0];
}
