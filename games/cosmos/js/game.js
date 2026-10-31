/*
 * MOMO Cosmos — ゲーム処理（物理・落下・合体・出現・ゲームオーバー）
 * DOM に触れない。描画と操作は render.js / input.js が担う。
 * 状態：TITLE / PLAY / PAUSE / GAMEOVER / BH_STANDBY / BH_BIRTH / BH / BH_SUPER
 *       / FINAL_ABSORB / SILENCE / BIGBANG / ENDROLL（第12章・第13章。演出は ending.js）
 */
(function (root) {
  'use strict';

  class CosmosGame {
    constructor(config, Matter, opts) {
      this.C = config;
      this.M = Matter;
      this.random = (opts && opts.random) || Math.random;
      this.listeners = {};
      this.state = 'TITLE';
      this.speed = 1;          // デバッグ用のゲーム速度
      this.forcedStage = 0;    // デバッグ：次に落とす段階を固定（0 = 固定しない）
      this.highScore = 0;
      this.clearCount = 0;     // クリア回数（main.js が保存から読む）
      this.eventsOn = true;    // 特殊イベントのオン・オフ（main.js が設定から入れる。第14.1節）
      this.stormSide = 0;      // 前の重力嵐の向き（-1 左・1 右・0 まだ）。ゲームをまたいで交互にする
      this.difficulty = 'apocalypse';   // 難易度（main.js が設定から入れる。次の start() から効く）
      this._newGame();
    }

    on(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => fn(data)); }

    // ---- 開始・状態 ----------------------------------------------------
    _newGame() {
      const M = this.M, C = this.C, P = C.physics, B = C.board;
      const D = C.difficulties[this.difficulty] || C.difficulties.apocalypse;
      this.sizeMul = D.sizeMul;      // 天体の半径の倍率（ブラックホールは変えない）
      this.missiles = D.missiles;    // 残りのミサイル
      this.missileArmed = false;     // ミサイルを選んで、壊す天体を待っている
      this.shot = null;              // 飛んでいるミサイル：{ body, t, dur, x0, y0, x, y }
      this.engine = M.Engine.create({
        enableSleeping: false,
        positionIterations: P.positionIterations,
        velocityIterations: P.velocityIterations
      });
      this.engine.gravity.y = P.gravityY;
      const t = B.wallThickness, W = B.width, H = B.height;
      // 壁と床は分類 2。彗星（分類 4）は天体（分類 1）とだけ当たる
      const opt = { isStatic: true, friction: P.friction, frictionStatic: P.frictionStatic, restitution: P.restitution, label: 'wall',
        collisionFilter: { category: 0x0002, mask: 0xFFFFFFFF, group: 0 } };
      M.Composite.add(this.engine.world, [
        M.Bodies.rectangle(-t / 2, H / 2 - H, t, H * 3, opt),          // 左（上に高く伸ばす）
        M.Bodies.rectangle(W + t / 2, H / 2 - H, t, H * 3, opt),       // 右
        M.Bodies.rectangle(W / 2, H + t / 2, W + t * 2, t, Object.assign({}, opt, { label: 'floor' })) // 床
      ]);
      this._pairs = [];
      const collect = ev => { for (const p of ev.pairs) this._pairs.push(p); };
      M.Events.on(this.engine, 'collisionStart', ev => {
        // このイベントは衝突を解く前に来る。床との組だけ反発を差し替える（組の反発は2つの大きい方になるため）
        for (const p of ev.pairs) if (p.bodyA.label === 'floor' || p.bodyB.label === 'floor') p.restitution = P.floorRestitution;
        collect(ev); this._cometHits(ev.pairs); this._impact(ev.pairs);
      });
      M.Events.on(this.engine, 'collisionActive', collect);

      this.time = 0;            // シミュレーション時間（秒）
      this._acc = 0;
      this.score = 0;
      this.maxStage = 1;
      this.dropCount = 0;
      this.lastDropAt = -1e9;
      this.overTime = 0;
      this.warning = false;
      this.recentSpawns = [];
      this.aimX = B.width / 2;
      this.queue = [this._rollStage(), this._rollStage()];
      this.newRecord = false;
      this.resumeState = 'PLAY';
      this.standby = null;      // BH_STANDBY：{ a, b, link, t, calm }
      this.birth = null;        // BH_BIRTH：{ t, x, y }
      this.bh = null;           // ブラックホール：{ x, y, r, growth, tier, pulse, from, spin }
      this.absorbing = [];      // 吸収の演出中：{ stage, x, y, angle, r, t }
      this.superT = 0;
      this.endT = 0;            // エンディングの各状態に入ってからの秒
      this.playTime = 0;        // 超巨大に達するまでのプレイ時間（秒）
      this.rollSkippable = false;
      this.rollDone = false;
      this.rollSec = this.C.ending.rollSec;  // エンドロールの長さ。main.js が文字の量から決め直す
      this._ev = {};            // エンディングで一度だけ起こすことの済み印
      // 特殊イベント（第14章）：timer＝前回から数える秒、warn＝予告中 { type, t }、cur＝発生中 { type, t, dur, … }
      // slow＝惑星衝突のスローの残り秒、calm＝ゲームオーバーにしない猶予 { still, left }（left は終わってからの残り）
      this.ev = { timer: 0, wait: null, warn: null, cur: null, mode: 'PLAY', lastHit: -1e9, slow: 0, calm: null, drops0: 0 };   // drops0＝前のイベントが終わったときの落とした数
      this.comet = null;
    }

    _setState(st) {
      this.state = st;
      if (this.missileArmed && st !== 'PLAY' && st !== 'PAUSE') { this.missileArmed = false; this.emit('missileArm', false); }
      this.emit('state', st);
    }
    start() { this._newGame(); this._setState('PLAY'); }
    toTitle() { this._newGame(); this._setState('TITLE'); }
    /** 落下操作を受け付ける状態（通常期と餌やり） */
    get controllable() { return this.state === 'PLAY' || this.state === 'BH'; }
    /** 時間が進む状態 */
    get running() { return ['PLAY', 'BH_STANDBY', 'BH_BIRTH', 'BH', 'BH_SUPER', 'FINAL_ABSORB', 'SILENCE', 'BIGBANG', 'ENDROLL'].includes(this.state); }
    /** 最終吸収より後（物理を動かさない）。ENDROLL の後半も含む */
    get afterAbsorb() { return ['SILENCE', 'BIGBANG', 'ENDROLL'].includes(this.state); }
    pause() { if (this.controllable) { this.resumeState = this.state; this._setState('PAUSE'); } }
    resume() { if (this.state === 'PAUSE') this._setState(this.resumeState); }

    // ---- 出現テーブル（第6.3節） ----------------------------------------
    spawnRange() {
      const row = this.C.spawnTable.find(r => this.maxStage <= r.upToMaxStage);
      return row.range;
    }

    _rollStage() {
      const [lo, hi] = this.spawnRange();
      const n = hi - lo + 1;
      const w = this.C.spawnWeightsFor(n);
      const r = this.recentSpawns, lim = this.C.maxSameInARow;
      // 直前に同じ天体が lim 回続いていれば、その天体を候補から外す
      let banned = 0;
      if (r.length >= lim && r.slice(-lim).every(s => s === r[r.length - 1])) banned = r[r.length - 1];
      let total = 0;
      const cand = [];
      for (let i = 0; i < n; i++) {
        const s = lo + i;
        if (s === banned && n > 1) continue;
        cand.push([s, w[i]]); total += w[i];
      }
      let x = this.random() * total;
      let pick = cand[cand.length - 1][0];
      for (const [s, wi] of cand) { if ((x -= wi) < 0) { pick = s; break; } }
      r.push(pick);
      if (r.length > 8) r.shift();
      return pick;
    }

    get nextStage() { return this.forcedStage || this.queue[0]; }
    get nextNextStage() { return this.queue[1]; }

    /** 天体の半径（難易度の倍率をかけたもの） */
    radius(stage) { return Math.round(this.C.stages[stage].radius * (stage <= 12 ? this.sizeMul : 1)); }

    // ---- 落下（第6章） ----------------------------------------------------
    clampX(x, stage) {
      const r = this.radius(stage || this.nextStage);
      return Math.max(r + 1, Math.min(this.C.board.width - r - 1, x));
    }

    canDrop() {
      return this.controllable && (this.time - this.lastDropAt) * 1000 >= this.C.input.dropCooldownMs;
    }

    setAim(x) { this.aimX = this.clampX(x); }

    /** 落とす。連打防止中は照準だけ動かして false を返す */
    drop(x) {
      if (x != null) this.setAim(x);
      if (!this.canDrop()) return false;
      let stage;
      if (this.forcedStage) stage = this.forcedStage;
      else { stage = this.queue.shift(); this.queue.push(this._rollStage()); }
      const x0 = this.clampX(this.aimX, stage);
      const b = this._addBody(stage, x0, this.C.board.dropY);
      b.plugin.cosmos.dropped = true;
      this.lastDropAt = this.time;
      this.dropCount++;
      this._noteStage(stage);
      this.aimX = this.clampX(this.aimX);
      this.emit('drop', { stage, x: x0 });
      return true;
    }

    _addBody(stage, x, y) {
      const P = this.C.physics;
      const r = this.radius(stage);
      const b = this.M.Bodies.circle(x, y, r, {
        restitution: P.restitution, friction: P.friction, frictionStatic: P.frictionStatic,
        frictionAir: P.frictionAir, density: P.density, label: 'body'
      });
      b.plugin = b.plugin || {};
      // sq：やわらかさの縮み量、sqV：その速さ、sqAng：縮む向き（ぶつかった向き）
      b.plugin.cosmos = { stage, born: this.time, merging: false, dropped: false, sq: 0, sqV: 0, sqAng: 0 };
      this.M.Composite.add(this.engine.world, b);
      return b;
    }

    _noteStage(stage) {
      if (stage > this.maxStage) { this.maxStage = stage; this.emit('maxStage', stage); }
    }

    bodies() { return this.M.Composite.allBodies(this.engine.world).filter(b => b.label === 'body'); }

    // ---- 更新 ------------------------------------------------------------
    update(dtSec) {
      if (!this.running) return;
      const P = this.C.physics, step = P.stepMs / 1000;
      this._acc += Math.min(dtSec, 0.1) * this.speed;
      let n = 0;
      while (this._acc >= step && n < P.maxStepsPerFrame * Math.max(1, this.speed)) {
        this._acc -= step; n++;
        this._step(step);
        if (!this.running) { this._acc = 0; break; }
      }
      if (n >= P.maxStepsPerFrame * Math.max(1, this.speed)) this._acc = 0; // 処理落ち時は追いかけない
    }

    _step(step) {
      const M = this.M;
      if (this.afterAbsorb) { this._updateEnding(step); return; }
      this._pairs.length = 0;
      this._mergedThisStep = 0;
      // BH_BIRTH の最初は物理をスローにする（第11.1節）
      this.engine.timing.timeScale = (this.state === 'BH_BIRTH' && this.birth.t < this.C.bh.gatherSec) ? this.C.bh.slowScale
        : this.ev.slow > 0 ? this.C.events.collision.slowScale : 1;   // 惑星衝突の一瞬のスロー
      if (this.ev.slow > 0) this.ev.slow -= step;
      if (this.bh && this._sucking) this._suction();
      M.Engine.update(this.engine, this.C.physics.stepMs);
      this.time += step;
      this._rollingResistance();
      this._squashSpring();
      this._processMerges();
      if (this.state === 'PLAY') this._checkGameOver(step);
      else if (this.state === 'BH_STANDBY') this._updateStandby(step);
      else if (this.state === 'BH_BIRTH') this._updateBirth(step);
      if (this.state === 'PLAY' || this.state === 'BH') this._updateEvents(step);
      else if (this.ev.cur || this.ev.warn || this.ev.timer) this._stopEvents();
      if (this.bh) this._updateBH(step);
      if (this.shot) this._updateShot(step);
      if (this.state === 'FINAL_ABSORB') this._updateFinal(step);
    }

    get _sucking() { return this.state === 'BH' || this.state === 'BH_SUPER' || this.state === 'FINAL_ABSORB'; }

    // 接触中の天体だけ角速度を減らす（第7.2節 転がり抵抗）
    _rollingResistance() {
      const k = this.C.physics.rollingDamping;
      const touched = new Set();
      for (const p of this.engine.pairs.list) {
        if (!p.isActive) continue;
        if (!p.bodyA.isStatic) touched.add(p.bodyA);
        if (!p.bodyB.isStatic) touched.add(p.bodyB);
      }
      touched.forEach(b => this.M.Body.setAngularVelocity(b, b.angularVelocity * k));
    }

    // ぶつかった瞬間：相対速度の法線成分に応じて、その向きに縮ませる
    _impact(pairs) {
      const S = this.C.squash;
      for (const p of pairs) {
        const a = p.bodyA, b = p.bodyB, n = p.collision.normal;
        const v = Math.abs((a.velocity.x - b.velocity.x) * n.x + (a.velocity.y - b.velocity.y) * n.y);
        this.emit('impact', { v });   // 着地・衝突の音（main.js が速さで選ぶ）
        this._checkCollision(p, v);
        const amt = Math.min(S.max, v * S.gain);
        if (amt < 0.01) continue;
        const ang = Math.atan2(n.y, n.x);
        for (const o of [a, b]) {
          const c = o.plugin && o.plugin.cosmos;
          if (!c) continue;
          if (amt > c.sq) { c.sqV = 0; c.sq = amt; c.sqAng = ang; }
        }
      }
    }

    // 縮みをばねで戻す（行き過ぎて少し伸び、ぷるんと収まる）
    _squashSpring() {
      const S = this.C.squash;
      for (const b of this.bodies()) {
        const c = b.plugin.cosmos;
        if (!c.sq && !c.sqV) continue;
        c.sqV = (c.sqV - S.stiffness * c.sq) * S.damping;
        c.sq += c.sqV;
        if (Math.abs(c.sq) < 0.001 && Math.abs(c.sqV) < 0.001) c.sq = c.sqV = 0;
      }
    }

    // ---- 合体（第8章） ----------------------------------------------------
    _processMerges() {
      const M = this.M, C = this.C;
      const seen = new Set();
      for (const p of this._pairs) {
        const a = p.bodyA, b = p.bodyB;
        if (a.label !== 'body' || b.label !== 'body') continue;
        const ca = a.plugin.cosmos, cb = b.plugin.cosmos;
        if (ca.merging || cb.merging || ca.stage !== cb.stage || ca.targeted || cb.targeted) continue;   // ミサイルに狙われた天体は合体しない
        const key = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const stage = ca.stage;
        if (ca.pending || cb.pending) continue;
        if (stage >= C.maxMergeStage) {
          // 中性子星どうし：通常期だけブラックホール誕生へ。待機中の3個目・BH 期は合体させない（吸われる）
          if (this.state === 'PLAY') this._enterStandby(a, b);
          continue;
        }
        ca.merging = cb.merging = true;
        const x = (a.position.x + b.position.x) / 2, y = (a.position.y + b.position.y) / 2;
        const vx = (a.velocity.x + b.velocity.x) / 2, vy = (a.velocity.y + b.velocity.y) / 2;
        const av = (a.angularVelocity + b.angularVelocity) / 2;
        M.Composite.remove(this.engine.world, a);
        M.Composite.remove(this.engine.world, b);
        const ns = stage + 1;
        const nb = this._addBody(ns, x, y);
        nb.plugin.cosmos.born = Math.min(ca.born, cb.born); // 合体で生まれた天体はすぐ判定対象（落下中扱いにしない）
        M.Body.setVelocity(nb, { x: vx, y: vy + C.physics.mergeBounceVy });
        M.Body.setAngularVelocity(nb, av);
        const add = C.stages[ns].score;
        this.score += add;
        this._noteStage(ns);
        this._mergedThisStep++;
        this.emit('merge', { stage: ns, x, y, add });
      }
    }

    // ---- ブラックホール誕生（第8.1節・第11.1節） --------------------------
    _enterStandby(a, b) {
      const M = this.M;
      a.plugin.cosmos.pending = b.plugin.cosmos.pending = true;
      // 2個は消さず、位置関係を保つように結ぶ
      const link = M.Constraint.create({ bodyA: a, bodyB: b, stiffness: 1, damping: 0.1,
        length: Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) });
      M.Composite.add(this.engine.world, link);
      this.standby = { a, b, link, t: 0, calm: 0 };
      if (this.warning) { this.warning = false; this.emit('warning', false); }
      this.overTime = 0;
      this._setState('BH_STANDBY');
    }

    _updateStandby(step) {
      const S = this.standby, BH = this.C.bh;
      S.t += step;
      const still = !this._mergedThisStep && this.bodies().every(b => b.speed < BH.stableSpeed);
      S.calm = still ? S.calm + step : 0;
      if (S.calm >= BH.stableSec || S.t >= BH.standbyMaxSec) {
        this.birth = { t: 0, x: (S.a.position.x + S.b.position.x) / 2, y: (S.a.position.y + S.b.position.y) / 2 };
        this._setState('BH_BIRTH');
        this.emit('bhBirth', { x: this.birth.x, y: this.birth.y });
      }
    }

    _updateBirth(step) {
      const BH = this.C.bh, B = this.birth, S = this.standby;
      B.t += step;
      if (S) { B.x = (S.a.position.x + S.b.position.x) / 2; B.y = (S.a.position.y + S.b.position.y) / 2; }
      if (S && B.t >= BH.appearAt) {
        // 中性子星2個が消え、中間地点にブラックホールが出現する
        this.M.Composite.remove(this.engine.world, [S.a, S.b, S.link]);
        this.standby = null;
        this._spawnBH(B.x, B.y);
        const add = this.C.stages[13].score;
        this.score += add;
        this._noteStage(13);
        this.emit('bhAppear', { x: B.x, y: B.y, add });
      }
      if (B.t >= BH.birthSec) {
        this.bh.x = BH.home.x; this.bh.y = BH.home.y;
        this.birth = null;
        this._setState('BH');
      }
    }

    _spawnBH(x, y) {
      this.bh = { x, y, r: this.C.bh.sizeCurve[0][1], growth: 0, food: 0, tier: 0, pulse: 0, from: { x, y }, spin: 0 };
    }

    /** 成長値 → 本体半径（第11.6節。間は直線でつなぐ） */
    bhRadius(growth) {
      const c = this.C.bh.sizeCurve;
      if (growth <= c[0][0]) return c[0][1];
      for (let i = 1; i < c.length; i++) {
        if (growth <= c[i][0]) { const [g0, r0] = c[i - 1], [g1, r1] = c[i]; return r0 + (r1 - r0) * (growth - g0) / (g1 - g0); }
      }
      return c[c.length - 1][1];
    }

    _grow(v) {
      const h = this.bh;
      h.growth += v;
      h.r = this.bhRadius(h.growth);
      let tier = 0;
      this.C.bh.tierAt.forEach((g, i) => { if (h.growth >= g) tier = i; });
      if (tier > h.tier) { h.tier = tier; this.emit('bhTier', tier); }
    }

    // 吸引（第11.4節）。力は重力（質量×重力の大きさ）の倍数で与える
    _suction() {
      const BH = this.C.bh, h = this.bh, M = this.M;
      const g = this.engine.gravity.scale * this.engine.gravity.y;
      const whole = this.state === 'BH_SUPER' || this.state === 'FINAL_ABSORB';
      for (const b of this.bodies()) {
        const dx = h.x - b.position.x, dy = h.y - b.position.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        // ブラックホールの近くでは天体どうしをすり抜けさせる（押し合って中心に届かず、吸えなくなるのを防ぐ）。
        // group を同じ負の数にした物体どうしはぶつからない。床・壁とはぶつかる
        b.collisionFilter.group = d < h.r * BH.passR ? -1 : 0;
        let k = 0;
        if (whole || d < h.r * BH.nearR) k = BH.nearG;
        else if (d < h.r * BH.farR) k = BH.farGmax - (BH.farGmax - BH.farGmin) * (d - h.r * BH.nearR) / (h.r * (BH.farR - BH.nearR));
        if (!k) continue;
        const f = k * g * b.mass, ux = dx / d, uy = dy / d;
        // 中心へ向かう成分と、回る向きの成分（渦を巻いて吸い込まれる）
        M.Body.applyForce(b, b.position, {
          x: f * ((1 - BH.swirl) * ux - BH.swirl * uy),
          y: f * ((1 - BH.swirl) * uy + BH.swirl * ux)
        });
      }
    }

    _updateBH(step) {
      const BH = this.C.bh, h = this.bh, M = this.M;
      h.spin += step;
      h.pulse = Math.max(0, h.pulse - step * 3);
      // 誕生後、盤面中央付近へゆっくり移る
      if (this.state === 'BH_BIRTH') {
        const k = Math.min(1, (this.birth.t - BH.appearAt) / (BH.birthSec - BH.appearAt)), e = k * k * (3 - 2 * k);
        h.x = h.from.x + (BH.home.x - h.from.x) * e;
        h.y = h.from.y + (BH.home.y - h.from.y) * e;
      }
      // 吸収（第11.5節）
      if (this._sucking) {
        for (const b of this.bodies()) {
          if (Math.hypot(h.x - b.position.x, h.y - b.position.y) >= h.r * BH.absorbR) continue;
          this._absorb(b);
        }
        if (this.state === 'BH') {
          this._grow(BH.growthPerSec * step);
          // 消化待ち（food）から、毎秒 digestPerSec までだけ成長に回す（盤面が埋まっていても約1分はかかる）
          const take = Math.min(h.food, BH.digestPerSec * step);
          if (take > 0) { h.food -= take; this._grow(take); }
        }
      }
      for (const a of this.absorbing) a.t += step;
      this.absorbing = this.absorbing.filter(a => a.t < BH.absorbSec);
      // 超巨大に到達（第11.8節）。文字を見せてから最終吸収へ
      if (this.state === 'BH' && h.growth >= BH.superGrowth) {
        this.superT = 0;
        this.playTime = this.time;
        this._setState('BH_SUPER');
        this.emit('supermassive');
      } else if (this.state === 'BH_SUPER') {
        this.superT += step;
        if (this.superT >= BH.superHoldSec) this._enter('FINAL_ABSORB');
      }
    }

    _absorb(b) {
      const h = this.bh, c = b.plugin.cosmos;
      this.M.Composite.remove(this.engine.world, b);
      this.absorbing.push({ stage: c.stage, x: b.position.x, y: b.position.y, angle: b.angle, r: b.circleRadius, t: 0 });
      const add = c.stage * this.C.bh.absorbScorePerStage;
      this.score += add;
      h.pulse = 1;
      if (this.state === 'BH') h.food += c.stage * c.stage;   // 消化待ちに入れる
      this.emit('absorb', { stage: c.stage, x: h.x, y: h.y, add });
    }

    // ---- 特殊イベント（第14章） ---------------------------------------------
    // 通常期とブラックホール期だけ進む。予告（warnSec）→ 発生 → 終わったら timer を 0 から数え直す
    _updateEvents(step) {
      const E = this.C.events, ev = this.ev;
      if (ev.mode !== this.state) { this._stopEvents(); ev.mode = this.state; } // 通常期 → BH 期で区切る
      if (ev.cur) {
        ev.cur.t += step;
        this._tickEvent(ev.cur, step);
        if (ev.cur && ev.cur.t >= ev.cur.dur) this._endEvent();
        return;
      }
      if (ev.warn) {
        ev.warn.t += step;
        // 起こすかは予告の時点で決めた。予告のあとは警告が出ても取りやめない（設定でオフにしたときだけ取りやめる。2026-10-31 作者の指示）
        if (!this.eventsOn) this._cancelEvent();
        else if (ev.warn.t >= E.warnSec) this._beginEvent(ev.warn.type);
        return;
      }
      if (!this.eventsOn) return;
      const active = this.time - this.lastDropAt < E.idleSec;
      if (active) ev.timer += step;                                  // 落とすのを止めている間は数えない
      if (ev.wait == null) ev.wait = E.delaySec[0] + this.random() * (E.delaySec[1] - E.delaySec[0]); // 次に起こすまでの秒
      if (ev.timer < ev.wait || this.warning || !active) return;     // 警告中・放置中は待つ
      if (this.dropCount - ev.drops0 < E.minDrops) return;           // 前のイベントから10個落とすまで待つ
      const cand = this._eventTypes().filter(t => this._eventOk(t));
      if (!cand.length) return;                                      // 起こせるものがなければ、起こせるようになるまで待つ
      ev.timer = 0; ev.wait = null;
      // 重み付きで選ぶ（フレアは多め）
      const w = cand.map(t => E.weights[t] || 1), sum = w.reduce((a, b) => a + b, 0);
      let r = this.random() * sum, i = 0;
      while (i < cand.length - 1 && r >= w[i]) { r -= w[i]; i++; }
      this._announce(cand[i]);
    }

    _eventTypes() { return this.state === 'BH' ? this.C.events.bhTypes : this.C.events.playTypes; }

    /** 発生条件（第14.3節）。force はデバッグ用（流星群の高さの条件を見ない） */
    _eventOk(type, force) {
      const E = this.C.events;
      if (type === 'flare') return this._flareTargets().length > 0;
      if (type === 'meteor') return force || this.bodies().every(b => b.position.y - b.circleRadius > E.meteor.topY);
      return true;
    }

    _flareTargets() { return this.bodies().filter(b => b.plugin.cosmos.stage >= this.C.events.flare.minStage && !b.plugin.cosmos.pending); }

    _announce(type) {
      this.ev.warn = { type, t: 0 };
      if (type === 'flare') {   // 対象の星を先に決め、予告の間に明るくする（render.js が描く）
        const ts = this._flareTargets();
        this.ev.warn.body = ts[Math.floor(this.random() * ts.length)];
      }
      this.emit('eventWarn', { type });
    }

    _cancelEvent() {
      const type = this.ev.warn && this.ev.warn.type;
      this.ev.warn = null; this.ev.timer = 0; this.ev.wait = null;
      this.emit('eventCancel', { type });
    }

    _beginEvent(type) {
      const E = this.C.events, B = this.C.board, M = this.M, rnd = this.random;
      const warnBody = this.ev.warn && this.ev.warn.body;
      this.ev.warn = null;
      let cur = null;
      if (type === 'flare') {
        const ts = this._flareTargets();
        if (ts.length) {
          const s = ts.includes(warnBody) ? warnBody : ts[Math.floor(rnd() * ts.length)], F = E.flare, tr = s.circleRadius, R = tr * F.rangeMul;
          for (const b of this.bodies()) {
            if (b === s) continue;
            const dx = b.position.x - s.position.x, dy = b.position.y - s.position.y, d = Math.hypot(dx, dy) || 1e-6;
            if (d >= R) continue;
            const k = F.push * Math.max(0, Math.min(1, 1 - (d - tr) / (R - tr)));
            const vy = dy / d * k;
            M.Body.setVelocity(b, { x: b.velocity.x + dx / d * k, y: b.velocity.y + (vy < 0 ? vy * F.upMul : vy) });
          }
          cur = { type, t: 0, dur: F.sec, x: s.position.x, y: s.position.y, r: tr, R, body: s };
        }
      } else if (type === 'comet') {
        const K = E.comet, left = rnd() < 0.5, bs = this.bodies();
        const x0 = left ? -K.margin : B.width + K.margin;
        const speed = (B.width + K.margin * 2) / (K.crossSec * 60);   // px/step
        let y0, vx, vy, target = null;
        if (this.state === 'PLAY' && bs.length) {
          // 左右の上の方から、山の重心（面積で重み付け）へ斜めに突っ込む
          let m = 0, cx = 0, cy = 0;
          for (const b of bs) { const a = b.circleRadius * b.circleRadius; m += a; cx += b.position.x * a; cy += b.position.y * a; }
          cx = cx / m + (rnd() - 0.5) * 2 * K.aimJitter; cy = cy / m + (rnd() - 0.5) * 2 * K.aimJitter;
          y0 = K.fromY[0] + rnd() * (K.fromY[1] - K.fromY[0]);
          const dx = cx - x0, dy = cy - y0, d = Math.hypot(dx, dy) || 1;
          vx = dx / d * speed; vy = dy / d * speed;
          target = { x: cx, y: cy };   // ここで跳ね返る
        } else {
          y0 = K.yRange[0] + rnd() * (K.yRange[1] - K.yRange[0]);
          const tilt = rnd() * K.tiltMax;
          vx = (left ? 1 : -1) * speed * Math.cos(tilt); vy = speed * Math.sin(tilt);
        }
        // すり抜ける物体（センサー）にして、当たった天体を1回だけ押す（押し続けると盤面が崩れすぎるため）
        const c = M.Bodies.circle(x0, y0, K.radius, {
          label: 'comet', isSensor: true, frictionAir: 0,
          collisionFilter: { category: 0x0004, mask: 0x0001, group: 0 }
        });
        M.Composite.add(this.engine.world, c);
        M.Body.setVelocity(c, { x: vx, y: vy });
        this.comet = { body: c, vx, vy, captured: false, hit: new Set(), target, bounced: false };
        cur = { type, t: 0, dur: K.maxSec };   // 画面の外へ出たら終わる（dur は念のための上限）
      } else if (type === 'meteor') {
        const K = E.meteor, n = K.count[0] + Math.floor(rnd() * (K.count[1] - K.count[0] + 1));
        cur = { type, t: 0, dur: K.sec + 0.5, n, done: 0, stage: this.spawnRange()[0] };
      } else if (type === 'storm') {
        const S = E.storm, deg = S.angleDeg[0] + rnd() * (S.angleDeg[1] - S.angleDeg[0]);
        // 向きは前の重力嵐の逆にして、左右交互にする（最初だけランダム。右向きばかりに感じたため。2026-10-31 作者の指示）
        this.stormSide = this.stormSide ? -this.stormSide : (rnd() < 0.5 ? -1 : 1);
        cur = { type, t: 0, dur: S.sec, ang: this.stormSide * deg * Math.PI / 180, k: 0 };   // 重力の傾きは _tickEvent で少しずつ
      } else if (type === 'wormhole') {
        const pos = this._wormholePlace();
        if (pos) cur = Object.assign({ type, t: 0, dur: E.wormhole.sec, r: E.wormhole.r }, pos);
      }
      if (!cur) { this.ev.timer = 0; this.ev.wait = null; this.emit('eventCancel', { type }); return; }
      this.ev.cur = cur;
      if (E.calm.types.includes(type)) this._startCalm();
      this.emit('eventStart', cur);
    }

    /** ゲームオーバーにしない猶予を始める（第14.5節）。イベントが終わってから、天体が落ち着くまで続く */
    _startCalm() {
      this.ev.calm = { still: 0, left: this.C.events.calm.maxSec };
      this.overTime = 0;
      if (this.warning) { this.warning = false; this.emit('warning', false); }
    }

    /** 猶予中なら true。揺さぶるイベントが続いている間は数えず、終わってから落ち着いたら（または maxSec で）解く */
    _calming(step) {
      const cl = this.ev.calm, K = this.C.events.calm, cur = this.ev.cur, warn = this.ev.warn;
      if (warn) return true;   // 予告中も数えない（予告したイベントが起こる前にゲームオーバーにしない）
      if (!cl) return false;
      if (cur && K.types.includes(cur.type)) return true;
      if (this.ev.slow > 0) return true;
      const G = this.C.gameOver;
      const moving = this.bodies().some(b => {
        const c = b.plugin.cosmos;
        if (c.dropped && this.time - c.born < G.settleAgeSec) return false;   // 落としたばかりの天体は見ない
        return Math.hypot(b.velocity.x, b.velocity.y) >= K.speed;
      });
      cl.still = moving ? 0 : cl.still + step;
      cl.left -= step;
      if (cl.still >= K.stillSec || cl.left <= 0) { this.ev.calm = null; return false; }
      return true;
    }

    _tickEvent(cur, step) {
      const E = this.C.events, B = this.C.board, M = this.M;
      if (cur.type === 'comet' && this.comet) {
        const K = E.comet, co = this.comet, c = co.body, h = this.bh;
        if (h && !co.captured && Math.hypot(h.x - c.position.x, h.y - c.position.y) < h.r * K.captureMul) co.captured = true;
        if (co.captured && h) {
          // ブラックホールに捕まった：向きを中心へ寄せながら速くして吸い込む（第14.4節）
          const dx = h.x - c.position.x, dy = h.y - c.position.y, d = Math.hypot(dx, dy) || 1e-6;
          const sp = Math.hypot(co.vx, co.vy) * 1.03;
          co.vx += (dx / d * sp - co.vx) * K.steer; co.vy += (dy / d * sp - co.vy) * K.steer;
          if (d < h.r * this.C.bh.absorbR) {
            M.Composite.remove(this.engine.world, c);
            this.absorbing.push({ comet: true, x: c.position.x, y: c.position.y, angle: Math.atan2(co.vy, co.vx), r: K.radius, t: 0 });
            h.pulse = 1;
            if (this.state === 'BH') h.food += K.growth;
            this.comet = null;
            this.emit('cometAbsorb', { x: h.x, y: h.y });
            cur.t = cur.dur;
            return;
          }
        }
        if (co.target && !co.bounced && !co.captured) {
          // 山の重心を通り過ぎたら跳ね返る。もう一度当たれるよう、押した天体の記録を消す
          if ((co.target.x - c.position.x) * co.vx + (co.target.y - c.position.y) * co.vy <= 0) {
            // 放物線の山が apexY に来る上向きの速さ：v = √(2 × 落ちる加速 × 上がる高さ)
            co.vx = Math.sign(co.vx) * K.bounceVx;
            co.vy = -Math.sqrt(2 * K.fall * Math.max(0, c.position.y - K.apexY));
            co.bounced = true; co.hit.clear();
            this.emit('cometBounce', { x: c.position.x, y: c.position.y });
          }
        } else if (co.bounced) co.vy += K.fall;           // 跳ね返ったあとは放物線で落ちる
        M.Body.setVelocity(c, { x: co.vx, y: co.vy });   // 当たっても向きを変えずに進む
        M.Body.setAngularVelocity(c, 0);
        const m = K.margin * 1.5;
        if (c.position.x < -m || c.position.x > B.width + m || c.position.y > B.height + m || c.position.y < -B.height) cur.t = cur.dur;
      } else if (cur.type === 'meteor') {
        const K = E.meteor;
        while (cur.done < cur.n && cur.t >= cur.done * K.sec / cur.n) {
          const r = this.radius(cur.stage), x = r + 10 + this.random() * (B.width - 2 * r - 20);
          const b = this._addBody(cur.stage, x, -r - 20);
          b.plugin.cosmos.dropped = true;
          b.plugin.cosmos.meteor = true;
          M.Body.setVelocity(b, { x: (this.random() - 0.5) * 2, y: K.startVy });
          cur.done++;
          this.emit('meteorSpawn', { stage: cur.stage, x });
        }
      } else if (cur.type === 'storm') {
        // 重力を斜め下へ傾ける。始めと終わりは rampSec かけて少しずつ
        const S = E.storm, k = Math.max(0, Math.min(1, cur.t / S.rampSec, (cur.dur - cur.t) / S.rampSec));
        const g = this.C.physics.gravityY * (1 + (S.gravityMul - 1) * k), a = cur.ang * k;
        cur.k = k;
        this.engine.gravity.x = Math.sin(a) * g;
        this.engine.gravity.y = Math.cos(a) * g;
      } else if (cur.type === 'wormhole') {
        const W = E.wormhole, A = W.area;
        // 2つの穴はゆっくり動き、範囲の端で跳ね返る。近づきすぎたら離れる向きに変える
        for (const h of [cur.a, cur.b]) {
          h.x += h.vx * step; h.y += h.vy * step;
          if (h.x < A.x[0] || h.x > A.x[1]) { h.vx = -h.vx; h.x = Math.max(A.x[0], Math.min(A.x[1], h.x)); }
          if (h.y < A.y[0] || h.y > A.y[1]) { h.vy = -h.vy; h.y = Math.max(A.y[0], Math.min(A.y[1], h.y)); }
        }
        const dx = cur.b.x - cur.a.x, dy = cur.b.y - cur.a.y, d = Math.hypot(dx, dy) || 1e-6;
        if (d < W.minDist) {
          const nx = dx / d, ny = dy / d;
          for (const [h, s] of [[cur.a, -1], [cur.b, 1]]) {
            const vn = h.vx * nx + h.vy * ny;
            if (vn * s < 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
          }
        }
        if (cur.t < W.openSec || cur.t > cur.dur - W.openSec) return;   // 開いている間だけ移す
        for (const b of this.bodies()) {
          const c = b.plugin.cosmos;
          const da = Math.hypot(b.position.x - cur.a.x, b.position.y - cur.a.y), db = Math.hypot(b.position.x - cur.b.x, b.position.y - cur.b.y);
          if (c.whIn) { if (da >= cur.r && db >= cur.r) c.whIn = false; continue; }   // 出た穴から離れるまでは戻さない
          if (c.pending || b.circleRadius > W.maxRadius || (c.whT != null && this.time - c.whT < W.cooldownSec)) continue;
          const to = da < cur.r ? cur.b : db < cur.r ? cur.a : null;
          if (!to || !this._roomAt(to.x, to.y, b.circleRadius, b)) continue;   // 出口がふさがっていたら移さない
          const from = { x: b.position.x, y: b.position.y };
          M.Body.setPosition(b, { x: to.x, y: to.y });
          c.whT = this.time; c.whIn = true;
          this.emit('warp', { from, to: { x: to.x, y: to.y }, stage: c.stage });
        }
      }
    }

    // 彗星に当たった天体を、進む向き（と彗星から離れる向き）に1回だけ押す。大きい天体ほど動きにくい
    _cometHits(pairs) {
      const co = this.comet, K = this.C.events.comet;
      if (!co) return;
      for (const p of pairs) {
        const b = p.bodyA === co.body ? p.bodyB : p.bodyB === co.body ? p.bodyA : null;
        if (!b || b.label !== 'body' || co.hit.has(b.id)) continue;
        co.hit.add(b.id);
        const sp = Math.hypot(co.vx, co.vy) || 1, dx = b.position.x - co.body.position.x, dy = b.position.y - co.body.position.y, d = Math.hypot(dx, dy) || 1;
        const k = K.push * Math.min(1, K.pushRef / b.circleRadius);
        this.M.Body.setVelocity(b, { x: b.velocity.x + (co.vx / sp * 0.7 + dx / d * 0.3) * k, y: b.velocity.y + (co.vy / sp * 0.7 + dy / d * 0.3) * k * (dy < 0 ? K.upMul : 1) });
        this.emit('cometHit', { x: b.position.x, y: b.position.y });
      }
    }

    /** (x, y) に半径 r の天体を置く余地があるか */
    _roomAt(x, y, r, self) {
      const B = this.C.board;
      if (x < r || x > B.width - r || y + r > B.height) return false;
      return this.bodies().every(o => o === self || Math.hypot(o.position.x - x, o.position.y - y) >= o.circleRadius + r);
    }

    // ワームホールの2つの穴（どちらもデッドラインより下の範囲 area の中）。それぞれゆっくり動く向きを持つ
    _wormholePlace() {
      const W = this.C.events.wormhole, A = W.area, rnd = this.random, span = (a) => a[0] + rnd() * (a[1] - a[0]);
      const hole = () => { const th = rnd() * Math.PI * 2; return { x: span(A.x), y: span(A.y), vx: Math.cos(th) * W.speed, vy: Math.sin(th) * W.speed }; };
      for (let i = 0; i < 40; i++) {
        const a = hole(), b = hole();
        if (Math.hypot(a.x - b.x, a.y - b.y) < W.minDist) continue;
        return { a, b };
      }
      return null;
    }

    _endEvent() {
      const cur = this.ev.cur;
      if (cur.type === 'storm') { this.engine.gravity.x = 0; this.engine.gravity.y = this.C.physics.gravityY; }
      if (cur.type === 'wormhole') this.bodies().forEach(b => { b.plugin.cosmos.whIn = false; });
      if (cur.type === 'comet' && this.comet) { this.M.Composite.remove(this.engine.world, this.comet.body); this.comet = null; }
      this.ev.cur = null; this.ev.timer = 0; this.ev.wait = null; this.ev.drops0 = this.dropCount;
      this.emit('eventEnd', { type: cur.type });
    }

    /** 予告中・発生中のイベントを止める（ブラックホール誕生・超巨大・タイトルへ など） */
    _stopEvents() {
      if (this.ev.cur) this._endEvent();
      if (this.ev.warn) this._cancelEvent();
      this.ev.timer = 0; this.ev.wait = null;
      this.ev.calm = null; this.ev.slow = 0;
    }

    // 惑星衝突（第14.3節）：木星以上の異なる天体どうしが速くぶつかったら、演出だけ出す
    _checkCollision(p, v) {
      const K = this.C.events.collision, a = p.bodyA, b = p.bodyB;
      if (this.state !== 'PLAY' || !this.eventsOn || v < K.minSpeed) return;
      if (a.label !== 'body' || b.label !== 'body') return;
      const sa = a.plugin.cosmos.stage, sb = b.plugin.cosmos.stage;
      if (sa === sb || sa < K.minStage || sb < K.minStage) return;
      if (this.time - this.ev.lastHit < K.cooldownSec) return;
      this.ev.lastHit = this.time;
      const ra = a.circleRadius, rb = b.circleRadius;
      // 当たった所：2つの中心を半径の比で分ける点
      const x = a.position.x + (b.position.x - a.position.x) * ra / (ra + rb), y = a.position.y + (b.position.y - a.position.y) * ra / (ra + rb);
      // 一瞬スローにし、2つを弾き離す（合体・得点のルールは変えない）。重い方ほど動きにくい
      const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y, d = Math.hypot(dx, dy) || 1e-6, ma = ra * ra, mb = rb * rb;
      this.M.Body.setVelocity(a, { x: a.velocity.x - dx / d * K.knock * 2 * mb / (ma + mb), y: a.velocity.y - dy / d * K.knock * 2 * mb / (ma + mb) });
      this.M.Body.setVelocity(b, { x: b.velocity.x + dx / d * K.knock * 2 * ma / (ma + mb), y: b.velocity.y + dy / d * K.knock * 2 * ma / (ma + mb) });
      this.ev.slow = K.slowSec;
      this._startCalm();
      this.emit('collision', { x, y, v, stages: [sa, sb] });
    }

    // ---- エンディング（第12章・第13章） ------------------------------------
    _enter(st) { this.endT = 0; this._ev = {}; this._setState(st); }

    /** 時刻 at を初めて過ぎたときだけ true（一度だけ起こすこと） */
    _once(key, at) {
      if (this._ev[key] || this.endT < at) return false;
      return (this._ev[key] = true);
    }

    // 最終吸収：残りの天体をすべて吸い込む。箱と UI のゆがみは ending.js が描く
    _updateFinal(step) {
      const E = this.C.ending;
      this.endT += step;
      if (this._once('walls', E.wallsAt[0])) {
        // 盤面の箱も吸い込まれ始めるので、壁と床の当たり判定を外す
        this.M.Composite.remove(this.engine.world, this.M.Composite.allBodies(this.engine.world).filter(b => b.isStatic));
      }
      if (this._once('sweep', E.sweepAt)) this.bodies().forEach(b => this._absorb(b));
      E.pulseAt.forEach((t, i) => { if (this._once('pulse' + i, t)) { this.bh.pulse = 1; this.emit('bhPulse', i); } });
      if (this.endT >= E.absorbSec && !this.absorbing.length) {
        this._finishScore();
        this.rollSkippable = this.clearCount > 0; // 一度クリアしたことがあればスキップできる（第3.2節）
        this.clearCount++;
        this.emit('clear', { count: this.clearCount, score: this.score, high: this.highScore, newRecord: this.newRecord, playTime: this.playTime });
        this._enter('SILENCE');
      }
    }

    _updateEnding(step) {
      const E = this.C.ending;
      this.endT += step;
      if (this.bh) this.bh.spin += step;
      if (this.state === 'SILENCE' && this.endT >= E.silenceSec) this._enter('BIGBANG');
      else if (this.state === 'BIGBANG') {
        if (this._once('flash', E.burstAt)) this.emit('bigbangFlash');
        if (this._once('music', E.musicAt)) this.emit('endingMusic');
        if (this.endT >= E.bigbangSec) this._enter('ENDROLL');
      } else if (this.state === 'ENDROLL' && !this.rollDone && this.endT >= this.rollSec) {
        this.rollDone = true;
        this.emit('rollDone');
      }
    }

    /** エンドロールを飛ばす（一度クリアしたことがあるときだけ。第3.2節） */
    skipRoll() {
      if (this.state === 'ENDROLL' && this.rollSkippable && !this.rollDone) this.endT = this.rollSec;
    }

    // ---- ゲームオーバー（第10章） -----------------------------------------
    _checkGameOver(step) {
      const G = this.C.gameOver, line = this.C.board.deadlineY;
      if (this._calming(step)) {   // 揺さぶるイベントの間と、落ち着くまでは数えない
        this.overTime = 0;
        if (this.warning) { this.warning = false; this.emit('warning', false); }
        return;
      }
      let over = false;
      for (const b of this.bodies()) {
        const c = b.plugin.cosmos;
        if (c.dropped && this.time - c.born < G.settleAgeSec) continue; // 落下中
        if (b.position.y - b.circleRadius < line) { over = true; break; }
      }
      this.overTime = over ? this.overTime + step : 0;
      const warn = this.overTime >= G.warnSec;
      if (warn !== this.warning) { this.warning = warn; this.emit('warning', warn); }
      if (this.overTime >= G.overSec) {
        this.state = 'GAMEOVER';
        this.warning = false;
        if (this.missileArmed) { this.missileArmed = false; this.emit('missileArm', false); }
        this._stopEvents();
        this._finishScore();
        this.emit('gameOver', { score: this.score, high: this.highScore, maxStage: this.maxStage, newRecord: this.newRecord });
        this.emit('state', this.state);
      }
    }

    _finishScore() {
      if (this.score > this.highScore) { this.highScore = this.score; this.newRecord = true; this.emit('highScore', this.highScore); }
    }

    // ---- ミサイル（easy だけ。2026-10-31 作者の指示） ------------------------
    // ミサイルを選んでから天体を選ぶと、その天体を1つ壊す。1回のゲームで missiles 発まで。通常期だけ使える
    get canMissile() { return this.state === 'PLAY' && this.missiles > 0 && !this.shot; }

    /** ミサイルを選ぶ／やめる（on を省くと切り替え） */
    armMissile(on) {
      const v = on == null ? !this.missileArmed : !!on;
      if (v && !this.canMissile) return false;
      if (v !== this.missileArmed) { this.missileArmed = v; this.emit('missileArm', v); }
      return true;
    }

    /** (x, y) の天体（盤面の座標）。少し外れていても近ければ選ぶ */
    bodyAt(x, y, slack) {
      let best = null, bd = Infinity;
      for (const b of this.bodies()) {
        if (b.plugin.cosmos.pending) continue;
        const d = Math.hypot(b.position.x - x, b.position.y - y) - b.circleRadius;
        if (d < (slack || 0) && d < bd) { best = b; bd = d; }
      }
      return best;
    }

    /** 選んだミサイルを (x, y) の天体へ撃つ。天体がなければ何もしない（選んだまま）。
     *  ミサイルは盤面の上の真ん中から flySec 秒で飛び込み（天体は下に積もっているので、下からだと見えないうちに当たる）、当たったら天体を壊す（その間、狙った天体は合体しない） */
    fireMissile(x, y) {
      if (!this.missileArmed || !this.canMissile || this.shot) return false;
      const b = this.bodyAt(x, y, 12);
      if (!b) return false;
      const B = this.C.board;
      b.plugin.cosmos.targeted = true;
      this.missiles--;
      this.missileArmed = false;
      this.emit('missileArm', false);
      this.shot = { body: b, t: 0, dur: this.C.missile.flySec, x0: B.width / 2, y0: -60, x: B.width / 2, y: -60, tx: b.position.x, ty: b.position.y };
      this.emit('missileFire', { left: this.missiles });
      return true;
    }

    // 飛んでいるミサイル：狙った天体の今の位置へ近づけ、着いたら壊す
    _updateShot(step) {
      const s = this.shot, b = s.body;
      s.t += step;
      const k = Math.min(1, s.t / s.dur), e = k * k;   // だんだん速く
      s.tx = b.position.x; s.ty = b.position.y;
      s.x = s.x0 + (s.tx - s.x0) * e; s.y = s.y0 + (s.ty - s.y0) * e;
      if (k < 1) return;
      this.shot = null;
      const alive = this.bodies().includes(b);
      if (alive) this.M.Composite.remove(this.engine.world, b);
      this.emit('missile', { x: s.tx, y: s.ty, r: b.circleRadius, stage: b.plugin.cosmos.stage, hit: alive, left: this.missiles });
    }

    // ---- デバッグ（第9.4節） ----------------------------------------------
    debugSpawn(stage, x) {
      if (!this.controllable) return;
      const b = this._addBody(stage, this.clampX(x == null ? this.aimX : x, stage), this.C.board.dropY);
      b.plugin.cosmos.dropped = true;
      this._noteStage(stage);
    }

    /** 誕生の演出を飛ばして BH 期へ（第9.4節） */
    debugToBH() {
      if (this.state !== 'PLAY') return;
      if (this.warning) { this.warning = false; this.emit('warning', false); }
      this.overTime = 0;
      this._spawnBH(this.C.bh.home.x, this.C.bh.home.y);
      this.score += this.C.stages[13].score;
      this._noteStage(13);
      this._setState('BH');
    }

    /** 特殊イベントをすぐ予告する（デバッグ）。確率と間隔は見ない。惑星衝突は一番大きい天体の所に演出だけ出す */
    debugEvent(type) {
      if (this.state !== 'PLAY' && this.state !== 'BH') return false;
      if (type === 'collision') {
        // 本当にぶつける：一番大きい天体へ、真上から別の段階の大きい天体を速く落とす（木星なら太陽、それ以外は木星）
        if (this.state !== 'PLAY') return false;
        const b = this.bodies().sort((p, q) => q.circleRadius - p.circleRadius)[0];
        if (!b || b.plugin.cosmos.stage < this.C.events.collision.minStage) return false;   // 木星以上がないとぶつけられない
        const st = b.plugin.cosmos.stage === this.C.events.collision.minStage ? 10 : 9;
        const j = this._addBody(st, this.clampX(b.position.x, st), this.C.board.dropY);
        j.plugin.cosmos.dropped = true;
        this._noteStage(st);
        this.M.Body.setVelocity(j, { x: 0, y: 16 });
        this.ev.lastHit = -1e9;   // 間隔の制限を外して確かめられるように
        return true;
      }
      if (type === 'flare' && !this._flareTargets().length && this.state === 'PLAY') {
        this.debugSpawn(10, this.C.board.width / 2);   // 太陽がなければ置いてから起こす
      }
      if (!this._eventTypes().includes(type) || !this._eventOk(type, true)) return false;
      this._stopEvents();
      this._announce(type);
      return true;
    }

    /** 成長値を足す（デバッグ） */
    debugGrow(v) { if (this.bh && this.state === 'BH') this._grow(v); }

    /** 超巨大まで一気に育てる（エンディングの確認用） */
    debugToEnding() {
      if (this.state === 'PLAY') this.debugToBH();
      if (this.state === 'BH') this._grow(this.C.bh.superGrowth - this.bh.growth);
    }
  }

  root.CosmosGame = CosmosGame;
  if (typeof module !== 'undefined') module.exports = CosmosGame;
})(typeof window !== 'undefined' ? window : globalThis);
