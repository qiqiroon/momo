/**
 * MOMO Billiards — 台定義データ
 * 仕様書 momo_billiards_spec.md 第3章（台形状仕様）
 *
 * 3.7節のとおり「同一の物理エンジン＋台定義データ」という構造を採るため、
 * 形状ごとの分岐はこのファイルのデータだけで表す。エンジンは形状を知らない。
 *
 * 座標系（10.2.2節）
 *   外接矩形の長辺方向を長軸とし、外接矩形の中心を原点・長軸をX軸・フット側を +X とする。
 *   単位は mm。基準スポットは (L/4, 0)（L＝長軸方向の外接矩形の長さ）。
 *
 * ★「台の内側かどうか」は必ず outline（外周の頂点列）から決める。
 *   halfW / halfH は外接矩形であって台の形ではない。長方形では両者が一致するため
 *   矩形での判定が長く通用していたが、六角形以降は一致しない。
 *   内側の判定・置ける場所・場外の判定は clearance() / inside() を通すこと。
 *
 * ポケットは形状ごとに個数が異なる（3.4.2節 D363）。
 *   標準長方形6（凸頂点4＋長辺の中央2）／正六角形6（凸頂点のみ）。
 *   3.5.1節・3.5.6節の表には D363 以前の個数が残っているが、3.4.2節と D363 を正とする。
 */
const BilliardsTable = (() => {
  'use strict';

  const R = 28.575;                 // 標準玉半径 mm（3.2.1節）
  const D = R * 2;                  // 標準玉直径 57.15 mm
  const MOUTH = 114.30;             // ポケット口径（3.4.1節）
  const PLAY_W = 2540.0;            // A-01 の長軸方向のプレイ面
  const PLAY_H = 1270.0;            // A-01 の短軸方向のプレイ面
  const HX = PLAY_W / 2, HY = PLAY_H / 2;
  const CUSHION_TOP = 63.5;         // クッション上端の高さ（5.3.4節）。玉の直径 57.15 より高い
  const CUSHION_W = 45;             // クッション上面の幅（描画と着地判定に使う）

  // ポケット口の開き。A-01 は第1段階からの実測値をそのまま引き継ぐ（変えると玉の入り方が変わる）。
  const GAP_CORNER = 66.0;
  const GAP_SIDE = MOUTH / 2;       // 57.15

  // A-08 L字（3.5.6節）。切欠きの一辺は 2073.9 − 1037.0 ＝ 1036.9 mm。
  const L_SIDE = 2073.9;                         // 外形の一辺 mm
  const L_ARM = 1037.0;                          // 腕の幅 mm

  // A-02 正六角形（3.5.2節）。一辺＝外接円半径。
  const HEX_A = 1114.3;                          // 一辺 mm
  const HEX_H = HEX_A * Math.sqrt(3) / 2;        // 対辺距離の半分 ＝ 965.01 mm
  // 面積は (3√3/2)a² ＝ 3,225,942 mm²。3.2.2節の 3,225,800 mm² との差は 0.004% で、
  // 仕様書が一辺の値そのものを与えているためこの寸法を正とする。

  function seg(x1, y1, x2, y2) { return { x1, y1, x2, y2 }; }
  function pt(x, y) { return { x, y }; }

  // ══════════════════════════════════════════════
  //  外周の幾何（形状に依存しない道具）
  // ══════════════════════════════════════════════

  function distToSeg(px, py, x1, y1, x2, y2) {
    const ex = x2 - x1, ey = y2 - y1;
    const l2 = ex * ex + ey * ey;
    let t = l2 < 1e-12 ? 0 : ((px - x1) * ex + (py - y1) * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (x1 + ex * t), py - (y1 + ey * t));
  }

  /** 点が外周の内側にあるか（射線交差法）。境界そのものの扱いは clearance() 側で決める */
  function inPolygon(o, x, y) {
    let hit = false;
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const yi = o[i].y, yj = o[j].y;
      if ((yi > y) !== (yj > y)) {
        const xx = o[i].x + (y - yi) * (o[j].x - o[i].x) / (yj - yi);
        if (x < xx) hit = !hit;
      }
    }
    return hit;
  }

  /**
   * 外周までの符号つき距離。内側が正・外側が負。
   * 「玉が丸ごと内側に収まるか」は clearance >= 玉半径 で表せる。
   */
  function clearance(table, x, y) {
    const o = table.outline;
    let best = Infinity;
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      const d = distToSeg(x, y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return inPolygon(o, x, y) ? best : -best;
  }

  /** 外周から margin 以上内側にあるか。margin に負の値を渡せば「外側への許容」になる */
  function inside(table, x, y, margin) {
    return clearance(table, x, y) >= (margin || 0);
  }

  /** 外周のうち点にいちばん近い場所 */
  function nearestBoundary(table, x, y) {
    const o = table.outline;
    let best = null, bestD = Infinity;
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const l2 = ex * ex + ey * ey;
      let t = l2 < 1e-12 ? 0 : ((x - a.x) * ex + (y - a.y) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a.x + ex * t, qy = a.y + ey * t;
      const d = Math.hypot(x - qx, y - qy);
      if (d < bestD) { bestD = d; best = { x: qx, y: qy, ex, ey, len: Math.sqrt(l2) }; }
    }
    return best;
  }

  /**
   * レール上のダイヤ（目印）の位置。外周の各辺を等分した点と、その辺の外向きを返す。
   *
   * **等分数は辺の長さから決める。** 標準長方形は 2540÷8 も 1270÷4 も 317.5 mm で、
   * 現実の9フィート台のダイヤはこの間隔で並んでいる。そこで
   * 「辺の長さ ÷ 317.5 にいちばん近い整数で等分する」を全形状の共通規則とした。
   * 長方形では長辺8等分・短辺4等分となり、第1段階の位置とそのまま一致する。
   * 正六角形は一辺 1114.3 mm なので 3.51 → 4等分（1辺あたり3個・全18個）。
   *
   * 形状ごとに個数を並べる形にすると、台を足したときに書き忘れる。
   */
  const DIAMOND_PITCH = 317.5;     // 現実の9フィート台のダイヤ間隔 mm

  function diamonds(table) {
    const o = table.outline, out = [];
    for (let i = 0; i < o.length; i++) {
      const a = o[i], b = o[(i + 1) % o.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      const div = Math.max(2, Math.round(len / DIAMOND_PITCH));
      // 外周は反時計回りに持っているので、外向きは (ey, -ex)
      const nx = ey / len, ny = -ex / len;
      for (let k = 1; k < div; k++) {
        out.push({ x: a.x + ex * k / div, y: a.y + ey * k / div, nx, ny });
      }
    }
    return out;
  }

  /** 境界上の点から見た内向き。真上に乗ってしまって向きが決まらないときの逃げ道 */
  function inwardAt(table, p) {
    const l = p.len < 1e-9 ? 1 : p.len;
    const nx = -p.ey / l, ny = p.ex / l;
    return inPolygon(table.outline, p.x + nx * 0.5, p.y + ny * 0.5) ? pt(nx, ny) : pt(-nx, -ny);
  }

  /**
   * 外周から margin 以上内側へ引き戻す（手玉をドラッグで動かすときに使う）。
   * 境界へ落としてから内向きに margin だけ入れる操作を数回繰り返す。
   * 角の近くでは1回で収まらないことがあるので反復する。
   */
  function clampInside(table, x, y, margin) {
    let px = x, py = y;
    for (let it = 0; it < 6; it++) {
      const c = clearance(table, px, py);
      if (c >= margin - 1e-6) break;
      const p = nearestBoundary(table, px, py);
      let nx = px - p.x, ny = py - p.y;
      const d = Math.hypot(nx, ny);
      if (d < 1e-9) { const n = inwardAt(table, p); nx = n.x; ny = n.y; }
      else { nx /= d; ny /= d; if (c < 0) { nx = -nx; ny = -ny; } }
      px = p.x + nx * margin; py = p.y + ny * margin;
    }
    return pt(px, py);
  }

  // ══════════════════════════════════════════════
  //  凹頂点の丸め（3.3.3節）
  // ══════════════════════════════════════════════

  const FILLET_R = 2.86;   // 凹頂点の丸め半径 mm（標準玉半径の1/10）

  function norm2pi(a) { const x = a % (2 * Math.PI); return x < 0 ? x + 2 * Math.PI : x; }

  /** 円弧のクッション。台の内側が円の外側にあるとき side='out'、内側にあるとき side='in' */
  function arc(cx, cy, r, a0, sweep, side) {
    return { kind: 'arc', cx, cy, r, a0, sweep, side: side || 'out' };
  }

  /**
   * 凹頂点（台の内側へ突き出た角）を外周から自動で見つけて、丸めの円弧を作る。
   *
   * **形ごとに「ここを丸める」と並べない。** 並べると台を足したときに書き忘れる
   * （ダイヤの個数と同じ理由）。外周は反時計回りに持っているので、
   * その頂点で右へ曲がっていれば凹頂点である、という事実だけで見分ける。
   *
   * 丸めはクッションの側にだけ入れる。「台の内側かどうか」の判定（clearance）は
   * 角の尖ったままの外周を使い続ける。丸めるとプレイ面は角の先ぶんだけ広がるが、
   * 判定を尖ったままにしておくとその分を「置けない」と見なす＝安全側に外れるため。
   */
  function buildFillets(outline, r) {
    const n = outline.length, out = [];
    for (let i = 0; i < n; i++) {
      const p = outline[(i - 1 + n) % n], v = outline[i], q = outline[(i + 1) % n];
      const ul = Math.hypot(v.x - p.x, v.y - p.y), wl = Math.hypot(q.x - v.x, q.y - v.y);
      if (ul < 1e-9 || wl < 1e-9) continue;
      const ux = (v.x - p.x) / ul, uy = (v.y - p.y) / ul;      // 入ってくる向き
      const wx = (q.x - v.x) / wl, wy = (q.y - v.y) / wl;      // 出ていく向き
      const cross = ux * wy - uy * wx;
      if (cross >= -1e-12) continue;                           // 左へ曲がる＝凸頂点。丸めない
      const half = (Math.PI + Math.atan2(cross, ux * wx + uy * wy)) / 2;  // 台の外側の角の半分
      const si = Math.sin(half), ta = Math.tan(half);
      if (si < 1e-6 || ta < 1e-6) continue;
      const d = r / ta;                                        // 頂点から接点までの、辺に沿った長さ
      if (d > ul * 0.4 || d > wl * 0.4) continue;              // 辺が短すぎて丸められない
      let bx = wx - ux, by = wy - uy;                          // 台の外側へ向かう二等分線
      const bl = Math.hypot(bx, by);
      if (bl < 1e-9) continue;
      bx /= bl; by /= bl;
      const cx = v.x + bx * (r / si), cy = v.y + by * (r / si);
      const angA = Math.atan2(v.y - uy * d - cy, v.x - ux * d - cx);   // 入ってくる辺の側の接点
      const angB = Math.atan2(v.y + wy * d - cy, v.x + wx * d - cx);   // 出ていく辺の側の接点
      const angMid = Math.atan2(-by, -bx);                     // 台の内側を向く向き
      const ab = norm2pi(angB - angA);
      out.push({
        i, d,
        arc: (norm2pi(angMid - angA) < ab)
          ? arc(cx, cy, r, angA, ab, 'out')
          : arc(cx, cy, r, angB, 2 * Math.PI - ab, 'out'),
      });
    }
    return out;
  }

  // ══════════════════════════════════════════════
  //  外周からクッションとポケットを組み立てる
  // ══════════════════════════════════════════════

  /**
   * ポケットの口と凹頂点の丸めを外周から切り取って、クッションの列を作る。
   * pocketSpec の各要素は
   *   { at:'vertex', i:頂点番号, cut:頂点から辺に沿って切る長さ }
   *   { at:'edge',   i:辺番号, t:辺上の位置(0..1), half:切る幅の半分 }
   *
   * 丸めもポケットと同じ「頂点から辺に沿って切る」で表せるので、切り取りは1本の仕組みで済む。
   * 切り取ったあとに円弧を足すところだけが違う。
   */
  function buildRails(outline, spec, hasPockets, fillets) {
    const n = outline.length;
    const edge = i => ({ a: outline[i], b: outline[(i + 1) % n] });
    const len = i => { const e = edge(i); return Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y); };
    const cuts = []; for (let i = 0; i < n; i++) cuts.push([]);
    const cutAtVertex = (vi, d) => {
      const prev = (vi - 1 + n) % n;              // 頂点へ入ってくる辺
      cuts[prev].push([len(prev) - d, len(prev)]);
      cuts[vi].push([0, d]);                      // 頂点から出ていく辺
    };
    // ポケットの口は「ポケットあり版」だけ。丸めは物理を成り立たせるためなので常に入れる
    if (hasPockets) {
      for (const pk of spec) {
        if (pk.at === 'vertex') cutAtVertex(pk.i, pk.cut);
        else { const c = len(pk.i) * pk.t; cuts[pk.i].push([c - pk.half, c + pk.half]); }
      }
    }
    for (const f of (fillets || [])) cutAtVertex(f.i, f.d);
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = edge(i), L = len(i);
      const ux = (e.b.x - e.a.x) / L, uy = (e.b.y - e.a.y) / L;
      const gaps = cuts[i].slice().sort((p, q) => p[0] - q[0]);
      let at = 0;
      for (const g of gaps) {
        const a = Math.max(0, g[0]), b = Math.min(L, g[1]);
        if (a > at) out.push(seg(e.a.x + ux * at, e.a.y + uy * at, e.a.x + ux * a, e.a.y + uy * a));
        if (b > at) at = b;
      }
      if (at < L) out.push(seg(e.a.x + ux * at, e.a.y + uy * at, e.b.x, e.b.y));
    }
    for (const f of (fillets || [])) out.push(f.arc);
    return out;
  }

  /** ポケットの中心座標を外周から求める */
  function buildPockets(outline, spec) {
    const n = outline.length;
    return spec.map(pk => {
      if (pk.at === 'vertex') {
        const v = outline[pk.i];
        return { id: pk.id, x: v.x, y: v.y, r: pk.r };
      }
      const a = outline[pk.i], b = outline[(pk.i + 1) % n];
      return { id: pk.id, x: a.x + (b.x - a.x) * pk.t, y: a.y + (b.y - a.y) * pk.t, r: pk.r };
    });
  }

  // ══════════════════════════════════════════════
  //  形状ごとの定義（3.5節）
  // ══════════════════════════════════════════════

  /** A-01 標準長方形（3.5.1節）。ポケット6個＝凸頂点4＋長辺の中央2（D363） */
  function shapeA01() {
    return {
      shape: 'A-01',
      outline: [pt(-HX, -HY), pt(HX, -HY), pt(HX, HY), pt(-HX, HY)],
      pocketSpec: [
        { id: 'CL', at: 'vertex', i: 0, cut: GAP_CORNER, r: 63 },
        { id: 'FL', at: 'vertex', i: 1, cut: GAP_CORNER, r: 63 },
        { id: 'FR', at: 'vertex', i: 2, cut: GAP_CORNER, r: 63 },
        { id: 'CR', at: 'vertex', i: 3, cut: GAP_CORNER, r: 63 },
        { id: 'SL', at: 'edge', i: 0, t: 0.5, half: GAP_SIDE, r: 58 },
        { id: 'SR', at: 'edge', i: 2, t: 0.5, half: GAP_SIDE, r: 58 },
      ],
      halfW: HX, halfH: HY,
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      spot: pt(PLAY_W / 4, 0),
      headSpot: pt(-PLAY_W / 4, 0),
      frameStyle: 'rect',      // 外枠の描き方。第1段階からの見た目をそのまま保つ
    };
  }

  /**
   * A-02 正六角形（3.5.2節）。頂点を長軸（±X）に置く向き。
   * ポケットは全6頂点（3.4.2節。長辺の中央は置かない＝準拠すべき現実の台が無いため）。
   * 内角120度なので、口径 114.30 mm を得る切り込みは 114.30 ÷ (2·sin60°) ＝ 65.99 mm。
   */
  function shapeA02() {
    const cut = MOUTH / (2 * Math.sin(Math.PI / 3));
    const L = HEX_A * 2;                     // 外接矩形の長辺 2228.6 mm
    return {
      shape: 'A-02',
      outline: [
        pt(HEX_A, 0), pt(HEX_A / 2, HEX_H), pt(-HEX_A / 2, HEX_H),
        pt(-HEX_A, 0), pt(-HEX_A / 2, -HEX_H), pt(HEX_A / 2, -HEX_H),
      ],
      pocketSpec: [
        { id: 'FT', at: 'vertex', i: 0, cut, r: 63 },
        { id: 'FR', at: 'vertex', i: 1, cut, r: 63 },
        { id: 'HR', at: 'vertex', i: 2, cut, r: 63 },
        { id: 'HT', at: 'vertex', i: 3, cut, r: 63 },
        { id: 'HL', at: 'vertex', i: 4, cut, r: 63 },
        { id: 'FL', at: 'vertex', i: 5, cut, r: 63 },
      ],
      halfW: HEX_A, halfH: HEX_H,
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      spot: pt(L / 4, 0),
      headSpot: pt(-L / 4, 0),
      frameStyle: 'outline',   // 外枠は外周をなぞる
    };
  }

  /**
   * A-08 L字（3.5.6節）。一辺 2073.9 mm の正方形から、一隅の 1036.9 mm 四方を切り取った形。
   * 面積は 3,225,900 mm² で、3.2.2節の 3,225,800 mm² との差は 0.003%。
   * 仕様書が頂点座標そのものを与えているため、この寸法を正とする。
   *
   * **外接矩形が正方形なので長軸が一意に定まらない**（10.2.2節）。長軸をXと明示する。
   * **基準スポットは上書きが必須**（10.2.4節）。共通規則の (L/4, 0) は切欠きの境界線の上
   * （内側へ 0.05 mm）に乗ってしまう。横の腕は 2073.9 × 1037.0 ＝ちょうど 2:1 で
   * 標準長方形と同じ比なので、その腕の中心線上に、標準長方形と同じ置き方（腕の長さの1/4）で置く。
   *
   * ポケットは7個（3.4.2節 D363）＝凸頂点5 ＋ 外周の長い2辺の中央2。
   * 凹頂点（切欠きの角）には置かない。そこは 3.3.3節の丸めが入る。
   */
  function shapeA08() {
    const h = L_SIDE / 2;            // 1036.95
    const k = L_ARM - h;             // 0.05 ＝切欠きの内側の座標
    const axisY = (-h + k) / 2;      // 横の腕の中心線 −518.45
    return {
      shape: 'A-08',
      outline: [pt(-h, -h), pt(h, -h), pt(h, k), pt(k, k), pt(k, h), pt(-h, h)],
      pocketSpec: [
        { id: 'HL', at: 'vertex', i: 0, cut: GAP_CORNER, r: 63 },
        { id: 'FL', at: 'vertex', i: 1, cut: GAP_CORNER, r: 63 },
        { id: 'FR', at: 'vertex', i: 2, cut: GAP_CORNER, r: 63 },
        { id: 'CT', at: 'vertex', i: 4, cut: GAP_CORNER, r: 63 },
        { id: 'HT', at: 'vertex', i: 5, cut: GAP_CORNER, r: 63 },
        { id: 'SB', at: 'edge', i: 0, t: 0.5, half: GAP_SIDE, r: 58 },
        { id: 'SL', at: 'edge', i: 5, t: 0.5, half: GAP_SIDE, r: 58 },
      ],
      halfW: h, halfH: h,
      longAxis: 'x', footDirection: +1,
      axisY,
      spot: pt(L_SIDE / 4, axisY),
      headSpot: pt(-L_SIDE / 4, axisY),
      frameStyle: 'outline',
    };
  }

  const SHAPES = { 'A-01': shapeA01, 'A-02': shapeA02, 'A-08': shapeA08 };

  /** 選べる外形の一覧（実装済みのものだけ） */
  const SHAPE_IDS = Object.keys(SHAPES);

  /**
   * 台定義データを1つ作る。
   * @param {string}  shape      外形識別子（A-01／A-02）。未知の値は A-01 として扱う
   * @param {boolean} hasPockets ポケットあり版なら true、キャロム版なら false
   */
  function make(shape, hasPockets) {
    const build = SHAPES[shape] || SHAPES['A-01'];
    const s = build();
    const fillets = buildFillets(s.outline, FILLET_R);
    return {
      shape: s.shape,
      name: s.shape,
      hasPockets: !!hasPockets,
      outline: s.outline,
      halfW: s.halfW, halfH: s.halfH,
      ballR: R,
      rails: buildRails(s.outline, s.pocketSpec, !!hasPockets, fillets),
      pockets: hasPockets ? buildPockets(s.outline, s.pocketSpec) : [],
      cushionTop: CUSHION_TOP,
      cushionWidth: CUSHION_W,
      frameStyle: s.frameStyle,
      // 10.2.2節：長軸・フット側・基準スポット
      longAxis: s.longAxis,
      footDirection: s.footDirection,
      // 長軸の線が短軸方向のどこを通るか。玉を並べる側は必ずこれを中心に置く。
      // 「台の中心線は y=0」は標準長方形と正六角形でしか成り立たない（L字では腕の中心）
      axisY: s.axisY || 0,
      spot: s.spot,
      headSpot: s.headSpot,
      center: pt(0, s.axisY || 0),
      // 物性値（3.7節・5.3.4節）。通常モードでの台ごとの差は微差に留める
      cushionRestitution: 0.86,
      clothSlide: 0.20,     // 滑り摩擦係数
      clothRoll: 0.010,     // 転がり抵抗
      clothSpin: 0.011,     // 縦軸まわり（サイドスピン）の減衰
      clothRestitution: 0.45, // 着地時のバウンド（5.8.3節）
    };
  }

  /** ダイヤ形ラック（G-01 ナインボール）。1番を先頭・9番を中央（7.3.1節）。 */
  function rackDiamond(table, nums) {
    // 行構成 1-2-3-2-1。先頭をフットスポットに置き、フット側（+X）へ広げる。
    const gap = D + 0.15;                 // 玉どうしをわずかに離して初期めり込みを防ぐ
    const dx = gap * Math.sqrt(3) / 2;
    const rows = [1, 2, 3, 2, 1];
    const order = [nums[0], nums[1], nums[2], nums[3], nums[8], nums[4], nums[5], nums[6], nums[7]];
    // order: 先頭=1番、中央（3行目の真ん中）=9番。残りは番号順に詰める。
    const out = []; let k = 0;
    for (let r = 0; r < rows.length; r++) {
      const n = rows[r];
      for (let i = 0; i < n; i++) {
        out.push({
          num: order[k++],
          x: table.spot.x + dx * r,
          y: table.spot.y + (i - (n - 1) / 2) * gap,
        });
      }
    }
    return out;
  }

  /** 三角ラック（G-02 エイトボール／G-03 ポケット・ローテーション）。 */
  function rackTriangle(table, nums, centerNum) {
    const gap = D + 0.15;
    const dx = gap * Math.sqrt(3) / 2;
    const cells = [];
    for (let r = 0; r < 5; r++) for (let i = 0; i <= r; i++) {
      cells.push({ x: table.spot.x + dx * r, y: table.spot.y + (i - r / 2) * gap, row: r, idx: i });
    }
    // 中央（3行目の真ん中＝index 4）に centerNum を置く。それ以外は番号順。
    const centerCell = 4;
    const rest = nums.filter(n => n !== centerNum);
    const out = [];
    for (let c = 0; c < cells.length; c++) {
      const num = (c === centerCell) ? centerNum : rest.shift();
      out.push({ num, x: cells[c].x, y: cells[c].y });
    }
    return out;
  }

  /**
   * キャロム版の定位置（10.2.5節）。赤2個は共通の的球、手玉は人数分の色。
   * @param {number} players 参加人数（手玉の数）
   */
  function caromPositions(table, players) {
    const mid = table.axisY;
    const reds = [
      { key: 'red1', x: table.spot.x, y: mid },
      { key: 'red2', x: 0, y: mid },
    ];
    const cues = [];
    const span = 212;   // 手玉どうしの間隔
    const base = table.headSpot.x;
    for (let i = 0; i < players; i++) {
      const offset = (i - (players - 1) / 2) * span;
      cues.push({ key: 'cue' + i, x: base, y: mid + offset });
    }
    return { reds, cues };
  }

  return {
    R, D, MOUTH, PLAY_W, PLAY_H, HX, HY, CUSHION_TOP, SHAPE_IDS, FILLET_R,
    make, rackDiamond, rackTriangle, caromPositions,
    clearance, inside, clampInside, nearestBoundary, diamonds, buildFillets,
  };
})();

if (typeof window !== 'undefined') window.BilliardsTable = BilliardsTable;
