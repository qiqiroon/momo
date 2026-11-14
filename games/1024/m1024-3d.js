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
  var FRONT_LIT = 0.72 + 0.28 * LIGHT[2];   // 正面を向いた面の明るさ

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
    // 数字の出し方を盤面でそろえる（§22・§23）。2D と同じ3段：0＝普通の数字／1＝2 と小さい n／2＝n だけ
    //   映っている札のどれか1枚でも読めなければ、全部を次の段にする。斜めの面も考えて、立方体の一辺の 8 割で見る
    var sizes = list.map(function (it) { return { n: it.t.n, size: proj(fr, it.q).k * TILE * 0.8 }; });
    var mode = sizes.every(function (z) { return z.size * fitOf(String(Math.pow(2, z.n))) >= 9; }) ? 0
      : sizes.every(function (z) { return z.size * fitPow(z.n) >= 9; }) ? 1 : 2;
    o = Object.assign({}, o, { labelMode: mode });
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
    var TL = o.tile || TILE;   // 札の一辺（2D の平面の札は画面の px で渡す）
    var half = TL / 2 * t.s, col = o.colorOf(t.n), dimK = o.dim ? 1 - 0.55 * o.dim : 1;
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
      if (o.flat) lit = Math.min(1, lit / FRONT_LIT);   // 2D：正面の面を元の色そのままにする
      litSum += lit;
      var U = rot(cam, fc[2]), V = rot(cam, fc[3]);
      faces.push({ pts: pts, corners: fc[1], lit: lit, facing: facing, nrm: nrm, U: U, V: V });
    });
    if (!faces.length) return;
    var pc = P([0, 0, 0]);
    if (t.glow) {   // クリアの演出・ゴールの札：金の光
      var R = pc.k * TL * 1.35 * t.s, g = ctx.createRadialGradient(pc.x, pc.y, 0, pc.x, pc.y, R);
      g.addColorStop(0, 'rgba(253,230,138,' + 0.6 * t.glow + ')'); g.addColorStop(1, 'rgba(253,230,138,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pc.x, pc.y, R, 0, Math.PI * 2); ctx.fill();
    }
    var size = pc.k * TL * t.s;   // 画面での札の大きさのめやす
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
      // 数字は面の縁いっぱいに書く（§19.2）。べき（n）だけのときは赤（§22）
      var md = o.labelMode || 0, color = o.dim ? 'rgba(0,0,0,0.6)' : col[1];
      var img = md === 1 ? powImg(t.n, color, !!o.deferText, !o.dim)
        : labelImg(md === 2 ? String(t.n) : String(Math.pow(2, t.n)), color, !!o.deferText, md === 2 && !o.dim);
      if (scr * img.fit < 4) return;
      ctx.save();
      ctx.transform(ux, uy, vx, vy, a.x, a.y);
      ctx.globalAlpha = Math.min(1, 0.35 + f.facing);
      ctx.drawImage(img, -1, -1, 2, 2);
      ctx.restore();
    }); }
    if (o.deferText) return { text: drawText };
    if (!o.noText) drawText(ctx);
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
  // べきの数字の色（§22）。白い字の札では、白い字に赤い縁
  var EXP_RED = '#D0102A';
  var FITS = {};
  function fitOf(lab) {
    if (FITS[lab] == null) { var c = document.createElement('canvas').getContext('2d'); c.font = "100px 'Fredoka One', sans-serif"; FITS[lab] = Math.min(0.72, 0.86 / (c.measureText(lab).width / 100)); }
    return FITS[lab];
  }
  // 「2」と上付きの n の形（§23）。字の大きさは「2」の大きさ ÷ 面の一辺
  function fitPow(n) {
    var k = '^' + n;
    if (FITS[k] == null) { var c = document.createElement('canvas').getContext('2d'); c.font = "100px 'Fredoka One', sans-serif";
      FITS[k] = Math.min(0.72 * 0.86, 0.86 / (c.measureText('2').width / 100 + c.measureText(String(n)).width / 100 * 0.6 + 0.04)); }
    return FITS[k];
  }
  // red：上付きの n を赤くする（ゲームオーバーで暗くしているときは赤くしない）
  function powImg(n, color, edge, red) {
    var k = '^' + n + '|' + color + '|' + (edge ? 1 : 0) + '|' + (red ? 1 : 0);
    if (LABELS[k]) return LABELS[k];
    var c = document.createElement('canvas'); c.width = c.height = LABEL_PX;
    var x = c.getContext('2d'), base = fitPow(n) * LABEL_PX, sup = base * 0.6, ns = String(n);
    c.fit = fitPow(n);
    x.font = "100px 'Fredoka One', sans-serif";
    var w2 = x.measureText('2').width / 100 * base, wn = x.measureText(ns).width / 100 * sup;
    var left = LABEL_PX / 2 - (w2 + wn + base * 0.04) / 2, y = LABEL_PX / 2 + LABEL_PX * 0.02, white = /^#fff/i.test(color);
    x.textAlign = 'left'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.font = base + "px 'Fredoka One', sans-serif";
    if (edge) { x.lineWidth = Math.max(3, base * 0.14); x.strokeStyle = white ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)'; x.strokeText('2', left, y + base * 0.1); }
    x.fillStyle = color; x.fillText('2', left, y + base * 0.1);
    x.font = sup + "px 'Fredoka One', sans-serif";
    var sx = left + w2 + base * 0.04, sy = y - base * 0.28;
    if (red && white) { x.lineWidth = Math.max(3, sup * 0.2); x.strokeStyle = EXP_RED; x.strokeText(ns, sx, sy); x.fillStyle = '#FFFFFF'; }
    else if (red) { if (edge) { x.lineWidth = Math.max(3, sup * 0.16); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.strokeText(ns, sx, sy); } x.fillStyle = EXP_RED; }
    else x.fillStyle = color;
    x.fillText(ns, sx, sy);
    return (LABELS[k] = c);
  }
  function labelImg(lab, color, edge, exp) {
    var k = lab + '|' + color + '|' + (edge ? 1 : 0) + '|' + (exp ? 1 : 0);
    if (LABELS[k]) return LABELS[k];
    var c = document.createElement('canvas'); c.width = c.height = LABEL_PX;
    var x = c.getContext('2d');
    x.font = "100px 'Fredoka One', sans-serif";
    var px = Math.min(LABEL_PX * 0.72, LABEL_PX * 0.86 / (x.measureText(lab).width / 100));   // 面の縁いっぱい
    c.fit = px / LABEL_PX;   // 字の大きさ ÷ 面の一辺
    x.font = px + "px 'Fredoka One', sans-serif";
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = color;
    if (exp) {   // べき：普通は赤い字。白い字の札は、白い字に赤い縁
      var white = /^#fff/i.test(color);
      x.lineJoin = 'round';
      if (white) { x.lineWidth = Math.max(4, px * 0.18); x.strokeStyle = EXP_RED; x.strokeText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02); x.fillStyle = '#FFFFFF'; }
      else {
        if (edge) { x.lineWidth = Math.max(3, px * 0.14); x.strokeStyle = 'rgba(255,255,255,0.9)'; x.strokeText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02); }
        x.fillStyle = EXP_RED;
      }
      x.fillText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02);
      return (LABELS[k] = c);
    }
    if (edge) {
      x.lineJoin = 'round'; x.lineWidth = Math.max(3, px * 0.14);
      x.strokeStyle = /^#fff/i.test(color) ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
      x.strokeText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02);
    }
    x.fillText(lab, LABEL_PX / 2, LABEL_PX / 2 + LABEL_PX * 0.02);
    return (LABELS[k] = c);
  }
  function clearLabels() { LABELS = {}; FITS = {}; }   // 字形（Web フォント）が読み込まれたら作り直す

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

  /* ── 2D の札（§18.1）。画面と平行な1枚の平面に、角の丸い立方体を並べたように描く ──
     視点は画面の真ん中の正面、少し離れた所。札の前の面がちょうど (x, y, cell) の四角になるように置くので、
     真ん中から離れた札ほど、真ん中の側の横の面が少し見える。数字は呼んだ側が前の面に書く */
  function flatFrame(W, H) { var D = Math.max(W, H) * 2.6; return { W: W, H: H, N: 1, dist: D, f: D, cx: W / 2, cy: H / 2 }; }
  // 遠い札（真ん中から離れた札）を先に描くための並べ替えの値
  function flatOrder(W, H, x, y) { return Math.hypot(x - W / 2, y - H / 2); }
  // 立方体の丸い面をそのまま描くと 16×16 で1回 70ms かかったため（2026-11-14 測定）、
  // 奥の面から前の面まで、角の丸い四角を少しずつずらして重ねる軽い描き方にする（正面からの見た目は同じ）
  function rr(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function drawFlat(ctx, fr, x, y, cell, s, n, colorOf) {
    var size = cell * s, half = size / 2, r = size * 0.16, col = colorOf(n);
    var k = fr.dist / (fr.dist + size);   // 奥の面の縮み（真ん中へ寄る）
    var bx = fr.cx + (x - fr.cx) * k, by = fr.cy + (y - fr.cy) * k, bh = half * k;
    var shift = Math.hypot(x - bx, y - by), layers = Math.max(1, Math.min(4, Math.ceil(shift / 1.5)));
    ctx.fillStyle = shade(col[0], 0.74);
    ctx.beginPath();
    for (var i = 0; i < layers; i++) {   // 横の面（奥 → 前の手前まで）
      var q = i / layers, cx = bx + (x - bx) * q, cy = by + (y - by) * q, hh = bh + (half - bh) * q;
      rr(ctx, cx - hh, cy - hh, hh * 2, hh * 2, r * hh / half);
    }
    ctx.fill();
    ctx.fillStyle = col[0];
    ctx.beginPath(); rr(ctx, x - half, y - half, size, size, r); ctx.fill();
  }

  /* ── 4D・5D の立方体の並びの図（§18.2）。3軸の矢印の左に置く ──
     立方体は枠だけ。4D は横一列（左が w=0）、5D は縦横の平面（上が v=0）。全体を回すと一緒に回る。
     並びの端の矢印を押すと、立方体の間で札が滑る。立方体を押すと、大きく映す立方体が替わる */
  // 立方体の中心の間隔（立方体の一辺を 1 として）は latticeModel の中で決める
  var LCOL = { w: '#c084fc', v: '#fbbf24' };
  function latticeModel(dim, N) {
    var LSP = dim === 5 ? 2.1 : 1.6;   // 5D は縦横に並ぶので、重ならないよう広めに
    var cubes = [], arrows = [], h = (N - 1) / 2, rows = dim === 5 ? N : 1, endX = h * LSP + 0.5, endY = (rows - 1) / 2 * LSP + 0.5;
    for (var v = 0; v < rows; v++) for (var w = 0; w < N; w++) cubes.push({ w: w, v: v, c: [(w - h) * LSP, ((rows - 1) / 2 - v) * LSP, 0] });
    arrows.push({ dir: 'wminus', ax: 'w', a: [-endX - 0.35, 0, 0], b: [-endX - 1.45, 0, 0] });
    arrows.push({ dir: 'wplus', ax: 'w', a: [endX + 0.35, 0, 0], b: [endX + 1.45, 0, 0] });
    if (dim === 5) {
      arrows.push({ dir: 'vminus', ax: 'v', a: [0, endY + 0.35, 0], b: [0, endY + 1.45, 0] });
      arrows.push({ dir: 'vplus', ax: 'v', a: [0, -endY - 0.35, 0], b: [0, -endY - 1.45, 0] });
    }
    return { cubes: cubes, arrows: arrows, sp: LSP };
  }
  // 並びの図を画面に映す（正射影）。いまの向きで、図全体が枠に収まる大きさにする
  // 矢印は押しやすいよう、画面で一定の大きさの丸いボタン（半径 ARW_R）にして、並びの端の外に置く（§21）
  var ARW_R = 16, ARW_GAP = 3;
  function latticeGeo(dim, N, cam, w, h) {
    var m = latticeModel(dim, N), pts = [];
    function P(v) { var q = rot(cam, v); return [q[0], -q[1], q[2]]; }
    m.cubes.forEach(function (cb) {
      cb.corners = [];
      for (var i = 0; i < 8; i++) { var p = P([cb.c[0] + (i & 1 ? 0.5 : -0.5), cb.c[1] + (i & 2 ? 0.5 : -0.5), cb.c[2] + (i & 4 ? 0.5 : -0.5)]); cb.corners.push(p); pts.push(p); }
      cb.q = P(cb.c);
    });
    m.arrows.forEach(function (a) { a.qa = P(a.a); a.qb = P(a.b); });
    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    // 矢印のボタンが並びの外に出る分を、向きに合わせて空けておく
    var padX = 6, padY = 6, B = ARW_R * 2 + ARW_GAP;
    m.arrows.forEach(function (a) {
      var dx = a.qb[0] - a.qa[0], dy = a.qb[1] - a.qa[1], l = Math.hypot(dx, dy) || 1;
      padX = Math.max(padX, Math.abs(dx / l) * B + 4); padY = Math.max(padY, Math.abs(dy / l) * B + 4);
    });
    var k = Math.min((w - padX * 2) / (x1 - x0 || 1), (h - padY * 2) / (y1 - y0 || 1));
    var ox = w / 2 - (x0 + x1) / 2 * k, oy = h / 2 - (y0 + y1) / 2 * k;
    function S(p) { return [ox + p[0] * k, oy + p[1] * k]; }
    m.cubes.forEach(function (cb) { cb.s = cb.corners.map(S); cb.sc = S(cb.q); });
    m.arrows.forEach(function (a) {
      // 並びの端（a.a）から、画面での向きに、ボタン1つ分だけ外へ。ただし枠からはみ出さない
      var e = S(a.qa), dx = a.qb[0] - a.qa[0], dy = a.qb[1] - a.qa[1], l = Math.hypot(dx, dy);
      var ux = l < 1e-6 ? (a.dir.indexOf('minus') >= 0 ? -1 : 1) : dx / l, uy = l < 1e-6 ? 0 : dy / l;
      var cx = e[0] + ux * (ARW_R + ARW_GAP), cy = e[1] + uy * (ARW_R + ARW_GAP);
      a.c = [Math.max(ARW_R + 1, Math.min(w - ARW_R - 1, cx)), Math.max(ARW_R + 1, Math.min(h - ARW_R - 1, cy))];
      a.u = [ux, uy];
    });
    m.k = k;
    return m;
  }
  var CUBE_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  // sel：大きく映している立方体 {w, v}。hot：押したばかりの矢印
  function drawLattice(ctx, w, h, cam, dim, N, sel, hot) {
    var m = latticeGeo(dim, N, cam, w, h);
    ctx.clearRect(0, 0, w, h);
    m.cubes.slice().sort(function (a, b) { return a.q[2] - b.q[2]; }).forEach(function (cb) {
      var on = sel && cb.w === sel.w && cb.v === (sel.v || 0);
      if (on) {   // 選んでいる立方体は、輪郭を薄く塗る
        var hp = hull(cb.s);
        ctx.fillStyle = 'rgba(234,88,12,0.28)'; ctx.beginPath();
        hp.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = on ? '#fb923c' : 'rgba(148,163,184,0.75)'; ctx.lineWidth = on ? 2 : 1.2;
      ctx.beginPath();
      CUBE_EDGES.forEach(function (e) { var a = cb.s[e[0]], b = cb.s[e[1]]; ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
      ctx.stroke();
    });
    m.arrows.forEach(function (a) {   // 丸いボタンに、向きの三角
      var on = hot === a.dir, cx = a.c[0], cy = a.c[1], ux = a.u[0], uy = a.u[1], r = ARW_R;
      ctx.fillStyle = on ? '#ffffff' : LCOL[a.ax];
      ctx.globalAlpha = on ? 1 : 0.92;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#111827';
      var t = r * 0.62, px = -uy, py = ux;
      ctx.beginPath();
      ctx.moveTo(cx + ux * t, cy + uy * t);
      ctx.lineTo(cx - ux * t * 0.6 + px * t * 0.8, cy - uy * t * 0.6 + py * t * 0.8);
      ctx.lineTo(cx - ux * t * 0.6 - px * t * 0.8, cy - uy * t * 0.6 - py * t * 0.8);
      ctx.closePath(); ctx.fill();
    });
  }
  // 押した点：矢印なら {arrow}、立方体なら {cube:{w,v}}。矢印は丸より少し広く拾う
  function latticeHit(w, h, cam, dim, N, x, y) {
    var m = latticeGeo(dim, N, cam, w, h), best = null, bd = 1e9;
    m.arrows.forEach(function (a) { var d = Math.hypot(x - a.c[0], y - a.c[1]); if (d < bd) { bd = d; best = { arrow: a }; } });
    if (bd < ARW_R + 8) return best;
    best = null; bd = 1e9;
    m.cubes.forEach(function (cb) { var d = Math.hypot(x - cb.sc[0], y - cb.sc[1]); if (d < bd) { bd = d; best = { cube: { w: cb.w, v: cb.v } }; } });
    return bd < Math.max(14, m.k * m.sp * 0.75) ? best : null;
  }
  // 並びの矢印の、画面での向き（動かないときの揺れに使う）
  function latticeArrowVec(cam, dim, N, dir) {
    var m = latticeModel(dim, N), a = m.arrows.filter(function (x) { return x.dir === dir; })[0];
    if (!a) return null;
    var qa = rot(cam, a.a), qb = rot(cam, a.b);
    return [qb[0] - qa[0], -(qb[1] - qa[1])];
  }

  window.M1024Three = {
    flatFrame: flatFrame, flatOrder: flatOrder, drawFlat: drawFlat,
    drawLattice: drawLattice, latticeHit: latticeHit, latticeArrowVec: latticeArrowVec,
    OPT: OPT, clearLabels: clearLabels,
    drawGizmo: drawGizmo, gizmoHit: gizmoHit, arrows: arrows,
    makeCam: makeCam, home: home, rotateBy: rotateBy, draw: draw,
    outline: outline, inside: inside, dirFor: dirFor, depthDirs: depthDirs
  };
})();
