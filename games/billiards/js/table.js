/**
 * MOMO Billiards — 台定義データ
 * 仕様書 momo_billiards_spec.md 第3章（台形状仕様）
 *
 * 3.7節のとおり「同一の物理エンジン＋台定義データ」という構造を採るため、
 * 形状ごとの分岐はこのファイルのデータだけで表す。エンジンは形状を知らない。
 *
 * 座標系（10.2.2節）
 *   外接矩形の長辺方向を長軸とし、外接矩形の中心を原点・長軸をX軸・フット側を +X とする。
 *   単位は mm。
 *
 * ★どの台も外接矩形を 2540 × 1270（標準長方形と同じ）に揃える（3.2.2節）。
 *   形ごとの寸法は「形の比」だけを持ち、実寸は fitToBox() が決める。
 *   面積は形ごとに変わる（標準長方形 100%／六角形とL字 75%／十字 56%／星型 43%）。
 *   基準スポットは「台の中心と、長軸の線が壁に達する点との中点」＝footSpotX()。
 *
 * ★「台の内側かどうか」は必ず outline（外周の頂点列）から決める。
 *   halfW / halfH は外接矩形であって台の形ではない。長方形では両者が一致するため
 *   矩形での判定が長く通用していたが、六角形以降は一致しない。
 *   内側の判定・置ける場所・場外の判定は clearance() / inside() を通すこと。
 *
 * ポケットは形状ごとに個数が異なる（3.4.2節 D363）。
 *   標準長方形6（凸頂点4＋長辺の中央2）／六角形6（凸頂点のみ）。
 *   3.5.1節・3.5.6節の表には D363 以前の個数が残っているが、3.4.2節と D363 を正とする。
 */
const BilliardsTable = (() => {
  'use strict';

  const R = 28.575;                 // 標準玉半径 mm（3.2.1節）
  const D = R * 2;                  // 標準玉直径 57.15 mm
  const MOUTH = 114.30;             // ポケット口径（3.4.1節）
  const PLAY_W = 2540.0;            // A-01 の長軸方向のプレイ面
  const PLAY_H = 1270.0;            // A-01 の短軸方向のプレイ面

  /*
   * ★どの台も外接矩形をこの大きさに揃える（3.2.2節）。
   *
   * 台は表示エリアいっぱいに拡大して描かれるので（3.2.4節）、外接矩形が大きい形ほど
   * 画面上の玉が小さくなる。とくに携帯は左右が狭く、そちらで頭打ちになる。
   * 外接矩形を標準長方形と同じ 2540 × 1270 に収めておけば、
   * **表示エリアの形が何であれ、玉が標準長方形より小さくなることはない**
   * （拡大率は縦横それぞれの余裕の小さいほうで決まるので、両方が標準以下なら必ず標準以上になる）。
   * これより緩いとどこかの画面の形で下回り、これより厳しくすると無駄に面積を削る。
   *
   * その代わり、面積は形ごとに変わる（＝面積を揃えるのをやめた）。
   * 面積は「その形が外接矩形をどれだけ埋めるか」だけで決まり、潰し方では変えられない。
   */
  const BOX_W = PLAY_W;
  const BOX_H = PLAY_H;
  const HX = PLAY_W / 2, HY = PLAY_H / 2;
  const CUSHION_TOP = 63.5;         // クッション上端の高さ（5.3.4節）。玉の直径 57.15 より高い
  const CUSHION_W = 45;             // クッション上面の幅（描画と着地判定に使う）

  // ポケット口の開き。A-01 は第1段階からの実測値をそのまま引き継ぐ（変えると玉の入り方が変わる）。
  const GAP_CORNER = 66.0;
  const GAP_SIDE = MOUTH / 2;       // 57.15

  // A-08 L字（3.5.6節）。切欠きの一辺は 2073.9 − 1037.0 ＝ 1036.9 mm。
  const L_SIDE = 2073.9;                         // 外形の一辺 mm
  const L_ARM = 1037.0;                          // 腕の幅 mm

  // A-09 十字（3.5.7節）。一辺 803.2 mm の正方形5個を十字に並べた形。
  const CROSS_A = 803.2;                         // 構成正方形の一辺＝腕の幅 mm
  // 全幅は 3a ＝ 2409.6 mm。仕様書の項目表は 2409.7 mm と書くが、これは
  // 面積 3,225,800 mm² から出た a＝803.2189 を、腕の幅と全幅で別々に丸めた差である。
  // 3.5.7節が頂点座標そのもの（±401.6／±1204.8）を与えているので、そちらを正とする。

  // A-11 星型（3.5.8節）。正五芒星の外形。先端は 3.3.2節に従って切り落とす。
  const STAR_ROUT = 1708.3;                      // 外接円半径（切り落とし前の先端まで）mm
  const STAR_RIN = 652.5;                        // 凹頂点（谷）までの半径 mm
  // 3.5.8節の項目表が書く外接矩形 3249.4 × 3090.4 は切り落とし**前**の値だが、
  // どの台も外接矩形を 2540 × 1270 に揃えるので（3.2.2節）、ここでは使わない。
  // 使うのは形の比（外接円半径と谷の半径の比）だけである。

  // A-02 六角形（3.5.2節）。形の比は正六角形＝一辺が外接円半径。
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

  // ── 境界要素（3.7節）──
  /*
   * ★台の境界は「直線分と円弧の並び」で持ち、判定はすべてここから引く。
   *
   * 多角形の台では、この並びは外周の辺そのものである（boundsFromOutline）。
   * だから六角形・L字・十字・星型の値は1つも変わらない。
   *
   * 曲面の台（スタジアム・楕円・ドーナツ）は頂点を1つも持たないので、
   * 頂点の並びだけでは表せない。細かい折れ線で代用すると2つが同時に壊れる。
   *   ・ダイヤは「辺の長さ ÷ 317.5」で決めるので、細片の数だけダイヤが並ぶ
   *   ・内側かどうかの判定が、折れ線が内側へ落ち込むぶんだけ内へ寄る
   *     （クッションに寄り添った玉が「はみ出している」と読まれる）
   * 折れ線は**描画のためだけ**に持つ。3.7節が禁じているのは物理の接点と法線の近似である。
   *
   * 並びは反時計回り。円弧は a0 から a0+sweep へ、角度が増える向きに進む。
   * arc() と norm2pi() はこの下で定義しているが、関数宣言なので先に使ってよい。
   */

  /** 境界要素が円弧か（直線分は kind を持たない＝エンジンと同じ見分け方） */
  function isArc(e) { return e.kind === 'arc'; }

  /** 境界要素の長さ。円弧は弧長 */
  function elemLen(e) { return isArc(e) ? e.r * e.sweep : Math.hypot(e.x2 - e.x1, e.y2 - e.y1); }

  /** 境界要素を 0〜1 で辿った点。円弧では弧長に比例＝角度に比例する */
  function elemPointT(e, t) {
    if (isArc(e)) {
      const a = e.a0 + e.sweep * t;
      return pt(e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a));
    }
    return pt(e.x1 + (e.x2 - e.x1) * t, e.y1 + (e.y2 - e.y1) * t);
  }

  /**
   * 境界要素を k/div だけ辿った点。**割る前に掛ける。**
   * 先に k/div を出して掛けると、最後の桁が「掛けてから割る」とわずかに食い違う。
   * 等分点（ダイヤ）は分子と分母のまま渡してここで割る。
   */
  function elemPointFrac(e, k, div) {
    if (isArc(e)) {
      const a = e.a0 + e.sweep * k / div;
      return pt(e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a));
    }
    return pt(e.x1 + (e.x2 - e.x1) * k / div, e.y1 + (e.y2 - e.y1) * k / div);
  }

  /**
   * 境界要素の一部を切り出す（始点から弧長 s0 まで進んだ所から s1 まで）。
   * toEnd を立てると終わりは要素の終点そのものを使う。
   * 終点を「長さから計算し直す」と丸め誤差で元の点とわずかにずれるので、
   * 最後の一片だけは端の値をそのまま渡す（多角形での値を変えないため）。
   */
  function subElem(e, s0, s1, toEnd) {
    if (isArc(e)) {
      const a0 = e.a0 + s0 / e.r;
      return arc(e.cx, e.cy, e.r, a0, toEnd ? (e.a0 + e.sweep - a0) : (s1 - s0) / e.r, e.side);
    }
    const L = elemLen(e), ux = (e.x2 - e.x1) / L, uy = (e.y2 - e.y1) / L;
    return toEnd
      ? seg(e.x1 + ux * s0, e.y1 + uy * s0, e.x2, e.y2)
      : seg(e.x1 + ux * s0, e.y1 + uy * s0, e.x1 + ux * s1, e.y1 + uy * s1);
  }

  /** 点から境界要素までの距離。円弧の範囲の外なら近いほうの端までの距離 */
  function elemDist(e, px, py) {
    if (!isArc(e)) return distToSeg(px, py, e.x1, e.y1, e.x2, e.y2);
    const dx = px - e.cx, dy = py - e.cy, d = Math.hypot(dx, dy);
    if (d > 1e-12 && norm2pi(Math.atan2(dy, dx) - e.a0) <= e.sweep) return Math.abs(d - e.r);
    const a = elemPointT(e, 0), b = elemPointT(e, 1);
    return Math.min(Math.hypot(px - a.x, py - a.y), Math.hypot(px - b.x, py - b.y));
  }

  /**
   * 点にいちばん近い、境界要素の上の点。
   * ex, ey は**進む向きの単位接線**、len は 1（受け取る側が len で割っても割らなくても同じ）。
   * 直線分の長さは elemLen と同じ Math.hypot で出す。
   * 長さの求め方を場所ごとに変えると、外向きの向きが最後の桁で食い違う。
   */
  function elemNearest(e, px, py) {
    if (!isArc(e)) {
      const ex = e.x2 - e.x1, ey = e.y2 - e.y1, l2 = ex * ex + ey * ey;
      let t = l2 < 1e-12 ? 0 : ((px - e.x1) * ex + (py - e.y1) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const L = elemLen(e) || 1;
      return { x: e.x1 + ex * t, y: e.y1 + ey * t, ex: ex / L, ey: ey / L, len: 1 };
    }
    const off = norm2pi(Math.atan2(py - e.cy, px - e.cx) - e.a0);
    // 範囲の外は近いほうの端へ寄せる。円弧の外側は 2π − sweep ぶんある
    const a = (off <= e.sweep) ? e.a0 + off
      : (off - e.sweep < 2 * Math.PI - off) ? e.a0 + e.sweep : e.a0;
    return {
      x: e.cx + e.r * Math.cos(a), y: e.cy + e.r * Math.sin(a),
      ex: -Math.sin(a), ey: Math.cos(a), len: 1,
    };
  }

  /** 多角形の外周を境界要素の並びに直す。辺そのものなので値は変わらない */
  function boundsFromOutline(o) {
    const n = o.length, out = [];
    for (let i = 0; i < n; i++) out.push(seg(o[i].x, o[i].y, o[(i + 1) % n].x, o[(i + 1) % n].y));
    return out;
  }

  /** 境界の全長（外周長）。壁ズリの走行距離の上限に使う（5.7.3節） */
  function perimeterOf(bounds) { let s = 0; for (const e of bounds) s += elemLen(e); return s; }

  /**
   * 境界を折れ線に写す。**描画と、内側かどうかの向きの判定にだけ使う。**
   * 円弧は step ラジアンごとに刻む。各要素の始点は必ず入れるので、
   * 直線分だけの台では元の頂点列がそのまま返る。
   */
  const SAMPLE_STEP = Math.PI / 90;      // 2度。半径 635 mm で外へのふくらみ 0.10 mm

  function sampleBounds(bounds) {
    const o = [];
    for (const e of bounds) {
      if (!isArc(e)) { o.push(pt(e.x1, e.y1)); continue; }
      const k = Math.max(2, Math.ceil(e.sweep / SAMPLE_STEP));
      for (let j = 0; j < k; j++) o.push(elemPointT(e, j / k));
    }
    return o;
  }

  /**
   * 長軸の線（y = axisY）が届く、いちばんフット側の壁の位置。
   * 基準スポットとバンキングの成立線に使う（10.2.2節）。
   */
  function boundaryReach(bounds, axisY) {
    let reach = 0;
    for (const e of bounds) {
      if (!isArc(e)) {
        if ((e.y1 > axisY) !== (e.y2 > axisY)) {
          const x = e.x1 + (axisY - e.y1) * (e.x2 - e.x1) / (e.y2 - e.y1);
          if (x > reach) reach = x;
        }
        continue;
      }
      const u = (axisY - e.cy) / e.r;
      if (u < -1 || u > 1) continue;
      const b = Math.asin(u);
      for (const ang of [b, Math.PI - b]) {
        if (norm2pi(ang - e.a0) > e.sweep) continue;
        const x = e.cx + e.r * Math.cos(ang);
        if (x > reach) reach = x;
      }
    }
    return reach;
  }

  /** 外周を囲う四角。幅・高さと中心 */
  function boxOf(o) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of o) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /**
   * 外周を、外接矩形が 2540 × 1270 になるように縦横それぞれ伸縮し、
   * 外接矩形の中心を原点へ置く（3.2.2節・10.2.2節）。
   *
   * **縦と横で別々の倍率を掛ける。** 一様に縮めると面積が大きく落ちるためで、
   * たとえば十字は一様なら 28%、縦横別なら 56% が残る。
   * そのぶん形は歪む（六角形は平たく、L字と十字は細長くなる）が、
   * 面積は「外接矩形をどれだけ埋めるか」で決まるので、これが取れる最大である。
   *
   * ポケットの口径と凹頂点の丸めは玉の大きさから決まる固定値なので（3.2.3節）、
   * ここでは伸縮しない。伸縮するのは外周だけで、口も丸めもあとから当てる。
   */
  function fitToBox(o) {
    const b = boxOf(o);
    const sx = BOX_W / b.w, sy = BOX_H / b.h;
    return { outline: o.map(p => pt((p.x - b.cx) * sx, (p.y - b.cy) * sy)), sx, sy };
  }

  /** 頂点 i の内角（ラジアン）。0〜π で返すので、凹頂点では裏側の角になる */
  function interiorAngle(o, i) {
    const n = o.length, p = o[(i - 1 + n) % n], v = o[i], q = o[(i + 1) % n];
    const ux = p.x - v.x, uy = p.y - v.y, wx = q.x - v.x, wy = q.y - v.y;
    const c = (ux * wx + uy * wy) / (Math.hypot(ux, uy) * Math.hypot(wx, wy));
    return Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
  }

  /** 頂点 i が凹（台の内側へ突き出ている）か。外周は反時計回りなので右へ曲がれば凹 */
  function isConcave(o, i) {
    const n = o.length, p = o[(i - 1 + n) % n], v = o[i], q = o[(i + 1) % n];
    return (v.x - p.x) * (q.y - v.y) - (v.y - p.y) * (q.x - v.x) < 0;
  }

  /**
   * 内角が 90 度に満たない鋭い頂点を、幅がちょうど mouth になるように切り落とす（3.3.2節）。
   *
   * 2本の辺に沿って同じ長さだけ戻ると、切り口は先端の軸（二等分線）に垂直になり、
   * その長さは 2·d·sin(内角/2) になる。だから d ＝ mouth ÷ (2·sin(内角/2))。
   * 切ってできる2つの角は「90度 ＋ 内角の半分」なので、**切る深さに関わらず必ず 90 度以上**
   * になり、玉が挟まる角は残らない（3.3.1節）。
   *
   * 内角90度以上の頂点と凹頂点には手を触れない。したがって長方形・六角形・L字・十字は
   * この関数を通しても1点も変わらない。実際に切られるのは星型の先端だけである。
   */
  function truncateSharp(o, mouth) {
    const n = o.length, out = [];
    for (let i = 0; i < n; i++) {
      const v = o[i], a = interiorAngle(o, i);
      if (isConcave(o, i) || a >= Math.PI / 2) { out.push(pt(v.x, v.y)); continue; }
      const p = o[(i - 1 + n) % n], q = o[(i + 1) % n];
      const ul = Math.hypot(p.x - v.x, p.y - v.y), wl = Math.hypot(q.x - v.x, q.y - v.y);
      const d = mouth / (2 * Math.sin(a / 2));
      out.push(pt(v.x + (p.x - v.x) / ul * d, v.y + (p.y - v.y) / ul * d));
      out.push(pt(v.x + (q.x - v.x) / wl * d, v.y + (q.y - v.y) / wl * d));
    }
    return out;
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
    // 距離は境界要素から解析的に出す（円弧は円弧のまま測る）。
    // 内か外かの向きだけは折れ線で数える。折れ線は円弧より内へ 0.10 mm ほど落ちるので、
    // 向きが入れ替わりうるのは境界から 0.10 mm 以内＝距離がほぼ 0 の帯だけで、
    // 「玉が丸ごと収まるか」（28.575 mm）の答えは動かない。
    let best = Infinity;
    for (const e of table.bounds) { const d = elemDist(e, x, y); if (d < best) best = d; }
    return inPolygon(table.outline, x, y) ? best : -best;
  }

  /** 外周から margin 以上内側にあるか。margin に負の値を渡せば「外側への許容」になる */
  function inside(table, x, y, margin) {
    return clearance(table, x, y) >= (margin || 0);
  }

  /** 外周のうち点にいちばん近い場所 */
  function nearestBoundary(table, x, y) {
    let best = null, bestD = Infinity;
    for (const e of table.bounds) {
      const p = elemNearest(e, x, y);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD) { bestD = d; best = p; }
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
   * もとの正六角形は一辺 1114.3 mm だが、伸縮すると 898.0 mm と 1270.0 mm の2種になる。
   *
   * 形状ごとに個数を並べる形にすると、台を足したときに書き忘れる。
   */
  const DIAMOND_PITCH = 317.5;     // 現実の9フィート台のダイヤ間隔 mm

  function diamonds(table) {
    const out = [];
    for (const e of table.bounds) {
      const len = elemLen(e);
      const div = Math.max(2, Math.round(len / DIAMOND_PITCH));
      // 境界は反時計回りに持っているので、進む向き (ex, ey) に対して外向きは (ey, -ex)
      for (let k = 1; k < div; k++) {
        const p = elemPointFrac(e, k, div), g = elemNearest(e, p.x, p.y);
        out.push({ x: p.x, y: p.y, nx: g.ey / g.len, ny: -g.ex / g.len });
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
  function buildRails(bounds, outline, spec, hasPockets, fillets) {
    const n = bounds.length;
    const len = i => elemLen(bounds[i]);
    const cuts = []; for (let i = 0; i < n; i++) cuts.push([]);
    const cutAtVertex = (vi, d) => {
      const prev = (vi - 1 + n) % n;              // 頂点へ入ってくる辺
      cuts[prev].push([len(prev) - d, len(prev)]);
      cuts[vi].push([0, d]);                      // 頂点から出ていく辺
    };
    // ポケットの口は「ポケットあり版」だけ。丸めは物理を成り立たせるためなので常に入れる
    /*
     * 頂点のポケットの切り込みは、辺に沿って何ミリ戻るかで指定する。
     * `cut` を直に持たせるのは、口の開きを第1段階の実測値のまま引き継ぐ形（内角90度の角）。
     * `mouth` を持たせた場合は、**その頂点の実際の内角から**切り込みを出す。
     * 外接矩形を揃えるために外周を潰すと内角が変わるので、
     * 切り込みの長さを決め打ちにすると口の広さが形ごとにずれてしまう。
     */
    const vertexCut = pk => (pk.cut != null)
      ? pk.cut
      : pk.mouth / (2 * Math.sin(interiorAngle(outline, pk.i) / 2));
    /*
     * 境界の途中に開ける口の、半分の長さ（境界に沿って測る）。
     * **曲面台では口径を弧長ではなく弦で測る**（3.4.1節）。
     * 半径 r の円弧で弦 mouth を張る半角は asin(mouth / 2r) なので、
     * 沿って測った長さは r·asin(mouth / 2r) になる。直線ではそのまま半分。
     */
    const edgeHalf = (pk, e) => (pk.half != null) ? pk.half
      : isArc(e) ? e.r * Math.asin(Math.min(1, pk.mouth / (2 * e.r)))
        : pk.mouth / 2;
    if (hasPockets) {
      for (const pk of spec) {
        if (pk.at === 'vertex') cutAtVertex(pk.i, vertexCut(pk));
        else {
          const c = len(pk.i) * pk.t, h = edgeHalf(pk, bounds[pk.i]);
          cuts[pk.i].push([c - h, c + h]);
        }
      }
    }
    for (const f of (fillets || [])) cutAtVertex(f.i, f.d);
    const out = [];
    for (let i = 0; i < n; i++) {
      const e = bounds[i], L = len(i);
      const gaps = cuts[i].slice().sort((p, q) => p[0] - q[0]);
      let at = 0;
      for (const g of gaps) {
        const a = Math.max(0, g[0]), b = Math.min(L, g[1]);
        if (a > at) out.push(subElem(e, at, a, false));
        if (b > at) at = b;
      }
      if (at < L) out.push(subElem(e, at, 0, true));
    }
    for (const f of (fillets || [])) out.push(f.arc);
    return out;
  }

  /** ポケットの中心座標を境界から求める。頂点はその境界要素の始点にあたる */
  function buildPockets(bounds, spec) {
    return spec.map(pk => {
      const p = elemPointT(bounds[pk.i], pk.at === 'vertex' ? 0 : pk.t);
      return { id: pk.id, x: p.x, y: p.y, r: pk.r };
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
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      frameStyle: 'rect',      // 外枠の描き方。第1段階からの見た目をそのまま保つ
    };
  }

  /**
   * A-02 六角形（3.5.2節）。形の比は正六角形。頂点を長軸（±X）に置く向き。
   * ポケットは全6頂点（3.4.2節。長辺の中央は置かない＝準拠すべき現実の台が無いため）。
   *
   * 外接矩形を揃えるために潰すと内角が 120 度から 90／135 度に変わるので、
   * 切り込みは長さを決め打ちにせず、口径 114.30 mm から**そのときの内角で**出す。
   * 潰したあとの最小内角はちょうど 90 度で、玉が挟まらない下限に乗る（3.3.1節）。
   */
  function shapeA02() {
    return {
      shape: 'A-02',
      outline: [
        pt(HEX_A, 0), pt(HEX_A / 2, HEX_H), pt(-HEX_A / 2, HEX_H),
        pt(-HEX_A, 0), pt(-HEX_A / 2, -HEX_H), pt(HEX_A / 2, -HEX_H),
      ],
      pocketSpec: [
        { id: 'FT', at: 'vertex', i: 0, mouth: MOUTH, r: 63 },
        { id: 'FR', at: 'vertex', i: 1, mouth: MOUTH, r: 63 },
        { id: 'HR', at: 'vertex', i: 2, mouth: MOUTH, r: 63 },
        { id: 'HT', at: 'vertex', i: 3, mouth: MOUTH, r: 63 },
        { id: 'HL', at: 'vertex', i: 4, mouth: MOUTH, r: 63 },
        { id: 'FL', at: 'vertex', i: 5, mouth: MOUTH, r: 63 },
      ],
      longAxis: 'x', footDirection: +1,
      axisY: 0,
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
      longAxis: 'x', footDirection: +1,
      axisY,
      frameStyle: 'outline',
    };
  }

  /**
   * A-09 十字（3.5.7節）。一辺 803.2 mm の正方形5個を十字に並べた形。
   * 面積は 5a² ＝ 3,225,651 mm² で、3.2.2節の 3,225,800 mm² との差は 0.005%。
   *
   * **外接矩形が正方形なので長軸が一意に定まらない**（10.2.2節）。長軸をXと明示する。
   * **基準スポットの上書きは要らない。** 共通規則の (L/4, 0) ＝ (602.4, 0) は
   * 横の腕の内部に落ちる（10.2.4節が「成立」と判定している）。
   * 横の腕の中心線は y=0 なので、標準長方形・六角形と同じく axisY は 0。
   *
   * ポケットは8個（3.4.2節・D363で変更なし）＝凸頂点8つのみ。
   * 長辺の中央には置かない（現実に対応する台が無いため）。
   * 凹頂点（腕の付け根）4つには置かず、そこには 3.3.3節の丸めが自動で入る。
   */
  function shapeA09() {
    const a = CROSS_A / 2;           //  401.6 ＝腕の幅の半分
    const b = CROSS_A * 1.5;         // 1204.8 ＝腕の先までの距離
    return {
      shape: 'A-09',
      // 反時計回り。下の腕の左先端から始めて、右回りに4本の腕をたどる
      outline: [
        pt(-a, -b), pt(a, -b),       // 0,1  下の腕の先端
        pt(a, -a),                   // 2    凹（腕の付け根）
        pt(b, -a), pt(b, a),         // 3,4  右（フット側）の腕の先端
        pt(a, a),                    // 5    凹
        pt(a, b), pt(-a, b),         // 6,7  上の腕の先端
        pt(-a, a),                   // 8    凹
        pt(-b, a), pt(-b, -a),       // 9,10 左（ヘッド側）の腕の先端
        pt(-a, -a),                  // 11   凹
      ],
      pocketSpec: [
        { id: 'BL', at: 'vertex', i: 0, cut: GAP_CORNER, r: 63 },
        { id: 'BR', at: 'vertex', i: 1, cut: GAP_CORNER, r: 63 },
        { id: 'FB', at: 'vertex', i: 3, cut: GAP_CORNER, r: 63 },
        { id: 'FT', at: 'vertex', i: 4, cut: GAP_CORNER, r: 63 },
        { id: 'TR', at: 'vertex', i: 6, cut: GAP_CORNER, r: 63 },
        { id: 'TL', at: 'vertex', i: 7, cut: GAP_CORNER, r: 63 },
        { id: 'HT', at: 'vertex', i: 9, cut: GAP_CORNER, r: 63 },
        { id: 'HB', at: 'vertex', i: 10, cut: GAP_CORNER, r: 63 },
      ],
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      frameStyle: 'outline',
    };
  }

  /**
   * A-11 星型（3.5.8節）。正五芒星の外形の先端5本を、3.3.2節に従って
   * 先端の軸に垂直な直線でポケット口径と同じ幅（114.30 mm）に切り落とした形。
   *
   * **先端の1本を +X＝フット側へ向ける。** 長軸は画面の縦に置かれるので（4.10.1節）、
   * 画面では ★ の字と同じく先端が上を向く。ラックはその先端の中に置かれる。
   *
   * **★この形だけは、切り落としを「潰したあと」にやり直す。**
   * 外接矩形を 2540 × 1270 に揃えるために縦横で違う倍率を掛けると、
   * 5本の先端の内角が 36 度から 14.8／21.4／61.2 度へ**ばらばらに変わる**。
   * 先に切ってから潰すと、切断面の幅が 114.30 からずれて、口の広さが先端ごとに違ってしまう。
   * 切り落とすと外接矩形が縮むので、「潰す → 切る → 測る」を繰り返して 2540 × 1270 へ寄せる。
   * 切ったあとの角は必ず 90 度以上になる（実測で最小 97.5 度）ので、玉が挟まる角は残らない。
   *
   * 5本の先端が別々の形になるのと引き換えに、**長軸まわりの左右対称は保たれる**。
   * ヘッド側とフット側は対称でなくなる（フット側が1本の先端、ヘッド側が2本）。
   *
   * ポケットは5個（3.4.2節）＝5つの切断面。凸頂点は切り落としで10個になるが、
   * ポケットを置くのは切断面だけで、切断面の両端はポケットの口の角になる。
   * 凹頂点5つには置かず、そこには 3.3.3節の丸めが自動で入る。
   * キャロム版では切断面がそのままクッションになる（3.6.1節）。
   */
  function shapeA11() {
    const tipAng = [0, 72, 144, 216, 288];   // 先端の向き（度）。1本が +X＝フット側
    const pocketId = ['FT', 'FR', 'HR', 'HL', 'FL'];

    // 切り落とす前の正五芒星。反時計回りに「先端 → 次の谷」を5回
    const star = (sx, sy) => {
      const o = [];
      for (const t of tipAng) {
        const a = t * Math.PI / 180, b = (t + 36) * Math.PI / 180;
        o.push(pt(STAR_ROUT * Math.cos(a) * sx, STAR_ROUT * Math.sin(a) * sy));
        o.push(pt(STAR_RIN * Math.cos(b) * sx, STAR_RIN * Math.sin(b) * sy));
      }
      return o;
    };

    // 潰す → 切る → 外接矩形を測る、を繰り返して 2540 × 1270 に合わせる
    let sx = 1, sy = 1, cut = null;
    for (let it = 0; it < 60; it++) {
      cut = truncateSharp(star(sx, sy), MOUTH);
      const b = boxOf(cut);
      sx *= BOX_W / b.w; sy *= BOX_H / b.h;
    }
    const b = boxOf(cut);
    const outline = cut.map(p => pt(p.x - b.cx, p.y - b.cy));

    return {
      shape: 'A-11',
      outline,
      // 切断面はまるごとポケットの口。辺の長さと切る幅がちょうど同じなので、
      // 丸め誤差でクッションの切れ端（長さ 0 の壁）が残らないよう気持ち広く指定する。
      // 切り取りは辺の中で頭打ちになるので、隣の辺へはみ出すことはない。
      pocketSpec: tipAng.map((_, k) => (
        { id: pocketId[k], at: 'edge', i: k * 3, t: 0.5, half: MOUTH / 2 + 0.5, r: 58 }
      )),
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      frameStyle: 'outline',
    };
  }

  /**
   * A-06 スタジアム型（3.5.4節）。長方形の両端に半円を付けた形。
   *
   * **この台は頂点を1つも持たない。**外周は「半円・直線・半円・直線」の4要素で表す。
   *
   * 3.5.4節の寸法（半円半径 672.1／直線部 1344.2）は**形の比**であって、
   * その比は既に 2:1 ＝ 2540 × 1270 と同じである。だから外接矩形を揃えても
   * 縦横が同じ倍率になり、**半円は半円のまま歪まない**。
   * そこで最初から揃った寸法で組む（星型と同じやり方）。半円半径は短辺の半分＝635.0、
   * 直線部は 2540 − 635×2 ＝ 1270.0 になる。面積は 2,879,669 mm²（標準長方形の 89%）で、
   * 3.2.2節の表の「約 2,879,000 mm²・89%」と一致する。
   *
   * **ポケットは6個**（3.4.3節）。両端の最遠点に2個を置き、そこから弧長等間隔に並べる。
   * 結果として直線部へ片側2個ずつ入る。**個数の割り振りを形ごとに書かない**
   * ── 弧長を6等分した結果がそう並ぶだけである。
   * 3.4.3節は「弧長は解析的に閉じた形で求まらないので事前計算値を持て」と定めるが、
   * それは楕円とドーナツの話で、**この台は円と直線なので弧長が式で解ける**。
   *
   * 口の広さは 3.4.1節に従い、**弧長ではなく弦**で 114.30 mm にする。
   * 捕球半径は 58（星型の切断面や標準長方形のサイドと同じ「角ではない口」の値）。
   */
  const STAD_R = HY;                        // 半円半径 635.0 ＝ 短辺の半分
  const STAD_STRAIGHT = PLAY_W - 2 * STAD_R; // 直線部 1270.0

  function shapeA06() {
    const P = 2 * STAD_STRAIGHT + 2 * Math.PI * STAD_R;   // 外周長 6529.8 mm
    const step = P / 6;                                    // ポケットの弧長間隔 1088.3 mm
    const quarter = Math.PI * STAD_R / 2;                  // 最遠点から接点まで 997.5 mm
    const off = step - quarter;                            // 接点から直線部へ入る距離 90.8 mm
    const t1 = off / STAD_STRAIGHT, t2 = 1 - t1;
    const cx = STAD_STRAIGHT / 2;                          // 半円の中心 ±635.0
    return {
      shape: 'A-06',
      // 反時計回り。フット側（+X）の半円の下端から始める
      bounds: [
        arc(cx, 0, STAD_R, -Math.PI / 2, Math.PI, 'in'),        // 0 フット側の半円
        seg(cx, STAD_R, -cx, STAD_R),                           // 1 上（+Y）の直線
        arc(-cx, 0, STAD_R, Math.PI / 2, Math.PI, 'in'),        // 2 ヘッド側の半円
        seg(-cx, -STAD_R, cx, -STAD_R),                         // 3 下（−Y）の直線
      ],
      pocketSpec: [
        { id: 'FT', at: 'edge', i: 0, t: 0.5, mouth: MOUTH, r: 58 },   // 最遠点（フット側）
        { id: 'FR', at: 'edge', i: 1, t: t1, mouth: MOUTH, r: 58 },
        { id: 'HR', at: 'edge', i: 1, t: t2, mouth: MOUTH, r: 58 },
        { id: 'HT', at: 'edge', i: 2, t: 0.5, mouth: MOUTH, r: 58 },   // 最遠点（ヘッド側）
        { id: 'HL', at: 'edge', i: 3, t: t1, mouth: MOUTH, r: 58 },
        { id: 'FL', at: 'edge', i: 3, t: t2, mouth: MOUTH, r: 58 },
      ],
      longAxis: 'x', footDirection: +1,
      axisY: 0,
      frameStyle: 'outline',
    };
  }

  const SHAPES = {
    'A-01': shapeA01, 'A-02': shapeA02, 'A-06': shapeA06,
    'A-08': shapeA08, 'A-09': shapeA09, 'A-11': shapeA11,
  };

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
    /*
     * 形は「頂点の並び」か「境界要素の並び」のどちらかで返ってくる。
     * 多角形は頂点で返し、ここで辺へ直す（値は変わらない）。
     * 曲面の台は頂点を持てないので境界要素で返し、折れ線はそこから写して作る。
     * どちらの道でも、この先は bounds（判定・壁・ポケット）と
     * outline（描画と内外の向き）の2つが必ず揃う。
     */
    let bounds, outline, sy;
    if (s.bounds) {
      // 曲面の台は既に 2540 × 1270 に揃った寸法で返ってくる（半円が歪まないため）
      bounds = s.bounds;
      outline = sampleBounds(bounds);
      sy = 1;
    } else {
      // どの台も外接矩形を 2540 × 1270 に揃える（3.2.2節）。
      // 星型は自分で合わせてから返してくるので、ここを通しても何も変わらない。
      const fit = fitToBox(s.outline);
      outline = fit.outline;
      bounds = boundsFromOutline(outline);
      sy = fit.sy;
    }
    const axisY = (s.axisY || 0) * sy;         // 玉を並べる線も一緒に潰す
    const spotX = footSpotX(bounds, outline, axisY);
    const fillets = buildFillets(outline, FILLET_R);
    return {
      shape: s.shape,
      name: s.shape,
      hasPockets: !!hasPockets,
      outline,
      bounds,
      perimeter: perimeterOf(bounds),
      halfW: BOX_W / 2, halfH: BOX_H / 2,
      ballR: R,
      rails: buildRails(bounds, outline, s.pocketSpec, !!hasPockets, fillets),
      pockets: hasPockets ? buildPockets(bounds, s.pocketSpec) : [],
      cushionTop: CUSHION_TOP,
      cushionWidth: CUSHION_W,
      frameStyle: s.frameStyle,
      // 10.2.2節：長軸・フット側・基準スポット
      longAxis: s.longAxis,
      footDirection: s.footDirection,
      // 長軸の線が短軸方向のどこを通るか。玉を並べる側は必ずこれを中心に置く。
      // 「台の中心線は y=0」は標準長方形と六角形でしか成り立たない（L字では腕の中心）
      axisY,
      spot: pt(spotX, axisY),
      headSpot: pt(-spotX, axisY),
      center: pt(0, axisY),
      // 物性値（3.7節・5.3.4節）。通常モードでの台ごとの差は微差に留める
      cushionRestitution: 0.86,
      clothSlide: 0.20,     // 滑り摩擦係数
      clothRoll: 0.010,     // 転がり抵抗
      clothSpin: 0.011,     // 縦軸まわり（サイドスピン）の減衰
      clothRestitution: 0.45, // 着地時のバウンド（5.8.3節）
    };
  }

  const RACK_GAP = D + 0.15;        // 玉どうしをわずかに離して初期めり込みを防ぐ
  const RACK_DX = RACK_GAP * Math.sqrt(3) / 2;

  /** 三角ラック15個の置き場所。先頭を (sx, sy) に置いてフット側（+X）へ広げる */
  function triangleCells(sx, sy) {
    const cells = [];
    for (let r = 0; r < 5; r++) for (let i = 0; i <= r; i++) {
      cells.push({ x: sx + RACK_DX * r, y: sy + (i - r / 2) * RACK_GAP, row: r, idx: i });
    }
    return cells;
  }

  /**
   * フットスポットの長軸方向の位置（10.2.2節・10.2.3節）。
   *
   * 標準長方形の (L/4, 0) は、言い換えると
   * **「台の中心と、長軸の線が壁に達する点との中点」**である。
   * 外接矩形を 2540 × 1270 に揃えたあとは、標準長方形・六角形・L字・十字の4つとも
   * この読み方でぴったり 635 になる（どれも長軸の線が外接矩形の端まで届くため）。
   *
   * 星型だけは、その位置が細い先端の奥に当たり、三角ラック15個を置くと
   * 外側の玉が壁へ食い込む。そこで**「中点」と「ラックが収まるいちばん奥」の小さいほう**を採る。
   * 形ごとに値を並べない ── 並べると台を足したときに書き忘れる（ダイヤ・丸めと同じ理由）。
   */
  function footSpotX(bounds, outline, axisY) {
    const tb = { bounds, outline };
    const reach = boundaryReach(bounds, axisY);
    const fits = sx => triangleCells(sx, axisY).every(c => clearance(tb, c.x, c.y) >= R);
    let x = reach / 2;
    while (x > 0 && !fits(x)) x -= 1;    // 1 mm ずつ手前へ。どの端末でも同じ値になる
    return x;
  }

  /** ダイヤ形ラック（G-01 ナインボール）。1番を先頭・9番を中央（7.3.1節）。 */
  function rackDiamond(table, nums) {
    // 行構成 1-2-3-2-1。先頭をフットスポットに置き、フット側（+X）へ広げる。
    const gap = RACK_GAP, dx = RACK_DX;
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
    const cells = triangleCells(table.spot.x, table.spot.y);
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
    // 検査から直に確かめるために出している。
    // 「内角90度以上には手を触れない」という条件は、いまのどの台でも働かない
    // （切り落としを掛ける相手が星型の先端5本だけで、どれも90度未満のため）。
    // 台の中では確かめようがないので、台とは別に作った多角形で直接確かめる。
    truncateSharp, fitToBox, interiorAngle,
    // 境界要素（3.7節）。曲面の台を直に測るために出している
    isArc, elemLen, elemPointT, elemDist, elemNearest, subElem,
    boundsFromOutline, sampleBounds, boundaryReach, perimeterOf,
  };
})();

if (typeof window !== 'undefined') window.BilliardsTable = BilliardsTable;
