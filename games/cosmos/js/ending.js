/*
 * MOMO Cosmos — エンディングの演出（仕様書 第12章・第13章）
 * 画面全体に重ねた Canvas（#fx）に描く：
 *   FINAL_ABSORB … 盤面の箱と UI を Canvas に描き写し、格子に分けてブラックホールへ渦を巻いて吸い込む
 *   BIGBANG      … 収縮・暗闇（5秒）・光の点と線・爆発・ホワイトアウト・透けて見える宇宙・膨張
 *   ENDROLL      … 中央から外へ流れる星の粒子（主役）＋ぼかした背景画像（補助）
 * 時刻はゲームの endT（デバッグのゲーム速度に従う）。クレジットの文字は DOM（main.js）。
 */
(function (root) {
  'use strict';

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---- DOM の見た目を Canvas に描き写す（第4.3節・第12.1節） ----------------
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  const visibleColor = c => c && c !== 'transparent' && !/rgba\([^)]*,\s*0\)$/.test(c);

  function drawDom(ctx, roots) {
    for (const top of roots) {
      if (!top) continue;
      for (const el of [top, ...top.querySelectorAll('*')]) {
        const rc = el.getBoundingClientRect();
        if (!rc.width || !rc.height) continue;           // 非表示（display:none の中）
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;
        const pr = cs.borderTopLeftRadius, rad = pr.endsWith('%') ? Math.min(rc.width, rc.height) * parseFloat(pr) / 100 : parseFloat(pr) || 0;
        const grads = cs.backgroundImage && cs.backgroundImage.match(/rgba?\([^)]+\)/g);
        if (grads && grads.length > 1) {
          const g = ctx.createLinearGradient(rc.left, 0, rc.right, 0);
          grads.forEach((c, i) => g.addColorStop(i / (grads.length - 1), c));
          ctx.fillStyle = g; roundRect(ctx, rc.left, rc.top, rc.width, rc.height, rad); ctx.fill();
        } else if (visibleColor(cs.backgroundColor)) {
          ctx.fillStyle = cs.backgroundColor; roundRect(ctx, rc.left, rc.top, rc.width, rc.height, rad); ctx.fill();
        }
        const bw = parseFloat(cs.borderTopWidth) || 0;
        if (bw && visibleColor(cs.borderTopColor)) {
          ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = bw;
          roundRect(ctx, rc.left + bw / 2, rc.top + bw / 2, rc.width - bw, rc.height - bw, rad); ctx.stroke();
        }
        if (el.tagName === 'CANVAS') { ctx.drawImage(el, rc.left, rc.top, rc.width, rc.height); continue; }
        if (el.children.length || !el.textContent.trim()) continue;
        ctx.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
        ctx.fillStyle = cs.color;
        ctx.textBaseline = 'middle';
        const center = el.tagName === 'BUTTON' || cs.textAlign === 'center';
        ctx.textAlign = center ? 'center' : 'left';
        ctx.fillText(el.textContent.trim(), center ? rc.left + rc.width / 2 : rc.left, rc.top + rc.height / 2);
      }
    }
  }

  // ---- 本体 -----------------------------------------------------------------
  class Ending {
    constructor(canvas, game, board, boardCanvas, sprites, C) {
      this.cv = canvas; this.ctx = canvas.getContext('2d');
      this.g = game; this.board = board; this.boardCv = boardCanvas; this.sprites = sprites; this.C = C;
      this.reset();
    }

    reset() {
      this.layers = [];      // 吸い込む絵：{ img, win, cells, center }
      this.parts = [];       // 光の粒子
      this.bang = null;      // ビッグバンの中心と大きさ（画面の px）
      this.form = null;      // 形成される星と銀河
      this.flow = null;     // エンドロールの流れる星
      this.drift = [];       // 流れていく銀河・星雲
      this.bgs = null;       // ぼかした背景画像
      this.nextDrift = 0;
      if (this.cv.width) this.ctx.clearRect(0, 0, this.cv.width, this.cv.height);
    }

    resize() {
      this.dpr = Math.min(root.devicePixelRatio || 1, 2);
      this.cv.width = Math.round(innerWidth * this.dpr);
      this.cv.height = Math.round(innerHeight * this.dpr);
    }

    /** ブラックホールの画面上の位置と半径 */
    bhScreen() {
      const r = this.boardCv.getBoundingClientRect(), s = r.width / this.C.board.width, h = this.g.bh;
      return { x: r.left + h.x * s, y: r.top + h.y * s, r: h.r * s, s, rect: r };
    }

    _canvas() {
      const c = document.createElement('canvas');
      c.width = this.cv.width; c.height = this.cv.height;
      return c;
    }

    /** FINAL_ABSORB の開始時：盤面の箱と UI を描き写す。描き写したあと main.js が DOM を隠す */
    capture(uiRoots) {
      const E = this.C.ending, dpr = this.dpr, bh = this.bhScreen();
      const box = this._canvas(), bx = box.getContext('2d');
      bx.setTransform(dpr * bh.s, 0, 0, dpr * bh.s, dpr * bh.rect.left, dpr * bh.rect.top);
      CosmosRender.drawGround(bx, this.C);
      CosmosRender.drawWalls(bx, this.C);
      const ui = this._canvas(), ux = ui.getContext('2d');
      ux.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawDom(ux, uiRoots);
      this.layers = [this._cells(box, E.wallsAt, bh), this._cells(ui, E.hudAt, bh)];
    }

    // 絵を格子に分ける。何も描かれていない格子は捨てる
    _cells(img, win, bh) {
      const cs = this.C.ending.cellPx, dpr = this.dpr, W = img.width, H = img.height;
      const data = img.getContext('2d').getImageData(0, 0, W, H).data;
      const cells = [];
      let dmax = 1;
      for (let y = 0; y < innerHeight; y += cs) {
        for (let x = 0; x < innerWidth; x += cs) {
          const x0 = Math.floor(x * dpr), y0 = Math.floor(y * dpr), x1 = Math.min(W, Math.ceil((x + cs) * dpr)), y1 = Math.min(H, Math.ceil((y + cs) * dpr));
          let hit = false;
          for (let py = y0; py < y1 && !hit; py += 2) for (let px = x0; px < x1; px += 2) if (data[(py * W + px) * 4 + 3] > 8) { hit = true; break; }
          if (!hit) continue;
          const cx = x + cs / 2, cy = y + cs / 2, dx = cx - bh.x, dy = cy - bh.y, d0 = Math.hypot(dx, dy);
          dmax = Math.max(dmax, d0);
          cells.push({ x, y, d0, a0: Math.atan2(dy, dx), done: false });
        }
      }
      // ブラックホールに近い格子ほど速く届く（遠い格子は時間帯の終わりに届く）
      const T = win[1] - win[0];
      cells.forEach(c => { c.T = T * (0.3 + 0.7 * c.d0 / dmax) * rand(0.92, 1); });
      return { img, win, cells };
    }

    _spark(x, y, cx, cy, n, hue) {
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(cy - y, cx - x) + rand(-0.6, 0.6), v = rand(40, 160);
        this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.5), age: 0, size: rand(1, 2.4), hue: hue != null ? hue : rand(20, 50), drag: 1.5 });
      }
    }

    _updateParts(dt) {
      for (const p of this.parts) {
        p.age += dt;
        const k = Math.exp(-p.drag * dt);
        p.vx *= k; p.vy *= k;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      this.parts = this.parts.filter(p => p.age < p.life);
    }

    _drawParts(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.parts) {
        const a = 1 - p.age / p.life;
        ctx.fillStyle = 'hsla(' + p.hue + ',90%,' + (p.light || 70) + '%,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    /** 毎フレーム。dt は画面の経過秒（ゲーム速度を掛けたもの） */
    draw(dt) {
      const g = this.g, st = g.state, ctx = this.ctx, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.cv.width, this.cv.height);
      if (!['FINAL_ABSORB', 'SILENCE', 'BIGBANG', 'ENDROLL'].includes(st)) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._updateParts(dt);
      if (st === 'FINAL_ABSORB') this._drawAbsorb(ctx, g.endT);
      else if (st === 'BIGBANG') this._drawBang(ctx, g.endT, dt);
      else if (st === 'ENDROLL') this._drawBang(ctx, this.C.ending.bigbangSec + g.endT, dt);
      this._drawParts(ctx);
    }

    // ---- 最終吸収（第12.1節） ----
    _drawAbsorb(ctx, t) {
      if (!this.g.bh) return;
      const bh = this.bhScreen(), cs = this.C.ending.cellPx, dpr = this.dpr;
      for (const L of this.layers) {
        if (t < L.win[0]) { ctx.drawImage(L.img, 0, 0, innerWidth, innerHeight); continue; }
        for (const c of L.cells) {
          if (c.done) continue;
          const u = clamp01((t - L.win[0]) / c.T), e = u * u;           // 落ちるように速くなる
          const d = c.d0 * (1 - e), th = c.a0 + 2.6 * e;                 // 渦を巻いて近づく
          const x = bh.x + d * Math.cos(th), y = bh.y + d * Math.sin(th);
          if (u >= 1 || d < bh.r * 0.5) {
            c.done = true;
            if (Math.random() < 0.25) this._spark(x, y, bh.x, bh.y, 1);
            continue;
          }
          const k = Math.min(1, d / (bh.r * 1.4));                      // 中心の近くで縮む
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(th);
          ctx.scale((1 + 2.4 * e) * k, Math.max(0.08, 1 - 0.9 * e) * k); // 中心の向きに引き伸ばし、横は細く
          ctx.rotate(-c.a0);
          ctx.drawImage(L.img, c.x * dpr, c.y * dpr, cs * dpr, cs * dpr, -cs / 2 - 0.3, -cs / 2 - 0.3, cs + 0.6, cs + 0.6);
          ctx.restore();
        }
      }
    }

    // ---- ビッグバン（第12.3節）〜エンドロールの背景（第13.1節） ----
    // T は BIGBANG の開始からの通しの秒（ENDROLL も続けて数える）
    _drawBang(ctx, T, dt) {
      const E = this.C.ending, W = innerWidth, H = innerHeight, diag = Math.hypot(W, H);
      if (!this.bang) {
        const bh = this.g.bh ? this.bhScreen() : { x: W / 2, y: H / 2, r: 60, s: 1, rect: this.boardCv.getBoundingClientRect() };
        this.bang = { x: bh.x, y: bh.y, r: bh.r, s: bh.s, rect: bh.rect, burst: false };
      }
      const B = this.bang;

      // 0〜0.8秒：ブラックホールが激しく収縮して点になり、周囲の光が吸い込まれる
      if (T < E.collapseSec) {
        const k = T / E.collapseSec;
        ctx.fillStyle = 'rgba(0,0,0,' + (0.35 + 0.65 * k).toFixed(3) + ')';
        ctx.fillRect(0, 0, W, H);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 70; i++) {                                    // 吸い込まれる光の筋
          const a = i * 2.39996 + k * 3, rr = (0.15 + (i % 7) / 7 * 0.6) * diag * Math.pow(1 - k, 1.6);
          ctx.strokeStyle = 'hsla(' + (i % 2 ? 30 : 270) + ',90%,75%,' + (0.5 * (1 - k)).toFixed(3) + ')';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(B.x + Math.cos(a) * rr, B.y + Math.sin(a) * rr);
          ctx.lineTo(B.x + Math.cos(a + 0.15) * rr * 0.8, B.y + Math.sin(a + 0.15) * rr * 0.8); ctx.stroke();
        }
        ctx.restore();
        if (this.g.bh) {
          const h = Object.assign({}, this.g.bh, { x: 0, y: 0, r: this.g.bh.r * Math.pow(1 - k, 2.2) + 0.5, pulse: 0 });
          ctx.save();
          ctx.translate(B.x, B.y); ctx.scale(B.s, B.s);
          this.board._drawBH(ctx, h, 0);
          ctx.restore();
        }
        return;
      }
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      if (T < E.dotAt) return;                                            // 黒い画面を残す（5秒）
      const ox = W / 2, oy = H / 2;                                       // ここからは画面の中央

      // 宇宙（星雲・銀河・星）は最初から描いておき、ホワイトアウトが透けていくと見えてくる
      if (!this.form) this._makeForm(W, H);
      if (T >= E.whiteAt) {
        // 膨張が始まったら大きくし続け、止めずに大きくなりながら消える（止まってから消えると不自然だった。2026-10-30 作者の指摘）
        const zoom = 1 + 0.9 * Math.pow(Math.max(0, T - E.expandAt) / 6, 1.6);
        const formFade = 1 - smooth((T - E.bigbangSec - 2) / 5);           // エンドロールの最初の数秒で消える
        if (formFade > 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          for (const s of this.form.sprites) {
            const sp = this.sprites[s.key];
            if (!sp) continue;
            const m = sp.meta, size = s.size * zoom, sc = size / Math.max(m.width, m.height);
            ctx.globalAlpha = s.alpha * formFade;
            ctx.save(); ctx.translate(ox + (s.x - ox) * zoom, oy + (s.y - oy) * zoom); ctx.rotate(s.rot + T * s.spin);
            ctx.drawImage(sp.img, -m.width * sc / 2, -m.height * sc / 2, m.width * sc, m.height * sc);
            ctx.restore();
          }
          ctx.globalAlpha = 1;
          for (const s of this.form.stars) {
            const a = (0.55 + 0.45 * Math.sin(T * s.tw + s.p)) * formFade;
            ctx.fillStyle = 'hsla(' + s.hue + ',80%,88%,' + a.toFixed(3) + ')';
            ctx.beginPath(); ctx.arc(ox + (s.x - ox) * zoom, oy + (s.y - oy) * zoom, s.r, 0, Math.PI * 2); ctx.fill();
          }
          ctx.restore();
        }
        // 宇宙の膨張。中央から外へ星が流れる（エンドロールの主役）
        if (T >= E.expandAt) this._drawFlow(ctx, T, dt, ox, oy, W, H);
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 中央に白い光の点が現れ、左右に水平に広がって白い線になる
      if (T < E.burstAt + 0.6) {
        const k = smooth((T - E.lineAt) / E.lineSec), out = 1 - clamp01((T - E.burstAt) / 0.6);
        const half = W * 0.55 * k, a = smooth((T - E.dotAt) / 0.08) * out;
        const glow = ctx.createRadialGradient(ox, oy, 0, ox, oy, 26);
        glow.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')'); glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow; ctx.fillRect(ox - 26, oy - 26, 52, 52);
        ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
        ctx.beginPath(); ctx.arc(ox, oy, 1.6, 0, Math.PI * 2); ctx.fill();
        if (half > 0.5) {
          const lg = ctx.createLinearGradient(ox - half, 0, ox + half, 0);
          lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,' + a.toFixed(3) + ')'); lg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = lg;
          ctx.fillRect(ox - half, oy - 1, half * 2, 2);
          ctx.globalAlpha = 0.35; ctx.fillRect(ox - half, oy - 4, half * 2, 8); ctx.globalAlpha = 1;
        }
      }
      // 爆発。光と粒子が広がり、中央の白い部分が画面いっぱいになる
      if (T >= E.burstAt && T < E.whiteAt + 0.5) {
        const B = this.bang;
        if (!B.burst) {
          B.burst = true;
          const hues = [45, 30, 15, 280, 210, 190];
          for (let i = 0; i < 520; i++) {
            const a = rand(0, Math.PI * 2), v = Math.pow(Math.random(), 0.5) * diag * 1.4;
            this.parts.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(1.5, 2.5), age: 0,
              size: rand(0.8, 2.6), hue: hues[i % hues.length], light: rand(65, 95), drag: 1.2 });
          }
        }
        const q = clamp01((T - E.burstAt) / (E.whiteAt - E.burstAt)), e = Math.pow(q, 0.9);
        const size = diag * (0.08 + 2.6 * e), fx = this.sprites.fx_bigbang;
        if (fx) {
          const m = fx.meta, sc = size / Math.min(m.width, m.height);
          ctx.globalAlpha = 0.9;
          ctx.drawImage(fx.img, ox - m.width * sc / 2, oy - m.height * sc / 2, m.width * sc, m.height * sc);
          ctx.globalAlpha = 1;
        }
        const core = diag * (0.03 + 0.75 * Math.pow(q, 1.6));                 // 白い中心が画面の端まで広がる
        const gl = ctx.createRadialGradient(ox, oy, 0, ox, oy, core * 1.6);
        gl.addColorStop(0, 'rgba(255,255,255,1)'); gl.addColorStop(0.6, 'rgba(255,250,240,1)');
        gl.addColorStop(0.8, 'rgba(251,191,36,0.5)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      // ホワイトアウト：画面全体が白くなり、だんだん透けて宇宙が見えてくる
      const wa = T < E.whiteAt ? smooth((T - (E.whiteAt - 0.5)) / 0.5) : 1 - smooth((T - E.whiteAt - E.whiteHoldSec) / E.revealSec);
      if (wa > 0) { ctx.fillStyle = 'rgba(255,255,255,' + wa.toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
      this._drawBangTitle(ctx, T, W, H);
    }

    // 「BIG BANG」の文字（第12.3節）。爆発で現れ、ホワイトアウトの間も読めるよう濃いオレンジにふちを付け、
    // 宇宙が透けて見えてくるころに少し大きくなりながら消える。エンディング中は英語だけ（訳は出さない）
    _drawBangTitle(ctx, T, W, H) {
      const E = this.C.ending, t0 = E.burstAt + 0.15, t1 = E.whiteAt + E.whiteHoldSec + 1.8;
      if (T < t0 || T > t1 + 1.2) return;
      const a = smooth((T - t0) / 0.35) * (1 - smooth((T - t1) / 1.2));
      if (a <= 0) return;
      const md = Math.min(W, H), sc = 0.9 + 0.25 * smooth((T - t0) / (t1 + 1.2 - t0));
      const big = Math.round(md * 0.14);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, H / 2); ctx.scale(sc, sc);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.font = big + 'px "Fredoka One", sans-serif';
      ctx.lineWidth = big * 0.14; ctx.strokeStyle = 'rgba(67,20,7,0.85)';
      ctx.strokeText('BIG BANG', 0, 0);
      ctx.fillStyle = '#fb923c'; ctx.fillText('BIG BANG', 0, 0);
      ctx.restore();
    }

    _makeForm(W, H) {
      const keys = ['galaxy', 'nebula', 'cosmic_dust', 'galaxy', 'nebula', 'stars_bg', 'galaxy_bg'];
      const md = Math.min(W, H);
      this.form = {
        sprites: keys.map(key => ({
          key, x: rand(0.12, 0.88) * W, y: rand(0.12, 0.88) * H, size: md * rand(0.3, 0.55),
          alpha: rand(0.45, 0.8), rot: rand(-0.4, 0.4), spin: rand(-0.02, 0.02)
        })),
        stars: Array.from({ length: Math.round(Math.max(160, W * H / 3500)) }, () => ({
          x: Math.random() * W, y: Math.random() * H, r: Math.random() < 0.08 ? 1.6 : rand(0.4, 1.2),
          tw: rand(0.6, 2), p: rand(0, 6.3), hue: Math.random() < 0.25 ? 30 : 220
        }))
      };
    }

    _drawFlow(ctx, T, dt, cx, cy, W, H) {
      const E = this.C.ending, md = Math.max(W, H) * 0.55;
      if (!this.flow) {
        this.flow = Array.from({ length: 320 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), z: rand(0.05, 1), pz: 0 }));
        this.flow.forEach(s => { s.pz = s.z; });
      }
      // 背景の画像（拡大・ぼかし・薄く。第13.1節）。小さく縮めてから引き伸ばしてぼかす
      if (!this.bgs) {
        this.bgs = ['bg_expansion', 'bg_travel', 'bg_space'].map(k => {
          const sp = this.sprites[k]; if (!sp) return null;
          const c = document.createElement('canvas'); c.width = 40; c.height = 26;
          c.getContext('2d').drawImage(sp.img, 0, 0, c.width, c.height);
          return c;
        });
      }
      const rollT = T - E.bigbangSec, seg = this.g.rollSec / 3;
      const bgIn = smooth((T - E.expandAt) / 4) * E.bgAlpha;
      const idx = Math.max(0, Math.floor(rollT / seg)), mix = smooth((rollT - (idx + 1) * seg + 3) / 3);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const cover = (c, a) => {
        if (!c || a <= 0) return;
        const s = Math.max(W / c.width, H / c.height) * 1.1;
        ctx.globalAlpha = a;
        ctx.drawImage(c, (W - c.width * s) / 2, (H - c.height * s) / 2, c.width * s, c.height * s);
      };
      cover(this.bgs[Math.min(idx, 2)], bgIn * (1 - (idx < 2 ? mix : 0)));
      if (idx < 2) cover(this.bgs[idx + 1], bgIn * mix);
      ctx.restore();

      // 流れる星（3次元の点を中心から外へ投影）
      const speed = 0.32 * smooth((T - E.expandAt) / 3);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const s of this.flow) {
        s.pz = s.z;
        s.z -= speed * dt;
        const sx = cx + s.x / s.z * md * 0.5, sy = cy + s.y / s.z * md * 0.5;
        if (s.z <= 0.03 || sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) {
          s.x = rand(-1, 1); s.y = rand(-1, 1); s.z = s.pz = rand(0.8, 1); continue;
        }
        const px = cx + s.x / s.pz * md * 0.5, py = cy + s.y / s.pz * md * 0.5;
        const a = clamp01((1 - s.z) * 1.3) * smooth((T - E.expandAt) / 2);
        ctx.strokeStyle = 'rgba(226,232,255,' + a.toFixed(3) + ')';
        ctx.lineWidth = Math.max(0.6, (1 - s.z) * 2.4);
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx + 0.01, sy); ctx.stroke();
      }
      // ゆっくり流れていく銀河・星雲・宇宙の塵（小さな部品）
      if (rollT > 2 && rollT > this.nextDrift && this.drift.length < 3) {
        this.nextDrift = rollT + rand(5, 9);
        const keys = ['galaxy', 'nebula', 'cosmic_dust'], a = rand(0, Math.PI * 2);
        this.drift.push({ key: keys[Math.floor(Math.random() * 3)], a, r: rand(0.06, 0.16), s: 1, age: 0, fade: 1, rot: rand(-0.5, 0.5) });
      }
      // 中央近くに現れ、少しずつ大きくなりながら、だんだん速く外へ流れて画面の外へ出ていく（宇宙の膨張と同じ、
      // 一定の割合で広がる動き）。大きくなりすぎても画面の中に残りそうなときだけ、薄くして消す
      // （星と同じ 1/z で動かすと、消える前に急に横へ滑って見えた。2026-10-30 作者の指摘）
      const rate = 0.16 * (speed / 0.32);            // 外へ広がる割合（1秒あたり）。星の流れが始まるのに合わせて速くなる
      const minWH = Math.min(W, H), maxSize = minWH * 0.95;
      for (const d of this.drift) {
        d.age += dt;
        d.r *= Math.exp(rate * dt);                   // 中心からの距離（画面の大きい辺に対する割合）
        d.s *= Math.exp(rate * 0.8 * dt);             // 大きさも距離に近い速さで大きくする（出るまでに 2.4〜5 倍。作者の希望）
        const sp = this.sprites[d.key]; if (!sp) continue;
        const m = sp.meta, size = minWH * 0.14 * d.s, sc = size / Math.max(m.width, m.height);
        const x = cx + Math.cos(d.a) * d.r * md * 2, y = cy + Math.sin(d.a) * d.r * md * 2;
        d.off = x + size / 2 < 0 || x - size / 2 > W || y + size / 2 < 0 || y - size / 2 > H;
        if (size > maxSize) d.fade = Math.max(0, d.fade - dt / 2);   // 外へ出る前に大きくなりすぎたら、2秒で薄くする
        ctx.globalAlpha = smooth(d.age / 2) * d.fade * 0.75;
        ctx.save(); ctx.translate(x, y); ctx.rotate(d.rot);
        ctx.drawImage(sp.img, -m.width * sc / 2, -m.height * sc / 2, m.width * sc, m.height * sc);
        ctx.restore();
      }
      this.drift = this.drift.filter(d => !d.off && d.fade > 0);
      ctx.restore();
    }
  }

  root.CosmosEnding = Ending;
})(window);
