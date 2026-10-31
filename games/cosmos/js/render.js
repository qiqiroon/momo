/*
 * MOMO Cosmos — 描画（Canvas 2D）
 * スプライトの描画規則は 切り出し仕様書 第7章 に従う。
 */
(function (root) {
  'use strict';

  // ---- スプライトの読み込み ------------------------------------------------
  async function loadSprites(base) {
    const res = await fetch(base + 'manifest.json');
    if (!res.ok) throw new Error('manifest.json を読めません: ' + res.status);
    const manifest = await res.json();
    const out = {};
    await Promise.all(Object.keys(manifest).map(key => new Promise(resolve => {
      const m = manifest[key];
      if (!m || !m.file) return resolve();
      const img = new Image();
      img.onload = () => { out[key] = { meta: m, img }; resolve(); };
      img.onerror = () => resolve(); // 読めない画像は色付きの円で代用する
      img.src = m.file; // manifest のパスは games/cosmos/ からの相対
    })));
    return out;
  }

  // ---- 天体1個の描画（共通） ------------------------------------------------
  function drawBody(ctx, sprites, C, stage, x, y, r, angle, alpha, squash) {
    const st = C.stages[stage];
    const sp = sprites[st.spriteKey];
    ctx.save();
    ctx.translate(x, y);
    if (squash && squash.sq) {
      // ぶつかった向きに縮め、直角の向きにふくらませる（やわらかさの見た目）
      ctx.rotate(squash.sqAng);
      ctx.scale(1 - squash.sq, 1 + squash.sq * C.squash.bulge);
      ctx.rotate(-squash.sqAng);
    }
    if (C.render.rotateSprites && angle) ctx.rotate(angle);
    if (alpha != null) ctx.globalAlpha = alpha;
    if (sp) {
      const m = sp.meta;
      ctx.globalCompositeOperation = m.blend || 'source-over';
      if (m.bodyRadiusPx) {
        const s = r / m.bodyRadiusPx;
        ctx.drawImage(sp.img, -m.centerX * s, -m.centerY * s, m.width * s, m.height * s);
      } else if (m.coreRadiusPx) {
        const s = r / m.coreRadiusPx;
        ctx.drawImage(sp.img, -m.centerX * s, -m.centerY * s, m.width * s, m.height * s);
      } else {
        // 超新星・中性子星：短辺 = 直径 × glowScale、中央合わせ
        const s = (2 * r * C.render.glowScale) / Math.min(m.width, m.height);
        ctx.drawImage(sp.img, -m.width * s / 2, -m.height * s / 2, m.width * s, m.height * s);
      }
    } else {
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- 盤面の箱（地・壁・床）。最終吸収で ending.js も同じ絵を描き写す ----------
  function drawGround(ctx, C) {
    const B = C.board, grad = ctx.createLinearGradient(0, 0, 0, B.height);
    grad.addColorStop(0, 'rgba(14,16,34,0.55)');
    grad.addColorStop(1, 'rgba(6,6,14,0.78)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, B.width, B.height);
  }
  function drawWalls(ctx, C) {
    const B = C.board;
    ctx.save();
    ctx.strokeStyle = 'rgba(251,146,60,0.75)';
    ctx.shadowColor = 'rgba(251,146,60,0.9)';
    ctx.shadowBlur = 12;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(1.5, 0); ctx.lineTo(1.5, B.height - 1.5); ctx.lineTo(B.width - 1.5, B.height - 1.5); ctx.lineTo(B.width - 1.5, 0);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 盤面 ----------------------------------------------------------------
  class BoardRenderer {
    constructor(canvas, game, sprites, C) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.g = game; this.sprites = sprites; this.C = C;
      this.fx = []; this.popups = []; this.shake = 0;
      this.aimVisible = false;
      this.scale = 1;
      this.t = k => k;           // 文言（main.js が言語の関数に差し替える）
      this.banner = null;        // 演出の文字：{ main, subKey, t0, dur }
      this.flash = null;         // 白い閃光：{ t0, dur }
      this.bare = false;         // 最終吸収から：箱は ending.js が描くので、ここでは描かない
      game.on('merge', e => this._onMerge(e));
      game.on('bhAppear', e => {
        const now = performance.now() / 1000;
        this.flash = { t0: now, dur: C.bh.flashSec };
        this.shake = Math.max(this.shake, 16);
        this.banner = { main: 'BLACK HOLE', subKey: 'bhBornSub', t0: now, dur: 3.2 };
        this.popups.push({ x: e.x, y: e.y, text: '+' + e.add.toLocaleString(), t0: now, dur: 1.6 });
      });
      game.on('absorb', e => {
        const now = performance.now() / 1000;
        this.fx.push({ x: e.x, y: e.y, r: game.bh.r * 1.5, t0: now, dur: 0.45, key: 'fx_absorb' });
        this.popups.push({ x: e.x + (Math.random() - 0.5) * 60, y: e.y - game.bh.r, text: '+' + e.add, t0: now, dur: 0.9 });
      });
      game.on('bhTier', () => { this.shake = Math.max(this.shake, 8); });
      game.on('supermassive', () => {
        // エンディングの始まりなので、言語によらず英語だけ（訳は出さない。2026-10-30 作者の指示）
        this.banner = { main: 'SUPERMASSIVE BLACK HOLE', subKey: null, t0: performance.now() / 1000, dur: 99 };
        this.shake = Math.max(this.shake, 12);
      });
      // ---- 特殊イベント（第14章） ----
      this.parts = [];           // 火花・破片・光の粒：{ x, y, vx, vy, t0, dur, size, color, rock, rot, vr }
      this.rings = [];           // 広がる光の輪：{ x, y, r0, r1, t0, dur, color }
      this._lastDraw = performance.now() / 1000;
      const EVN = { flare: 'SOLAR FLARE', comet: 'COMET', meteor: 'METEOR SHOWER', storm: 'GRAVITY STORM', wormhole: 'WORMHOLE' };
      game.on('eventWarn', e => {
        this.banner = { main: EVN[e.type], subKey: 'ev_' + e.type, t0: performance.now() / 1000, dur: C.events.warnSec + 1.3, event: true };
      });
      game.on('eventCancel', () => {
        const bn = this.banner;
        if (bn && bn.event) bn.dur = Math.min(bn.dur, performance.now() / 1000 - bn.t0 + 0.6);
      });
      game.on('eventStart', e => {
        const now = performance.now() / 1000;
        if (e.type === 'flare') {
          // 衝撃波（押す範囲 R まで届く輪）を3重に。続いて _drawFlare が炎の弧を描く
          this.rings.push({ x: e.x, y: e.y, r0: e.r, r1: e.R, t0: now, dur: 0.9, color: '251,146,60' });
          this.rings.push({ x: e.x, y: e.y, r0: e.r * 0.8, r1: e.R * 0.8, t0: now + 0.12, dur: 0.8, color: '253,224,71' });
          this.rings.push({ x: e.x, y: e.y, r0: e.r, r1: e.R * 1.1, t0: now + 0.3, dur: 0.9, color: '254,215,170' });
          for (let i = 0; i < 48; i++) {
            const a = Math.random() * Math.PI * 2, s = 250 + Math.random() * 380;
            this.parts.push({ x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t0: now, dur: 0.6 + Math.random() * 0.6, size: 3 + Math.random() * 4, color: '253,186,116' });
          }
          this.shake = Math.max(this.shake, 10);
        }
        if (e.type === 'storm') this.shake = Math.max(this.shake, 5);
      });
      game.on('warp', e => {
        const now = performance.now() / 1000;
        this.rings.push({ x: e.from.x, y: e.from.y, r0: 10, r1: 70, t0: now, dur: 0.45, color: '216,180,254' });
        this.rings.push({ x: e.to.x, y: e.to.y, r0: 70, r1: 10, t0: now, dur: 0.45, color: '165,243,252' });
      });
      game.on('cometHit', e => this._sparks(e.x, e.y, 8, '253,186,116', 220));
      game.on('cometBounce', e => {   // 山の重心で跳ね返った所に衝撃
        this._sparks(e.x, e.y, 30, '253,224,71', 480);
        this.rings.push({ x: e.x, y: e.y, r0: 20, r1: 150, t0: performance.now() / 1000, dur: 0.5, color: '251,146,60' });
        this.shake = Math.max(this.shake, 12);
      });
      game.on('collision', e => {
        const now = performance.now() / 1000;
        this.banner = { main: 'PLANET COLLISION', subKey: 'ev_collision', t0: now, dur: 2.4, event: true };
        this.shake = Math.max(this.shake, 22);
        // 当たった所に白い閃光の玉を一瞬（ゲームの側では同時に一瞬スローになる）
        this.rings.push({ x: e.x, y: e.y, r0: 90, r1: 10, t0: now, dur: 0.45, color: '255,255,255', fill: true });
        this.rings.push({ x: e.x, y: e.y, r0: 10, r1: 240, t0: now, dur: 0.7, color: '255,237,213' });
        this.rings.push({ x: e.x, y: e.y, r0: 10, r1: 150, t0: now + 0.12, dur: 0.6, color: '251,146,60' });
        this._sparks(e.x, e.y, 60, '253,224,71', 620);
        for (let i = 0; i < 16; i++) {   // 小惑星の破片（見た目だけ）
          const a = Math.random() * Math.PI * 2, s = 160 + Math.random() * 300;
          this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 140, t0: now, dur: 1.4 + Math.random() * 0.6, size: 10 + Math.random() * 16, rock: true, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
        }
      });
      // ミサイル（easy）：選んでいる間は案内の文字。壊したら爆発
      game.on('missileArm', on => {
        const now = performance.now() / 1000;
        if (on) this.banner = { main: 'MISSILE', subKey: 'missileHint', t0: now, dur: 9999, missile: true };
        else if (this.banner && this.banner.missile) this.banner.dur = Math.min(this.banner.dur, now - this.banner.t0 + 0.3);
      });
      game.on('missile', e => {
        const now = performance.now() / 1000, X = C.missile;
        this.fx.push({ x: e.x, y: e.y, r: Math.max(40, e.r) * X.explodeMul / 2, t0: now, dur: X.explodeSec, key: 'explosion', blend: 'source-over', fade: true });
        this.shake = Math.max(this.shake, 14);
        this.rings.push({ x: e.x, y: e.y, r0: e.r * 1.2, r1: 8, t0: now, dur: 0.35, color: '255,255,255', fill: true });
        this.rings.push({ x: e.x, y: e.y, r0: e.r * 0.5, r1: e.r * 2.6, t0: now, dur: 0.6, color: '248,113,113' });
        this._sparks(e.x, e.y, 40, '253,186,116', 520);
        for (let i = 0; i < 10; i++) {   // 壊れた天体の破片
          const a = Math.random() * Math.PI * 2, s = 140 + Math.random() * 260;
          this.parts.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, t0: now, dur: 1.0 + Math.random() * 0.5, size: 6 + Math.random() * e.r * 0.25, rock: true, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10 });
        }
      });
      game.on('state', st => {
        if (st === 'PLAY' || st === 'TITLE') { this.banner = null; this.flash = null; this.bare = false; this.parts = []; this.rings = []; }
        // 最終吸収に入ったら「SUPERMASSIVE BLACK HOLE」を 0.6 秒で消す
        if (st === 'FINAL_ABSORB' && this.banner) this.banner.dur = performance.now() / 1000 - this.banner.t0 + 0.6;
      });
    }

    resize(cssW, cssH) {
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.scale = this.canvas.width / this.C.board.width;
    }

    _sparks(x, y, n, color, speed) {
      const now = performance.now() / 1000;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
        this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t0: now, dur: 0.35 + Math.random() * 0.45, size: 2 + Math.random() * 3, color });
      }
    }

    // 重力嵐：盤面の色味を変え、重力の向き（斜め下）に筋を流す（第14.3節）
    _drawStorm(ctx, cur, now) {
      const B = this.C.board, a = Math.min(1, cur.t / 0.6, (cur.dur - cur.t) / 0.8);
      if (a <= 0) return;
      const ang = cur.ang * (cur.k || 0), ux = Math.sin(ang), uy = Math.cos(ang);
      ctx.save();
      ctx.globalAlpha = a;
      // 重力の向きの側（下手）を濃くする
      const cx = B.width / 2, cy = B.height / 2, L = 520;
      const gr = ctx.createLinearGradient(cx - ux * L, cy - uy * L, cx + ux * L, cy + uy * L);
      gr.addColorStop(0, 'rgba(76,29,149,0.06)'); gr.addColorStop(1, 'rgba(124,58,237,0.34)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, B.width, B.height);
      ctx.strokeStyle = 'rgba(196,181,253,0.30)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      const span = B.height + B.width + 200;
      for (let i = 0; i < 22; i++) {
        // 筋は重力の向きに流れる。出発点を盤面の外周に散らし、向きに沿って進める
        const p = (now * 560 + i * 173) % span - 100, side = ((i * 131) % (B.width + 400)) - 200;
        const x = cx + (-uy) * (side - B.width / 2) + ux * (p - span / 2) * 0.9;
        const y = cy + ux * (side - B.width / 2) + uy * (p - span / 2) * 0.9;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ux * 70, y + uy * 70); ctx.stroke();
      }
      // 盤面の中央に、重力の向きの矢印を薄く出す
      ctx.translate(cx, 300); ctx.rotate(-ang);
      ctx.fillStyle = 'rgba(221,214,254,' + (0.22 + 0.1 * Math.sin(now * 5)).toFixed(3) + ')';
      ctx.beginPath(); ctx.moveTo(-14, -40); ctx.lineTo(14, -40); ctx.lineTo(14, 10); ctx.lineTo(30, 10); ctx.lineTo(0, 48); ctx.lineTo(-30, 10); ctx.lineTo(-14, 10); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // 太陽フレア：予告の間は星が脈打って明るくなる（k＝0→1）。発生後は炎の弧が星の縁から噴き出す
    _drawFlareCharge(ctx, b, k, now) {
      const x = b.position.x, y = b.position.y, r = b.circleRadius;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const pul = 0.75 + 0.25 * Math.sin(now * (8 + 14 * k));
      const R = r * (1.3 + 0.9 * k);
      const gl = ctx.createRadialGradient(x, y, r * 0.6, x, y, R);
      gl.addColorStop(0, 'rgba(253,224,71,' + (0.55 * k * pul).toFixed(3) + ')');
      gl.addColorStop(0.6, 'rgba(251,146,60,' + (0.3 * k * pul).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    _drawFlare(ctx, cur, now) {
      const b = cur.body, x = b && b.position ? b.position.x : cur.x, y = b && b.position ? b.position.y : cur.y, r = cur.r;
      const u = cur.t / cur.dur, a = Math.min(1, (1 - u) / 0.35);
      if (a <= 0) return;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 星そのものの強い光
      const gl = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * (1.6 + u));
      gl.addColorStop(0, 'rgba(255,247,200,' + (0.7 * a).toFixed(3) + ')');
      gl.addColorStop(0.5, 'rgba(251,146,60,' + (0.35 * a).toFixed(3) + ')');
      gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r * (1.6 + u), 0, Math.PI * 2); ctx.fill();
      // 炎の弧（プロミネンス）：縁の2点を結ぶ輪が外へ伸びていく
      ctx.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        const th = i * 0.898 + 0.4, w = 0.28 + (i % 3) * 0.08;
        const grow = Math.min(1, cur.t / (0.35 + 0.08 * i));
        const h = r * (0.5 + 0.9 * grow + 0.15 * Math.sin(now * 6 + i));
        const p1x = x + Math.cos(th - w) * r, p1y = y + Math.sin(th - w) * r;
        const p2x = x + Math.cos(th + w) * r, p2y = y + Math.sin(th + w) * r;
        const cx = x + Math.cos(th) * (r + h * 1.6), cy = y + Math.sin(th) * (r + h * 1.6);
        for (const [lw, col] of [[9, '251,146,60'], [4, '253,224,71']]) {
          ctx.strokeStyle = 'rgba(' + col + ',' + (0.8 * a * grow).toFixed(3) + ')';
          ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.quadraticCurveTo(cx, cy, p2x, p2y); ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ワームホール：入口（紫とオレンジ）と出口（水色）の渦をプログラムで描く
    _drawWormhole(ctx, cur, now) {
      const W = this.C.events.wormhole, open = Math.min(1, cur.t / W.openSec, (cur.dur - cur.t) / W.openSec);
      if (open <= 0) return;
      const one = (x, y, dir, c1, c2) => {
        const r = cur.r * (0.4 + 0.6 * open);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gl = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6);
        gl.addColorStop(0, 'rgba(' + c1 + ',' + (0.55 * open).toFixed(3) + ')');
        gl.addColorStop(0.5, 'rgba(' + c2 + ',' + (0.2 * open).toFixed(3) + ')');
        gl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gl; ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2);
        ctx.lineCap = 'round';
        for (let i = 0; i < 5; i++) {
          const a0 = dir * now * (2.2 + 0.4 * i) + i * Math.PI * 0.4, rr = r * (0.3 + 0.17 * i);
          ctx.strokeStyle = 'rgba(' + (i % 2 ? c2 : c1) + ',' + (0.7 * open).toFixed(3) + ')';
          ctx.lineWidth = 3 - i * 0.3;
          ctx.beginPath(); ctx.arc(x, y, rr, a0, a0 + 2.2); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(10,6,24,' + (0.85 * open).toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(x, y, r * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      };
      // 2つの穴は双方向。つながっていることを、流れる点線で示す
      ctx.save();
      ctx.strokeStyle = 'rgba(216,180,254,' + (0.28 * open).toFixed(3) + ')';
      ctx.lineWidth = 2; ctx.setLineDash([6, 12]); ctx.lineDashOffset = -now * 40;
      ctx.beginPath(); ctx.moveTo(cur.a.x, cur.a.y); ctx.lineTo(cur.b.x, cur.b.y); ctx.stroke();
      ctx.restore();
      one(cur.a.x, cur.a.y, 1, '216,180,254', '251,146,60');   // 紫とオレンジの穴
      one(cur.b.x, cur.b.y, -1, '165,243,252', '255,255,255'); // 水色の穴（逆に回る）
    }

    // 彗星の絵（meteor.webp）：岩が左下・炎の尾が右上。岩の中心を物体の位置に合わせ、進む向きに回す
    _drawComet(ctx, x, y, r, dir, alpha, scale) {
      const sp = this.sprites.meteor;
      ctx.save();
      ctx.translate(x, y);
      if (alpha != null) ctx.globalAlpha = alpha;
      if (sp) {
        const m = sp.meta, s = r / 42 * (scale || 1);   // 岩の半径は絵の上で約 42px、中心は (62, 118)
        ctx.rotate(dir - 2.44);                        // 絵の進む向きは約 140°
        ctx.drawImage(sp.img, -62 * s, -118 * s, m.width * s, m.height * s);
      } else {
        ctx.fillStyle = '#fb923c'; ctx.beginPath(); ctx.arc(0, 0, r * (scale || 1), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    _onMerge(e) {
      const F = this.C.mergeFx;
      const tier = e.stage <= F.small.maxStage ? F.small : e.stage <= F.medium.maxStage ? F.medium : F.large;
      const now = performance.now() / 1000;
      this.fx.push({ x: e.x, y: e.y, r: this.g.radius(e.stage) * tier.size, t0: now, dur: tier.durSec });
      if (e.add) this.popups.push({ x: e.x, y: e.y, text: '+' + e.add, t0: now, dur: F.popupSec });
      if (tier.shake) this.shake = Math.max(this.shake, tier.shake);
    }

    draw() {
      const ctx = this.ctx, C = this.C, g = this.g, B = C.board;
      const now = performance.now() / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      let sx = 0, sy = 0;
      if (this.shake > 0.2) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; this.shake *= 0.86; } else this.shake = 0;
      ctx.setTransform(this.scale, 0, 0, this.scale, sx * this.scale, sy * this.scale);

      // 盤面の地（背景の星が少し透ける）
      if (!this.bare) drawGround(ctx, C);
      const evCur = g.ev && g.ev.cur;
      if (evCur && evCur.type === 'storm') this._drawStorm(ctx, evCur, now);
      if (evCur && evCur.type === 'wormhole') this._drawWormhole(ctx, evCur, now);
      const evW = g.ev && g.ev.warn;
      if (evW && evW.type === 'flare' && evW.body) this._drawFlareCharge(ctx, evW.body, Math.min(1, evW.t / C.events.warnSec), now);
      if (evCur && evCur.type === 'flare') this._drawFlare(ctx, evCur, now);

      // デッドライン（警告中は赤く点滅）。ブラックホールが生まれたら消す
      if (!g.bh) {
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 2;
      if (g.warning) {
        const on = Math.floor(now * 4) % 2 === 0;
        ctx.strokeStyle = on ? 'rgba(239,68,68,0.95)' : 'rgba(239,68,68,0.25)';
      } else ctx.strokeStyle = 'rgba(251,146,60,0.35)';
      ctx.beginPath(); ctx.moveTo(0, B.deadlineY); ctx.lineTo(B.width, B.deadlineY); ctx.stroke();
      // 警告中は、ゲームオーバーまでの残りの秒を線の右端の下に出す（10秒に伸ばしたので。2026-10-31）
      if (g.warning) {
        ctx.setLineDash([]);
        ctx.font = '700 30px "Fredoka One", sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(239,68,68,0.95)';
        ctx.fillText(String(Math.max(1, Math.ceil(C.gameOver.overSec - g.overTime))), B.width - 12, B.deadlineY + 8);
      }
      ctx.restore();
      }

      // 誕生：待機中の2個に光を集める（第11.1節 1）
      if (g.state === 'BH_BIRTH' && g.birth && !g.bh) {
        const k = Math.min(1, g.birth.t / C.bh.appearAt);
        const rr = 60 + 220 * k;
        const gl = ctx.createRadialGradient(g.birth.x, g.birth.y, 0, g.birth.x, g.birth.y, rr);
        gl.addColorStop(0, 'rgba(255,255,255,' + (0.25 + 0.6 * k).toFixed(3) + ')');
        gl.addColorStop(0.4, 'rgba(165,243,252,' + (0.25 * k).toFixed(3) + ')');
        gl.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = gl;
        ctx.fillRect(g.birth.x - rr, g.birth.y - rr, rr * 2, rr * 2); ctx.restore();
      }

      // ブラックホール本体（天体より奥に描く。天体は手前を通り抜けて吸い込まれる）
      if (g.bh) this._drawBH(ctx, g.bh, now);

      // 照準
      if (g.controllable && this.aimVisible && !g.missileArmed) {
        const stg = g.nextStage, r = g.radius(stg), x = g.clampX(g.aimX, stg);
        ctx.save();
        ctx.strokeStyle = 'rgba(229,229,229,0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.beginPath(); ctx.moveTo(x, B.dropY + r); ctx.lineTo(x, B.height); ctx.stroke();
        ctx.restore();
        drawBody(ctx, this.sprites, C, stg, x, B.dropY, r, 0, g.canDrop() ? 0.55 : 0.25);
        // 落とす前の天体のレベルと名前を、天体の上に出す（表示言語で）
        // 猫語の鳴き声は呼ぶたびに変わるので、天体か言語が変わったときだけ決め直す
        const I = root.CosmosI18n, lang = I ? I.lang + '/' + I.baseLang() : '';
        if (!this._aimName || this._aimName.stg !== stg || this._aimName.lang !== lang) {
          this._aimName = { stg, lang, name: I ? I.stageName(stg, C) : C.stages[stg].name };
        }
        const name = 'LV' + stg + ' ' + this._aimName.name;   // 「LV1 月」のように（2026-10-31 作者の指示）
        ctx.save();
        ctx.font = '700 15px "Noto Sans JP", "Noto Sans SC", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.lineWidth = 4; ctx.lineJoin = 'round';
        // 大きい天体は上が情報ヘッダーに隠れるので、名前は天体の真ん中に出す
        const ny = B.dropY - r - 6 - 15 >= C.board.nameTopY ? B.dropY - r - 6 : B.dropY + 8;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.strokeText(name, x, ny);
        ctx.fillStyle = 'rgba(255,255,255,' + (g.canDrop() ? 0.9 : 0.45) + ')'; ctx.fillText(name, x, ny);
        ctx.restore();
      }

      // 流星群で降ってくる天体の光の尾
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const b of g.bodies()) {
        if (!b.plugin.cosmos.meteor || b.velocity.y < 2) continue;
        const r = b.circleRadius, len = Math.min(160, b.velocity.y * 14);
        const gr = ctx.createLinearGradient(b.position.x, b.position.y - len, b.position.x, b.position.y);
        gr.addColorStop(0, 'rgba(165,243,252,0)'); gr.addColorStop(1, 'rgba(165,243,252,0.5)');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.moveTo(b.position.x - r * 0.7, b.position.y); ctx.lineTo(b.position.x, b.position.y - len); ctx.lineTo(b.position.x + r * 0.7, b.position.y); ctx.fill();
      }
      ctx.restore();

      // 天体
      for (const b of g.bodies()) {
        drawBody(ctx, this.sprites, C, b.plugin.cosmos.stage, b.position.x, b.position.y, b.circleRadius, b.angle, null, b.plugin.cosmos);
      }

      // 飛んでいるミサイル：先端を狙った天体へ向けて描く
      if (g.shot) {
        const s = g.shot, sp = this.sprites.missile_fly, dir = Math.atan2(s.ty - s.y, s.tx - s.x);
        ctx.save();
        ctx.translate(s.x, s.y);
        if (sp) {
          const m = sp.meta, sc = 150 / m.width;   // 盤面では長さ 150（煙まで）
          ctx.rotate(dir - m.dirRad);
          ctx.drawImage(sp.img, -m.noseX * sc, -m.noseY * sc, m.width * sc, m.height * sc);
        } else {
          ctx.rotate(dir); ctx.fillStyle = '#ef4444'; ctx.fillRect(-30, -5, 30, 10);
        }
        ctx.restore();
      }

      // ミサイルを選んでいる間：どの天体も赤い点線の輪で囲み、マウスの下の天体は照準の印で示す
      if (g.missileArmed) {
        const hot = this.pointer && g.bodyAt(this.pointer.x, this.pointer.y, 12);
        ctx.save();
        for (const b of g.bodies()) {
          const on = b === hot, r = b.circleRadius + (on ? 6 : 3);
          ctx.setLineDash(on ? [] : [6, 6]);
          ctx.lineWidth = on ? 3 : 1.5;
          ctx.strokeStyle = on ? 'rgba(248,113,113,0.95)' : 'rgba(248,113,113,' + (0.35 + 0.2 * Math.sin(now * 6)).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(b.position.x, b.position.y, r, 0, Math.PI * 2); ctx.stroke();
          if (on) {   // 十字
            ctx.beginPath();
            ctx.moveTo(b.position.x - r - 10, b.position.y); ctx.lineTo(b.position.x - r + 8, b.position.y);
            ctx.moveTo(b.position.x + r - 8, b.position.y); ctx.lineTo(b.position.x + r + 10, b.position.y);
            ctx.moveTo(b.position.x, b.position.y - r - 10); ctx.lineTo(b.position.x, b.position.y - r + 8);
            ctx.moveTo(b.position.x, b.position.y + r - 8); ctx.lineTo(b.position.x, b.position.y + r + 10);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 吸い込まれていく天体（第11.5節：引き伸ばされながら縮み、0.3秒で消える）
      if (g.bh) {
        for (const a of g.absorbing) {
          const k = Math.min(1, a.t / C.bh.absorbSec), e = k * k;
          const x = a.x + (g.bh.x - a.x) * e, y = a.y + (g.bh.y - a.y) * e;
          const dir = Math.atan2(g.bh.y - a.y, g.bh.x - a.x), sc = 1 - k;
          ctx.save();
          ctx.translate(x, y); ctx.rotate(dir); ctx.scale(sc * (1 + 1.6 * k), sc * (1 - 0.5 * k)); ctx.rotate(-dir);
          if (a.comet) this._drawComet(ctx, 0, 0, a.r, a.angle, 1 - 0.4 * k);
          else drawBody(ctx, this.sprites, C, a.stage, 0, 0, a.r, a.angle, 1 - 0.4 * k);
          ctx.restore();
        }
      }

      // 彗星
      if (g.comet) {
        const c = g.comet.body;
        this._drawComet(ctx, c.position.x, c.position.y, c.circleRadius, Math.atan2(g.comet.vy, g.comet.vx), null, 1.5);
      }

      // 広がる光の輪（太陽フレア・ワームホール・惑星衝突）
      const dtp = Math.min(0.1, now - this._lastDraw); this._lastDraw = now;
      this.rings = this.rings.filter(r => now - r.t0 < r.dur);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rings) {
        const k = (now - r.t0) / r.dur;
        if (k < 0) continue;
        const e = 1 - (1 - k) * (1 - k), rr = r.r0 + (r.r1 - r.r0) * e;
        ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(1, rr), 0, Math.PI * 2);
        if (r.fill) { ctx.fillStyle = 'rgba(' + r.color + ',' + (0.9 * (1 - k)).toFixed(3) + ')'; ctx.fill(); continue; }   // 閃光の玉
        ctx.strokeStyle = 'rgba(' + r.color + ',' + (0.85 * (1 - k)).toFixed(3) + ')';
        ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.stroke();
      }
      ctx.restore();

      // 火花・小惑星の破片（見た目だけ）
      this.parts = this.parts.filter(p => now - p.t0 < p.dur);
      for (const p of this.parts) {
        p.x += p.vx * dtp; p.y += p.vy * dtp; p.vy += (p.rock ? 380 : 160) * dtp; p.vx *= 0.985;
        const k = (now - p.t0) / p.dur;
        if (p.rock) {
          p.rot += p.vr * dtp;
          const sp = this.sprites.asteroid;
          ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.globalAlpha = 1 - k * k;
          if (sp) { const s = (2 * p.size) / Math.min(sp.meta.width, sp.meta.height); ctx.drawImage(sp.img, -sp.meta.width * s / 2, -sp.meta.height * s / 2, sp.meta.width * s, sp.meta.height * s); }
          else { ctx.fillStyle = '#78716c'; ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        } else {
          ctx.save(); ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = 'rgba(' + p.color + ',' + (1 - k).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 - 0.5 * k), 0, Math.PI * 2); ctx.fill();
          ctx.restore();
        }
      }

      // 合体・吸収の光
      this.fx = this.fx.filter(f => now - f.t0 < f.dur);
      for (const f of this.fx) {
        const fxs = this.sprites[f.key || 'fx_merge'];
        const k = (now - f.t0) / f.dur;
        ctx.save();
        ctx.globalCompositeOperation = f.blend || 'lighter';
        ctx.globalAlpha = f.fade ? 1 - k * k : 1 - k;   // 爆発（fade）は終わり近くで一気に消す
        const rr = f.r * (0.7 + 0.6 * k);
        if (fxs) {
          const m = fxs.meta, s = (2 * rr) / Math.min(m.width, m.height);
          ctx.drawImage(fxs.img, f.x - m.width * s / 2, f.y - m.height * s / 2, m.width * s, m.height * s);
        } else {
          ctx.fillStyle = 'rgba(251,191,36,0.6)';
          ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }

      // スコアの加算値
      this.popups = this.popups.filter(p => now - p.t0 < p.dur);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = '700 26px "Fredoka One", "Noto Sans JP", sans-serif';
      for (const p of this.popups) {
        const k = (now - p.t0) / p.dur;
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = '#fb923c';
        ctx.fillText(p.text, p.x, p.y - 20 - 40 * k);
      }
      ctx.restore();

      // 壁と床（細い光の線）
      if (!this.bare) drawWalls(ctx, C);

      // 白い閃光（光過敏に配慮して短く1回。第11.1節 2）
      if (this.flash) {
        const k = (now - this.flash.t0) / this.flash.dur;
        if (k >= 1) this.flash = null;
        else { ctx.save(); ctx.fillStyle = 'rgba(255,255,255,' + (0.85 * (1 - k)).toFixed(3) + ')'; ctx.fillRect(0, 0, B.width, B.height); ctx.restore(); }
      }

      // 演出の文字（英語のまま。下に表示言語の小さな訳。第24.5節）
      if (this.banner) {
        const bn = this.banner, k = (now - bn.t0) / bn.dur;
        if (k >= 1) this.banner = null;
        else {
          const el = now - bn.t0, a = Math.min(1, el / 0.4) * Math.min(1, (bn.dur - el) / 0.6);
          const y = B.height * 0.22;
          ctx.save();
          ctx.globalAlpha = a;
          ctx.textAlign = 'center';
          const big = bn.main.length > 12 ? 40 : 58;
          ctx.font = big + 'px "Fredoka One", sans-serif';
          ctx.shadowColor = bn.event ? 'rgba(234,88,12,0.95)' : 'rgba(168,85,247,0.9)'; ctx.shadowBlur = 24;
          ctx.fillStyle = '#ffffff';
          ctx.fillText(bn.main, B.width / 2, y);
          const sub = this.t(bn.subKey);
          if (sub) {
            ctx.shadowBlur = 8;
            ctx.font = '20px "Noto Sans JP", "Noto Sans SC", sans-serif';
            ctx.fillStyle = '#fb923c';
            ctx.fillText(sub, B.width / 2, y + 34);
          }
          ctx.restore();
        }
      }
    }

    // ブラックホール：周りの光（重力エフェクト）・渦・本体の絵（第11.1節・第11.6節）
    _drawBH(ctx, h, now) {
      const r = h.r * (1 + 0.08 * h.pulse);
      const power = 0.55 + 0.15 * h.tier;   // 成長段階が上がるほど強く
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 吸い込みの範囲をぼんやり見せる
      const halo = ctx.createRadialGradient(h.x, h.y, r * 0.8, h.x, h.y, r * 3.2);
      halo.addColorStop(0, 'rgba(168,85,247,' + (0.32 * power).toFixed(3) + ')');
      halo.addColorStop(0.45, 'rgba(234,88,12,' + (0.12 * power).toFixed(3) + ')');
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(h.x - r * 3.2, h.y - r * 3.2, r * 6.4, r * 6.4);
      // 渦（ゆっくり回る光の弧）
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const a0 = h.spin * (0.9 + 0.15 * i) + i * Math.PI / 3;
        const rr = r * (1.25 + 0.28 * i);
        ctx.strokeStyle = i % 2 ? 'rgba(251,146,60,' + (0.22 * power).toFixed(3) + ')' : 'rgba(196,181,253,' + (0.26 * power).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.5, r * 0.05);
        ctx.beginPath(); ctx.arc(h.x, h.y, rr, a0, a0 + 1.1); ctx.stroke();
      }
      ctx.restore();
      // 本体の絵（中心の黒い円が Rb になるよう合わせる）。絵がなければ黒い円
      const sp = this.sprites.blackhole;
      ctx.save();
      if (sp && sp.meta.coreRadiusPx) {
        const m = sp.meta, s = r / m.coreRadiusPx;
        ctx.drawImage(sp.img, h.x - m.centerX * s, h.y - m.centerY * s, m.width * s, m.height * s);
      } else {
        ctx.fillStyle = '#000'; ctx.strokeStyle = 'rgba(251,146,60,0.8)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    /** 次・次々の天体のアイコン（小さな Canvas に描く） */
    drawIcon(canvas, stage) {
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      const css = canvas.clientWidth || 48;
      if (canvas.width !== Math.round(css * dpr)) { canvas.width = canvas.height = Math.round(css * dpr); }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!stage) return;
      const W = canvas.width;
      const r = W * (stage === 7 || stage === 8 ? 0.26 : 0.4);
      drawBody(ctx, this.sprites, this.C, stage, W / 2, W / 2, r, 0);
    }
  }

  // ---- 全面背景（星の粒子をプログラムで描く：仕様書 第17.2節） ----------
  class StarField {
    constructor(canvas, C) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.C = C;
      this.stars = [];
      const n = C.render.starCount;
      for (let i = 0; i < n; i++) {
        this.stars.push({ x: Math.random(), y: Math.random(), r: Math.random() < 0.08 ? 1.6 : 0.4 + Math.random() * 0.9,
          p: Math.random() * Math.PI * 2, s: 0.4 + Math.random() * 1.4, hue: Math.random() < 0.2 ? 30 : 220 });
      }
    }
    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(innerWidth * dpr);
      this.canvas.height = Math.round(innerHeight * dpr);
      this.dpr = dpr;
    }
    draw(t, reduced) {
      const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, W, H);
      const neb = ctx.createRadialGradient(W * 0.25, H * 0.2, 0, W * 0.25, H * 0.2, Math.max(W, H) * 0.7);
      neb.addColorStop(0, 'rgba(60,40,110,0.18)'); neb.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = neb; ctx.fillRect(0, 0, W, H);
      for (const s of this.stars) {
        const a = reduced ? 0.7 : 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * s.s + s.p));
        ctx.fillStyle = 'hsla(' + s.hue + ',80%,88%,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r * this.dpr, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  root.CosmosRender = { loadSprites, drawBody, drawGround, drawWalls, BoardRenderer, StarField };
})(window);
