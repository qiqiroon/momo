/* MOMO 1024 — 3D モードの描き方と向きの決め方（仕様書 §17.5）。canvas に自分で描く（three.js は使わない）
   盤面の位置 [d, r, c]（d＝奥行き。0 が最初の向きでいちばん手前）を、真ん中を原点にした空間に置く：
     x = c − (N−1)/2（右が＋）、y = (N−1)/2 − r（上が＋）、z = (N−1)/2 − d（手前が＋）
   視点は、空間を yaw（縦の軸まわり）→ pitch（横の軸まわり）の順に回して、手前の (0,0,dist) から見る。 */
(function () {
  'use strict';
  var DEG = Math.PI / 180;
  var HOME = { yaw: -32 * DEG, pitch: 26 * DEG };
  var TILE = 0.62;          // 札の立方体の一辺（マスの間隔を 1 として）
  var LIGHT = norm([-0.45, 0.8, 0.55]);

  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

  function makeCam() { return { yaw: HOME.yaw, pitch: HOME.pitch, zoom: 1 }; }
  function home(cam) { cam.yaw = HOME.yaw; cam.pitch = HOME.pitch; cam.zoom = 1; }
  function rotateBy(cam, dx, dy) {
    cam.yaw += dx * 0.0095;
    cam.pitch = Math.max(-85 * DEG, Math.min(85 * DEG, cam.pitch + dy * 0.0095));
  }

  // 空間 → 視点の空間（回転だけ）
  function rot(cam, v) {
    var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    var x = v[0] * cy + v[2] * sy, z = -v[0] * sy + v[2] * cy, y = v[1];
    return [x, y * cp - z * sp, y * sp + z * cp];
  }
  // 画面の大きさと盤面の大きさから、映し方を決める
  function frame(cam, W, H, N) {
    var R = Math.sqrt(3) * N / 2;           // 盤面を包む球の半径
    var dist = R * 3.4;
    var f = Math.min(W, H) * 0.5 * (dist - R) / (R * 0.84) * cam.zoom;
    return { W: W, H: H, N: N, dist: dist, f: f, cx: W / 2, cy: H / 2 };
  }
  function toWorld(N, p) { var h = (N - 1) / 2; return [p[2] - h, h - p[1], h - p[0]]; }
  // 視点の空間の点 → 画面の点（x, y, 奥行き, 拡大率）
  function proj(fr, q) {
    var depth = fr.dist - q[2], k = fr.f / depth;
    return { x: fr.cx + q[0] * k, y: fr.cy - q[1] * k, depth: depth, k: k };
  }

  // 札の立方体の6面：[外向きの向き, 4つの角の符号]
  var FACES = [   // [外向き, 4つの角, 文字の右, 文字の下]
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [0, 0, -1], [0, -1, 0]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]], [0, 0, 1], [0, -1, 0]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], [1, 0, 0], [0, 0, 1]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], [1, 0, 0], [0, 0, -1]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [1, 0, 0], [0, -1, 0]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], [-1, 0, 0], [0, -1, 0]]
  ];

  function rgbOf(hex, k) {
    var v = parseInt(hex.slice(1), 16);
    return [(v >> 16) * k, ((v >> 8) & 255) * k, (v & 255) * k];
  }
  function avg(list) {
    var r = [0, 0, 0];
    list.forEach(function (c) { r[0] += c[0] / list.length; r[1] += c[1] / list.length; r[2] += c[2] / list.length; });
    return r;
  }
  function css(c) { return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')'; }
  function shade(hex, k) {
    var v = parseInt(hex.slice(1), 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    function f(x) { return Math.max(0, Math.min(255, Math.round(k < 1 ? x * k : x + (255 - x) * (k - 1)))); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  /* 描く。o = { N, tiles:[{pos:[d,r,c](小数可), n, s(大きさ), goal, glow}], colorOf(n)→[札,文字], label(n, px)→{text,font},
                 dim(0..1 暗くする), shake:[dx,dy] } */
  function draw(ctx, W, H, cam, o) {
    var N = o.N, fr = frame(cam, W, H, N), h = N / 2;
    ctx.save();
    if (o.shake) ctx.translate(o.shake[0], o.shake[1]);
    // 外枠（Cube と同じく暗い背景に細い線）
    var corners = [];
    for (var i = 0; i < 8; i++) corners.push(proj(fr, rot(cam, [i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h])));
    var EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    ctx.lineWidth = 1.2;
    EDGES.forEach(function (e) {
      var a = corners[e[0]], b = corners[e[1]];
      ctx.strokeStyle = 'rgba(148,163,184,0.38)';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    });
    // 空きマスの点
    var occupied = {};
    o.tiles.forEach(function (t) { if (t.home) occupied[t.home.join(',')] = true; });
    ctx.fillStyle = 'rgba(100,116,139,0.55)';
    for (var d = 0; d < N; d++) for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      if (occupied[d + ',' + r + ',' + c]) continue;
      var pp = proj(fr, rot(cam, toWorld(N, [d, r, c])));
      ctx.beginPath(); ctx.arc(pp.x, pp.y, Math.max(1.2, 0.05 * pp.k), 0, Math.PI * 2); ctx.fill();
    }
    // 札：奥から順に
    var list = o.tiles.map(function (t) {
      var q = rot(cam, toWorld(N, t.pos));
      return { t: t, q: q, depth: fr.dist - q[2] };
    }).sort(function (a, b) { return b.depth - a.depth; });
    var alpha = o.alpha == null ? 1 : o.alpha;
    if (alpha >= 1) list.forEach(function (it) { drawCube(ctx, fr, cam, it.q, it.t, o); });
    else {
      // 半透明：1つの札をいったん下書きの canvas に不透明で描き、その札だけを透かして重ねる
      // （札を直接透かして描くと、面と丸みの塗りが重なった所だけ濃くなり、筋が出るため）
      var cvs = ctx.canvas, sc = scratchFor(cvs), sx = sc.getContext('2d'), m = ctx.getTransform();
      var oT = Object.assign({}, o, { deferText: true });
      list.forEach(function (it) {
        var pc = proj(fr, it.q), R = pc.k * TILE * 1.45 * Math.max(0.2, it.t.s);
        var bx = Math.max(0, Math.floor(m.a * (pc.x - R) + m.e)), by = Math.max(0, Math.floor(m.d * (pc.y - R) + m.f));
        var bw = Math.min(cvs.width, Math.ceil(m.a * (pc.x + R) + m.e)) - bx, bh = Math.min(cvs.height, Math.ceil(m.d * (pc.y + R) + m.f)) - by;
        if (bw <= 0 || bh <= 0) return;
        sx.setTransform(1, 0, 0, 1, 0, 0); sx.clearRect(bx, by, bw, bh);
        sx.setTransform(m);
        var d = drawCube(sx, fr, cam, it.q, it.t, oT);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;   // 縁も含めて札全体を同じだけ透かす
        ctx.drawImage(sc, bx, by, bw, bh, bx, by, bw, bh);
        ctx.restore();
        if (d) d.text(ctx);   // 数字は透かさずに上から（縁取り付き）
      });
    }
    ctx.restore();
  }

  // 角の丸い多角形の道筋（画面の点の列）
  function roundPoly(ctx, pts, r) {
    var n = pts.length;
    ctx.beginPath();
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      var m0 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      if (i === 0) ctx.moveTo(m0[0], m0[1]);
      var rr = Math.min(r, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2, Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 2);
      ctx.arcTo(p1[0], p1[1], p2[0], p2[1], rr);
    }
    ctx.closePath();
  }
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var j = pts.length - 1; j >= 0; j--) { var p2 = pts[j]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p2) <= 0) up.pop(); up.push(p2); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }

  // 札：角の丸い立方体。線は引かず、面の明るさの違いだけで形を見せる。数字は見えている全部の面に貼る
  var INSET = 0.8;
  var OPT = { bands: true, text: true, hull: true };   // 重さを測るときだけ切り替える   // 面の平らな部分の大きさ（残りが丸い角の部分）
  function drawCube(ctx, fr, cam, center, t, o) {
    if (t.s <= 0.01) return;
    var half = TILE / 2 * t.s, col = o.colorOf(t.n), dimK = o.dim ? 1 - 0.55 * o.dim : 1;
    var faces = [], all = [], litSum = 0;
    function P(v) { return proj(fr, [center[0] + v[0], center[1] + v[1], center[2] + v[2]]); }
    FACES.forEach(function (fc) {
      var nrm = rot(cam, fc[0]);
      var fcq = [center[0] + nrm[0] * half, center[1] + nrm[1] * half, center[2] + nrm[2] * half];
      var toEye = [-fcq[0], -fcq[1], fr.dist - fcq[2]];
      var facing = (nrm[0] * toEye[0] + nrm[1] * toEye[1] + nrm[2] * toEye[2]) / Math.hypot(toEye[0], toEye[1], toEye[2]);
      if (facing <= 0) return;
      var pts = fc[1].map(function (sg) { var w = rot(cam, [sg[0] * half, sg[1] * half, sg[2] * half]); var q = P(w); return [q.x, q.y]; });
      pts.forEach(function (q) { all.push(q); });
      var lit = 0.72 + 0.28 * Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);   // 元の色より明るくしない
      litSum += lit;
      var U = rot(cam, fc[2]), V = rot(cam, fc[3]);
      faces.push({ pts: pts, corners: fc[1], lit: lit, facing: facing, nrm: nrm, U: U, V: V });
    });
    if (!faces.length) return;
    var pc = P([0, 0, 0]);
    if (t.glow) {   // クリアの演出・ゴールの札：金の光
      var R = pc.k * TILE * 1.35 * t.s, g = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, R);
      g.addColorStop(0, 'rgba(253,230,138,' + 0.6 * t.glow + ')'); g.addColorStop(1, 'rgba(253,230,138,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pc.x, pc.y, R, 0, Math.PI * 2); ctx.fill();
    }
    var size = pc.k * TILE * t.s;   // 画面での札の大きさのめやす
    // 丸い角の立方体（2026-11-14 利用者と3度直した）
    //   ・面はその面の色（元の色より明るくしない）
    //   ・2つの面が見えている辺：A の面の色 → B の面の色 のグラデーション
    //   ・輪郭の辺（見えない裏側の面との境）：その面の色のまま。暗くしない（辺の途中で色を変えない）
    //   ・輪郭の角（2つの面の輪郭の辺が出会う所）：丸めて、A の面の色 → B の面の色でつなぐ
    //   ・3つの面が集まる角：3つの面の色の平均
    var hp = hull(all), rad = size * 0.2;
    var cols = faces.map(function (f) { return rgbOf(col[0], f.lit * dimK); });
    faces.forEach(function (f) {
      var cx = 0, cy = 0;
      f.pts.forEach(function (q) { cx += q[0] / 4; cy += q[1] / 4; });
      f.ins = f.pts.map(function (q) { return [cx + (q[0] - cx) * INSET, cy + (q[1] - cy) * INSET]; });
    });
    // 下地は塗らない（輪郭の角からはみ出して色の違う縁になるため）。塗り分けのすき間は、同じ色で 1px なぞって埋める
    var edges = {}, corners = {}, sil = {};
    faces.forEach(function (f, i) {
      for (var j = 0; j < 4; j++) {
        var c0 = String(f.corners[j]), c1 = String(f.corners[(j + 1) % 4]), key = c0 < c1 ? c0 + '|' + c1 : c1 + '|' + c0;
        var e = { i: i, a0: f.ins[j], a1: f.ins[(j + 1) % 4], o0: f.pts[j], o1: f.pts[(j + 1) % 4], k0: c0, k1: c1 };
        if (edges[key]) edges[key].push(e); else edges[key] = [e];
        (corners[c0] = corners[c0] || []).push({ i: i, p: f.ins[j] });
      }
    });
    function poly(pts) { ctx.beginPath(); pts.forEach(function (q, k) { if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }
    function paint(style) { ctx.fillStyle = ctx.strokeStyle = style; ctx.fill(); ctx.lineWidth = 1; ctx.lineJoin = 'round'; ctx.stroke(); }
    function grad(m0, m1, ca, cb) {
      var gr = ctx.createLinearGradient(m0[0], m0[1], m1[0], m1[1]);
      gr.addColorStop(0, css(ca)); gr.addColorStop(1, css(cb)); return gr;
    }
    function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    function toward(a, b, d) { var l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, k = Math.min(0.45, d / l); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
    if (OPT.bands) {
      for (var key in edges) {
        var L = edges[key], A = L[0], B = L[1];
        if (B) {
          var bSame = B.k0 === A.k0, b0 = bSame ? B.a0 : B.a1, b1 = bSame ? B.a1 : B.a0;
          poly([A.a0, A.a1, b1, b0]); paint(grad(mid(A.a0, A.a1), mid(b0, b1), cols[A.i], cols[B.i]));
        } else {
          // 輪郭の辺：面の色のまま。両端は丸い角の分だけ内へ寄せ、角は下でまとめて描く
          var q0 = toward(A.o0, A.o1, rad), q1 = toward(A.o1, A.o0, rad);
          poly([A.a0, A.a1, q1, q0]); paint(css(cols[A.i]));
          (sil[A.k0] = sil[A.k0] || []).push({ i: A.i, q: q0, p: A.a0, V: A.o0 });
          (sil[A.k1] = sil[A.k1] || []).push({ i: A.i, q: q1, p: A.a1, V: A.o1 });
        }
      }
      // 輪郭の角：寄せた2点を、角を制御点にした曲線でつなぐ
      for (var vk in sil) {
        var S = sil[vk];
        if (S.length !== 2) continue;
        var s1 = S[0], s2 = S[1], V = s1.V;
        ctx.beginPath();
        ctx.moveTo(s1.q[0], s1.q[1]);
        ctx.quadraticCurveTo(V[0], V[1], s2.q[0], s2.q[1]);
        if (s1.i === s2.i) { ctx.lineTo(s1.p[0], s1.p[1]); ctx.closePath(); paint(css(cols[s1.i])); }
        else { ctx.lineTo(s2.p[0], s2.p[1]); ctx.lineTo(s1.p[0], s1.p[1]); ctx.closePath(); paint(grad(mid(s1.q, s1.p), mid(s2.q, s2.p), cols[s1.i], cols[s2.i])); }
      }
      // 3つの面が集まる角
      for (var ck in corners) {
        var cs = corners[ck];
        if (cs.length < 3) continue;
        poly([cs[0].p, cs[1].p, cs[2].p]); paint(css(avg([cols[cs[0].i], cols[cs[1].i], cols[cs[2].i]])));
      }
    }
    // 面の平らな部分（角は尖らせたまま。まわりと同じ色で接するので境は見えない）
    faces.forEach(function (f, i) { poly(f.ins); paint(css(cols[i])); });
    // 数字：面の上に貼る（面の向きに合わせて傾ける）。札を透かしても、数字は透かさない（2026-11-14 利用者の指示）
    //   透かすときは、札を重ねたあとで描けるよう、描く手順だけを返す
    function drawText(ctx) { if (OPT.text) faces.forEach(function (f) {
      if (f.facing < 0.12) return;
      var c3 = [f.nrm[0] * half, f.nrm[1] * half, f.nrm[2] * half];
      var a = P(c3), pu = P([c3[0] + f.U[0] * half, c3[1] + f.U[1] * half, c3[2] + f.U[2] * half]);
      var pv = P([c3[0] + f.V[0] * half, c3[1] + f.V[1] * half, c3[2] + f.V[2] * half]);
      var ux = pu.x - a.x, uy = pu.y - a.y, vx = pv.x - a.x, vy = pv.y - a.y;
      var scr = Math.min(Math.hypot(ux, uy), Math.hypot(vx, vy)) * 2;   // 画面での面の短い辺
      if (scr < 7) return;
      var lab = String(Math.pow(2, t.n));
      var fs = lab.length <= 2 ? 1.05 : lab.length === 3 ? 0.82 : lab.length === 4 ? 0.64 : 0.52;   // 面の半分を 1 として
      if (scr / 2 * fs < 6) { lab = String(t.n); fs = 1.0; }
      ctx.save();
      ctx.transform(ux, uy, vx, vy, a.x, a.y);
      ctx.globalAlpha = Math.min(1, 0.35 + f.facing);
      ctx.drawImage(labelImg(lab, fs, o.dim ? 'rgba(0,0,0,0.6)' : col[1], !!o.deferText), -1, -1, 2, 2);
      ctx.restore();
    }); }
    if (o.deferText) return { text: drawText };
    drawText(ctx);
  }

  var SCRATCH = null;
  function scratchFor(cvs) {
    if (!SCRATCH) SCRATCH = document.createElement('canvas');
    if (SCRATCH.width !== cvs.width || SCRATCH.height !== cvs.height) { SCRATCH.width = cvs.width; SCRATCH.height = cvs.height; }
    return SCRATCH;
  }
  // 数字の絵（面の半分を 1 とした正方形 [-1,1] に収まる）。文字・大きさ・色ごとに一度だけ作る
  var LABELS = {}, LABEL_PX = 128;
  // edge：縁取りを付ける（札を透かすとき。透けた暗い所に重なっても読めるように）。文字が白なら暗い縁、それ以外は白い縁
  function labelImg(lab, fs, color, edge) {
    var k = lab + '|' + fs + '|' + color + '|' + (edge ? 1 : 0);
    if (LABELS[k]) return LABELS[k];
    var c = document.createElement('canvas'); c.width = c.height = LABEL_PX;
    var x = c.getContext('2d');
    x.font = Math.round(fs * LABEL_PX / 2) + "px 'Fredoka One', sans-serif";
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color;
    if (edge) {
      x.lineJoin = 'round'; x.lineWidth = Math.max(3, fs * LABEL_PX * 0.07);
      x.strokeStyle = /^#fff/i.test(color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
      x.strokeText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02);
    }
    x.fillText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02);
    return (LABELS[k] = c);
  }
  function clearLabels() { LABELS = {}; }   // 字形（Web フォント）が読み込まれたら作り直す

  // 盤面の外枠を画面に映した形（凸の多角形）。中を払えば滑る、外をドラッグすれば回る
  function outline(cam, W, H, N) {
    var fr = frame(cam, W, H, N), h = N / 2, pts = [];
    for (var i = 0; i < 8; i++) { var p = proj(fr, rot(cam, [i & 1 ? h : -h, i & 2 ? h : -h, i & 4 ? h : -h])); pts.push([p.x, p.y]); }
    pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [];
    pts.forEach(function (p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    for (var j = pts.length - 1; j >= 0; j--) { var p2 = pts[j]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p2) <= 0) up.pop(); up.push(p2); }
    lo.pop(); up.pop();
    return lo.concat(up);
  }
  function inside(poly, x, y) {
    var ok = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) ok = !ok;
    }
    return ok;
  }

  // 盤面の6つの向き（空間の向き）
  var DIRV = { left: [-1, 0, 0], right: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1] };
  var AXIS = { left: 0, right: 0, up: 1, down: 1, front: 2, back: 2 };
  function viewAxis(cam) {   // 画面の奥へいちばん向いている軸（0=x 1=y 2=z）
    var best = 0, bv = -1;
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach(function (v, i) { var a = Math.abs(rot(cam, v)[2]); if (a > bv) { bv = a; best = i; } });
    return best;
  }
  // 画面の向き (sx, sy)（右・下が＋）に、いちばん近い盤面の向き。画面の奥へ向いている軸は除く
  function dirFor(cam, sx, sy) {
    var ax = viewAxis(cam), l = Math.hypot(sx, sy) || 1, best = null, bv = -2;
    Object.keys(DIRV).forEach(function (k) {
      if (AXIS[k] === ax) return;
      var q = rot(cam, DIRV[k]), ql = Math.hypot(q[0], q[1]) || 1;
      var dot = (q[0] * sx - q[1] * sy) / (ql * l);
      if (dot > bv) { bv = dot; best = k; }
    });
    return best;
  }
  // 「奥」「手前」の向き
  function depthDirs(cam) {
    var ax = viewAxis(cam), res = {};
    Object.keys(DIRV).forEach(function (k) {
      if (AXIS[k] !== ax) return;
      if (rot(cam, DIRV[k])[2] < 0) res.back = k; else res.front = k;
    });
    return res;
  }

  // ── 向きの矢印（3軸の座標の形。§17.2）。盤面の6つの向きを、いまの見え方のとおりに描く ──
  var AXCOL = ['#f87171', '#4ade80', '#60a5fa'];   // 横（左右）・縦（上下）・奥行き
  function arrows(cam) {
    var out = [];
    Object.keys(DIRV).forEach(function (k) {
      var q = rot(cam, DIRV[k]), vx = q[0], vy = -q[1], l = Math.hypot(vx, vy);
      if (l < 0.3) {   // 画面の奥へ向いている：重ならないよう斜めに出す（奥は右上、手前は左下）
        var away = q[2] < 0; vx = away ? 0.62 : -0.62; vy = away ? -0.62 : 0.62; l = 0.88;
      }
      var len = Math.max(0.5, Math.min(1, l));
      out.push({ dir: k, ax: AXIS[k], x: vx / l * len, y: vy / l * len, z: q[2] });
    });
    return out;
  }
  function gizmoGeo(w, h) { return { cx: w / 2, cy: h / 2, R: Math.min(w, h) / 2 - 12 }; }
  function drawGizmo(ctx, w, h, cam, hot) {
    var g = gizmoGeo(w, h), list = arrows(cam).sort(function (a, b) { return a.z - b.z; });
    ctx.clearRect(0, 0, w, h);
    list.forEach(function (a) {
      var far = a.z < -0.2, tx = g.cx + a.x * g.R, ty = g.cy + a.y * g.R, sx = g.cx + a.x * g.R * 0.22, sy = g.cy + a.y * g.R * 0.22;
      var ang = Math.atan2(ty - sy, tx - sx), hl = 11, on = hot === a.dir;
      ctx.globalAlpha = on ? 1 : far ? 0.5 : 0.95;
      ctx.strokeStyle = ctx.fillStyle = on ? '#ffffff' : AXCOL[a.ax];
      ctx.lineWidth = far ? 3 : 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(tx - Math.cos(ang) * hl * 0.6, ty - Math.sin(ang) * hl * 0.6); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - Math.cos(ang - 0.5) * hl, ty - Math.sin(ang - 0.5) * hl);
      ctx.lineTo(tx - Math.cos(ang + 0.5) * hl, ty - Math.sin(ang + 0.5) * hl);
      ctx.closePath(); ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e5e5e5'; ctx.beginPath(); ctx.arc(g.cx, g.cy, 3.5, 0, Math.PI * 2); ctx.fill();
  }
  // 押した点にいちばん近い矢印（真ん中のあたりは無し）
  function gizmoHit(w, h, cam, x, y) {
    var g = gizmoGeo(w, h), best = null, bd = 1e9;
    if (Math.hypot(x - g.cx, y - g.cy) < g.R * 0.18) return null;
    arrows(cam).forEach(function (a) {
      var ax = g.cx + a.x * g.R * 0.3, ay = g.cy + a.y * g.R * 0.3, bx = g.cx + a.x * g.R * 1.1, by = g.cy + a.y * g.R * 1.1;
      var dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      var d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t)) - (a.z > 0.2 ? 2 : 0);   // 重なったら手前の矢印を選ぶ
      if (d < bd) { bd = d; best = a; }
    });
    return bd < 24 ? best : null;
  }

  window.M1024Three = {
    OPT: OPT, clearLabels: clearLabels,
    drawGizmo: drawGizmo, gizmoHit: gizmoHit, arrows: arrows,
    makeCam: makeCam, home: home, rotateBy: rotateBy, draw: draw,
    outline: outline, inside: inside, dirFor: dirFor, depthDirs: depthDirs
  };
})();
