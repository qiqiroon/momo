// 駒の形の計算。製造機（L:\momo\games\polyomino\generator\lib\polyomino.mjs）と同じ定義にする。
// 座標は [x, y]（x は右へ、y は下へ増える。画面と同じ向き）。DOM を触らない

export type Cell = readonly [number, number];

/** 最小の x・y が 0 になるよう平行移動し、(y, x) の順に並べる */
export function normalize(cells: readonly Cell[]): Cell[] {
  let mx = Infinity, my = Infinity;
  for (const [x, y] of cells) { if (x < mx) mx = x; if (y < my) my = y; }
  return cells.map(([x, y]) => [x - mx, y - my] as Cell).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

export const keyOf = (cells: readonly Cell[]): string => cells.map(([x, y]) => x + ',' + y).join(';');

/**
 * 向きの番号 o（0〜7）で形を変える。o>=4 なら先に左右反転（x → -x）し、
 * そのあと時計回りに 90°×(o%4) 回す。結果は正規化して返す（製造機の orient と同じ）
 */
export function orient(cells: readonly Cell[], o: number): Cell[] {
  let c: Cell[] = cells.map(([x, y]) => (o >= 4 ? [-x, y] : [x, y]) as Cell);
  for (let r = 0; r < o % 4; r++) c = c.map(([x, y]) => [-y, x] as Cell);
  return normalize(c);
}

/** 駒に囲まれた穴のマス（外とつながらない空きマス） */
export function holesOf(cells: readonly Cell[]): Cell[] {
  const s = new Set(cells.map(([x, y]) => x + ',' + y));
  let W = 0, H = 0;
  for (const [x, y] of cells) { if (x > W) W = x; if (y > H) H = y; }
  const out = new Set(['-1,-1']);
  const st: Cell[] = [[-1, -1]];
  while (st.length) {
    const [x, y] = st.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < -1 || ny < -1 || nx > W + 1 || ny > H + 1) continue;
      const k = nx + ',' + ny;
      if (out.has(k) || s.has(k)) continue;
      out.add(k);
      st.push([nx, ny]);
    }
  }
  const holes: Cell[] = [];
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    const k = x + ',' + y;
    if (!s.has(k) && !out.has(k)) holes.push([x, y]);
  }
  return holes;
}

/** 形を囲む長方形の幅と高さ（マス数） */
export function sizeOf(cells: readonly Cell[]): { w: number; h: number } {
  let W = 0, H = 0;
  for (const [x, y] of cells) { if (x > W) W = x; if (y > H) H = y; }
  return { w: W + 1, h: H + 1 };
}

/**
 * 駒の外周の線分（マスの辺のうち、同じ駒のマスと接していないもの）。
 * 描くときに内側のマス境界を消し、外周だけ線を引くのに使う（アイコンと同じ描き方）
 */
export function outlineEdges(cells: readonly Cell[]): Array<[number, number, number, number]> {
  const s = new Set(cells.map(([x, y]) => x + ',' + y));
  const edges: Array<[number, number, number, number]> = [];
  for (const [x, y] of cells) {
    if (!s.has(x + ',' + (y - 1))) edges.push([x, y, x + 1, y]);
    if (!s.has(x + ',' + (y + 1))) edges.push([x, y + 1, x + 1, y + 1]);
    if (!s.has((x - 1) + ',' + y)) edges.push([x, y, x, y + 1]);
    if (!s.has((x + 1) + ',' + y)) edges.push([x + 1, y, x + 1, y + 1]);
  }
  return edges;
}
