// 駒や盤面の形を小さな SVG にする（レベル選択の盤面の絵・駒リスト）。
// マスの内側の境界は描かず、外周だけ線を引く（アイコンと同じ描き方）

import { type Cell, outlineEdges, sizeOf } from '../core/geometry';

export interface ShapeStyle {
  /** 1マスの大きさ（px） */
  cell: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** 穴のマスの色（穴あき駒） */
  holeFill?: string;
  /** 立体に描く（縁を 1 マスの 4 分の 1 の幅で盛り上げ、影を付ける。盤面の駒と同じ描き方）。fill は #rrggbb で渡す */
  bevel?: boolean;
}

let seq = 0;

/** 色を明るく（amt>0）・暗く（amt<0）寄せる。#rrggbb のみ */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)),
  );
  return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
}

export function shapeSvg(cells: readonly Cell[], holes: readonly Cell[], st: ShapeStyle): string {
  const { w, h } = sizeOf(cells);
  const c = st.cell;
  const pad = st.strokeWidth / 2;
  const b = st.bevel ? c / 4 : 0;
  const W = w * c + st.strokeWidth + b, H = h * c + st.strokeWidth + b;
  // マスを1つの path にまとめる（隣どうしの継ぎ目が見えないよう、塗りは1回）
  const rects = cells.map(([x, y]) => `M${x * c},${y * c}h${c}v${c}h${-c}z`).join('');
  const holeRects = holes.map(([x, y]) => `M${x * c},${y * c}h${c}v${c}h${-c}z`).join('');
  const edges = outlineEdges(cells).map(([x1, y1, x2, y2]) => `M${x1 * c},${y1 * c}L${x2 * c},${y2 * c}`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${-pad} ${-pad} ${W} ${H}" aria-hidden="true">` +
    // 色は style で渡す（属性の fill="var(--x)" では CSS の変数が効かないため）
    (b ? bevelBody(rects, st.fill, b) : `<path d="${rects}" style="fill:${st.fill}"/>`) +
    (holeRects && st.holeFill && !b ? `<path d="${holeRects}" style="fill:${st.holeFill}"/>` : '') +
    `<path d="${edges}" style="fill:none;stroke:${st.stroke}" stroke-width="${st.strokeWidth}" stroke-linecap="square"/>` +
    `</svg>`
  );
}

/** 立体の駒（H 鋼のような形。盤面の boardView.drawPiece と同じ考え方を SVG の切り抜きで） */
function bevelBody(rects: string, fill: string, r: number): string {
  const id = `pv${++seq}`;
  const e = r * 0.35, w = r * 0.5, k = r + w;
  const clip = (name: string, dx: number, dy: number) =>
    `<clipPath id="${id}${name}"><path d="${rects}" transform="translate(${dx},${dy})"/></clipPath>`;
  const p = (dx: number, dy: number, color: string) =>
    `<path d="${rects}" transform="translate(${dx},${dy})" style="fill:${color}"/>`;
  const g = (name: string, inner: string) => `<g clip-path="url(#${id}${name})">${inner}</g>`;
  return (
    `<defs>${clip('s', 0, 0)}${clip('e', -e, -e)}${clip('a', r, r)}${clip('b', r, -r)}${clip('c', -r, r)}${clip('d', -r, -r)}` +
    `${clip('k', k, k)}${clip('m', -k, -k)}</defs>` +
    `<path d="${rects}" transform="translate(${r * 0.45},${r * 0.65})" style="fill:#000;opacity:.5"/>` +
    // 縁
    g('s', p(0, 0, shade(fill, -0.45)) + p(-e, -e, shade(fill, 0.22)) + g('e', p(e, e, fill))) +
    // 中の板
    g('s', g('a', g('b', g('c', g('d',
      p(0, 0, shade(fill, -0.55)) + p(k, k, shade(fill, 0.12)) + g('k', g('m', p(0, 0, shade(fill, -0.2)))),
    )))))
  );
}
