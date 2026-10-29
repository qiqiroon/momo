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
  function drawBody(ctx, sprites, C, stage, x, y, r, angle, alpha) {
    const st = C.stages[stage];
    const sp = sprites[st.spriteKey];
    ctx.save();
    ctx.translate(x, y);
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

  // ---- 盤面 ----------------------------------------------------------------
  class BoardRenderer {
    constructor(canvas, game, sprites, C) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d');
      this.g = game; this.sprites = sprites; this.C = C;
      this.fx = []; this.popups = []; this.shake = 0;
      this.aimVisible = false;
      this.scale = 1;
      game.on('merge', e => this._onMerge(e));
    }

    resize(cssW, cssH) {
      const dpr = Math.min(root.devicePixelRatio || 1, 3);
      this.canvas.style.width = cssW + 'px';
      this.canvas.style.height = cssH + 'px';
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.scale = this.canvas.width / this.C.board.width;
    }

    _onMerge(e) {
      const F = this.C.mergeFx;
      const tier = e.stage <= F.small.maxStage ? F.small : e.stage <= F.medium.maxStage ? F.medium : F.large;
      const now = performance.now() / 1000;
      this.fx.push({ x: e.x, y: e.y, r: this.C.stages[e.stage].radius * tier.size, t0: now, dur: tier.durSec });
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
      const grad = ctx.createLinearGradient(0, 0, 0, B.height);
      grad.addColorStop(0, 'rgba(14,16,34,0.55)');
      grad.addColorStop(1, 'rgba(6,6,14,0.78)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, B.width, B.height);

      // デッドライン（警告中は赤く点滅）
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.lineWidth = 2;
      if (g.warning) {
        const on = Math.floor(now * 4) % 2 === 0;
        ctx.strokeStyle = on ? 'rgba(239,68,68,0.95)' : 'rgba(239,68,68,0.25)';
      } else ctx.strokeStyle = 'rgba(251,146,60,0.35)';
      ctx.beginPath(); ctx.moveTo(0, B.deadlineY); ctx.lineTo(B.width, B.deadlineY); ctx.stroke();
      ctx.restore();

      // 照準
      if (g.state === 'PLAY' && this.aimVisible) {
        const stg = g.nextStage, r = C.stages[stg].radius, x = g.clampX(g.aimX, stg);
        ctx.save();
        ctx.strokeStyle = 'rgba(229,229,229,0.28)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 8]);
        ctx.beginPath(); ctx.moveTo(x, B.dropY + r); ctx.lineTo(x, B.height); ctx.stroke();
        ctx.restore();
        drawBody(ctx, this.sprites, C, stg, x, B.dropY, r, 0, g.canDrop() ? 0.55 : 0.25);
      }

      // 天体
      for (const b of g.bodies()) {
        drawBody(ctx, this.sprites, C, b.plugin.cosmos.stage, b.position.x, b.position.y, b.circleRadius, b.angle);
      }

      // 合体の光
      const fxs = this.sprites.fx_merge;
      this.fx = this.fx.filter(f => now - f.t0 < f.dur);
      for (const f of this.fx) {
        const k = (now - f.t0) / f.dur;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1 - k;
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

  root.CosmosRender = { loadSprites, drawBody, BoardRenderer, StarField };
})(window);
